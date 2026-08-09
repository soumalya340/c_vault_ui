/**
 * Canonical preset data mirrored from c_vault_script (Pools.md / Vault.md).
 * Keep in sync with:
 *   - c_vault_script/constant.js (ASSET_PRESETS)
 *   - c_vault_script/lib/vaultPresets.js (VAULT_PRESETS)
 *   - db/supabase/migration/0005_presets.sql
 */

export const ASSET_PRESETS = [
  {
    key: "wsol",
    aliases: ["sol", "wsol", "wrapped sol"],
    asset_name: "SOL",
    mint: "So11111111111111111111111111111111111111112",
    pool_address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
    pyth_feed_id: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    decimals: 9,
    route: "DirectUsdc",
    price_source_tag: 0,
    price_dex_kind: 0,
    swap_kind: "Whirlpool",
    token_program_tag: 0,
  },
  {
    key: "wbtc",
    aliases: ["btc", "wbtc", "bitcoin", "wrapped bitcoin"],
    asset_name: "BTC",
    mint: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
    pool_address: "B5EwJVDuAauzUEEdwvbuXzbFFgEYnUqqS37TUM1c4PQA",
    pyth_feed_id: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    decimals: 8,
    route: "ViaSol",
    price_source_tag: 0,
    price_dex_kind: 0,
    swap_kind: "Whirlpool",
    token_program_tag: 0,
  },
  {
    key: "weth",
    aliases: ["eth", "weth", "ethereum", "wrapped ethereum"],
    asset_name: "ETH",
    mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    pool_address: "HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF",
    pyth_feed_id: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    decimals: 8,
    route: "ViaSol",
    price_source_tag: 0,
    price_dex_kind: 0,
    swap_kind: "Whirlpool",
    token_program_tag: 0,
  },
  {
    key: "w26",
    aliases: ["w26", "w26-usdc", "w26usdc", "w26 usdc"],
    asset_name: "W26",
    mint: "AYYfBtUEwQp5ynUD4AUd8azoyxgtp7oH7QsSBvCmmoon",
    pool_address: "3AK56LD4ih9uKGuAUwJ7MuhABAcibiwj3g5hE9ky5d9w",
    pyth_feed_id: "0000000000000000000000000000000000000000000000000000000000000000",
    decimals: 6,
    route: "DirectUsdc",
    price_source_tag: 1,
    price_dex_kind: 1,
    swap_kind: "DammV2",
    token_program_tag: 0,
  },
  {
    key: "nest",
    aliases: ["nest", "nest-sol", "nestsol", "nest sol"],
    asset_name: "NEST",
    mint: "68Nq68CrtLVpyvK5Un7UADiNczaGf39hBbj3diRsYj6D",
    pool_address: "FpqhEG281t5Bi6yT782ieQkpzmPMRyBY5oirK1rcwCH1",
    pyth_feed_id: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    decimals: 9,
    route: "ViaSol",
    price_source_tag: 1,
    price_dex_kind: 1,
    swap_kind: "DammV2",
    token_program_tag: 0,
  },
  {
    key: "spcx",
    aliases: ["spcx", "spcx-usdc", "spcxusdc", "spcx / usdc", "spcx/usdc"],
    asset_name: "SPCX",
    mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb",
    pool_address: "FgjxPHeYsq1axH29fnGKZi6UyRWi4tMPHgu1gc3ezA9U",
    pyth_feed_id: "0000000000000000000000000000000000000000000000000000000000000000",
    decimals: 6,
    route: "DirectUsdc",
    price_source_tag: 1,
    price_dex_kind: 0,
    swap_kind: "Whirlpool",
    token_program_tag: 1,
  },
  {
    key: "jup",
    aliases: ["jup", "jup-sol", "jupsol", "jup / sol", "jup/sol", "jupiter"],
    asset_name: "JUP",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    pool_address: "C1MgLojNLWBKADvu9BHdtgzz1oZX4dZ5zGdGcgvvW8Wz",
    pyth_feed_id: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    decimals: 6,
    route: "ViaSol",
    price_source_tag: 1,
    price_dex_kind: 0,
    swap_kind: "Whirlpool",
    token_program_tag: 0,
  },
  {
    key: "nvda",
    aliases: ["nvda", "nvdax", "nvda-usdc", "nvda / usdc", "nvda/usdc", "nvidia"],
    asset_name: "NVDAx",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    pool_address: "6R4r93V5fcMzc13CL2enEepDSYcr4Qx3ptZBDwudTXCo",
    pyth_feed_id: "0000000000000000000000000000000000000000000000000000000000000000",
    decimals: 8,
    route: "DirectUsdc",
    price_source_tag: 1,
    price_dex_kind: 0,
    swap_kind: "Whirlpool",
    token_program_tag: 1,
  },
  {
    // Mainnet MET/USDC DAMM v2 — same listing as programs tests (dev.test.ts).
    key: "met",
    aliases: ["met", "meteora", "met-usdc", "metusdc", "met usdc", "metcoin", "met coin"],
    asset_name: "MET",
    mint: "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL",
    pool_address: "BnztueWcXv93mgW7yJe8WYpnCxpz34nujPhfjQT6SLu1",
    pyth_feed_id: "0000000000000000000000000000000000000000000000000000000000000000",
    decimals: 6,
    route: "DirectUsdc",
    price_source_tag: 1,
    price_dex_kind: 1,
    swap_kind: "DammV2",
    token_program_tag: 0,
  },
] as const;

