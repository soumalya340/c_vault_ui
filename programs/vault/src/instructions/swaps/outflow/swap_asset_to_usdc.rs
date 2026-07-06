use anchor_lang::prelude::*;
use anchor_spl::token::Token;

use std::boxed::Box;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::{RedeemState, Vault};
use crate::utils::whirlpool_cpi::anchor_orca_swap;

/// Swap a single vault asset → USDC directly via an Asset/USDC Whirlpool pool (no wSOL hop).
/// Used during the redeem flow for assets whose `route == DirectUsdc`.
///
/// `asset_index` is the slot index inside `Vault.assets[]` for the asset being swapped.
/// The input amount is read from `RedeemState.asset_amount_in[asset_index]` — the
/// proportional slice snapshotted at `request_redeem` — so the caller does not
/// re-derive it. Each asset may only be swapped once per redeem; the
/// `asset_swapped[asset_index]` flag acts as an idempotency guard. Net USDC is
/// accumulated into `pending_usdc` so multi-asset redeems can call this once per
/// asset before calling `claim`.
pub fn swap_asset_to_usdc_handler(
    ctx: Context<SwapAssetToUsdc>,
    vault_id: u64,
    asset_index: u8,
    min_usdc_out: u64,
    a_to_b: bool,
) -> Result<()> {
    let idx = asset_index as usize;
    require!(idx < ctx.accounts.vault.num_assets as usize, VaultError::InvalidAccountsLength);

    let redeem_state = &ctx.accounts.redeem_state;
    require!(
        Clock::get()?.unix_timestamp >= redeem_state.unlock_time,
        VaultError::TooEarlyRedeem
    );
    require!(redeem_state.redeemable_shares > 0, VaultError::ZeroAmount);
    require!(!redeem_state.asset_swapped[idx], VaultError::AssetAlreadySwapped);

    // Input amount was snapshotted at request_redeem time.
    let asset_amount = redeem_state.asset_amount_in[idx];
    require!(asset_amount > 0, VaultError::ZeroAmount);

    let bump = ctx.accounts.vault.authority_bump;
    let usdc_before = ctx.accounts.usdc_vault.amount;

    anchor_orca_swap(
        &ctx.accounts.whirlpool_program.to_account_info(),
        &[
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.vault_authority.to_account_info(),
            ctx.accounts.whirlpool.to_account_info(),
            ctx.accounts.token_owner_account_a.to_account_info(),
            ctx.accounts.token_vault_a.to_account_info(),
            ctx.accounts.token_owner_account_b.to_account_info(),
            ctx.accounts.token_vault_b.to_account_info(),
            ctx.accounts.tick_array_0.to_account_info(),
            ctx.accounts.tick_array_1.to_account_info(),
            ctx.accounts.tick_array_2.to_account_info(),
            ctx.accounts.oracle.to_account_info(),
        ],
        vault_id,
        bump,
        asset_amount,
        min_usdc_out,
        a_to_b,
    )?;

    ctx.accounts.usdc_vault.reload()?;
    let gross_usdc = ctx.accounts.usdc_vault.amount.saturating_sub(usdc_before);

    let fee_bps = ctx.accounts.vault.performance_fee_bps as u128;
    let fee = (gross_usdc as u128)
        .checked_mul(fee_bps)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)? as u64;
    let net_usdc = gross_usdc.checked_sub(fee).ok_or(VaultError::MathOverflow)?;

    let state = &mut ctx.accounts.redeem_state;
    state.asset_swapped[idx] = true;
    state.asset_usdc_out[idx] = net_usdc;
    state.pending_usdc = state
        .pending_usdc
        .checked_add(net_usdc)
        .ok_or(VaultError::MathOverflow)?;

    emit!(SwapAssetToUsdcEvent {
        user: ctx.accounts.user.key(),
        asset_index,
        asset_in: asset_amount,
        gross_usdc,
        fee,
        net_usdc,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct SwapAssetToUsdc<'info> {
    #[account(seeds = [VAULT_SEED, &vault_id.to_le_bytes()], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,

    #[account(seeds = [VAULT_AUTHORITY_SEED, &vault_id.to_le_bytes()], bump = vault.authority_bump)]
    /// CHECK: PDA — swap signer
    pub vault_authority: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [REDEEM_SEED, user.key().as_ref(), &vault_id.to_le_bytes()],
        bump  = redeem_state.bump,
    )]
    pub redeem_state: Box<Account<'info, RedeemState>>,

    #[account(
        mut,
        seeds = [USDC_VAULT_SEED, vault.base_mint.as_ref(), &vault_id.to_le_bytes()],
        bump  = vault.usdc_vault_bump,
        token::mint      = vault.base_mint,
        token::authority = vault_authority,
    )]
    pub usdc_vault: Box<Account<'info, anchor_spl::token::TokenAccount>>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,

    /// CHECK: Orca Whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    /// CHECK: Asset/USDC pool state.
    #[account(mut)] pub whirlpool: UncheckedAccount<'info>,
    /// CHECK: token owner account A.
    #[account(mut)] pub token_owner_account_a: UncheckedAccount<'info>,
    /// CHECK: token vault A.
    #[account(mut)] pub token_vault_a: UncheckedAccount<'info>,
    /// CHECK: token owner account B.
    #[account(mut)] pub token_owner_account_b: UncheckedAccount<'info>,
    /// CHECK: token vault B.
    #[account(mut)] pub token_vault_b: UncheckedAccount<'info>,
    /// CHECK: tick array 0.
    #[account(mut)] pub tick_array_0: UncheckedAccount<'info>,
    /// CHECK: tick array 1.
    #[account(mut)] pub tick_array_1: UncheckedAccount<'info>,
    /// CHECK: tick array 2.
    #[account(mut)] pub tick_array_2: UncheckedAccount<'info>,
    /// CHECK: oracle PDA.
    pub oracle: UncheckedAccount<'info>,
}

#[event]
pub struct SwapAssetToUsdcEvent {
    pub user: Pubkey,
    pub asset_index: u8,
    pub asset_in: u64,
    pub gross_usdc: u64,
    pub fee: u64,
    pub net_usdc: u64,
    pub timestamp: i64,
}
