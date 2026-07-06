use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint as BaseMint, Token, TokenAccount, Transfer};
use anchor_spl::token_interface::{
    self, Mint, MintTo, TokenAccount as InterfaceTokenAccount, TokenInterface,
};

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::{GlobalState, UserInfo, Vault};
use crate::utils::ata::{read_token_amount, validate_asset_ata};
use crate::utils::calculate_nav::{compute_share_price, compute_shares_to_mint, sum_nav};
use crate::utils::cpi::fee_split::split_and_transfer_fees;

// ── Handler ───────────────────────────────────────────────────────────────────

/// Instruction A — deposit USDC and mint shares.
///
/// Sets vault.pending_usdc so that per-asset swap legs must follow in the same
/// transaction. The program enforces this via guards on those swap instructions.
///
/// For a `Fixed` vault sitting near its `max_shares` cap, a deposit that would
/// mint past the cap is not rejected: it is clamped down to exactly the
/// remaining share headroom, and only the proportional USDC needed for that
/// clamped share amount is pulled from the user.
///
///   Step 1: Guards
///   Step 2: Read pre-swap NAV from Pyth + current ATA balances
///   Step 3: Split platform + vault fees off usdc_amount; shares are priced and
///           minted against the net amount only (fee never enters the basket)
///   Step 4: Compute shares for the net requested amount
///   Step 5: Fixed-vault cap — clamp shares + net amount to remaining headroom
///   Step 6: Transfer gross USDC user → usdc_vault, then pay the two fee slices
///           out of usdc_vault to treasury_addr / fee_recipient
///   Step 7: Mint shares to user
///   Step 8: Update vault state + set pending_usdc + update UserInfo + emit event
pub fn deposit_handler(
    ctx: Context<Deposit>,
    vault_id: u64,
    usdc_amount: u64,
    min_shares_out: u64,
) -> Result<()> {
    // ── Step 1: Guards ────────────────────────────────────────────────────────
    require!(usdc_amount > 0, VaultError::ZeroAmount);
    require!(
        !ctx.accounts.global_state.deposit_disable,
        VaultError::DepositsDisabled
    );
    require!(!ctx.accounts.vault.paused, VaultError::VaultPaused);
    // Deposit no longer creates a per-user record; pending deployment is tracked
    // by vault-level aggregates. Concurrent deposits from the same user simply
    // add to those aggregates — there is no per-user lock to conflict on.
    if ctx.accounts.vault.total_shares == 0 {
        require!(
            ctx.accounts.user.key() == ADMIN_PUBKEY,
            VaultError::GenesisNotSeeded
        );
    }

    // ── Step 2: NAV from existing asset balances (pre-swap) ───────────────────
    // remaining_accounts = [asset ATAs..., price feeds...], each num_assets long,
    // ordered to match Vault.assets[0..num_assets].
    let num_assets = ctx.accounts.vault.num_assets as usize;

    for i in 0..num_assets {
        validate_asset_ata(
            &ctx.remaining_accounts[i],
            &ctx.accounts.vault.assets[i].mint,
        )?;
    }

    let clock = Clock::get()?;
    let authority_bump = ctx.accounts.vault.authority_bump;

    let mut pre_balances = [0u64; MAX_ASSETS];
    for i in 0..num_assets {
        pre_balances[i] = read_token_amount(&ctx.remaining_accounts[i])?;
    }

    let assets = &ctx.accounts.vault.assets[..num_assets];
    let total_shares = ctx.accounts.vault.total_shares;

    // ── Step 3: Split platform + vault fees off the gross requested amount ────
    // Shares are priced and minted against `net_usdc` only — the fee slices
    // never enter the basket, so no shareholder is diluted by them.
    let platform_fee = (usdc_amount as u128)
        .checked_mul(ctx.accounts.global_state.platform_fee_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)? as u64;
    let vault_fee = (usdc_amount as u128)
        .checked_mul(ctx.accounts.vault.performance_fee_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)? as u64;
    let net_usdc = usdc_amount
        .checked_sub(platform_fee)
        .ok_or(VaultError::MathOverflow)?
        .checked_sub(vault_fee)
        .ok_or(VaultError::MathOverflow)?;
    require!(net_usdc > 0, VaultError::ZeroAmount);

    // ── Step 4: Shares for the net requested amount ───────────────────────────
    let shares_to_mint = compute_shares_to_mint(
        assets,
        ctx.remaining_accounts,
        num_assets,
        &pre_balances[..num_assets],
        total_shares,
        net_usdc,
    )?;
    require!(shares_to_mint > 0, VaultError::ZeroAmount);

    // ── Step 5: Fixed-vault supply cap — partial fill ──────────────────────────
    // If the full request would mint past max_shares, clamp shares down to the
    // remaining headroom and scale net_usdc down to match — instead of
    // rejecting the deposit outright. Dynamic vaults (max_shares == None) are
    // never clamped. Genesis deposit (total_shares == 0) can't be clamped by
    // this formula (no NAV/price yet), so it is left untouched — the cap still
    // applies via the plain overflow check below. Clamping scales `usdc_amount`
    // (gross) down proportionally so fees stay in sync with what actually gets
    // deployed.
    let (usdc_amount, net_usdc, shares_to_mint) = match ctx.accounts.vault.max_shares {
        Some(max_shares)
            if total_shares > 0 && total_shares.saturating_add(shares_to_mint) > max_shares =>
        {
            let remaining_shares = max_shares
                .checked_sub(total_shares)
                .ok_or(VaultError::ShareCapExceeded)?;
            require!(remaining_shares > 0, VaultError::ShareCapExceeded);

            // Inverse of compute_shares_to_mint: usdc = shares × total_nav / total_shares.
            let total_nav = sum_nav(
                assets,
                ctx.remaining_accounts,
                num_assets,
                &pre_balances[..num_assets],
            )?;
            let clamped_net_usdc = (remaining_shares as u128)
                .checked_mul(total_nav as u128)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(total_shares as u128)
                .ok_or(VaultError::MathOverflow)? as u64;
            require!(clamped_net_usdc > 0, VaultError::ZeroAmount);

            // Scale gross usdc_amount down by the same ratio the net amount was
            // clamped by, so the fee split stays proportionally consistent.
            let clamped_gross = (clamped_net_usdc as u128)
                .checked_mul(usdc_amount as u128)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(net_usdc as u128)
                .ok_or(VaultError::MathOverflow)? as u64;

            (clamped_gross, clamped_net_usdc, remaining_shares)
        }
        Some(max_shares) => {
            let projected = total_shares
                .checked_add(shares_to_mint)
                .ok_or(VaultError::MathOverflow)?;
            require!(projected <= max_shares, VaultError::ShareCapExceeded);
            (usdc_amount, net_usdc, shares_to_mint)
        }
        None => (usdc_amount, net_usdc, shares_to_mint),
    };

    require!(
        shares_to_mint >= min_shares_out,
        VaultError::SlippageExceeded
    );

    // ── Step 6: Transfer gross USDC user → usdc_vault, then pay fee slices out ─
    token::transfer(
        CpiContext::new(
            ctx.accounts.base_token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_usdc_account.to_account_info(),
                to: ctx.accounts.usdc_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        usdc_amount,
    )?;

    let fee_split = split_and_transfer_fees(
        &ctx.accounts.base_token_program,
        &ctx.accounts.usdc_vault,
        &ctx.accounts.vault_authority,
        &[&[
            VAULT_AUTHORITY_SEED,
            &vault_id.to_le_bytes(),
            &[authority_bump],
        ]],
        &ctx.accounts.treasury_usdc_account,
        Some(&ctx.accounts.fee_recipient_usdc_account),
        usdc_amount,
        ctx.accounts.global_state.platform_fee_bps,
        ctx.accounts.vault.performance_fee_bps,
    )?;
    // net_usdc (used for share pricing above) and fee_split.net_amount must
    // agree — both are derived from the same (possibly clamped) usdc_amount.
    debug_assert_eq!(fee_split.net_amount, net_usdc);

    // ── Step 7: Mint shares to user (Token-2022 share mint) ───────────────────
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.user_share_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[&[
                VAULT_AUTHORITY_SEED,
                &vault_id.to_le_bytes(),
                &[authority_bump],
            ]],
        ),
        shares_to_mint,
    )?;

    // ── Step 8: Update state ──────────────────────────────────────────────────
    let vault = &mut ctx.accounts.vault;
    vault.total_shares = vault
        .total_shares
        .checked_add(shares_to_mint)
        .ok_or(VaultError::MathOverflow)?;
    vault.total_usdc_value = vault
        .total_usdc_value
        .checked_add(net_usdc)
        .ok_or(VaultError::MathOverflow)?;
    vault.total_deposited = vault
        .total_deposited
        .checked_add(net_usdc)
        .ok_or(VaultError::MathOverflow)?;

    let share_price = compute_share_price(vault.total_usdc_value, vault.total_shares)?;
    vault.update_high_prices(share_price, clock.unix_timestamp, ROLLING_WINDOW_SECS);

    // ── Classify each asset slot → write vault-level pending aggregates ────────
    // Option A: each DirectUsdc and non-wSOL-native ViaSol asset's USDC slice is
    // stored in vault.usdc_target_amount[i]. The wSOL-native ViaSol slice is added
    // to total_pending_usdc only (it has no second-hop target). sol_target_bps[] is
    // already set in create_etf and is not touched here. Sized off net_usdc — the
    // fee slices already left usdc_vault and are never deployed into the basket.
    for i in 0..num_assets {
        let asset = &vault.assets[i];
        let slice_usdc = (net_usdc as u128)
            .checked_mul(asset.allocation_bps as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(10_000)
            .ok_or(VaultError::MathOverflow)? as u64;

        if asset.mint == vault.base_mint {
            // USDC-native: funds already sit in usdc_vault; nothing pending.
            continue;
        }

        if asset.route == crate::state::PoolRoute::ViaSol && asset.mint == WSOL_MINT {
            // wSOL-native ViaSol: needs the USDC->wSOL hop, but no second-hop
            // asset target — tracked in total_pending_usdc only.
            vault.total_pending_usdc = vault
                .total_pending_usdc
                .checked_add(slice_usdc)
                .ok_or(VaultError::MathOverflow)?;
        } else {
            // DirectUsdc non-native, OR non-wSOL-native ViaSol: store per-asset.
            vault.usdc_target_amount[i] = vault.usdc_target_amount[i]
                .checked_add(slice_usdc)
                .ok_or(VaultError::MathOverflow)?;
            vault.total_pending_usdc = vault
                .total_pending_usdc
                .checked_add(slice_usdc)
                .ok_or(VaultError::MathOverflow)?;
        }
    }

    // ── UserInfo ──────────────────────────────────────────────────────────────
    let info = &mut ctx.accounts.user_info;
    info.user = ctx.accounts.user.key();
    info.total_usdc_deposited = info
        .total_usdc_deposited
        .checked_add(usdc_amount)
        .ok_or(VaultError::MathOverflow)?;
    info.last_usdc_deposited = usdc_amount;
    info.last_shares_minted = shares_to_mint;
    info.last_deposit_ts = clock.unix_timestamp;

    emit!(DepositEvent {
        user: ctx.accounts.user.key(),
        usdc_amount,
        net_usdc,
        platform_fee: fee_split.platform_fee,
        vault_fee: fee_split.vault_fee,
        shares_minted: shares_to_mint,
        share_price,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ── Accounts ──────────────────────────────────────────────────────────────────

/// `remaining_accounts` must be exactly `num_assets × 2` accounts:
/// `[asset_ata_0..asset_ata_N, price_feed_0..price_feed_N]`, both ordered to
/// match `Vault.assets[0..num_assets]`.
#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct Deposit<'info> {
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump,
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        mut,
        seeds = [VAULT_SEED, &vault_id.to_le_bytes()],
        bump  = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        constraint = base_mint.key() == vault.base_mint @ VaultError::InvalidMint,
    )]
    pub base_mint: Box<Account<'info, BaseMint>>,

    #[account(
        seeds = [VAULT_AUTHORITY_SEED, &vault_id.to_le_bytes()],
        bump  = vault.authority_bump,
    )]
    /// CHECK: PDA — token mint authority
    pub vault_authority: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [USDC_VAULT_SEED, vault.base_mint.as_ref(), &vault_id.to_le_bytes()],
        bump  = vault.usdc_vault_bump,
        token::mint      = vault.base_mint,
        token::authority = vault_authority,
    )]
    pub usdc_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [SHARES_MINT_SEED, &vault_id.to_le_bytes()],
        bump  = vault.share_mint_bump,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = vault.base_mint,
        token::authority = user,
        token::token_program = base_token_program,
    )]
    pub user_usdc_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = share_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_share_account: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// Token-2022 program (for c_vault share mint / burn / transfers).
    pub token_program: Interface<'info, TokenInterface>,
    /// Classic SPL Token program (for USDC transfers).
    pub base_token_program: Program<'info, Token>,

    // ── UserInfo ──────────────────────────────────────────────────────────────
    /// One PDA per (vault, user) — created on this user's first deposit into
    /// this vault, reused (accumulated) on every deposit after that.
    #[account(
        init_if_needed,
        payer = user,
        seeds = [USER_INFO_SEED, vault.key().as_ref(), user.key().as_ref()],
        bump,
        space = ANCHOR_DISCRIMINATOR + UserInfo::INIT_SPACE,
    )]
    pub user_info: Box<Account<'info, UserInfo>>,

    // ── Fee payout ATAs (created idempotently, paid for by the depositor) ────
    /// CHECK: treasury wallet — USDC ATA authority only.
    #[account(address = global_state.treasury_addr)]
    pub treasury: AccountInfo<'info>,

    /// CHECK: vault performance-fee recipient — USDC ATA authority only.
    #[account(address = vault.fee_recipient)]
    pub fee_recipient: AccountInfo<'info>,

    /// Platform fee slice destination — treasury's USDC ATA.
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
        associated_token::token_program = base_token_program,
    )]
    pub treasury_usdc_account: Box<Account<'info, TokenAccount>>,

    /// Vault fee slice destination — vault's fee_recipient USDC ATA.
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = base_mint,
        associated_token::authority = fee_recipient,
        associated_token::token_program = base_token_program,
    )]
    pub fee_recipient_usdc_account: Box<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct DepositEvent {
    pub user: Pubkey,
    pub usdc_amount: u64,
    pub net_usdc: u64,
    pub platform_fee: u64,
    pub vault_fee: u64,
    pub shares_minted: u64,
    pub share_price: u64,
    pub timestamp: i64,
}
