/**
 * Surfpool cheatcode RPC helpers (localhost only).
 *
 * Browser-side `Connection` still exposes `_rpcRequest`; Surfpool accepts
 * `surfnet_*` methods on the same HTTP endpoint as the validator.
 */

import type { Connection } from '@solana/web3.js';

type RpcRequest = (
  method: string,
  params: unknown[],
) => Promise<{ result?: unknown; error?: unknown } | unknown>;

export type SurfnetFail = { __failed: true; error: unknown };

export async function surfnetRpc(
  connection: Connection,
  method: string,
  params: unknown[],
): Promise<unknown | SurfnetFail> {
  try {
    const rpc = (connection as unknown as { _rpcRequest: RpcRequest })._rpcRequest;
    if (typeof rpc !== 'function') {
      return { __failed: true, error: new Error('Connection has no _rpcRequest') };
    }
    const result = await rpc.call(connection, method, params);
    if (result && typeof result === 'object' && 'error' in result && (result as { error?: unknown }).error) {
      throw new Error(`${method} failed: ${JSON.stringify((result as { error: unknown }).error)}`);
    }
    if (result && typeof result === 'object' && 'result' in result) {
      return (result as { result: unknown }).result;
    }
    return result;
  } catch (err) {
    return { __failed: true, error: err };
  }
}

export function isSurfnetFail(v: unknown): v is SurfnetFail {
  return Boolean(v && typeof v === 'object' && (v as SurfnetFail).__failed);
}
