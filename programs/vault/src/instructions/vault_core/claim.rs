use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint as BaseMint, Token, TokenAccount, Transfer};

use std::boxed::Box;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::{GlobalState, RedeemState, Vault};
use crate::utils::cpi::fee_split::split_and_transfer_fees;

// ── Handler ───────────────────────────────────────────────────────────────────

/// Instruction 3 of 3 — split off the platform fee, transfer the remaining
/// USDC to the user, and close RedeemState.
///
/// `pending_usdc` already had the vault's performance fee deducted per-asset
/// during the redeem swaps (`swap_asset_to_usdc` / `swap_sol_to_usdc`) — only
/// the platform fee is split here.
///
///   Step 1: Guards
///   Step 2: Split platform fee usdc_vault → treasury, transfer remainder → user
///   Step 3: RedeemState closes (rent back to user via close = user constraint)
///   Step 4: Emit event
pub fn claim_handler(ctx: Context<Claim>, vault_id: u64) -> Result<()> {
    let clock = Clock::get()?;
    let pending_usdc = ctx.accounts.redeem_state.pending_usdc;

    // ── Step 1: Guards ────────────────────────────────────────────────────────
    require!(pending_usdc > 0, VaultError::NothingToClaim);
    require!(
        clock.unix_timestamp >= ctx.accounts.redeem_state.unlock_time,
        VaultError::TooEarlyRedeem
    );

    let authority_bump = ctx.accounts.vault.authority_bump;
    let signer_seeds: &[&[&[u8]]] =
        &[&[VAULT_AUTHORITY_SEED, &vault_id.to_le_bytes(), &[authority_bump]]];

    // ── Step 2: Split platform fee, then pay the user ─────────────────────────
    let fee_split = split_and_transfer_fees(
        &ctx.accounts.token_program,
        &ctx.accounts.usdc_vault,
        &ctx.accounts.vault_authority,
        signer_seeds,
        &ctx.accounts.treasury_usdc_account,
        None, // vault fee already deducted upstream, per-asset, during redeem
        pending_usdc,
        ctx.accounts.global_state.platform_fee_bps,
        0,
    )?;

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.usdc_vault.to_account_info(),
                to: ctx.accounts.user_usdc_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        fee_split.net_amount,
    )?;

    // Step 3: RedeemState closes automatically via `close = user` on the account constraint.

    // ── Step 4: Emit event ────────────────────────────────────────────────────
    emit!(ClaimEvent {
        user: ctx.accounts.user.key(),
        gross_usdc: pending_usdc,
        platform_fee: fee_split.platform_fee,
        usdc_amount: fee_split.net_amount,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Claim: {} USDC → {} (platform fee: {})",
        fee_split.net_amount,
        ctx.accounts.user.key(),
        fee_split.platform_fee
    );

    Ok(())
}

// ── Accounts ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct Claim<'info> {
    #[account(
        seeds = [GLOBAL_STATE_SEED],
        bump,
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(
        seeds = [VAULT_SEED, &vault_id.to_le_bytes()],
        bump  = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        constraint = base_mint.key() == vault.base_mint @ VaultError::InvalidMint,
    )]
    pub base_mint: Account<'info, BaseMint>,

    #[account(
        seeds = [VAULT_AUTHORITY_SEED, &vault_id.to_le_bytes()],
        bump  = vault.authority_bump,
    )]
    /// CHECK: PDA — token transfer authority
    pub vault_authority: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [REDEEM_SEED, user.key().as_ref(), &vault_id.to_le_bytes()],
        bump  = redeem_state.bump,
        close = user,
    )]
    pub redeem_state: Box<Account<'info, RedeemState>>,

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
        token::mint = vault.base_mint,
    )]
    pub user_usdc_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: treasury wallet — USDC ATA authority only.
    #[account(address = global_state.treasury_addr)]
    pub treasury: AccountInfo<'info>,

    /// Platform fee slice destination — treasury's USDC ATA.
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = base_mint,
        associated_token::authority = treasury,
        associated_token::token_program = token_program,
    )]
    pub treasury_usdc_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct ClaimEvent {
    pub user: Pubkey,
    pub gross_usdc: u64,
    pub platform_fee: u64,
    pub usdc_amount: u64,
    pub timestamp: i64,
}
