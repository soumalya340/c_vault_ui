use anchor_lang::prelude::*;

use crate::constants::{MAX_ASSETS, MAX_ELIGIBLE_BASE_MINTS};

/// Global configuration and counters shared across all vault instances.
#[derive(InitSpace)]
#[account]
pub struct GlobalState {
    pub is_emergency: bool,

    pub total_vaults: u64,

    pub treasury_addr: Pubkey,

    pub platform_fee_bps: u64,

    /// When true, new deposits are blocked program-wide; redemptions stay open.
    pub deposit_disable: bool,

    /// Count of active entries in `eligible_base_mints`.
    pub num_eligible_base_mints: u8,

    /// Company-approved stable mints that may be used as a vault's `base_mint`.
    pub eligible_base_mints: [Pubkey; MAX_ELIGIBLE_BASE_MINTS],
}

impl GlobalState {
    pub fn is_eligible_base_mint(&self, mint: &Pubkey) -> bool {
        let n = self.num_eligible_base_mints as usize;
        self.eligible_base_mints[..n].iter().any(|m| m == mint)
    }
}

// ── Fund type ─────────────────────────────────────────────────────────────────

/// Whether the vault's asset basket is frozen at creation or can grow over time.
///
/// - `Fixed`   — asset count is locked at init; `Vault.max_assets` sets the cap.
/// - `Dynamic` — new assets can be added on the fly; `Vault.max_assets` is ignored.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum FundType {
    Fixed,
    Dynamic,
}

impl Default for FundType {
    fn default() -> Self {
        FundType::Dynamic
    }
}

// ── Swap routing ───────────────────────────────────────────────────────────────

/// How USDC reaches a particular asset inside the vault.
///
/// - `DirectUsdc` — single Whirlpool hop: USDC ↔ Asset
/// - `ViaSol`     — two-hop: USDC → wSOL (via `Vault.usdc_sol_pool`),
///                  then wSOL → Asset (via `AssetInfo.pool_address`)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub enum PoolRoute {
    DirectUsdc,
    ViaSol,
}

impl Default for PoolRoute {
    fn default() -> Self {
        PoolRoute::DirectUsdc
    }
}

// ── Per-asset configuration ────────────────────────────────────────────────────

/// Static configuration for one asset held by the vault.
/// Stored inline in `Vault.assets[i]`; slot is inactive when `mint == Pubkey::default()`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, InitSpace)]
pub struct AssetInfo {
    /// SPL mint of this asset.
    pub mint: Pubkey,

    /// Orca Whirlpool pool used to swap this asset.
    /// - `DirectUsdc`: this pool is USDC ↔ Asset
    /// - `ViaSol`:     this pool is wSOL ↔ Asset  (USDC→wSOL uses `Vault.usdc_sol_pool`)
    pub pool_address: Pubkey,

    /// Pyth price feed ID (32-byte hex) for this asset quoted in USD.
    pub pyth_feed_id: [u8; 32],

    /// Portfolio weight in basis points. Sum across all active assets must equal 10 000.
    pub allocation_bps: u16,

    /// Token decimals — cached at init to avoid mint account reads in hot paths.
    pub decimals: u8,

    /// Routing strategy for USDC ↔ Asset swaps.
    pub route: PoolRoute,
}

impl Default for AssetInfo {
    fn default() -> Self {
        Self {
            mint: Pubkey::default(),
            pool_address: Pubkey::default(),
            pyth_feed_id: [0u8; 32],
            allocation_bps: 0,
            decimals: 0,
            route: PoolRoute::DirectUsdc,
        }
    }
}

// ── Core vault account ─────────────────────────────────────────────────────────

#[derive(InitSpace)]
#[account]
pub struct Vault {
    // ── Identity ───────────────────────────────────────────────────────────────
    /// Sequential global id assigned at creation (== GlobalState.total_vaults at
    /// the time of creation). Part of every PDA seed for this vault.
    pub vault_id: u64,

