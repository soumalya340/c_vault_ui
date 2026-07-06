use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::Vault;
use crate::utils::calculate_nav::compute_share_price;

/// Unpause this vault and reset the rolling high-price window.
pub(crate) fn resume(ctx: Context<VaultManagerOnly>, _vault_id: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(vault.paused, VaultError::NotInEmergency);

    vault.paused = false;

    let share_price = compute_share_price(vault.total_usdc_value, vault.total_shares)?;
    let clock = Clock::get()?;

    vault.rolling_high_price = share_price;
    vault.rolling_window_start = clock.unix_timestamp;

    emit!(VaultResumedEvent {
        vault_id: vault.vault_id,
        vault_manager: ctx.accounts.vault_manager.key(),
        new_rolling_high: share_price,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Vault {} resumed | new rolling high: {} | window reset",
        vault.vault_id,
        share_price
    );
    Ok(())
}

/// Pause or unpause deposits for this vault. Redemptions remain always available.
pub(crate) fn set_paused(
    ctx: Context<VaultManagerOnly>,
    _vault_id: u64,
    paused: bool,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let old_paused = vault.paused;
    vault.paused = paused;

    emit!(VaultPausedUpdatedEvent {
        vault_id: vault.vault_id,
        vault_manager: ctx.accounts.vault_manager.key(),
        old_paused,
        new_paused: paused,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Vault {} deposits paused = {}", vault.vault_id, paused);
    Ok(())
}

/// Update the pubkey that receives accrued performance fees for this vault.
pub(crate) fn set_fee_recipient(
    ctx: Context<VaultManagerOnly>,
    _vault_id: u64,
    fee_recipient: Pubkey,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let old_fee_recipient = vault.fee_recipient;
    vault.fee_recipient = fee_recipient;

    emit!(FeeRecipientUpdatedEvent {
        vault_id: vault.vault_id,
        vault_manager: ctx.accounts.vault_manager.key(),
        old_fee_recipient,
        new_fee_recipient: fee_recipient,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Update the redeem cooldown period for this vault.
/// Bounds: 0 (instant) … 7 days (604 800 s).
pub(crate) fn set_redeem_cooldown(
    ctx: Context<VaultManagerOnly>,
    _vault_id: u64,
    cooldown_secs: i64,
) -> Result<()> {
    require!(cooldown_secs >= 0, VaultError::InvalidCooldown);
    require!(
        cooldown_secs <= 7 * 24 * 60 * 60,
        VaultError::InvalidCooldown
    );

    let vault = &mut ctx.accounts.vault;
    let old_cooldown_secs = vault.redeem_cooldown_secs;
    vault.redeem_cooldown_secs = cooldown_secs;

    emit!(RedeemCooldownUpdatedEvent {
        vault_id: vault.vault_id,
        vault_manager: ctx.accounts.vault_manager.key(),
        old_cooldown_secs,
        new_cooldown_secs: cooldown_secs,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "Vault {} redeem cooldown updated: {} → {} seconds",
        vault.vault_id,
        old_cooldown_secs,
        cooldown_secs
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct VaultManagerOnly<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, &vault_id.to_le_bytes()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        constraint = vault_manager.key() == vault.vault_manager @ VaultError::Unauthorized
    )]
    pub vault_manager: Signer<'info>,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct VaultResumedEvent {
    pub vault_id: u64,
    pub vault_manager: Pubkey,
    pub new_rolling_high: u64,
    pub timestamp: i64,
}

#[event]
pub struct VaultPausedUpdatedEvent {
    pub vault_id: u64,
    pub vault_manager: Pubkey,
    pub old_paused: bool,
    pub new_paused: bool,
    pub timestamp: i64,
}

#[event]
pub struct FeeRecipientUpdatedEvent {
    pub vault_id: u64,
    pub vault_manager: Pubkey,
    pub old_fee_recipient: Pubkey,
    pub new_fee_recipient: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct RedeemCooldownUpdatedEvent {
    pub vault_id: u64,
    pub vault_manager: Pubkey,
    pub old_cooldown_secs: i64,
    pub new_cooldown_secs: i64,
    pub timestamp: i64,
}
