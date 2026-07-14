import { PublicKey } from '@solana/web3.js';

/** Local copy of app/providers.tsx's Network type — kept dependency-free to avoid a cycle. */
export type Network = 'localhost' | 'mainnet';

/**
 * c_vault program id — same on every cluster (and in the IDL).
 * Prior ids: 7wcJJoT1d1kSUkc3HHvH2DG1cVvDXm6psLwe2pHgdQUk,
 * 2YW9wGokqo321EtDNWWH2CSQxFiJz3uMoNxa9dgbHn2P — do not use for PDAs.
 */
export const C_VAULT_PROGRAM_ID = new PublicKey(
  '3ifxGy4phHHAEpomdyyrBx2Bs5vKejbUPqsJ1eGPned2',
);

export const ADMIN_PUBKEY = new PublicKey(
  'cyaibXfQvCC4qKDYNguU4mXryhKjSkszPWkd56KFkrF',
);

export const DEFAULT_VAULT_ID = 0;

export const GLOBAL_STATE_SEED = Buffer.from('global_state');
export const ASSET_SEED = Buffer.from('asset');
export const VAULT_SEED = Buffer.from('etf_vault');
export const VAULT_AUTHORITY_SEED = Buffer.from('vault_authority');
export const SHARES_MINT_SEED = Buffer.from('shares_mint');
export const USDC_VAULT_SEED = Buffer.from('usdc_vault');
export const USER_INFO_SEED = Buffer.from('user_info');
export const REDEEM_SEED = Buffer.from('redeem');

/**
 * Quote mint per cluster. The program hardcodes a single `USDC_MINT` constant
 * and is built+deployed once per cluster, so the mint the program accepts
 * differs by deployment. Sending the wrong one fails `create_etf` with
 * QuoteMintNotEligible (6041) and deposit/claim with InvalidMint.
 *
 * Always read these via `NETWORK_CONSTANTS[network].usdcMint` — never import
 * a bare mint constant into instruction-building code.
 */
/** Mainnet (and local validator when mirroring mainnet): Circle USDC. */
export const USDC_MINT_MAINNET = new PublicKey(
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
);

/** Canonical USDC/wSOL Orca Whirlpool — the genesis wSOL asset's swap pool,
 *  prefilled on the Initialize global state form. Same address for mainnet and
 *  localhost (local runs use the same program constants as mainnet). */
export const WSOL_USDC_POOL = new PublicKey('Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE');

/**
 * Per-network values. Localhost and mainnet share program constants (quote mint,
 * USDC↔wSOL pool) — only the RPC endpoint differs. The quote mint seeds the
 * `usdc_vault` PDA; derive with the wrong one and you address a missing vault.
 */
export const NETWORK_CONSTANTS: Record<
  Network,
  { usdcMint: PublicKey; wsolUsdcPool: PublicKey }
> = {
  mainnet: {
    usdcMint: USDC_MINT_MAINNET,
    wsolUsdcPool: WSOL_USDC_POOL,
  },
  localhost: {
    usdcMint: USDC_MINT_MAINNET,
    wsolUsdcPool: WSOL_USDC_POOL,
  },
};

export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

/**
 * Asset id 0 is permanently reserved for wSOL by construction —
 * `init_global_state` creates the genesis wSOL AssetInfo inline and starts
 * `total_assets` at 1. Mirrors `WSOL_ASSET_ID` in the program's constants.rs.
 */
export const WSOL_ASSET_ID = 0;
export const WBTC_MINT = new PublicKey('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
export const WETH_MINT = new PublicKey('7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs');

export const USDC_DECIMALS = 6;
export const WSOL_DECIMALS = 9;
export const WBTC_DECIMALS = 8;
export const WETH_DECIMALS = 8;

export const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
);

/** SPL Memo — required by Whirlpool `swap_v2`. */
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** Meteora DAMM v2 (cp-amm) program. */
export const DAMM_V2_PROGRAM_ID = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');

/** Const PDA `["pool_authority"]` of the cp-amm program. */
export const DAMM_V2_POOL_AUTHORITY = new PublicKey(
  'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC',
);

/** Const PDA `["__event_authority"]` of the cp-amm program. */
export const DAMM_V2_EVENT_AUTHORITY = new PublicKey(
  '3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet',
);

export const WSOL_WBTC_POOL = new PublicKey('B5EwJVDuAauzUEEdwvbuXzbFFgEYnUqqS37TUM1c4PQA');
export const WSOL_WETH_POOL = new PublicKey('HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF');

/**
 * Pyth push-oracle program — the c_vault program reads PriceUpdateV2 accounts
 * for NAV, and the canonical account for a feed id is the PDA
 * [shard(u16 LE), feed_id] on this program. Derived internally; there is no
 * Pyth-facing UI anywhere in c_vault_ui.
 */
export const PYTH_PUSH_ORACLE_PROGRAM_ID = new PublicKey(
  'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT',
);

/**
 * Pyth SOL/USD price feed id (64-char hex, no 0x). Same id on every cluster
 * (Pyth pull oracle) — mirrors `SOL_USD_PYTH_FEED_ID` in the program's
 * constants.rs. Used for ViaSol DEX pricing and as the genesis wSOL asset's
 * default feed.
 */
export const SOL_USD_PYTH_FEED_ID_HEX =
  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

export const SOL_USD_PYTH_FEED_ID: number[] = Array.from(
  Buffer.from(SOL_USD_PYTH_FEED_ID_HEX, 'hex'),
);

/** `AssetInfo.price_source_tag` / create_etf `price_source_tag`. */
export const PRICE_SOURCE_PYTH = 0;
export const PRICE_SOURCE_DEX = 1;

/** `AssetInfo.token_program_tag`. */
export const TOKEN_PROGRAM_TAG_SPL = 0;
export const TOKEN_PROGRAM_TAG_TOKEN_2022 = 1;

export const PRICE_SCALE = 1_000_000_000;
