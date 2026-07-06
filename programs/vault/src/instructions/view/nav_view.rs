use anchor_lang::prelude::*;

use crate::constants::{MAX_ASSETS, VAULT_SEED};
use crate::errors::VaultError;
use crate::state::Vault;
use crate::utils::ata::{read_token_amount, validate_asset_ata};
use crate::utils::calculate_nav::{compute_share_price, compute_total_nav};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct NavViewResult {
    /// Total portfolio value in USDC (6 decimals).
    pub total_nav: u64,
    /// Current share price (PRICE_SCALE = 1e9 denominator).
    pub share_price: u64,
    /// Outstanding shares at time of query.
    pub total_shares: u64,
}

/// `remaining_accounts` must be exactly `num_assets × 2` accounts:
/// `[asset_ata_0..asset_ata_N, price_feed_0..price_feed_N]`, both ordered to
/// match `Vault.assets[0..num_assets]`.
#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct GetTotalNavView<'info> {
    #[account(seeds = [VAULT_SEED, &vault_id.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
}

pub fn get_total_nav_view_handler(
    ctx: Context<GetTotalNavView>,
    _vault_id: u64,
) -> Result<NavViewResult> {
    let num_assets = ctx.accounts.vault.num_assets as usize;

    let assets = &ctx.accounts.vault.assets[..num_assets];
    let mut balances = [0u64; MAX_ASSETS];
    for i in 0..num_assets {
        validate_asset_ata(&ctx.remaining_accounts[i], &assets[i].mint)?;
        balances[i] = read_token_amount(&ctx.remaining_accounts[i])?;
    }

    let total_nav = compute_total_nav(
        assets,
        ctx.remaining_accounts,
        num_assets,
        &balances[..num_assets],
    )?;

    require!(total_nav > 0, VaultError::ZeroAmount);

    let total_shares = ctx.accounts.vault.total_shares;
    let share_price = compute_share_price(total_nav, total_shares)?;

    Ok(NavViewResult {
        total_nav,
        share_price,
        total_shares,
    })
}
