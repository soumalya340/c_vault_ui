use anchor_lang::prelude::*;
use anchor_spl::token::Token;

use std::boxed::Box;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::{PoolRoute, Vault};
use crate::utils::whirlpool_cpi::anchor_orca_swap;

/// Permissionless: convert the vault's ViaSol-bound pending USDC → wSOL in one hop.
/// Size = total_pending_usdc minus the sum of DirectUsdc-asset pending targets
/// (everything pending that is not a Direct target is ViaSol-bound, covering both
/// non-wSOL-native ViaSol slices and the wSOL-native slice). No-ops if 0.
/// Resulting wSOL: the wSOL-native asset's own bps share stays as its target; the
/// remainder becomes total_pending_sol for the ViaSol second-hop legs to divide.
pub fn swap_usdc_to_sol_handler(
    ctx: Context<SwapUsdcToSol>,
    vault_id: u64,
    min_wsol_out: u64,
    a_to_b: bool,
) -> Result<()> {
    let vault = &ctx.accounts.vault;
    let num_assets = vault.num_assets as usize;

    // ViaSol USDC = total pending − Σ DirectUsdc-non-native targets.
    let direct_target_sum: u64 = (0..num_assets)
        .filter(|&i| {
            vault.assets[i].route == PoolRoute::DirectUsdc && vault.assets[i].mint != vault.base_mint
        })
        .map(|i| vault.usdc_target_amount[i])
        .sum();

    let via_sol_slice = vault.total_pending_usdc.saturating_sub(direct_target_sum);

    if via_sol_slice == 0 {
        return Ok(());
    }

    // bps sums for splitting the resulting wSOL.
    let via_sol_bps_sum: u64 = (0..num_assets)
        .filter(|&i| vault.assets[i].route == PoolRoute::ViaSol)
        .map(|i| vault.assets[i].allocation_bps as u64)
        .sum();
    require!(via_sol_bps_sum > 0, VaultError::ZeroAmount);

    let wsol_native_bps_sum: u64 = (0..num_assets)
        .filter(|&i| vault.assets[i].mint == WSOL_MINT)
        .map(|i| vault.assets[i].allocation_bps as u64)
        .sum();

    let bump = vault.authority_bump;
    let wsol_before = ctx.accounts.wsol_owner_account.amount;

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
        via_sol_slice,
        min_wsol_out,
        a_to_b,
    )?;

    ctx.accounts.wsol_owner_account.reload()?;
    let wsol_received = ctx
        .accounts
        .wsol_owner_account
        .amount
        .saturating_sub(wsol_before);

    // wSOL-native slot keeps its own share; the rest is distributable.
    let wsol_native_share = (wsol_received as u128)
        .checked_mul(wsol_native_bps_sum as u128)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(via_sol_bps_sum as u128)
        .ok_or(VaultError::MathOverflow)? as u64;

    let distributable_sol = wsol_received.saturating_sub(wsol_native_share);

    let vault_mut = &mut ctx.accounts.vault;
    // Consume the converted USDC and zero the non-wSOL-native ViaSol targets.
    vault_mut.total_pending_usdc = vault_mut.total_pending_usdc.saturating_sub(via_sol_slice);
    for i in 0..num_assets {
        if vault_mut.assets[i].route == PoolRoute::ViaSol && vault_mut.assets[i].mint != WSOL_MINT {
            vault_mut.usdc_target_amount[i] = 0;
        }
    }
    vault_mut.total_pending_sol = vault_mut
        .total_pending_sol
        .checked_add(distributable_sol)
        .ok_or(VaultError::MathOverflow)?;

    emit!(SwapUsdcToSolEvent {
        caller: ctx.accounts.signer.key(),
        usdc_in: via_sol_slice,
        wsol_out: wsol_received,
        distributable_sol,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct SwapUsdcToSol<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, &vault_id.to_le_bytes()],
        bump  = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(seeds = [VAULT_AUTHORITY_SEED, &vault_id.to_le_bytes()], bump = vault.authority_bump)]
    /// CHECK: PDA — swap signer
    pub vault_authority: AccountInfo<'info>,

    /// Permissionless caller — any signer may run the conversion.
    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token>,

    /// CHECK: Orca Whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    /// CHECK: USDC/wSOL pool state.
    #[account(mut)] pub whirlpool: UncheckedAccount<'info>,
    /// CHECK: vault's USDC owner account (token_owner_account_a or _b depending on a_to_b).
    #[account(mut)] pub token_owner_account_a: UncheckedAccount<'info>,
    /// CHECK: token vault A.
    #[account(mut)] pub token_vault_a: UncheckedAccount<'info>,
    /// CHECK: vault's wSOL owner account (token_owner_account_a or _b depending on a_to_b).
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

    /// CHECK: vault's wSOL holding account — must be whichever of
    /// token_owner_account_a/_b actually holds wSOL, passed again here so the
    /// handler can read its balance before/after without guessing which slot.
    #[account(mut)]
    pub wsol_owner_account: Box<Account<'info, anchor_spl::token::TokenAccount>>,
}

#[event]
pub struct SwapUsdcToSolEvent {
    pub caller: Pubkey,
    pub usdc_in: u64,
    pub wsol_out: u64,
    pub distributable_sol: u64,
    pub timestamp: i64,
}
