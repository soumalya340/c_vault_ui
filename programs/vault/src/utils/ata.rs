use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::errors::VaultError;

/// Read the `amount` field (bytes 64-71) from a raw SPL token account without
/// fully deserialising it. Avoids placing a ~200-byte `TokenAccount` on the stack,
/// which matters inside `try_accounts` where BPF frame limits are tight.
///
/// SPL token account layout (165 bytes):
///   0..32  mint
///  32..64  owner
///  64..72  amount  ← we want this
///  72..73  delegate_option  ...
#[inline(always)]
pub fn read_token_amount(account: &AccountInfo<'_>) -> Result<u64> {
    let data = account.try_borrow_data()?;
    require!(data.len() >= 72, VaultError::AccountNotInitialized);
    Ok(u64::from_le_bytes(data[64..72].try_into().unwrap()))
}

/// Validates that the given account is a properly initialized SPL Token account
/// whose embedded mint (bytes 0..32) matches the expected canonical mint.
///
/// This is used for the vault's asset holding accounts (wSOL / wBTC / wETH)
/// which are passed as `UncheckedAccount` to stay under stack limits.
/// Only the owner program + raw byte layout is checked (no full deserialization).
///
/// Call this before `read_token_amount` when you rely on the balance for NAV
/// or proportional calculations.
#[inline(always)]
pub fn validate_asset_ata(ata: &AccountInfo<'_>, expected_mint: &Pubkey) -> Result<()> {
    require!(
        ata.owner == &anchor_spl::token::ID,
        VaultError::IncorrectOwner
    );

    let data = ata.try_borrow_data()?;
    require!(data.len() >= 72, VaultError::AccountNotInitialized);

    let mint_bytes: &[u8; 32] = data[0..32].try_into().unwrap();
    require!(
        mint_bytes == expected_mint.as_ref(),
        VaultError::InvalidMint
    );

    Ok(())
}

/// Create an ATA idempotently; if it already exists, verify owner and mint.
pub fn create_ata_idempotent<'info>(
    payer: AccountInfo<'info>,
    ata: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    associated_token_program: AccountInfo<'info>,
) -> Result<()> {
    if ata.data_is_empty() {
        msg!("Creating vault ATA idempotently for mint {}", mint.key());
        let cpi_accounts = anchor_spl::associated_token::Create {
            payer,
            associated_token: ata,
            authority,
            mint,
            system_program,
            token_program,
        };
        let cpi_ctx = CpiContext::new(associated_token_program, cpi_accounts);
        anchor_spl::associated_token::create(cpi_ctx)
            .map_err(|_| error!(VaultError::CpiFailure))?;
    } else {
        let data = ata.try_borrow_data()?;
        let token_account = TokenAccount::try_deserialize(&mut data.as_ref())?;
        require_keys_eq!(
            token_account.owner,
            authority.key(),
            VaultError::IncorrectOwner
        );
        require_keys_eq!(token_account.mint, mint.key(), VaultError::InvalidMint);
    }
    Ok(())
}

/// Validates that the given ATA already exists on-chain, is owned by `authority`,
/// and holds the expected `mint`. This is used for ATAs that are required to be
/// pre-created off-chain (to save CU on creation inside the instruction).
///
/// Returns `AccountNotInitialized` if the account is missing or has zero lamports.
pub fn validate_ata_exists<'info>(
    ata: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    mint: AccountInfo<'info>,
) -> Result<()> {
    require!(
        !ata.data_is_empty() && ata.lamports() > 0,
        VaultError::AccountNotInitialized
    );

    let data = ata.try_borrow_data()?;
    let token_account = TokenAccount::try_deserialize(&mut data.as_ref())?;
    require_keys_eq!(
        token_account.owner,
        authority.key(),
        VaultError::IncorrectOwner
    );
    require_keys_eq!(token_account.mint, mint.key(), VaultError::InvalidMint);
    Ok(())
}
