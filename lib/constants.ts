import { PublicKey } from '@solana/web3.js';

/** Local copy of app/providers.tsx's Network type — kept dependency-free to avoid a cycle. */
export type Network = 'devnet' | 'mainnet';

/**
 * c_vault program id — same on devnet and mainnet (and in the IDL).
 * Old id was 2YW9wGokqo321EtDNWWH2CSQxFiJz3uMoNxa9dgbHn2P — do not use for PDAs.
 */
export const C_VAULT_PROGRAM_ID = new PublicKey(
  '7wcJJoT1d1kSUkc3HHvH2DG1cVvDXm6psLwe2pHgdQUk',
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

export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/**
 * Per-network values only. Program id is the constant C_VAULT_PROGRAM_ID
 * (same on mainnet and devnet); only the USDC mint differs by cluster.
 */
export const NETWORK_CONSTANTS: Record<Network, { usdcMint: PublicKey }> = {
  mainnet: {
    usdcMint: USDC_MINT,
  },
  devnet: {
    usdcMint: new PublicKey('CBh1CYgXrqK48NPKwCYe91fiUv66w9K2dBcjsKheaP23'),
  },
};

export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
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

export const WSOL_USDC_POOL = new PublicKey('Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE');
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

/** `AssetInfo.price_source_tag` / create_etf `price_source_tag`. */
export const PRICE_SOURCE_PYTH = 0;
export const PRICE_SOURCE_DEX = 1;

/** `AssetInfo.token_program_tag`. */
export const TOKEN_PROGRAM_TAG_SPL = 0;
export const TOKEN_PROGRAM_TAG_TOKEN_2022 = 1;

export const PRICE_SCALE = 1_000_000_000;
