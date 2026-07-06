use anchor_lang::prelude::*;

use crate::constants::{GLOBAL_STATE_SEED, MAX_ASSETS, VAULT_SEED};
use crate::errors::VaultError;
use crate::state::{GlobalState, Vault};
use crate::utils::ata::{read_token_amount, validate_asset_ata};
use crate::utils::calculate_nav::{compute_share_price, compute_shares_to_mint, compute_total_nav};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PreviewDepositResult {
    /// Shares the user would receive for `usdc_amount` (same math as `deposit`).
    pub shares_to_mint: u64,
    /// Live NAV used for the quote (USDC, 6 decimals). 0 at genesis.
    pub total_nav: u64,
    /// Share price implied by the live NAV (PRICE_SCALE = 1e9 denominator).
    pub share_price: u64,
    /// Outstanding shares at time of quote.
    pub total_shares: u64,
    /// Platform fee slice that would be deducted from `usdc_amount` (gross).
    pub platform_fee: u64,
    /// Vault performance fee slice that would be deducted from `usdc_amount` (gross).
    pub vault_fee: u64,
    /// `usdc_amount` after both fee slices — this is what shares are priced against.
    pub net_usdc: u64,
}

/// `remaining_accounts` must be exactly `num_assets × 2` accounts:
/// `[asset_ata_0..asset_ata_N, price_feed_0..price_feed_N]`, both ordered to
/// match `Vault.assets[0..num_assets]`.
#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct PreviewDeposit<'info> {
    #[account(seeds = [GLOBAL_STATE_SEED], bump)]
    pub global_state: Account<'info, GlobalState>,

    #[account(seeds = [VAULT_SEED, &vault_id.to_le_bytes()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
}

/// Read-only quote: how many shares would `usdc_amount` mint right now?
/// Mirrors `deposit_handler` exactly (pre-swap NAV + `compute_shares_to_mint`).
pub fn preview_deposit_handler(
    ctx: Context<PreviewDeposit>,
    _vault_id: u64,
    usdc_amount: u64,
) -> Result<PreviewDepositResult> {
    require!(usdc_amount > 0, VaultError::ZeroAmount);

    let num_assets = ctx.accounts.vault.num_assets as usize;

    let assets = &ctx.accounts.vault.assets[..num_assets];
    let mut balances = [0u64; MAX_ASSETS];
    for i in 0..num_assets {
        validate_asset_ata(&ctx.remaining_accounts[i], &assets[i].mint)?;
        balances[i] = read_token_amount(&ctx.remaining_accounts[i])?;
    }

    let total_shares = ctx.accounts.vault.total_shares;

    // Mirrors deposit_handler Step 3: fees come off the gross amount first;
    // shares are priced and minted against net_usdc only.
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

    let shares_to_mint = compute_shares_to_mint(
        assets,
        ctx.remaining_accounts,
        num_assets,
        &balances[..num_assets],
        total_shares,
        net_usdc,
    )?;

    // Genesis vault has no assets yet — NAV is 0 and price is the $1.00 baseline.
    let total_nav = if total_shares == 0 {
        0
    } else {
        compute_total_nav(
            assets,
            ctx.remaining_accounts,
            num_assets,
            &balances[..num_assets],
        )?
    };
    let share_price = compute_share_price(total_nav, total_shares)?;

    Ok(PreviewDepositResult {
        shares_to_mint,
        total_nav,
        share_price,
        total_shares,
        platform_fee,
        vault_fee,
        net_usdc,
    })
}
