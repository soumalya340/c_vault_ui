use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::{Mint as TokenMint, Token, TokenAccount};
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{BaseStateWithExtensions, ExtensionType, PodStateWithExtensions},
    pod::PodMint,
    state::Mint as SplMint2022,
};
use anchor_spl::token_2022_extensions::metadata_pointer::{
    metadata_pointer_initialize, MetadataPointerInitialize,
};
use anchor_spl::token_interface::{token_metadata_initialize, TokenInterface, TokenMetadataInitialize};
use spl_pod::optional_keys::OptionalNonZeroPubkey;
use spl_token_metadata_interface::state::TokenMetadata;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::{AssetInfo, FundType, GlobalState, InitializeParams, Vault};

// ── Handler ───────────────────────────────────────────────────────────────────

/// Admin-only: create a new ETF fund vault, including its Token-2022 share
/// metadata, in a single transaction.
///
/// The new vault's id is always `global_state.total_vaults` (the latest id) —
/// PDA seeds are derived directly from that counter, so there is no
/// caller-supplied id to validate. After the vault is initialised,
/// `global_state.total_vaults` is incremented by 1.
///
/// `name`/`symbol`/`uri` set the Token-2022 inline metadata on the freshly
/// created share mint (formerly a separate `create_share_metadata`
/// instruction — merged here so both steps land in one transaction).
pub fn create_etf_handler(
    ctx: Context<CreateEtf>,
    params: InitializeParams,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    require!(
        !ctx.accounts.global_state.is_emergency,
        VaultError::EmergencyMode
    );
    require!(
        ctx.accounts
            .global_state
            .is_eligible_base_mint(&ctx.accounts.usdc_mint.key()),
        VaultError::BaseMintNotEligible
    );

    // ── Parameter validation ───────────────────────────────────────────────────
    let vault_id = ctx.accounts.global_state.total_vaults;
    require!(!params.assets.is_empty(), VaultError::NoAssets);
    require!(params.assets.len() <= MAX_ASSETS, VaultError::TooManyAssets);
    require!(params.performance_fee_bps <= 2000, VaultError::FeeTooHigh);

    let total_bps: u16 = params.assets.iter().map(|a| a.allocation_bps).sum();
    require!(total_bps == 10_000, VaultError::InvalidAllocation);

    let needs_sol_pool = params
        .assets
        .iter()
        .any(|a| a.route == crate::state::PoolRoute::ViaSol);
    require!(
        !needs_sol_pool || params.usdc_sol_pool.is_some(),
        VaultError::MissingUsdcSolPool
    );

    // ── Share mint creation (manual) ──────────────────────────────────────────
    // Anchor's `#[account(init, mint::…)]` macro can't declare the Token-2022
    // `MetadataPointer` extension on anchor-spl 0.31.0 (support landed in
    // 0.31.1), and extensions must be initialized *before* `InitializeMint2`.
    // So the mint is created by hand: allocate + assign, init the metadata
    // pointer (pointing at itself — the mint is its own metadata account),
    // then init the mint proper, then (below) init the metadata content.
    let vault_id_bytes = vault_id.to_le_bytes();
    let shares_mint_seeds: &[&[&[u8]]] =
        &[&[SHARES_MINT_SEED, &vault_id_bytes, &[ctx.bumps.shares_mint]]];

    let mint_space =
        ExtensionType::try_calculate_account_len::<SplMint2022>(&[ExtensionType::MetadataPointer])
            .map_err(|_| VaultError::MathOverflow)?;
    let mint_lamports = Rent::get()?.minimum_balance(mint_space);

    invoke_signed(
        &system_instruction::create_account(
            ctx.accounts.authority.key,
            ctx.accounts.shares_mint.key,
            mint_lamports,
            mint_space as u64,
            ctx.accounts.shares_token_program.key,
        ),
        &[
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.shares_mint.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        shares_mint_seeds,
    )?;

    let shares_mint_key = ctx.accounts.shares_mint.key();
    metadata_pointer_initialize(
        CpiContext::new_with_signer(
            ctx.accounts.shares_token_program.to_account_info(),
            MetadataPointerInitialize {
                token_program_id: ctx.accounts.shares_token_program.to_account_info(),
                mint: ctx.accounts.shares_mint.to_account_info(),
            },
            shares_mint_seeds,
        ),
        Some(shares_mint_key),
        Some(shares_mint_key),
    )?;

    invoke_signed(
        &spl_token_2022::instruction::initialize_mint2(
            ctx.accounts.shares_token_program.key,
            ctx.accounts.shares_mint.key,
            ctx.accounts.vault_authority.key,
            None,
            ctx.accounts.usdc_mint.decimals,
        )?,
        &[ctx.accounts.shares_mint.to_account_info()],
        shares_mint_seeds,
    )?;

    // ── Vault initialisation ──────────────────────────────────────────────────
    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;

    vault.vault_id = vault_id;
    vault.fee_recipient = params.fee_recipient.unwrap_or(ctx.accounts.authority.key());
    vault.vault_manager = ctx.accounts.authority.key();
    vault.paused = false;
    vault.base_mint = ctx.accounts.usdc_mint.key();
    vault.shares_mint = ctx.accounts.shares_mint.key();

    vault.performance_fee_bps = params.performance_fee_bps;

    vault.total_shares = 0;
    vault.total_usdc_value = 0;
    vault.ath_share_price = PRICE_SCALE;
    vault.rolling_high_price = PRICE_SCALE;
    vault.rolling_window_start = clock.unix_timestamp;
    vault.total_deposited = 0;
    vault.total_withdrawn = 0;

    vault.redeem_cooldown_secs = REDEEM_COOLDOWN_SECS;

    // ── Fund type + caps ──────────────────────────────────────────────────────
    // A Fixed vault must declare a positive share supply cap; a Dynamic vault is
    // always uncapped (any caller-supplied caps are ignored / cleared).
    vault.fund_type = params.fund_type;
    match params.fund_type {
        FundType::Fixed => {
            let max_shares = params.max_shares.ok_or(VaultError::MissingMaxShares)?;
            require!(max_shares > 0, VaultError::InvalidMaxShares);
            vault.max_shares = Some(max_shares);
        }
        FundType::Dynamic => {
            vault.max_shares = None;
        }
    }

    vault.usdc_sol_pool = params.usdc_sol_pool;
    vault.num_assets = params.assets.len() as u8;

    for (i, ap) in params.assets.iter().enumerate() {
        vault.assets[i] = AssetInfo {
            mint: ap.mint,
            pool_address: ap.pool_address,
            pyth_feed_id: ap.pyth_feed_id,
            allocation_bps: ap.allocation_bps,
            decimals: ap.decimals,
            route: ap.route,
        };
    }

    // ── Compute vault.sol_target_bps[] — fixed ratio, computed once ──────────
    // Ratio of each non-wSOL-native ViaSol asset's bps to the sum of all such
    // assets' bps. Immutable after this point; swap_sol_to_asset reads it directly.
    let via_sol_bps_sum: u32 = params
        .assets
        .iter()
        .filter(|a| a.route == crate::state::PoolRoute::ViaSol && a.mint != WSOL_MINT)
        .map(|a| a.allocation_bps as u32)
        .sum();

    if via_sol_bps_sum > 0 {
        for (i, ap) in params.assets.iter().enumerate() {
            if ap.route == crate::state::PoolRoute::ViaSol && ap.mint != WSOL_MINT {
                vault.sol_target_bps[i] =
                    ((ap.allocation_bps as u32) * 10_000 / via_sol_bps_sum) as u16;
            }
        }
    }

    vault.bump = ctx.bumps.vault;
    vault.authority_bump = ctx.bumps.vault_authority;
    vault.share_mint_bump = ctx.bumps.shares_mint;
    vault.usdc_vault_bump = ctx.bumps.usdc_vault;

    // ── GlobalState: bump vault counter (after vault is fully initialised) ─────
    let global_state = &mut ctx.accounts.global_state;
    global_state.total_vaults = global_state
        .total_vaults
        .checked_add(1)
        .ok_or(VaultError::MathOverflow)?;

    // ── Share Token-2022 metadata (formerly create_share_metadata) ────────────
    // The mint was allocated rent only for the MetadataPointer extension above;
    // the TokenMetadata TLV entry is variable-length, so top up rent before init.
    let shares_mint_info = ctx.accounts.shares_mint.to_account_info();

    let token_metadata = TokenMetadata {
        update_authority: OptionalNonZeroPubkey::try_from(Some(
            ctx.accounts.vault_authority.key(),
        ))?,
        mint: shares_mint_info.key(),
        name: name.clone(),
        symbol: symbol.clone(),
        uri: uri.clone(),
        ..Default::default()
    };

    let mint_data = shares_mint_info.try_borrow_data()?;
    let mint_state = PodStateWithExtensions::<PodMint>::unpack(&mint_data)?;
    let new_account_len = mint_state
        .try_get_new_account_len_for_variable_len_extension(&token_metadata)
        .map_err(|_| VaultError::MathOverflow)?;
    drop(mint_data);

    let rent = Rent::get()?;
    let new_minimum_balance = rent.minimum_balance(new_account_len);
    let additional_lamports = new_minimum_balance.saturating_sub(shares_mint_info.lamports());

    if additional_lamports > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: shares_mint_info.clone(),
                },
            ),
            additional_lamports,
        )?;
    }

    let authority_signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_AUTHORITY_SEED,
        &vault_id_bytes,
        &[ctx.bumps.vault_authority],
    ]];

    let cpi_accounts = TokenMetadataInitialize {
        program_id: ctx.accounts.shares_token_program.to_account_info(),
        mint: shares_mint_info.clone(),
        metadata: shares_mint_info,
        mint_authority: ctx.accounts.vault_authority.to_account_info(),
        update_authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.shares_token_program.to_account_info(),
        cpi_accounts,
        authority_signer_seeds,
    );

    token_metadata_initialize(cpi_ctx, name.clone(), symbol.clone(), uri.clone())?;

    emit!(ShareMetadataCreatedEvent {
        vault_id,
        vault_manager: ctx.accounts.authority.key(),
        name,
        symbol,
        uri,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "ETF created | vault_id: {} | assets: {} | fee_bps: {} | admin: {}",
        vault_id,
        vault.num_assets,
        vault.performance_fee_bps,
        ADMIN_PUBKEY,
    );
    Ok(())
}

