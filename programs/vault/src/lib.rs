use anchor_lang::prelude::*;

declare_id!("2YW9wGokqo321EtDNWWH2CSQxFiJz3uMoNxa9dgbHn2P");

pub mod admin;
pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;
pub mod vault;

pub use admin::*;
pub use instructions::*;
pub use vault::*;
// ============================================================
// PROGRAM ENTRY POINTS
// ============================================================

#[program]
pub mod c_vault {
    use super::*;

    // ── Admin ──────────────────────────────────────────────────────

    /// Create the GlobalState singleton. Must be called once before any vault is created.
    pub fn init_global_state(ctx: Context<InitGlobalState>, platform_fee_bps: u64) -> Result<()> {
        init_global_state::init_global_state_handler(ctx, platform_fee_bps)
    }

    /// Create a new ETF fund vault, including its Token-2022 share metadata,
    /// in a single transaction. The new vault's id is always
    /// `global_state.total_vaults`; PDA seeds are derived from it directly. The
    /// counter is incremented by 1 once the vault is initialised.
    pub fn create_etf(
        ctx: Context<CreateEtf>,
        params: state::InitializeParams,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        create_etf::create_etf_handler(ctx, params, name, symbol, uri)
    }

    /// Update the program-wide treasury recipient address.
    pub fn update_treasury_addr(
        ctx: Context<AdminGlobalState>,
        treasury_addr: Pubkey,
    ) -> Result<()> {
        admin::update_treasury_addr(ctx, treasury_addr)
    }

    /// Update the platform fee charged in basis points (max 20%).
    pub fn update_platform_fee_bps(
        ctx: Context<AdminGlobalState>,
        platform_fee_bps: u64,
    ) -> Result<()> {
        admin::update_platform_fee_bps(ctx, platform_fee_bps)
    }

    /// Turn global emergency mode on or off (blocks new deposits program-wide).
    pub fn set_emergency(ctx: Context<AdminGlobalState>, is_emergency: bool) -> Result<()> {
        admin::set_emergency(ctx, is_emergency)
    }

    /// Turn program-wide deposit blocking on or off.
    pub fn set_deposit_disable(
        ctx: Context<AdminGlobalState>,
        deposit_disable: bool,
    ) -> Result<()> {
        admin::set_deposit_disable(ctx, deposit_disable)
    }

    /// Add a company-approved stable mint to the eligible base_mint allowlist.
    pub fn add_eligible_base_mint(ctx: Context<AdminGlobalState>, mint: Pubkey) -> Result<()> {
        admin::add_eligible_base_mint(ctx, mint)
    }

    /// Remove a mint from the eligible base_mint allowlist.
    pub fn remove_eligible_base_mint(ctx: Context<AdminGlobalState>, mint: Pubkey) -> Result<()> {
        admin::remove_eligible_base_mint(ctx, mint)
    }

    /// Resume vault after pause and reset the rolling high-price window.
    pub fn resume(ctx: Context<VaultManagerOnly>, vault_id: u64) -> Result<()> {
        vault_ops::resume(ctx, vault_id)
    }

    /// Pause or unpause deposits for this vault (withdrawals always remain open).
    pub fn set_paused(ctx: Context<VaultManagerOnly>, vault_id: u64, paused: bool) -> Result<()> {
        vault_ops::set_paused(ctx, vault_id, paused)
    }

    /// Update the pubkey that receives accrued performance fees for this vault.
    pub fn set_fee_recipient(
        ctx: Context<VaultManagerOnly>,
        vault_id: u64,
        fee_recipient: Pubkey,
    ) -> Result<()> {
        vault_ops::set_fee_recipient(ctx, vault_id, fee_recipient)
    }

    /// Update the redeem cooldown (0 … 604 800 s). Applies to future redeems only.
    pub fn set_redeem_cooldown(
        ctx: Context<VaultManagerOnly>,
        vault_id: u64,
        cooldown_secs: i64,
    ) -> Result<()> {
        vault_ops::set_redeem_cooldown(ctx, vault_id, cooldown_secs)
    }

    // ── Core instructions ──────────────────────────────────────────

    /// Instruction A — transfer USDC, price shares against pre-swap NAV, mint shares.
    /// Must be followed by per-asset swap legs in the same transaction. For
    /// `Fixed` vaults near their max_shares cap, the deposit is clamped to
    /// remaining headroom rather than rejected.
    pub fn deposit(
        ctx: Context<Deposit>,
        vault_id: u64,
        usdc_amount: u64,
        min_shares_out: u64,
    ) -> Result<()> {
        deposit::deposit_handler(ctx, vault_id, usdc_amount, min_shares_out)
    }

    /// Permissionless: convert the vault's ViaSol-bound pending USDC → wSOL.
    /// Size derived on-chain; no-ops if nothing is pending.
    pub fn swap_usdc_to_sol(
        ctx: Context<SwapUsdcToSol>,
        vault_id: u64,
        min_wsol_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        swap_usdc_to_sol::swap_usdc_to_sol_handler(ctx, vault_id, min_wsol_out, a_to_b)
    }

