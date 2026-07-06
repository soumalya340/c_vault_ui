use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::GlobalState;

pub fn init_global_state_handler(
    ctx: Context<InitGlobalState>,
    platform_fee_bps: u64,
) -> Result<()> {
    let global_state = &mut ctx.accounts.global_state;

    global_state.is_emergency = false;
    global_state.total_vaults = 0;
    global_state.deposit_disable = false;
    global_state.eligible_base_mints[0] = USDC_MINT;
    global_state.num_eligible_base_mints = 1;
    global_state.platform_fee_bps = platform_fee_bps;
    global_state.treasury_addr = ctx.accounts.authority.key();

    msg!(
        "GlobalState initialized | admin: {} | default base mint: {}",
        ADMIN_PUBKEY,
        USDC_MINT
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitGlobalState<'info> {
    #[account(
        init,
        payer = authority,
        seeds = [GLOBAL_STATE_SEED],
        bump,
        space = ANCHOR_DISCRIMINATOR + GlobalState::INIT_SPACE,
    )]
    pub global_state: Account<'info, GlobalState>,

    #[account(mut, address = ADMIN_PUBKEY @ VaultError::UnauthorizedAdmin)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