    /// When true, new deposits are paused program-wide; redemptions stay open.
    pub paused: bool,

    // ── Authority ──────────────────────────────────────────────────────────────
    pub vault_manager: Pubkey,
    pub fee_recipient: Pubkey,

    // ── Mints ──────────────────────────────────────────────────────────────────
    pub base_mint: Pubkey,   // USDC (deposit/withdraw currency)
    pub shares_mint: Pubkey, // ERC-4626 share token

    // ── ERC-4626 accounting ────────────────────────────────────────────────────
    /// Total outstanding shares (mirrors share_mint.supply, kept in sync).
    pub total_shares: u64,
    /// Last-known total portfolio value in USDC (6 decimals).
    /// Updated by: deposit (+usdc_amount), redeem (-usdc_out).
    pub total_usdc_value: u64,

    // ── Share-price tracking ───────────────────────────────────────────────────
    pub ath_share_price: u64,      // all-time high (PRICE_SCALE denominated)
    pub rolling_high_price: u64,   // 30-day rolling high
    pub rolling_window_start: i64, // unix timestamp of window start

    // ── Stats ─────────────────────────────────────────────────────────
    pub total_deposited: u64,
    pub total_withdrawn: u64,
    pub performance_fee_bps: u16,

    // ── Pending deployment (vault-wide aggregates, inflow deployment flow) ────
    /// Total undeployed USDC owed to inflow swaps (Direct and ViaSol groups).
    pub total_pending_usdc: u64,
    /// Total undeployed wSOL owed to ViaSol asset legs. Zero until the
    /// USDC→wSOL hop runs.
    pub total_pending_sol: u64,
    /// USDC pending per asset — DirectUsdc non-native and non-wSOL-native ViaSol
    /// slots. Zero for USDC-native and wSOL-native slots.
    pub usdc_target_amount: [u64; MAX_ASSETS],
    /// Fixed ViaSol wSOL split in bps (sums to 10_000 across non-wSOL-native
    /// ViaSol assets). Set once in `create_etf`; immutable after creation.
    pub sol_target_bps: [u16; MAX_ASSETS],

    // ── Redeem settings ────────────────────────────────────────────────────────
    /// Cooldown (seconds) from request_redeem → swap / claim allowed.
    /// Defaults to REDEEM_COOLDOWN_SECS (86 400). Configurable by admin.
    pub redeem_cooldown_secs: i64,

    // ── Stored PDA bumps (avoid re-deriving on every CPI) ─────────────────────
    pub bump: u8,            // vault PDA bump (VAULT_SEED)
    pub authority_bump: u8,  // vault_authority PDA bump (VAULT_AUTHORITY_SEED)
    pub share_mint_bump: u8, // shares_mint PDA bump
    pub usdc_vault_bump: u8, // usdc_vault token account bump

    // ── Fund type ──────────────────────────────────────────────────────────────
    /// Whether this vault's asset basket is fixed or can grow dynamically.
    pub fund_type: FundType,

    /// Hard cap on total outstanding shares (supply cap) for a `Fixed` vault.
    /// Deposits that would push `total_shares` above this are rejected. Only
    /// enforced when `fund_type == Fixed`; `None` means uncapped (always the
    /// case for `Dynamic`).
    pub max_shares: Option<u64>,

    // ── Dynamic asset basket ───────────────────────────────────────────────────
    /// Orca Whirlpool pool for USDC ↔ wSOL.
    /// Required (Some) when any asset uses `route == ViaSol`; None for USDC-only vaults.
    pub usdc_sol_pool: Option<Pubkey>,

    /// Number of active asset slots (1–MAX_ASSETS).
    /// Slots `[0..num_assets)` are active; remaining slots are zeroed.
    pub num_assets: u8,

    /// Per-asset configuration.
    pub assets: [AssetInfo; MAX_ASSETS],
}