// ── Account context ───────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CreateEtf<'info> {
    /// Program-wide singleton — must already be initialised via init_global_state.
    /// `total_vaults` is read here (pre-handler) to derive this vault's PDA seeds.
    #[account(
        mut,
        seeds = [GLOBAL_STATE_SEED],
        bump,
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    /// The new vault state PDA, keyed by the current global vault counter.
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, &global_state.total_vaults.to_le_bytes()],
        bump,
        space = ANCHOR_DISCRIMINATOR + Vault::INIT_SPACE,
    )]
    pub vault: Box<Account<'info, Vault>>,

    /// Per-vault PDA that signs CPIs on behalf of this vault.
    #[account(seeds = [VAULT_AUTHORITY_SEED, &global_state.total_vaults.to_le_bytes()], bump)]
    /// CHECK: program-derived signer — no data stored
    pub vault_authority: AccountInfo<'info>,

    /// Share (LP) token mint for this vault — Token-2022. Created manually in the
    /// handler (not via Anchor's `init` + `mint::…` macro) because the
    /// `MetadataPointer` extension must be initialized *before* `InitializeMint2`,
    /// and this workspace's anchor-spl (0.31.0) doesn't yet support declaring
    /// mint extensions through the account macro (added in 0.31.1).
    #[account(
        mut,
        seeds = [SHARES_MINT_SEED, &global_state.total_vaults.to_le_bytes()],
        bump,
    )]
    /// CHECK: uninitialized PDA — manually created + initialized as a Token-2022
    /// mint (with MetadataPointer extension) in the handler below.
    pub shares_mint: UncheckedAccount<'info>,

    /// USDC token account custodied by this vault.
    #[account(
        init,
        payer = authority,
        seeds = [USDC_VAULT_SEED, usdc_mint.key().as_ref(), &global_state.total_vaults.to_le_bytes()],
        bump,
        token::mint      = usdc_mint,
        token::authority = vault_authority,
    )]
    pub usdc_vault: Box<Account<'info, TokenAccount>>,

    /// The USDC mint (base currency for all deposits and redemptions).
    pub usdc_mint: Box<Account<'info, TokenMint>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    /// Token-2022 program — used for the share mint.
    pub shares_token_program: Interface<'info, TokenInterface>,
    /// Classic SPL Token program — used for the USDC vault account.
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[event]
pub struct ShareMetadataCreatedEvent {
    pub vault_id: u64,
    pub vault_manager: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub timestamp: i64,
}
