use anchor_lang::prelude::*;
use anchor_spl::token::Token;

use std::boxed::Box;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::{RedeemState, Vault};
use crate::utils::whirlpool_cpi::anchor_orca_swap;

/// Swap a vault asset → wSOL via an Asset/wSOL Whirlpool pool.
/// Used during the redeem flow for assets whose `route == ViaSol`.
/// After all assets are converted to wSOL, call `swap_sol_to_usdc` to finish.
///
/// `asset_index` selects the slot in `Vault.assets[]`; the input amount is read
/// from `RedeemState.asset_amount_in[asset_index]` (snapshotted at request time),
/// so the caller does not re-derive it.
pub fn swap_asset_to_sol_handler(
    ctx: Context<SwapAssetToSol>,
    vault_id: u64,
    asset_index: u8,
    min_wsol_out: u64,
    a_to_b: bool,
) -> Result<()> {
    let idx = asset_index as usize;
    require!(
        idx < ctx.accounts.vault.num_assets as usize,
        VaultError::InvalidAccountsLength
    );

    let redeem_state = &ctx.accounts.redeem_state;
    require!(
        Clock::get()?.unix_timestamp >= redeem_state.unlock_time,
        VaultError::TooEarlyRedeem
    );
    require!(redeem_state.redeemable_shares > 0, VaultError::ZeroAmount);
    require!(redeem_state.pending_usdc == 0, VaultError::RedeemAlreadyPending);

    // Input amount was snapshotted at request_redeem time.
    let asset_amount = redeem_state.asset_amount_in[idx];
    require!(asset_amount > 0, VaultError::ZeroAmount);

    let bump = ctx.accounts.vault.authority_bump;

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
        min_wsol_out,
        a_to_b,
    )?;

    emit!(SwapAssetToSolEvent {
        user: ctx.accounts.user.key(),
        asset_index,
        asset_in: asset_amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct SwapAssetToSol<'info> {
    #[account(seeds = [VAULT_SEED, &vault_id.to_le_bytes()], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,

    #[account(seeds = [VAULT_AUTHORITY_SEED, &vault_id.to_le_bytes()], bump = vault.authority_bump)]
    /// CHECK: PDA — swap signer
    pub vault_authority: AccountInfo<'info>,

    #[account(
        seeds = [REDEEM_SEED, user.key().as_ref(), &vault_id.to_le_bytes()],
        bump  = redeem_state.bump,
    )]
    pub redeem_state: Box<Account<'info, RedeemState>>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,

    /// CHECK: Orca Whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    /// CHECK: Asset/wSOL pool state.
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
pub struct SwapAssetToSolEvent {
    pub user: Pubkey,
    pub asset_index: u8,
    pub asset_in: u64,
    pub timestamp: i64,
}
