/**
 * Wire contract for the vault price stream. Mirrors `NavView`
 * (`lib/cvault.tsx`) plus stream metadata (`slot`, `ts`, `stale`).
 */
export interface NavPricePayload {
  vaultId: number;
  /** Human-readable, e.g. `$1.0342`. */
  sharePriceUsd: string;
  /** Human-readable, e.g. `$12,043.11`. */
  totalNavUsd: string;
  totalSharesUi: string;
  /** Raw, PRICE_SCALE (1e9) units. */
  sharePrice: string;
  /** Raw, 6-decimal USDC. */
  totalNav: string;
  /** Slot the simulation was evaluated against; 0 when unknown. */
  slot: number;
  /** Server epoch ms at broadcast. */
  ts: number;
  /** True when the last recompute failed and this is the previous good value. */
  stale: boolean;
  /** Present only for an empty vault — explains the $0.00 result. */
  note?: string;
}

export type NavStreamMessage =
  | ({ type: 'snapshot' | 'update' } & NavPricePayload)
  | { type: 'error'; vaultId: number; message: string };

export type ClientCommand = { type: 'subscribe'; vaultId: number };

/**
 * Parse an inbound client frame. Returns null for anything unrecognised —
 * callers must treat null as a protocol error and close the socket. Vault ids
 * are on-chain `u64` slot indices, so only non-negative integers are valid.
 */
export function parseClientCommand(raw: string): ClientCommand | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { type, vaultId } = parsed as Record<string, unknown>;
  if (type !== 'subscribe') return null;
  if (typeof vaultId !== 'number' || !Number.isInteger(vaultId) || vaultId < 0) {
    return null;
  }
  return { type: 'subscribe', vaultId };
}