// ── Vault methods ──────────────────────────────────────────────────────────────

impl Vault {
    /// Update ATH and rolling 30-day high share prices.
    pub fn update_high_prices(&mut self, share_price: u64, now: i64, rolling_window_secs: i64) {
        if share_price > self.ath_share_price {
            self.ath_share_price = share_price;
        }
        if now > self.rolling_window_start + rolling_window_secs {
            self.rolling_high_price = share_price;
            self.rolling_window_start = now;
        } else if share_price > self.rolling_high_price {
            self.rolling_high_price = share_price;
        }
    }

    /// Return a slice of only the active asset configs.
    pub fn active_assets(&self) -> &[AssetInfo] {
        &self.assets[..self.num_assets as usize]
    }
}

// ── Per-user deposit tracking ──────────────────────────────────────────────────

#[derive(InitSpace)]
#[account]
pub struct UserInfo {
    pub user: Pubkey,
    // ── Lifetime totals ────────────────────────────────────────────────────────
    pub total_usdc_deposited: u64,
    // ── Last deposit snapshot (for slippage / debug inspection) ───────────────
    pub last_usdc_deposited: u64,
    pub last_shares_minted: u64,
    pub last_deposit_ts: i64,
}

// ── Per-user redeem state (3-step async redeem flow) ──────────────────────────
#[derive(InitSpace)]
#[account]
pub struct RedeemState {
    /// Shares burned at request time; 0 means no active redeem.
    pub redeemable_shares: u64,
    /// Unix timestamp — swap / claim are blocked before this.
    pub unlock_time: i64,
    /// Running total of net USDC accumulated across all per-asset swaps.
    /// Incremented each time an asset is swapped; `claim` transfers this amount.
    pub pending_usdc: u64,
    pub bump: u8,
    /// Number of active asset slots at request time — how many entries of
    /// `asset_amount_in` / `asset_swapped` / `asset_usdc_out` are meaningful.
    pub num_assets: u8,
    /// Per-asset input amount (native token units) the redeemer must swap,
    /// snapshotted at `request_redeem` time as the user's proportional slice of
    /// the pool: `floor(pool_balance[i] × shares / total_shares)`.
    /// Indexed to match `Vault.assets[i]`. The per-asset swap instructions read
    /// directly from this array instead of re-deriving the proportion.
    pub asset_amount_in: [u64; MAX_ASSETS],

    /// Per-asset swap completion flag (indexed by `AssetInfo` slot).
    /// `true` once asset[i] has been fully swapped to USDC; prevents re-swapping.
    pub asset_swapped: [bool; MAX_ASSETS],
    /// Net USDC (after performance fee) received from each per-asset swap.
    /// Slot [i] is only meaningful when `asset_swapped[i] == true`.
    pub asset_usdc_out: [u64; MAX_ASSETS],
}

// ── Initialisation params ──────────────────────────────────────────────────────
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AssetInitParam {
    pub mint: Pubkey,
    pub pool_address: Pubkey,
    pub pyth_feed_id: [u8; 32],
    pub allocation_bps: u16,
    pub decimals: u8,
    pub route: PoolRoute,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeParams {
    /// Pubkey that receives accrued performance fees.
    /// When `None`, defaults to the transaction signer at creation time.
    pub fee_recipient: Option<Pubkey>,
    /// Performance fee in basis points (max 2_000).
    pub performance_fee_bps: u16,
    /// Orca Whirlpool USDC↔wSOL first hop; None when all assets use DirectUsdc.
    pub usdc_sol_pool: Option<Pubkey>,
    /// 1–MAX_ASSETS entries; allocation_bps must sum to 10_000.
    pub assets: Vec<AssetInitParam>,
    /// Fixed or dynamic basket; defaults to Dynamic if omitted.
    pub fund_type: FundType,
    /// Max outstanding shares; required for Fixed, ignored for Dynamic.
    pub max_shares: Option<u64>,
}
