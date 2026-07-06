use anchor_lang::prelude::*;
use anchor_spl::token::Token;

use std::boxed::Box;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::{PoolRoute, Vault};
use crate::utils::whirlpool_cpi::anchor_orca_swap;

/// Permissionless: deploy the vault's pending wSOL for one ViaSol asset.
/// Amount = total_pending_sol × sol_target_bps[idx] / 10_000 (order-independent,
/// no sweep). No-ops if 0 (also covers "USDC->wSOL hop hasn't run yet").
pub fn swap_sol_to_asset_handler(
    ctx: Context<SwapSolToAsset>,
    vault_id: u64,
    asset_index: u8,
    min_asset_out: u64,
    a_to_b: bool,
) -> Result<()> {
    let idx = asset_index as usize;
    let vault = &ctx.accounts.vault;
    require!(idx < vault.num_assets as usize, VaultError::InvalidAccountsLength);
    require!(
        vault.assets[idx].route == PoolRoute::ViaSol && vault.assets[idx].mint != WSOL_MINT,
        VaultError::InvalidPendingAssetSlot
    );

    // Deploy this asset's fixed bps share of the current pending wSOL
    // (order-independent, no last-leg sweep). Tiny wSOL dust may remain in
    // total_pending_sol until the next USDC->wSOL conversion tops it up.
    let amount = (vault.total_pending_sol as u128)
        .checked_mul(vault.sol_target_bps[idx] as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)? as u64;

    if amount == 0 {
        return Ok(());
    }

    let bump = vault.authority_bump;

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
        amount,
        min_asset_out,
        a_to_b,
    )?;

    let vault_mut = &mut ctx.accounts.vault;
    vault_mut.total_pending_sol = vault_mut.total_pending_sol.saturating_sub(amount);

    emit!(SwapSolToAssetEvent {
        caller: ctx.accounts.signer.key(),
        asset_index,
        wsol_in: amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct SwapSolToAsset<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, &vault_id.to_le_bytes()],
        bump  = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(seeds = [VAULT_AUTHORITY_SEED, &vault_id.to_le_bytes()], bump = vault.authority_bump)]
    /// CHECK: PDA — swap signer
    pub vault_authority: AccountInfo<'info>,

    /// Permissionless caller — any signer may deploy pending wSOL.
    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token>,

    /// CHECK: Orca Whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    /// CHECK: wSOL/Asset pool state.
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
pub struct SwapSolToAssetEvent {
    pub caller: Pubkey,
    pub asset_index: u8,
    pub wsol_in: u64,
    pub timestamp: i64,
}
