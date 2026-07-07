'use client';

// Client wrappers for the c_vault_ui API routes. Tokens come from the forge
// `token_registry` table; vaults from the `vaults` table
// (forge/supabase/migrations/0004_vaults.sql) — the single source of truth
// for what the Vaults tab renders.

export interface TokenOption {
  token_index: string;
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  uri: string;
}

export interface VaultAssetRecord {
  mint: string;
  pool_address: string;
  allocation_bps: number;
  decimals: number;
  route: 'ViaSol' | 'DirectUsdc';
  pyth_feed_id: string;
}

export interface VaultRecord {
  vault_address: string;
  vault_id: number;
  network: string;
  vault_authority: string;
  shares_mint: string;
  usdc_vault: string;
  base_mint: string;
  name: string;
  symbol: string;
  uri: string;
  fee_recipient: string;
  performance_fee_bps: number;
  fund_type: 'dynamic' | 'fixed';
  max_shares: string | null;
  usdc_sol_pool: string | null;
  assets: VaultAssetRecord[];
  creator: string;
  tx_signature: string;
  /** ALT created alongside the vault; bundles deposit/redeem swap accounts. */
  alt_address: string | null;
  created_at?: string;
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

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export async function fetchTokens(): Promise<TokenOption[]> {
  const res = await fetch('/api/tokens');
  const { tokens } = await jsonOrThrow<{ tokens: TokenOption[] }>(res);
  return tokens;
}

export async function fetchVaults(network: string): Promise<VaultRecord[]> {
  const res = await fetch(`/api/vaults?network=${encodeURIComponent(network)}`);
  const { vaults } = await jsonOrThrow<{ vaults: VaultRecord[] }>(res);
  return vaults;
}

export async function saveVault(row: Omit<VaultRecord, 'created_at'>): Promise<void> {
  const res = await fetch('/api/vaults', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  await jsonOrThrow<{ ok: boolean }>(res);
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
