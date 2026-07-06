use anchor_lang::prelude::*;

// ── Account sizing ────────────────────────────────────────────────────────────
pub const ANCHOR_DISCRIMINATOR: usize = 8;

// ── PDA seeds ─────────────────────────────────────────────────────────────────
pub const GLOBAL_STATE_SEED: &[u8] = b"global_state";
pub const VAULT_SEED: &[u8] = b"etf_vault";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";
pub const SHARES_MINT_SEED: &[u8] = b"shares_mint";
pub const USDC_VAULT_SEED: &[u8] = b"usdc_vault";
pub const USER_INFO_SEED: &[u8] = b"user_info";
pub const REDEEM_SEED: &[u8] = b"redeem";

pub const MAX_ASSETS: usize = 8;

/// Max company-approved stablecoin mints allowed as vault `base_mint`.
pub const MAX_ELIGIBLE_BASE_MINTS: usize = 10;

// ── Native mints ──────────────────────────────────────────────────────────────
/// Solana's canonical wrapped-SOL mint — used to detect wSOL-native asset slots.
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
/// Mainnet USDC — default eligible base mint at GlobalState init.
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// ── Admin ─────────────────────────────────────────────────────────────────────
pub const ADMIN_PUBKEY: Pubkey = pubkey!("cyaibXfQvCC4qKDYNguU4mXryhKjSkszPWkd56KFkrF");

// ── Share pricing ─────────────────────────────────────────────────────────────
/// Fixed-point scale for share price: 1_000_000_000 (9-decimal).
pub const PRICE_SCALE: u64 = 1_000_000_000;

// ── Time windows ─────────────────────────────────────────────────────────────
/// 30-day rolling window for high-price tracking (seconds).
pub const ROLLING_WINDOW_SECS: i64 = 30 * 24 * 60 * 60;

/// Maximum age of a Pyth price feed before it is considered stale (seconds).
pub const PYTH_MAX_AGE_SECS: u64 = 60;

/// Redeem cooldown period before swap_to_usdc / claim are allowed (seconds).
pub const REDEEM_COOLDOWN_SECS: i64 = 24 * 60 * 60;

// ── Orca Whirlpool ────────────────────────────────────────────────────────────
pub const WHIRLPOOL_PROGRAM_ID: Pubkey = pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

/// Instruction discriminator for the Orca Whirlpool `swap` instruction.
pub const WHIRLPOOL_SWAP_DISCRIMINATOR: [u8; 8] = [248, 198, 158, 145, 225, 117, 135, 200];

/// Lower sqrt-price bound for Whirlpool swaps.
pub const MIN_SQRT_PRICE_X64: u128 = 4_295_048_016;
/// Upper sqrt-price bound for Whirlpool swaps.
pub const MAX_SQRT_PRICE_X64: u128 = 79_226_673_515_401_279_992_447_579_055;

/// Current program version (synced with Cargo.toml).
pub const PROGRAM_VERSION: &str = "1.1.0";
