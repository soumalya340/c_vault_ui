use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount as InterfaceTokenAccount, TokenInterface};

use std::boxed::Box;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::{GlobalState, RedeemState, Vault};
use crate::utils::ata::{read_token_amount, validate_asset_ata};
use crate::utils::calculate_swap_amounts::compute_redeem_swap_amounts;

// ── Handler ───────────────────────────────────────────────────────────────────

/// Instruction 1 of 3 — burn shares, snapshot the per-asset swap amounts, and
/// start the cooldown.
///
/// The redeemer's slice of the vault is a flat percentage of the pool (the same
/// proportion NAV uses): `floor(pool_balance[i] × shares / total_shares)`. Those
/// amounts are computed here from the current vault asset balances and frozen
/// into `RedeemState.asset_amount_in[i]`, so the later per-asset swap
/// instructions can be driven straight from storage.
///
/// The vault's asset ATAs are supplied via `remaining_accounts`, one per active
/// asset, in the same order as `Vault.assets[0..num_assets]`.
///
///   Step 1: Guards
///   Step 2: Snapshot per-asset swap amounts (pre-burn supply)
///   Step 3: Burn share tokens
///   Step 4: Update vault state
///   Step 5: Write RedeemState
///   Step 6: Emit event
pub fn request_redeem_handler(
    ctx: Context<RequestRedeem>,
    vault_id: u64,
    shares: u64,
) -> Result<()> {
    // ── Step 1: Guards ────────────────────────────────────────────────────────
    require!(shares > 0, VaultError::ZeroAmount);
    require!(!ctx.accounts.global_state.is_emergency, VaultError::EmergencyMode);
    require!(
        ctx.accounts.user_share_account.amount >= shares,
        VaultError::InsufficientShares
    );
    require!(
        ctx.accounts.redeem_state.pending_usdc == 0,
        VaultError::RedeemAlreadyPending
    );

    let clock = Clock::get()?;
    let authority_bump = ctx.accounts.vault.authority_bump;
    let total_shares = ctx.accounts.vault.total_shares;

    // ── Step 2: Snapshot per-asset swap amounts (against pre-burn supply) ──────
    // remaining_accounts = vault asset ATAs, one per active asset, ordered to
    // match Vault.assets[0..num_assets].
    let num_assets = ctx.accounts.vault.num_assets as usize;
    require!(
        ctx.remaining_accounts.len() == num_assets,
        VaultError::InvalidAccountsLength
    );

    let mut pool_balances = [0u64; MAX_ASSETS];
    for i in 0..num_assets {
        let ata = &ctx.remaining_accounts[i];
        validate_asset_ata(ata, &ctx.accounts.vault.assets[i].mint)?;
        pool_balances[i] = read_token_amount(ata)?;
    }

    let asset_amount_in = compute_redeem_swap_amounts(
        &pool_balances,
        num_assets,
        shares,
        total_shares,
    )?;

    // ── Step 3: Burn share tokens (Token-2022) ────────────────────────────────
    token_interface::burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.shares_mint.to_account_info(),
                from: ctx.accounts.user_share_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[&[VAULT_AUTHORITY_SEED, &vault_id.to_le_bytes(), &[authority_bump]]],
        ),
        shares,
    )?;

    // ── Step 4: Update vault state ────────────────────────────────────────────
    let vault = &mut ctx.accounts.vault;

    // Approximate proportional USDC value removed — corrected by update_vault_value bot.
    let usdc_approx = (vault.total_usdc_value as u128)
        .checked_mul(shares as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(total_shares as u128)
        .ok_or(VaultError::MathOverflow)? as u64;

    vault.total_shares = vault
        .total_shares
        .checked_sub(shares)
        .ok_or(VaultError::MathOverflow)?;
    vault.total_usdc_value = vault.total_usdc_value.saturating_sub(usdc_approx);

    // ── Step 5: Write RedeemState ─────────────────────────────────────────────
    let redeem_state = &mut ctx.accounts.redeem_state;
    redeem_state.bump = ctx.bumps.redeem_state;
    redeem_state.redeemable_shares = shares;
    redeem_state.unlock_time = clock.unix_timestamp + ctx.accounts.vault.redeem_cooldown_secs;
    redeem_state.pending_usdc = 0;
    redeem_state.num_assets = num_assets as u8;
    redeem_state.asset_amount_in = asset_amount_in;
    redeem_state.asset_swapped = [false; MAX_ASSETS];
    redeem_state.asset_usdc_out = [0u64; MAX_ASSETS];

    // ── Step 6: Emit event ────────────────────────────────────────────────────
    emit!(RequestRedeemEvent {
        user: ctx.accounts.user.key(),
        shares_burned: shares,
        unlock_time: redeem_state.unlock_time,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ── Accounts ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct RequestRedeem<'info> {
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump,
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(
        mut,
        seeds = [VAULT_SEED, &vault_id.to_le_bytes()],
        bump  = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        seeds = [VAULT_AUTHORITY_SEED, &vault_id.to_le_bytes()],
        bump  = vault.authority_bump,
    )]
    /// CHECK: PDA — token mint authority
    pub vault_authority: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [SHARES_MINT_SEED, &vault_id.to_le_bytes()],
        bump  = vault.share_mint_bump,
    )]
    pub shares_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = shares_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_share_account: InterfaceAccount<'info, InterfaceTokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        seeds = [REDEEM_SEED, user.key().as_ref(), &vault_id.to_le_bytes()],
        bump,
        space = ANCHOR_DISCRIMINATOR + RedeemState::INIT_SPACE,
    )]
    pub redeem_state: Box<Account<'info, RedeemState>>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// Token-2022 program (for c_vault share burn).
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct RequestRedeemEvent {
    pub user: Pubkey,
    pub shares_burned: u64,
    pub unlock_time: i64,
    pub timestamp: i64,
}