    /// Permissionless: deploy the vault's pending USDC into one DirectUsdc asset.
    /// Amount is derived on-chain from `vault.usdc_target_amount[idx]`; no-ops if 0.
    pub fn swap_usdc_to_asset(
        ctx: Context<SwapUsdcToAsset>,
        vault_id: u64,
        asset_index: u8,
        min_asset_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        swap_usdc_to_asset::swap_usdc_to_asset_handler(
            ctx,
            vault_id,
            asset_index,
            min_asset_out,
            a_to_b,
        )
    }

    /// Permissionless: deploy the vault's pending wSOL into one ViaSol asset.
    /// Amount = total_pending_sol × sol_target_bps[idx] / 10_000; no-ops if 0.
    pub fn swap_sol_to_asset(
        ctx: Context<SwapSolToAsset>,
        vault_id: u64,
        asset_index: u8,
        min_asset_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        swap_sol_to_asset::swap_sol_to_asset_handler(
            ctx,
            vault_id,
            asset_index,
            min_asset_out,
            a_to_b,
        )
    }

    /// Instruction 1 of 3 — burn shares, record proportional asset amounts, start 24hr cooldown.
    pub fn request_redeem(ctx: Context<RequestRedeem>, vault_id: u64, shares: u64) -> Result<()> {
        redeem::request_redeem_handler(ctx, vault_id, shares)
    }

    /// Instruction 2 of 3 (per-asset) — after cooldown, swap one asset slot → USDC
    /// directly (DirectUsdc route). The input amount is read from
    /// `RedeemState.asset_amount_in[asset_index]`; net USDC is accumulated into
    /// `pending_usdc`. Call once per DirectUsdc asset before `claim`.
    pub fn swap_asset_to_usdc(
        ctx: Context<SwapAssetToUsdc>,
        vault_id: u64,
        asset_index: u8,
        min_usdc_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        swap_asset_to_usdc::swap_asset_to_usdc_handler(
            ctx,
            vault_id,
            asset_index,
            min_usdc_out,
            a_to_b,
        )
    }

    /// Instruction 2 of 3 (per-asset, ViaSol leg 1) — swap one asset slot → wSOL.
    /// The input amount is read from `RedeemState.asset_amount_in[asset_index]`.
    /// Follow with `swap_sol_to_usdc` to finish converting the wSOL to USDC.
    pub fn swap_asset_to_sol(
        ctx: Context<SwapAssetToSol>,
        vault_id: u64,
        asset_index: u8,
        min_wsol_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        swap_asset_to_sol::swap_asset_to_sol_handler(
            ctx,
            vault_id,
            asset_index,
            min_wsol_out,
            a_to_b,
        )
    }

    /// Instruction 2 of 3 (per-asset, ViaSol leg 2) — swap accumulated wSOL → USDC
    /// for `asset_index`, deduct the performance fee, and accumulate net USDC into
    /// `pending_usdc`. `wsol_amount` is the wSOL produced by the prior
    /// `swap_asset_to_sol` leg (a runtime value, not the stored asset amount).
    pub fn swap_sol_to_usdc(
        ctx: Context<SwapSolToUsdc>,
        vault_id: u64,
        asset_index: u8,
        wsol_amount: u64,
        min_usdc_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        swap_sol_to_usdc::swap_sol_to_usdc_handler(
            ctx,
            vault_id,
            asset_index,
            wsol_amount,
            min_usdc_out,
            a_to_b,
        )
    }

    /// Instruction 3 of 3 — send pending USDC to user and close RedeemState.
    pub fn claim(ctx: Context<Claim>, vault_id: u64) -> Result<()> {
        claim::claim_handler(ctx, vault_id)
    }

    // ── View ───────────────────────────────────────────────────────

    /// Read-only: returns live NAV, share price, and total shares.
    /// Call with `.view()` from the TypeScript client — no wallet signature needed.
    pub fn get_total_nav_view(
        ctx: Context<GetTotalNavView>,
        vault_id: u64,
    ) -> Result<NavViewResult> {
        nav_view::get_total_nav_view_handler(ctx, vault_id)
    }

    /// Read-only: shares a `usdc_amount` deposit would mint right now.
    /// Call with `.view()` from the TypeScript client — no wallet signature needed.
    pub fn preview_deposit(
        ctx: Context<PreviewDeposit>,
        vault_id: u64,
        usdc_amount: u64,
    ) -> Result<PreviewDepositResult> {
        preview_deposit::preview_deposit_handler(ctx, vault_id, usdc_amount)
    }

    /// Read-only: asset amounts + estimated USDC that burning `shares` would return.
    /// Call with `.view()` from the TypeScript client — no wallet signature needed.
    pub fn preview_redeem(
        ctx: Context<PreviewRedeem>,
        vault_id: u64,
        shares: u64,
    ) -> Result<PreviewRedeemResult> {
        preview_redeem::preview_redeem_handler(ctx, vault_id, shares)
    }
}
