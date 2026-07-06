use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    // ── Input validation ──────────────────────────────────────────────────────
    #[msg("Amount must be > 0")]
    ZeroAmount,

    // ── Authorisation ─────────────────────────────────────────────────────────
    #[msg("Unauthorized caller")]
    Unauthorized,

    #[msg("Only admin may call this instruction")]
    UnauthorizedAdmin,

    // ── Vault state ───────────────────────────────────────────────────────────
    #[msg("Vault deposits are paused")]
    VaultPaused,

    #[msg("Genesis deposit not seeded yet — only admin can make the first deposit")]
    GenesisNotSeeded,

    #[msg("Vault is in emergency mode — only withdrawals allowed")]
    EmergencyMode,

    #[msg("Vault is not currently in emergency mode")]
    NotInEmergency,

    #[msg("Insufficient shares to redeem")]
    InsufficientShares,

    // ── Pricing / oracle ──────────────────────────────────────────────────────
    #[msg("Oracle price is stale or unavailable")]
    StaleOracle,

    #[msg("Oracle price is zero or negative")]
    InvalidOraclePrice,

    // ── Swap / CPI ────────────────────────────────────────────────────────────
    #[msg("Slippage tolerance exceeded — try again")]
    SlippageExceeded,

    #[msg("CPI call to external program failed")]
    CpiFailure,

    #[msg("wSOL balance is insufficient to cover WBTC + WETH swap legs")]
    InsufficientWsolBalance,

    #[msg("Token mint does not match expected canonical mint")]
    InvalidMint,

    // ── Account validation ────────────────────────────────────────────────────
    #[msg("Required token account is not initialised or has zero lamports")]
    AccountNotInitialized,

    #[msg("Token account owner does not match expected authority")]
    IncorrectOwner,

    #[msg("remaining_accounts length must equal the number of active vault assets")]
    InvalidAccountsLength,

    // ── Arithmetic ────────────────────────────────────────────────────────────
    #[msg("Math overflow — value too large")]
    MathOverflow,

    // ── Fees ──────────────────────────────────────────────────────────────────
    #[msg("Performance fee cannot exceed 20%")]
    FeeTooHigh,

    #[msg("vault_fee_bps > 0 but no vault_fee_recipient account was provided")]
    MissingFeeRecipient,

    // ── Redeem flow ───────────────────────────────────────────────────────────
    #[msg("Redeem cooldown not elapsed — try again after unlock_time")]
    TooEarlyRedeem,

    #[msg("Cooldown must be between 0 and 604 800 seconds (7 days)")]
    InvalidCooldown,

    #[msg("No USDC pending — swap redeemed assets to USDC first")]
    NothingToClaim,

    #[msg("A redeem is already pending — claim it before starting a new one")]
    RedeemAlreadyPending,

    // ── ETF creation ──────────────────────────────────────────────────────────
    #[msg("Asset allocation BPS must sum to exactly 10 000")]
    InvalidAllocation,

    #[msg("Asset count exceeds the maximum allowed slots")]
    TooManyAssets,

    #[msg("Asset list must contain at least one asset")]
    NoAssets,

    #[msg("vault_id must equal global_state.total_vaults (sequential creation enforced)")]
    InvalidVaultId,

    #[msg("usdc_sol_pool must be provided when any asset uses ViaSol routing")]
    MissingUsdcSolPool,

    #[msg("This asset slot has already been swapped in the current redeem — cannot swap twice")]
    AssetAlreadySwapped,

    #[msg("A Fixed vault must declare a max_shares supply cap")]
    MissingMaxShares,

    #[msg("max_shares must be greater than zero")]
    InvalidMaxShares,

    #[msg("Deposit would exceed the Fixed vault's max_shares supply cap")]
    ShareCapExceeded,

    #[msg("Deposits are disabled program-wide")]
    DepositsDisabled,

    #[msg("Base mint is not on the company-approved eligible list")]
    BaseMintNotEligible,

    #[msg("Eligible base mint list is full")]
    EligibleMintListFull,

    #[msg("Mint is already on the eligible base mint list")]
    EligibleMintAlreadyListed,

    #[msg("Mint is not on the eligible base mint list")]
    EligibleMintNotFound,

    // ── Inflow deployment ───────────────────────────────────────────────────
    #[msg("asset_index refers to a USDC-native or wSOL-native slot, which never enters the pending pool")]
    InvalidPendingAssetSlot,
}
