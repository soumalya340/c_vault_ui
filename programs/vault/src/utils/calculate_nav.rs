use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::constants::{PRICE_SCALE, PYTH_MAX_AGE_SECS};
use crate::errors::VaultError;
use crate::state::AssetInfo;

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Read and validate a Pyth feed, returning (mantissa, abs_exponent).
///
/// `feed_id` comes from `AssetInfo.pyth_feed_id`, set per-asset at vault
/// creation — no hardcoded feed ids here.
fn read_price(feed: &PriceUpdateV2, feed_id: &[u8; 32]) -> Result<(i64, u32)> {
    let clock = Clock::get()?;
    let price = feed
        .get_price_no_older_than(&clock, PYTH_MAX_AGE_SECS, feed_id)
        .map_err(|_| error!(VaultError::StaleOracle))?;
    require!(price.price > 0, VaultError::InvalidOraclePrice);
    Ok((price.price, price.exponent.unsigned_abs()))
}

/// Deserialize a Pyth price-update account from raw `remaining_accounts` data.
fn read_price_from_info(feed_account: &AccountInfo, feed_id: &[u8; 32]) -> Result<(i64, u32)> {
    let data = feed_account.try_borrow_data()?;
    let feed = PriceUpdateV2::try_deserialize(&mut &data[..])
        .map_err(|_| error!(VaultError::StaleOracle))?;
    read_price(&feed, feed_id)
}

/// USD value of one asset in USDC base units (6 decimals).
/// Formula: balance × mantissa × 10^6 / (10^abs_expo × 10^decimals)
fn asset_usdc_value(balance: u64, mantissa: i64, abs_expo: u32, decimals: u8) -> Result<u64> {
    if balance == 0 {
        return Ok(0);
    }
    let numerator = (balance as u128)
        .checked_mul(mantissa as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_mul(1_000_000u128)
        .ok_or(VaultError::MathOverflow)?;
    let denominator = 10u128
        .checked_pow(abs_expo + decimals as u32)
        .ok_or(VaultError::MathOverflow)?;
    Ok((numerator / denominator) as u64)
}

/// Sum the USD value (USDC 6-decimal base units) of every active asset.
///
/// `remaining_accounts` layout: `[asset_ata_0..N, price_feed_0..N]`.
/// `assets` and `balances` must both have length `num_assets`.
pub fn sum_nav(
    assets: &[AssetInfo],
    remaining_accounts: &[AccountInfo],
    num_assets: usize,
    balances: &[u64],
) -> Result<u64> {
    require!(assets.len() >= num_assets, VaultError::InvalidAccountsLength);
    require!(balances.len() >= num_assets, VaultError::InvalidAccountsLength);
    require!(
        remaining_accounts.len() == num_assets * 2,
        VaultError::InvalidAccountsLength
    );

    let mut total_nav: u64 = 0;
    for i in 0..num_assets {
        let (mantissa, abs_expo) =
            read_price_from_info(&remaining_accounts[num_assets + i], &assets[i].pyth_feed_id)?;
        let value = asset_usdc_value(balances[i], mantissa, abs_expo, assets[i].decimals)?;
        total_nav = total_nav.checked_add(value).ok_or(VaultError::MathOverflow)?;
    }
    Ok(total_nav)
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Read each asset's Pyth feed, compute NAV, and return how many shares to mint.
///
/// `remaining_accounts` layout: `[asset_ata_0..N, price_feed_0..N]`.
pub fn compute_shares_to_mint(
    assets: &[AssetInfo],
    remaining_accounts: &[AccountInfo],
    num_assets: usize,
    balances: &[u64],
    total_shares: u64,
    usdc_deposit: u64,
) -> Result<u64> {
    if total_shares == 0 {
        // Genesis: 1 share per USDC base unit → establishes $1.00 baseline
        return Ok(usdc_deposit);
    }

    let total_nav = sum_nav(assets, remaining_accounts, num_assets, balances)?;
    require!(total_nav > 0, VaultError::ZeroAmount);

    // shares = usdc_deposit × total_shares / total_nav
    let shares = (usdc_deposit as u128)
        .checked_mul(total_shares as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(total_nav as u128)
        .ok_or(VaultError::MathOverflow)? as u64;

    Ok(shares)
}

// ── Share-price helper ────────────────────────────────────────────────────────

/// `share_price = (total_usdc_value × PRICE_SCALE) ÷ total_shares`
pub fn compute_share_price(total_usdc_value: u64, total_shares: u64) -> Result<u64> {
    if total_shares == 0 {
        return Ok(PRICE_SCALE);
    }
    let price = (total_usdc_value as u128)
        .checked_mul(PRICE_SCALE as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(total_shares as u128)
        .ok_or(VaultError::MathOverflow)? as u64;
    Ok(price)
}

// ── Public NAV computation (used by nav_view instruction) ────────────────────

/// Compute total NAV from oracle feeds and ATA balances.
///
/// `remaining_accounts` layout: `[asset_ata_0..N, price_feed_0..N]`.
pub fn compute_total_nav(
    assets: &[AssetInfo],
    remaining_accounts: &[AccountInfo],
    num_assets: usize,
    balances: &[u64],
) -> Result<u64> {
    sum_nav(assets, remaining_accounts, num_assets, balances)
}