export const VAULT_PRESETS = [
  {
    vault: 1,
    name: "Blue Chip Trio",
    symbol: "BCT3",
    theme: "Pyth majors only — smoke test after genesis + two create_asset calls",
    assets: [
      { assetId: 0, allocationBps: 4000, role: "L1 anchor (Pyth)" },
      { assetId: 1, allocationBps: 3500, role: "BTC store-of-value (Pyth)" },
      { assetId: 2, allocationBps: 2500, role: "ETH beta (Pyth)" },
    ],
  },
  {
    vault: 2,
    name: "Core Four",
    symbol: "CORE4",
    theme: "Large caps + JUP — majors with one Solana DeFi leg",
    assets: [
      { assetId: 0, allocationBps: 3000, role: "Core SOL" },
      { assetId: 1, allocationBps: 2500, role: "BTC leg" },
      { assetId: 2, allocationBps: 2500, role: "ETH leg" },
      { assetId: 6, allocationBps: 2000, role: "JUP / Solana DeFi (DEX TWAP)" },
    ],
  },
  {
    vault: 3,
    name: "DEX Quad",
    symbol: "DEX4",
    theme: "Pools.md DEX tokens only — no WBTC/WETH",
    assets: [
      { assetId: 0, allocationBps: 2500, role: "wSOL anchor" },
      { assetId: 3, allocationBps: 2500, role: "W26-USDC (DAMM v2)" },
      { assetId: 4, allocationBps: 2500, role: "NEST-SOL (DAMM v2)" },
      { assetId: 6, allocationBps: 2500, role: "JUP-SOL (Whirlpool)" },
    ],
  },
  {
    vault: 4,
    name: "Balanced Five",
    symbol: "BAL5",
    theme: "Majors + meme/alt DEX legs — balanced risk",
    assets: [
      { assetId: 0, allocationBps: 2500, role: "SOL core" },
      { assetId: 1, allocationBps: 2000, role: "BTC" },
      { assetId: 2, allocationBps: 2000, role: "ETH" },
      { assetId: 5, allocationBps: 2000, role: "SPCX-USDC (Whirlpool, Token-2022)" },
      { assetId: 6, allocationBps: 1500, role: "JUP-SOL" },
    ],
  },
  {
    vault: 5,
    name: "TWAP Penta",
    symbol: "TWP5",
    theme: "Full TWAP coverage — every DEX-priced preset from Pools.md",
    assets: [
      { assetId: 0, allocationBps: 2000, role: "Pyth anchor" },
      { assetId: 3, allocationBps: 2000, role: "W26 DirectUsdc TWAP" },
      { assetId: 4, allocationBps: 2000, role: "NEST ViaSol TWAP" },
      { assetId: 5, allocationBps: 2000, role: "SPCX DirectUsdc TWAP" },
      { assetId: 6, allocationBps: 2000, role: "JUP ViaSol TWAP" },
    ],
  },
  {
    vault: 6,
    name: "Six Mix",
    symbol: "MIX6",
    theme: "Even-ish blend — majors tilt + DAMM alts",
    assets: [
      { assetId: 0, allocationBps: 2200, role: "SOL overweight" },
      { assetId: 1, allocationBps: 1800, role: "BTC" },
      { assetId: 2, allocationBps: 1800, role: "ETH" },
      { assetId: 3, allocationBps: 1500, role: "W26" },
      { assetId: 4, allocationBps: 1400, role: "NEST" },
      { assetId: 6, allocationBps: 1300, role: "JUP" },
    ],
  },
  {
    vault: 7,
    name: "Seven Star",
    symbol: "S7",
    theme: "Full registry — all seven listed assets, equal-ish weights",
    assets: [
      { assetId: 0, allocationBps: 1800, role: "wSOL" },
      { assetId: 1, allocationBps: 1400, role: "wBTC" },
      { assetId: 2, allocationBps: 1400, role: "wETH" },
      { assetId: 3, allocationBps: 1400, role: "W26" },
      { assetId: 4, allocationBps: 1400, role: "NEST" },
      { assetId: 5, allocationBps: 1300, role: "SPCX" },
      { assetId: 6, allocationBps: 1300, role: "JUP" },
    ],
  },
  {
    vault: 8,
    name: "Route Blend",
    symbol: "RBL7",
    theme: "Swap-route stress — ViaSol vs DirectUsdc mix",
    assets: [
      { assetId: 0, allocationBps: 1500, role: "DirectUsdc (wSOL)" },
      { assetId: 1, allocationBps: 1600, role: "ViaSol (wBTC)" },
      { assetId: 2, allocationBps: 1600, role: "ViaSol (wETH)" },
      { assetId: 3, allocationBps: 1400, role: "DirectUsdc (W26)" },
      { assetId: 4, allocationBps: 1500, role: "ViaSol (NEST)" },
      { assetId: 5, allocationBps: 1200, role: "DirectUsdc (SPCX)" },
      { assetId: 6, allocationBps: 1200, role: "ViaSol (JUP)" },
    ],
  },
  {
    vault: 9,
    name: "RWA Quad",
    symbol: "RWA4",
    theme: "RWA equities — wSOL + wETH anchors, NVDAx + SPCX (Token-2022)",
    assets: [
      { assetId: 0, allocationBps: 2500, role: "wSOL anchor (Pyth)" },
      { assetId: 2, allocationBps: 2500, role: "wETH (Pyth)" },
      { assetId: 7, allocationBps: 2500, role: "NVDAx/USDC (DEX TWAP, Token-2022)" },
      { assetId: 5, allocationBps: 2500, role: "SPCX/USDC (DEX TWAP, Token-2022)" },
    ],
  },
  {
    vault: 10,
    name: "Wildcard Eight",
    symbol: "WLD8",
    theme: "Random alt mix — all eight listed assets, no single narrative",
    assets: [
      { assetId: 0, allocationBps: 1250, role: "wSOL" },
      { assetId: 1, allocationBps: 1250, role: "wBTC" },
      { assetId: 2, allocationBps: 1250, role: "wETH" },
      { assetId: 3, allocationBps: 1250, role: "W26" },
      { assetId: 4, allocationBps: 1250, role: "NEST" },
      { assetId: 5, allocationBps: 1250, role: "SPCX" },
      { assetId: 6, allocationBps: 1250, role: "JUP" },
      { assetId: 7, allocationBps: 1250, role: "NVDAx" },
    ],
  },
] as const;

