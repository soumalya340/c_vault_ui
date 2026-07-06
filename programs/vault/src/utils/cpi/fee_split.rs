use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::VaultError;

/// Result of splitting a gross amount into platform fee, vault fee, and net.
pub struct FeeSplit {
    pub platform_fee: u64,
    pub vault_fee: u64,
    pub net_amount: u64,
}

/// Splits `gross_amount` into a platform slice (→ `treasury`), an optional
/// vault slice (→ `vault_fee_recipient`), and a remainder, transferring both
/// fee slices out of `source` via CPI. Returns all three amounts so the caller
/// has a single source of truth for state updates / event fields — never
/// re-derive these bps computations elsewhere.
///
/// `vault_fee_recipient` may be `None` when `vault_fee_bps == 0` (e.g. claim,
/// where the vault-side fee was already deducted upstream per-asset) — passing
/// `None` with a non-zero `vault_fee_bps` is a caller error.
///
/// `signer_seeds` is empty (`&[]`) when `authority` is a wallet `Signer` (e.g.
/// the depositing user); pass the PDA's seeds when `authority` is a program PDA
/// (e.g. `vault_authority` during claim).
///
/// bps are computed independently off `gross_amount` (not off each other), so
/// `platform_fee_bps + vault_fee_bps` must not exceed 10_000 — callers are
/// expected to enforce that cap when the fee bps are set (see `FeeTooHigh`).
#[allow(clippy::too_many_arguments)]
pub fn split_and_transfer_fees<'info>(
    token_program: &Program<'info, Token>,
    source: &Account<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    treasury: &Account<'info, TokenAccount>,
    vault_fee_recipient: Option<&Account<'info, TokenAccount>>,
    gross_amount: u64,
    platform_fee_bps: u64,
    vault_fee_bps: u16,
) -> Result<FeeSplit> {
    let platform_fee = (gross_amount as u128)
        .checked_mul(platform_fee_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)? as u64;

    let vault_fee = (gross_amount as u128)
        .checked_mul(vault_fee_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)? as u64;

    let net_amount = gross_amount
        .checked_sub(platform_fee)
        .ok_or(VaultError::MathOverflow)?
        .checked_sub(vault_fee)
        .ok_or(VaultError::MathOverflow)?;

    if platform_fee > 0 {
        transfer(
            token_program,
            source,
            treasury,
            authority,
            signer_seeds,
            platform_fee,
        )?;
    }

    if vault_fee > 0 {
        let recipient = vault_fee_recipient.ok_or(VaultError::MissingFeeRecipient)?;
        transfer(
            token_program,
            source,
            recipient,
            authority,
            signer_seeds,
            vault_fee,
        )?;
    }

    Ok(FeeSplit {
        platform_fee,
        vault_fee,
        net_amount,
    })
}

fn transfer<'info>(
    token_program: &Program<'info, Token>,
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    let cpi_accounts = Transfer {
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: authority.clone(),
    };
    let cpi_ctx = if signer_seeds.is_empty() {
        CpiContext::new(token_program.to_account_info(), cpi_accounts)
    } else {
        CpiContext::new_with_signer(token_program.to_account_info(), cpi_accounts, signer_seeds)
    };
    token::transfer(cpi_ctx, amount)
}
