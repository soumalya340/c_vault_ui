'use client';

// Client wrappers for the c_vault_ui API routes. Tokens come from the forge
// `token_registry` table; vaults from the `vaults` table
// (db/supabase/migration/0001_vaults.sql) — the single source of truth
// for what the Vaults tab renders.

export interface TokenOption {
  token_index: string;
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  uri: string;
}

/** One row from `pre_approved_token_registry` — mirrors the on-chain AssetInfo shape. */
export interface AssetRegistryEntry {
  asset_id: string;
  asset_name: string;
  mint: string;
  pool_address: string;
  pyth_feed_id: string;
  decimals: number;
  route: 'ViaSol' | 'DirectUsdc';
  price_source_tag: number;
  price_dex_kind: number;
  price_pool_address: string;
  swap_kind: 'Whirlpool' | 'DammV2';
  token_program_tag: number;
  active: boolean;
}

/** Off-chain vault row — matches live Supabase `vaults` (docs/Supabase_Info.md). */
export interface VaultRecord {
  vault_address: string;
  vault_id: number;
  network: string;
  vault_authority: string;
  shares_mint: string;
  usdc_vault: string;
  name: string;
  symbol: string;
  uri: string;
  fee_recipient: string;
  fund_type: 'dynamic' | 'fixed';
  max_shares: string | null;
  creator: string;
  tx_signature: string;
  /** ALT created alongside the vault; bundles deposit/redeem swap accounts. */
  alt_address: string | null;
  paused: number;
  admin_locked: number;
  vault_manager: string;
  deposit_fee_bps: number;
  redeem_fee_bps: number;
  total_usdc_value: string;
  asset_ids: number[];
  asset_allocation_bps: number[];
  num_assets: number;
  /** Mirrors on-chain `Vault.genesis_done` — false until genesis_deposit succeeds. */
  genesis_deposit_status: boolean;
  /** True once DAMM v2 shares×USDC customizable pool exists on-chain. */
  is_pool_created: boolean;
  /** Free-text vault description, mirrored on-chain via `set_share_metadata_fields`. */
  additional_metadata: string | null;
  created_at?: string;
}

/** One row from `asset_presets` (Pools.md) — the catalogue `create_asset` can fill from. */
export interface AssetPresetRecord {
  preset_key: string;
  asset_name: string;
  mint: string;
  pool_address: string;
  pyth_feed_id: string;
  decimals: number;
  route: 'ViaSol' | 'DirectUsdc';
  price_source_tag: number;
  price_dex_kind: number;
  swap_kind: 'Whirlpool' | 'DammV2';
  token_program_tag: number;
  aliases: string[];
}

export interface PoolRecord {
  pool_address: string;
  mint_a: string;
  mint_b: string;
  symbol_a: string;
  symbol_b: string;
  decimals_a: number;
  decimals_b: number;
  tick_spacing: number;
  network: string;
}

export interface PythRecord {
  token_name: string;
  pyth_id: string; // 64-char hex feed id, no 0x prefix
  mint_address: string;
}

/**
 * Thrown by `jsonOrThrow` when the API response names which request field
 * caused the failure (e.g. a duplicate-mint 409) — callers can attach
 * `.field` to the matching form input instead of only showing a toast.
 */
export class FieldError extends Error {
  field: string;
  constructor(message: string, field: string) {
    super(message);
    this.name = 'FieldError';
    this.field = field;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    const field =
      body && typeof body === 'object' && 'field' in body
        ? String((body as { field: unknown }).field)
        : null;
    throw field ? new FieldError(message, field) : new Error(message);
  }
  return body as T;
}

export async function fetchTokens(): Promise<TokenOption[]> {
  const res = await fetch('/api/tokens');
  const { tokens } = await jsonOrThrow<{ tokens: TokenOption[] }>(res);
  return tokens;
}

/** Pre-approved assets for the Create ETF token picker, scoped to `network`. */
export async function fetchAssetRegistry(network: string): Promise<AssetRegistryEntry[]> {
  const res = await fetch(`/api/asset-registry?network=${encodeURIComponent(network)}`);
  const { assets } = await jsonOrThrow<{ assets: AssetRegistryEntry[] }>(res);
  return assets;
}

/**
 * Mirror a just-listed `create_asset` call into `pre_approved_token_registry`.
 * Throws `FieldError` on `mint` when that mint is already listed on this network.
 */
