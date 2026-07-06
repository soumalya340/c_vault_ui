use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::constants::{
    MAX_SQRT_PRICE_X64, MIN_SQRT_PRICE_X64, VAULT_AUTHORITY_SEED, WHIRLPOOL_SWAP_DISCRIMINATOR,
};
use crate::errors::VaultError;

/// Whirlpool `swap` accounts slice — 11 entries in order:
///   [0] token_program (readonly)
///   [1] token_authority (signer)
///   [2] whirlpool (mut)
///   [3] token_owner_account_a (mut)
///   [4] token_vault_a (mut)
///   [5] token_owner_account_b (mut)
///   [6] token_vault_b (mut)
///   [7] tick_array_0 (mut)
///   [8] tick_array_1 (mut)
///   [9] tick_array_2 (mut)
///  [10] oracle (readonly)
pub fn anchor_orca_swap<'info>(
    whirlpool_program: &AccountInfo<'info>,
    accs: &[AccountInfo<'info>; 11],
    vault_id: u64,
    authority_bump: u8,
    amount: u64,
    min_out: u64,
    a_to_b: bool,
) -> Result<()> {
    let bump = [authority_bump];
    let vault_id_bytes = vault_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_AUTHORITY_SEED, &vault_id_bytes, &bump]];

    let sqrt_price_limit = if a_to_b {
        MIN_SQRT_PRICE_X64
    } else {
        MAX_SQRT_PRICE_X64
    };

    let mut data = [0u8; 42];
    data[..8].copy_from_slice(&WHIRLPOOL_SWAP_DISCRIMINATOR);
    data[8..16].copy_from_slice(&amount.to_le_bytes());
    data[16..24].copy_from_slice(&min_out.to_le_bytes());
    data[24..40].copy_from_slice(&sqrt_price_limit.to_le_bytes());
    data[40] = 1; // amount_specified_is_input = true
    data[41] = u8::from(a_to_b);

    let account_metas = [
        AccountMeta::new_readonly(accs[0].key(), false),
        AccountMeta::new_readonly(accs[1].key(), true),
        AccountMeta::new(accs[2].key(), false),
        AccountMeta::new(accs[3].key(), false),
        AccountMeta::new(accs[4].key(), false),
        AccountMeta::new(accs[5].key(), false),
        AccountMeta::new(accs[6].key(), false),
        AccountMeta::new(accs[7].key(), false),
        AccountMeta::new(accs[8].key(), false),
        AccountMeta::new(accs[9].key(), false),
        AccountMeta::new_readonly(accs[10].key(), false),
    ];

    let ix = Instruction {
        program_id: whirlpool_program.key(),
        accounts: account_metas.to_vec(),
        data: data.to_vec(),
    };

    invoke_signed(&ix, accs, signer_seeds)
        .map_err(|_| error!(VaultError::CpiFailure))?;

    Ok(())
}
