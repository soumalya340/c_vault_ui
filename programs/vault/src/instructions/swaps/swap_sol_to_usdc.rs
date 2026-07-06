use anchor_lang::prelude::*;
use anchor_spl::token::Token;

use std::boxed::Box;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::{RedeemState, Vault};
use crate::utils::whirlpool_cpi::anchor_orca_swap;

/// Swap accumulated wSOL → USDC via the wSOL/USDC Whirlpool pool.
/// Final step of the redeem flow for ViaSol assets (called after `swap_asset_to_sol`).
///
/// `asset_index` is the slot index inside `Vault.assets[]` for the ViaSol asset whose
/// wSOL leg is being finalized here. The flag `asset_swapped[asset_index]` is set to
/// prevent re-execution, and net USDC is accumulated into `pending_usdc`.
pub fn swap_sol_to_usdc_handler(
    ctx: Context<SwapSolToUsdc>,
    vault_id: u64,
    asset_index: u8,
    wsol_amount: u64,
    min_usdc_out: u64,
    a_to_b: bool,
) -> Result<()> {
    let idx = asset_index as usize;
    require!(idx < ctx.accounts.vault.num_assets as usize, VaultError::InvalidAccountsLength);

    let redeem_state = &ctx.accounts.redeem_state;
    require!(
        Clock::get()?.unix_timestamp >= redeem_state.unlock_time,
        VaultError::TooEarlyRedeem
    );
    require!(redeem_state.redeemable_shares > 0, VaultError::ZeroAmount);
    require!(!redeem_state.asset_swapped[idx], VaultError::AssetAlreadySwapped);
    require!(wsol_amount > 0, VaultError::ZeroAmount);

    let bump = ctx.accounts.vault.authority_bump;
    let usdc_before = ctx.accounts.usdc_vault.amount;

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
        wsol_amount,
        min_usdc_out,
        a_to_b,
    )?;

    ctx.accounts.usdc_vault.reload()?;
    let gross_usdc = ctx.accounts.usdc_vault.amount.saturating_sub(usdc_before);

    let fee_bps = ctx.accounts.vault.performance_fee_bps as u128;
    let fee = (gross_usdc as u128)
        .checked_mul(fee_bps)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(VaultError::MathOverflow)? as u64;
    let net_usdc = gross_usdc.checked_sub(fee).ok_or(VaultError::MathOverflow)?;

    let state = &mut ctx.accounts.redeem_state;
    state.asset_swapped[idx] = true;
    state.asset_usdc_out[idx] = net_usdc;
    state.pending_usdc = state
        .pending_usdc
        .checked_add(net_usdc)
        .ok_or(VaultError::MathOverflow)?;

    emit!(SwapSolToUsdcEvent {
        user: ctx.accounts.user.key(),
        asset_index,
        wsol_in: wsol_amount,
        gross_usdc,
        fee,
        net_usdc,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct SwapSolToUsdc<'info> {
    #[account(seeds = [VAULT_SEED, &vault_id.to_le_bytes()], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,

    #[account(seeds = [VAULT_AUTHORITY_SEED, &vault_id.to_le_bytes()], bump = vault.authority_bump)]
    /// CHECK: PDA — swap signer
    pub vault_authority: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [REDEEM_SEED, user.key().as_ref(), &vault_id.to_le_bytes()],
        bump  = redeem_state.bump,
    )]
    pub redeem_state: Box<Account<'info, RedeemState>>,

    #[account(
        mut,
        seeds = [USDC_VAULT_SEED, vault.base_mint.as_ref(), &vault_id.to_le_bytes()],
        bump  = vault.usdc_vault_bump,
        token::mint      = vault.base_mint,
        token::authority = vault_authority,
    )]
    pub usdc_vault: Box<Account<'info, anchor_spl::token::TokenAccount>>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,

    /// CHECK: Orca Whirlpool program.
    #[account(address = WHIRLPOOL_PROGRAM_ID)]
    pub whirlpool_program: UncheckedAccount<'info>,

    /// CHECK: wSOL/USDC pool state.
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
pub struct SwapSolToUsdcEvent {
    pub user: Pubkey,
    pub asset_index: u8,
    pub wsol_in: u64,
    pub gross_usdc: u64,
    pub fee: u64,
    pub net_usdc: u64,
    pub timestamp: i64,
}