/**
 * Shorten verbose registry/preset names for UI showcase.
 * Keeps legacy "Wrapped SOL" / DB rows readable as SOL / BTC / ETH.
 */
const ASSET_DISPLAY_ALIASES: Record<string, string> = {
  'wrapped sol': 'SOL',
  'wrapped btc': 'BTC',
  'wrapped eth': 'ETH',
  'wrapped bitcoin': 'BTC',
  'wrapped ethereum': 'ETH',
  wsol: 'SOL',
  wbtc: 'BTC',
  weth: 'ETH',
  meteora: 'MET',
  'met coin': 'MET',
  metcoin: 'MET',
};

/** Longer human name shown beside the ticker in basket rows. */
const ASSET_FULL_NAMES: Record<string, string> = {
  SOL: 'Solana',
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  JUP: 'Jupiter',
  SPCX: 'SpaceX',
  NVDAx: 'NVIDIA',
  NEST: 'Nest',
  W26: 'W26',
  BONK: 'Bonk',
  MET: 'Meteora',
};

/** Optional full name for a short ticker (e.g. SOL → Solana). */
export function assetFullName(ticker: string): string {
  const key = ticker.trim();
  if (!key) return '';
  return ASSET_FULL_NAMES[key] ?? ASSET_FULL_NAMES[key.toUpperCase()] ?? '';
}

/** Map a stored asset_name to the short UI label when known. */
export function displayAssetName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return ASSET_DISPLAY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/** Resolve a display name for a mint from the canonical Pools.md preset catalog. */
export function assetNameForMint(mint: string): string {
  const preset = ASSET_PRESETS.find((p) => p.mint === mint);
  return preset ? displayAssetName(preset.asset_name) : '';
}