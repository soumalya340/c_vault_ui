import { Connection, type Commitment, type ConnectionConfig } from '@solana/web3.js';

/**
 * Every wallet gets the public RPC and nothing else. Only the admin wallet
 * (ADMIN_PUBKEY, armed via setFailoverAdminMode) gets retries: 3 failed
 * attempts against the public endpoint, then a permanent switch to Helius
 * for the rest of the session. The Helius URL is fetched from
 * /api/rpc/helius on demand — the API key never reaches the client bundle.
 */
const MAX_PUBLIC_ATTEMPTS = 3;

type RpcRequest = (method: string, args: unknown[]) => Promise<unknown>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    // Non-admin: public RPC only, retried on its own (same 429 behavior
    // web3.js used to give everyone for free before we disabled its
    // built-in retry above) — but never fails over to Helius.
    if (!adminMode) {
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

    // Public RPC failed 3 times in a row for the admin wallet — switch to
    // Helius permanently for the rest of this session.
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
