import { Connection, type Commitment, type ConnectionConfig } from '@solana/web3.js';

/**
 * Single-endpoint Connection for the platform. Mainnet resolves via
 * `getRpcEndpoint` (Helius when set, else public mainnet-beta). No runtime
 * failover to a second RPC.
 */
const MAX_ATTEMPTS = 3;

type RpcRequest = (method: string, args: unknown[]) => Promise<unknown>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withoutBuiltinRateLimitRetry(
  config: Commitment | ConnectionConfig,
): ConnectionConfig {
  const base: ConnectionConfig = typeof config === 'string' ? { commitment: config } : config;
  // web3.js retries 429s internally before our wrapper sees the error — disable
  // so we control retry timing on the single platform endpoint.
  return { ...base, disableRetryOnRateLimit: true };
}

export function createPlatformConnection(
  endpoint: string,
  config: Commitment | ConnectionConfig = 'confirmed',
): Connection {
  const connection = new Connection(endpoint, withoutBuiltinRateLimitRetry(config));
  const originalRpcRequest = (connection as unknown as { _rpcRequest: RpcRequest })._rpcRequest;

  const wrappedRpcRequest: RpcRequest = async (method, args) => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await originalRpcRequest(method, args);
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_ATTEMPTS) await sleep(500 * attempt);
      }
    }
    throw lastErr;
  };

  (connection as unknown as { _rpcRequest: RpcRequest })._rpcRequest = wrappedRpcRequest;

  return connection;
}