use anchor_lang::prelude::*;

use crate::constants::{GLOBAL_STATE_SEED, MAX_ASSETS, VAULT_SEED};
use crate::errors::VaultError;
use crate::state::{GlobalState, Vault};
use crate::utils::ata::{read_token_amount, validate_asset_ata};
use crate::utils::calculate_nav::compute_total_nav;
use crate::utils::calculate_swap_amounts::compute_redeem_swap_amounts;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PreviewRedeemResult {
    /// Number of active assets in `asset_amounts`.
    pub num_assets: u8,
    /// Proportional token amounts the user would be owed, indexed to match
    /// `Vault.assets[0..num_assets]`. Unused slots are zero.
    pub asset_amounts: [u64; MAX_ASSETS],
    /// Oracle-priced USDC value of those assets (6 decimals) — gross, before
    /// either fee slice, i.e. what the redeemed basket is worth right now.
    pub estimated_usdc_value: u64,
    /// Outstanding shares at time of quote.
    pub total_shares: u64,
    /// Vault performance fee slice — deducted per-asset during the redeem
    /// swaps, before `pending_usdc` is ever set. Estimated here off the
    /// gross oracle value since the real swaps haven't run yet.
    pub vault_fee: u64,
    /// Platform fee slice — deducted at `claim` time from `pending_usdc`.
    pub platform_fee: u64,
    /// Estimate of what `claim` would actually pay out to the user, i.e.
    /// `estimated_usdc_value - vault_fee - platform_fee`.
    pub estimated_net_usdc: u64,
}

/// `remaining_accounts` must be exactly `num_assets × 2` accounts:
/// `[asset_ata_0..asset_ata_N, price_feed_0..price_feed_N]`, both ordered to
/// match `Vault.assets[0..num_assets]`.
#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct PreviewRedeem<'info> {
    #[account(seeds = [GLOBAL_STATE_SEED], bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(seeds = [VAULT_SEED, &vault_id.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
}

/// Read-only quote: what would burning `shares` return right now?
/// Mirrors `request_redeem_handler`'s proportional split, then prices the
/// resulting asset amounts with live Pyth feeds for a USDC estimate.
pub fn preview_redeem_handler(
    ctx: Context<PreviewRedeem>,
    _vault_id: u64,
    shares: u64,
) -> Result<PreviewRedeemResult> {
    require!(shares > 0, VaultError::ZeroAmount);

    let total_shares = ctx.accounts.vault.total_shares;
    require!(total_shares > 0, VaultError::ZeroAmount);
    require!(shares <= total_shares, VaultError::InsufficientShares);

    let num_assets = ctx.accounts.vault.num_assets as usize;

    let assets = &ctx.accounts.vault.assets[..num_assets];
    let mut pool_balances = [0u64; MAX_ASSETS];
    for i in 0..num_assets {
        validate_asset_ata(&ctx.remaining_accounts[i], &assets[i].mint)?;
        pool_balances[i] = read_token_amount(&ctx.remaining_accounts[i])?;
    }

    let asset_amounts =
        compute_redeem_swap_amounts(&pool_balances, num_assets, shares, total_shares)?;

    // Price the user's slice with live oracles (pre-swap-fee/slippage estimate).
    let estimated_usdc_value = compute_total_nav(
        assets,
        ctx.remaining_accounts,
        num_assets,
        &asset_amounts[..num_assets],
    )?;

    // Mirrors the two fee slices actually applied across request_redeem's
    // per-asset swaps (vault_fee) and claim (platform_fee) — both estimated
    // here off the gross oracle value since neither has run yet.
    let vault_fee = (estimated_usdc_value as u128)
        .checked_mul(ctx.accounts.vault.performance_fee_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)? as u64;
    let platform_fee = (estimated_usdc_value as u128)
        .checked_mul(ctx.accounts.global_state.platform_fee_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)? as u64;
    let estimated_net_usdc = estimated_usdc_value
        .checked_sub(vault_fee)
        .ok_or(VaultError::MathOverflow)?
        .checked_sub(platform_fee)
        .ok_or(VaultError::MathOverflow)?;

    Ok(PreviewRedeemResult {
        num_assets: num_assets as u8,
        asset_amounts,
        estimated_usdc_value,
        total_shares,
        vault_fee,
        platform_fee,
        estimated_net_usdc,
    })
}
