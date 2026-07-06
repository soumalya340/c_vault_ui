use anchor_lang::prelude::*;

use crate::constants::MAX_ASSETS;
use crate::errors::VaultError;

// ── Per-asset redeem swap-amount calculation ────────────────────────────────────
//
// When a user requests a redemption, their slice of the vault is a flat
// percentage of the whole pool — exactly the same proportion used by NAV.
//
//   user_fraction = redeemed_shares / total_shares_before_burn
//   amount_in[i]  = floor(pool_balance[i] × redeemed_shares / total_shares)
//
// Example: pool holds 30 SOL / 20 WETH / 10 WBTC and the user's shares are 0.1 %
// of the supply → they redeem 0.03 SOL, 0.02 WETH, 0.01 WBTC. These amounts are
// snapshotted at request time and stored in `RedeemState.asset_amount_in[i]` so
// the later per-asset swap instructions can be driven straight from storage
// without re-deriving the proportion (which would drift as the pool moves during
// the cooldown window).

/// `floor(balance × shares / total_shares)` — the proportional slice of one asset
/// owed to a redeemer holding `shares` out of `total_shares`.
#[inline]
pub fn pro_rata_amount(balance: u64, shares: u64, total_shares: u64) -> Result<u64> {
    require!(total_shares > 0, VaultError::ZeroAmount);
    Ok((balance as u128)
        .checked_mul(shares as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(total_shares as u128)
        .ok_or(VaultError::MathOverflow)? as u64)
}

/// Compute the per-asset token amounts a redeemer must swap, indexed to match
/// `Vault.assets[i]`.
///
/// - `pool_balances`  — current vault ATA balance for each active asset slot,
///                      in the same order as `Vault.assets[0..num_assets]`.
/// - `shares`         — shares being redeemed.
/// - `total_shares`   — total outstanding shares **before** this redemption's
///                      burn (the supply the proportion is measured against).
///
/// Slots `[num_assets..MAX_ASSETS]` are left at 0. Returns the fixed-size array
/// ready to copy into `RedeemState.asset_amount_in`.
pub fn compute_redeem_swap_amounts(
    pool_balances: &[u64],
    num_assets: usize,
    shares: u64,
    total_shares: u64,
) -> Result<[u64; MAX_ASSETS]> {
    require!(num_assets <= MAX_ASSETS, VaultError::TooManyAssets);
    require!(num_assets > 0, VaultError::NoAssets);
    require!(
        pool_balances.len() >= num_assets,
        VaultError::InvalidAccountsLength
    );
    require!(shares > 0, VaultError::ZeroAmount);
    require!(total_shares >= shares, VaultError::MathOverflow);

    let mut amounts = [0u64; MAX_ASSETS];
    for i in 0..num_assets {
        amounts[i] = pro_rata_amount(pool_balances[i], shares, total_shares)?;
    }
    Ok(amounts)
}
