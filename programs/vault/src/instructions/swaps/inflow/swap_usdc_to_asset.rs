use anchor_lang::prelude::*;
use anchor_spl::token::Token;

use std::boxed::Box;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::{PoolRoute, Vault};
use crate::utils::whirlpool_cpi::anchor_orca_swap;

/// Permissionless: deploy the vault's pending USDC for one DirectUsdc asset.
/// Amount is exactly `vault.usdc_target_amount[idx]` (order-independent, no
/// sweep). No-ops if 0.
pub fn swap_usdc_to_asset_handler(
    ctx: Context<SwapUsdcToAsset>,
    vault_id: u64,
    asset_index: u8,
    min_asset_out: u64,
    a_to_b: bool,
) -> Result<()> {
    let idx = asset_index as usize;
    let vault = &ctx.accounts.vault;
    require!(idx < vault.num_assets as usize, VaultError::InvalidAccountsLength);
    require!(
        vault.assets[idx].route == PoolRoute::DirectUsdc && vault.assets[idx].mint != vault.base_mint,
        VaultError::InvalidPendingAssetSlot
    );

    // Deploy exactly this asset's stored pending USDC (order-independent, no
    // sweep). Sub-1-unit rounding dust may linger harmlessly in
    // total_pending_usdc; it does not accumulate per-asset.
    let amount = vault.usdc_target_amount[idx];

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
    vault_mut.total_pending_usdc = vault_mut.total_pending_usdc.saturating_sub(amount);
    let target = vault_mut.usdc_target_amount[idx];
    vault_mut.usdc_target_amount[idx] = target.saturating_sub(amount.min(target));

    emit!(SwapUsdcToAssetEvent {
        caller: ctx.accounts.signer.key(),
        asset_index,
        usdc_in: amount,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct SwapUsdcToAsset<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, &vault_id.to_le_bytes()],
        bump  = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(seeds = [VAULT_AUTHORITY_SEED, &vault_id.to_le_bytes()], bump = vault.authority_bump)]
    /// CHECK: PDA — swap signer
    pub vault_authority: AccountInfo<'info>,

    /// Permissionless caller — pays tx fees; any signer may deploy pending funds.
    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token>,

    /// CHECK: Orca Whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    /// CHECK: USDC/Asset pool state.
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
pub struct SwapUsdcToAssetEvent {
    pub caller: Pubkey,
    pub asset_index: u8,
    pub usdc_in: u64,
    pub timestamp: i64,
}
