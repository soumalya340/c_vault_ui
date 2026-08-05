import { PublicKey } from '@solana/web3.js';
import idlJson from '@/idl/c_vault.json';

/** Local copy of app/providers.tsx's Network type — kept dependency-free to avoid a cycle. */
export type Network = 'localhost' | 'mainnet';

/**
 * c_vault program id — read from the IDL's `address` field (Anchor 0.30+ format) so this
 * can never drift from what `lib/program.ts`'s `Program` instance resolves at runtime.
 * Prior ids: 7wcJJoT1d1kSUkc3HHvH2DG1cVvDXm6psLwe2pHgdQUk,
 * 2YW9wGokqo321EtDNWWH2CSQxFiJz3uMoNxa9dgbHn2P — do not use for PDAs.
 */
export const C_VAULT_PROGRAM_ID = new PublicKey((idlJson as { address: string }).address);

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
export const REDEEM_SEED = Buffer.from('redeem');
/** Per-user, per-vault USDC escrow for the async redeem flow (C-03). */
export const REDEEM_USDC_SEED = Buffer.from('redeem_usdc');

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

/** Mirror on-chain `MAX_ASSETS` / fee bounds from `programs/vault/src/constants.rs`. */
export const MAX_ASSETS = 8;
export const MAX_DEPOSIT_FEE_BPS = 600;
export const MIN_REDEEM_FEE_BPS = 50;
export const MAX_REDEEM_FEE_BPS = 1000;

/**
 * Hard cap on name+symbol+uri UTF-8 bytes for `create_etf`.
 *
 * Bound by Solana's 1232-byte packet (static keys, no ALT on create) and
 * Anchor's ~1000-byte instruction encoder. A full base64 `data:image/...` URI
 * will blow past this — use a short https link to off-chain metadata/JSON.
 */
export const CREATE_ETF_MAX_METADATA_BYTES = 400;

/**
 * @deprecated TWAP keeper removed from the program (2.0.2). Kept only so dead
 * client modules fail clearly at runtime rather than at import time. Do not use.
 */
export const TWAP_OBSERVATION_MAX_STALE_SECS = 45 * 60;
/** @deprecated See TWAP_OBSERVATION_MAX_STALE_SECS. */
export const TWAP_KEEPER_MAX_STALE_SECS = 60 * 60;
/** @deprecated TWAP keeper instruction removed. */
export const TWAP_KEEPER_PUBKEY = new PublicKey(
  'DExJYXEqEGCzbsN93FeeoQu6cQZkuEB8PBEn64GJKt7W',
);

/** `AssetInfo.token_program_tag`. */
export const TOKEN_PROGRAM_TAG_SPL = 0;
export const TOKEN_PROGRAM_TAG_TOKEN_2022 = 1;

export const PRICE_SCALE = 1_000_000_000;
/** Decimal places implied by `PRICE_SCALE` — for parseUnits/formatUnits on share prices. */
export const PRICE_SCALE_DECIMALS = 9;

/**
 * Baskets with more than this many assets cannot fit deposit / redeem / genesis
 * in one v0 transaction (trace depth + account limits). Split when `numAssets` exceeds
 * this value — mirrors `c_vault_script/Rules.md` and `MULTI_TX_ASSET_THRESHOLD`.
 */
export const MULTI_TX_ASSET_THRESHOLD = 4;

/**
 * Soft guide: per-asset Whirlpool/DAMM legs often add ~8–12 unique accounts.
 * With shared vault/program keys, ~2–3 legs sit safely under the 64-account
 * lock when combined with deposit. Runtime packing uses `packIxsForAlt`
 * (lock count + 1232-byte probe), not this constant, for hard splits.
 */
export const SWAP_LEGS_PER_TX = 2;

/**
 * Max vault-authority ATA create instructions per v0 tx when a basket exceeds
 * MULTI_TX_ASSET_THRESHOLD. Each ix adds a unique mint + ATA pubkey to the
 * message — with an ALT these compress to 1-byte indices, so 8 ATAs stay well
 * under the 1232-byte tx cap.
 */
export const VAULT_ATA_IXS_PER_TX = 8;
