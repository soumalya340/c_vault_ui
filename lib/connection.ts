import { Connection, type Commitment, type ConnectionConfig } from '@solana/web3.js';

/**
 * Connection wrapper used for every wallet.
 *
 * Mainnet primary endpoint is normally `NEXT_PUBLIC_HELIUS_RPC` (paid Helius
 * exposed to the frontend so all users share the same RPC). Localhost uses
 * the local validator and never fails over.
 *
 * Admin-only safety net: if the connected wallet is ADMIN_PUBKEY and the
 * primary endpoint is *not* already Helius (e.g. env fell back to public
 * mainnet-beta), after 3 failed attempts we fetch `/api/rpc/helius` and
 * switch for the rest of the session. Server-only `HELIUS_API_KEY` never
 * reaches the client bundle via that path.
 */
const MAX_PUBLIC_ATTEMPTS = 3;

type RpcRequest = (method: string, args: unknown[]) => Promise<unknown>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHeliusEndpoint(url: string): boolean {
  return url.includes('helius');
}

async function fetchHeliusEndpoint(network: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/rpc/helius?network=${network}`);
    if (!res.ok) return null;
    const { url } = (await res.json()) as { url?: string };
    return url ?? null;
  } catch {
    return null;
  }
}

function withoutBuiltinRateLimitRetry(
  config: Commitment | ConnectionConfig,
): ConnectionConfig {
  const base: ConnectionConfig = typeof config === 'string' ? { commitment: config } : config;
  // web3.js retries 429s internally (5x, up to ~8s backoff) before an error
  // ever reaches our wrapper below. Disable that so a 429 surfaces
  // immediately and our own retry/failover loop is the only one running.
  return { ...base, disableRetryOnRateLimit: true };
}

export function createFailoverConnection(
  publicEndpoint: string,
  network: string,
  config: Commitment | ConnectionConfig = 'confirmed',
): Connection {
  const primary = new Connection(publicEndpoint, withoutBuiltinRateLimitRetry(config));
  let adminMode = false;
  let usingHelius = false;
  let fallback: Connection | null = null;
  // Localhost has no Helius host; mainnet already on Helius needs no failover.
  const canFailoverToHelius = network === 'mainnet' && !isHeliusEndpoint(publicEndpoint);

  (primary as unknown as { setFailoverAdminMode: (on: boolean) => void }).setFailoverAdminMode = (
    on: boolean,
  ) => {
    adminMode = on;
  };

  const originalRpcRequest = (primary as unknown as { _rpcRequest: RpcRequest })._rpcRequest;

  const wrappedRpcRequest: RpcRequest = async (method, args) => {
    if (usingHelius && fallback) {
      return (fallback as unknown as { _rpcRequest: RpcRequest })._rpcRequest(method, args);
    }

    // Non-admin, or no Helius failover path: retry primary only.
    if (!adminMode || !canFailoverToHelius) {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= MAX_PUBLIC_ATTEMPTS; attempt += 1) {
        try {
          return await originalRpcRequest(method, args);
        } catch (err) {
          lastErr = err;
          if (attempt < MAX_PUBLIC_ATTEMPTS) await sleep(500 * attempt);
        }
      }
      throw lastErr;
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_PUBLIC_ATTEMPTS; attempt += 1) {
      try {
        return await originalRpcRequest(method, args);
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_PUBLIC_ATTEMPTS) await sleep(250 * attempt);
      }
    }

    // Primary failed 3 times for the admin wallet — switch to Helius for the
    // rest of this session (mainnet only, and only when primary was not Helius).
    const heliusEndpoint = await fetchHeliusEndpoint(network);
    if (!heliusEndpoint) throw lastErr;

    usingHelius = true;
    fallback = new Connection(heliusEndpoint, withoutBuiltinRateLimitRetry(config));
    try {
      return await (fallback as unknown as { _rpcRequest: RpcRequest })._rpcRequest(method, args);
    } catch {
      throw lastErr;
    }
  };

  (primary as unknown as { _rpcRequest: RpcRequest })._rpcRequest = wrappedRpcRequest;

  return primary;
}