export async function saveAssetRegistryEntry(
  row: AssetRegistryEntry & { network: string },
): Promise<void> {
  const res = await fetch('/api/asset-registry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  await jsonOrThrow<{ ok: boolean }>(res);
}

/** Catalogue of known assets (Pools.md), seeded identically on every network. */
export async function fetchAssetPresets(network: string): Promise<AssetPresetRecord[]> {
  const res = await fetch(`/api/presets?network=${encodeURIComponent(network)}`);
  const { assetPresets } = await jsonOrThrow<{ assetPresets: AssetPresetRecord[] }>(res);
  return assetPresets;
}

/** Insert (or return existing) mint in `token_registry` when a new token is used. */
export async function saveToken(row: {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  uri?: string;
  pda?: string;
  daily_cap?: string;
}): Promise<TokenOption> {
  const res = await fetch('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  const { token } = await jsonOrThrow<{ token: TokenOption; created: boolean }>(res);
  return token;
}

export async function fetchVaults(network: string): Promise<VaultRecord[]> {
  const res = await fetch(`/api/vaults?network=${encodeURIComponent(network)}`);
  const { vaults } = await jsonOrThrow<{ vaults: VaultRecord[] }>(res);
  // Older rows / partial selects may omit flags — treat missing as not done.
  return vaults.map((v) => ({
    ...v,
    genesis_deposit_status: Boolean(v.genesis_deposit_status),
    is_pool_created: Boolean(v.is_pool_created),
  }));
}

export async function saveVault(
  row: Omit<VaultRecord, 'created_at' | 'additional_metadata'> & { additional_metadata?: string | null },
): Promise<void> {
  const res = await fetch('/api/vaults', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  await jsonOrThrow<{ ok: boolean }>(res);
}

/** Drafts "Additional information" text from the share name via the server-side NVIDIA route. */
export async function generateVaultDescription(shareName: string): Promise<string> {
  const res = await fetch('/api/vault-metadata/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shareName }),
  });
  const { text } = await jsonOrThrow<{ text: string }>(res);
  return text;
}

/** Uploads an image (already compressed client-side) to Vercel Blob; returns its public URL. */
export async function uploadVaultMetadataImage(file: File): Promise<string> {
  const res = await fetch(`/api/vault-metadata/upload-image?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  const { url } = await jsonOrThrow<{ url: string }>(res);
  return url;
}

/**
 * Persist deposit/redeem ALT addresses after create_etf or genesis auto-create.
 * Writes `deposit_alt_address`, `redeem_alt_address`, and legacy `alt_address`
 * (API aliases deposit → alt_address for older clients).
 */
export async function updateVaultAlts(
  network: string,
  vaultId: number,
  alts: {
    deposit_alt_address: string | null;
    redeem_alt_address: string | null;
  },
): Promise<VaultRecord> {
  const res = await fetch('/api/vaults', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      network,
      vault_id: vaultId,
      deposit_alt_address: alts.deposit_alt_address,
      redeem_alt_address: alts.redeem_alt_address,
    }),
  });
  const { vault } = await jsonOrThrow<{ vault: VaultRecord }>(res);
  return vault;
}

/** Persist `genesis_deposit_status` after a successful genesis or on-chain reconcile. */
export async function updateVaultGenesisStatus(
  network: string,
  vaultId: number,
  genesisDepositStatus: boolean,
): Promise<VaultRecord> {
  const res = await fetch('/api/vaults', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      network,
      vault_id: vaultId,
      genesis_deposit_status: genesisDepositStatus,
    }),
  });
  const { vault } = await jsonOrThrow<{ vault: VaultRecord }>(res);
  return {
    ...vault,
    genesis_deposit_status: Boolean(vault.genesis_deposit_status),
    is_pool_created: Boolean(vault.is_pool_created),
  };
}

/** Persist `is_pool_created` after DAMM v2 pool create or on-chain reconcile. */
export async function updateVaultPoolCreated(
  network: string,
  vaultId: number,
  isPoolCreated: boolean,
): Promise<VaultRecord> {
  const res = await fetch('/api/vaults', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      network,
      vault_id: vaultId,
      is_pool_created: isPoolCreated,
    }),
  });
  const { vault } = await jsonOrThrow<{ vault: VaultRecord }>(res);
  return {
    ...vault,
    genesis_deposit_status: Boolean(vault.genesis_deposit_status),
    is_pool_created: Boolean(vault.is_pool_created),
  };
}

/** Pool for a mint pair (either order) from `orca_pools` — null when absent. */
export async function fetchPool(
  mintA: string,
  mintB: string,
  network: string,
): Promise<PoolRecord | null> {
  const params = new URLSearchParams({ mintA, mintB, network });
  const res = await fetch(`/api/pools?${params}`);
  const { pool } = await jsonOrThrow<{ pool: PoolRecord | null }>(res);
  return pool;
}

/** Every pool in `orca_pools` that includes `mint` on either side. */
export async function fetchAllPoolsForMint(
  mint: string,
  network: string,
): Promise<PoolRecord[]> {
  const params = new URLSearchParams({ mint, network });
  const res = await fetch(`/api/pools?${params}`);
  const { pools } = await jsonOrThrow<{ pools: PoolRecord[] }>(res);
  return pools;
}

/**
 * Every pool pairing `mint` with any of `counterMints` (e.g. the base mint
 * and wSOL) — powers the pool picker dropdown so a token with both a
 * base-mint pool and a SOL pool lets the user choose either.
 */
export async function fetchPoolsForToken(
  mint: string,
  counterMints: string[],
  network: string,
): Promise<PoolRecord[]> {
  const params = new URLSearchParams({
    mint,
    counterMints: counterMints.join(','),
    network,
  });
  const res = await fetch(`/api/pools?${params}`);
  const { pools } = await jsonOrThrow<{ pools: PoolRecord[] }>(res);
  return pools;
}

/** Pyth feed id for a mint from `PythInfo` — null when absent. */
export async function fetchPythInfo(mint: string): Promise<PythRecord | null> {
  const res = await fetch(`/api/pyth?mint=${encodeURIComponent(mint)}`);
  const { pyth } = await jsonOrThrow<{ pyth: PythRecord | null }>(res);
  return pyth;
}

/** Record a manually supplied pyth feed id so future lookups find it. */
export async function savePythInfo(row: PythRecord): Promise<void> {
  const res = await fetch('/api/pyth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  await jsonOrThrow<{ ok: boolean }>(res);
}
