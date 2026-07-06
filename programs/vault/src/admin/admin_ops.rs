use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::GlobalState;

const MAX_PLATFORM_FEE_BPS: u64 = 2_000;

/// Update the program-wide treasury recipient address.
pub(crate) fn update_treasury_addr(
    ctx: Context<AdminGlobalState>,
    treasury_addr: Pubkey,
) -> Result<()> {
    let global_state = &mut ctx.accounts.global_state;
    let old_treasury_addr = global_state.treasury_addr;
    global_state.treasury_addr = treasury_addr;

    emit!(TreasuryAddrUpdatedEvent {
        admin: ctx.accounts.admin.key(),
        old_treasury_addr,
        new_treasury_addr: treasury_addr,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Treasury address updated to {}", treasury_addr);
    Ok(())
}

/// Update the platform fee charged in basis points (max 20%).
pub(crate) fn update_platform_fee_bps(
    ctx: Context<AdminGlobalState>,
    platform_fee_bps: u64,
) -> Result<()> {
    require!(
        platform_fee_bps <= MAX_PLATFORM_FEE_BPS,
        VaultError::FeeTooHigh
    );

    let global_state = &mut ctx.accounts.global_state;
    let old_platform_fee_bps = global_state.platform_fee_bps;
    global_state.platform_fee_bps = platform_fee_bps;

    emit!(PlatformFeeUpdatedEvent {
        admin: ctx.accounts.admin.key(),
        old_platform_fee_bps,
        new_platform_fee_bps: platform_fee_bps,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Platform fee updated to {} bps", platform_fee_bps);
    Ok(())
}

/// Turn global emergency mode on or off.
/// When on, new deposits are blocked program-wide; redemptions stay open.
pub(crate) fn set_emergency(ctx: Context<AdminGlobalState>, is_emergency: bool) -> Result<()> {
    ctx.accounts.global_state.is_emergency = is_emergency;

    emit!(GlobalEmergencyUpdatedEvent {
        admin: ctx.accounts.admin.key(),
        is_emergency,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Global emergency mode set to {}", is_emergency);
    Ok(())
}

/// Turn program-wide deposit blocking on or off (redemptions stay open).
pub(crate) fn set_deposit_disable(
    ctx: Context<AdminGlobalState>,
    deposit_disable: bool,
) -> Result<()> {
    let global_state = &mut ctx.accounts.global_state;
    let old_deposit_disable = global_state.deposit_disable;
    global_state.deposit_disable = deposit_disable;

    emit!(DepositDisableUpdatedEvent {
        admin: ctx.accounts.admin.key(),
        old_deposit_disable,
        new_deposit_disable: deposit_disable,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Global deposit_disable set to {}", deposit_disable);
    Ok(())
}

/// Add a company-approved stable mint to the eligible `base_mint` list.
pub(crate) fn add_eligible_base_mint(
    ctx: Context<AdminGlobalState>,
    mint: Pubkey,
) -> Result<()> {
    require!(mint != Pubkey::default(), VaultError::InvalidMint);

    let global_state = &mut ctx.accounts.global_state;
    let n = global_state.num_eligible_base_mints as usize;
    require!(n < MAX_ELIGIBLE_BASE_MINTS, VaultError::EligibleMintListFull);
    require!(
        !global_state.is_eligible_base_mint(&mint),
        VaultError::EligibleMintAlreadyListed
    );

    global_state.eligible_base_mints[n] = mint;
    global_state.num_eligible_base_mints = global_state
        .num_eligible_base_mints
        .checked_add(1)
        .ok_or(VaultError::MathOverflow)?;

    emit!(EligibleBaseMintAddedEvent {
        admin: ctx.accounts.admin.key(),
        mint,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Eligible base mint added: {}", mint);
    Ok(())
}

/// Remove a mint from the eligible `base_mint` list.
pub(crate) fn remove_eligible_base_mint(
    ctx: Context<AdminGlobalState>,
    mint: Pubkey,
) -> Result<()> {
    let global_state = &mut ctx.accounts.global_state;
    let n = global_state.num_eligible_base_mints as usize;
    let idx = global_state.eligible_base_mints[..n]
        .iter()
        .position(|m| *m == mint)
        .ok_or(VaultError::EligibleMintNotFound)?;

    global_state.eligible_base_mints[idx] = global_state.eligible_base_mints[n - 1];
    global_state.eligible_base_mints[n - 1] = Pubkey::default();
    global_state.num_eligible_base_mints -= 1;

    emit!(EligibleBaseMintRemovedEvent {
        admin: ctx.accounts.admin.key(),
        mint,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Eligible base mint removed: {}", mint);
    Ok(())
}

#[derive(Accounts)]
pub struct AdminGlobalState<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_STATE_SEED],
        bump,
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(address = ADMIN_PUBKEY @ VaultError::UnauthorizedAdmin)]
    pub admin: Signer<'info>,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct TreasuryAddrUpdatedEvent {
    pub admin: Pubkey,
    pub old_treasury_addr: Pubkey,
    pub new_treasury_addr: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PlatformFeeUpdatedEvent {
    pub admin: Pubkey,
    pub old_platform_fee_bps: u64,
    pub new_platform_fee_bps: u64,
    pub timestamp: i64,
}

#[event]
pub struct GlobalEmergencyUpdatedEvent {
    pub admin: Pubkey,
    pub is_emergency: bool,
    pub timestamp: i64,
}

#[event]
pub struct DepositDisableUpdatedEvent {
    pub admin: Pubkey,
    pub old_deposit_disable: bool,
    pub new_deposit_disable: bool,
    pub timestamp: i64,
}

#[event]
pub struct EligibleBaseMintAddedEvent {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct EligibleBaseMintRemovedEvent {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub timestamp: i64,
}
