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
  created_at?: string;
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
