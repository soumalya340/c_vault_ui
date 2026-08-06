import { Connection, PublicKey, type Commitment } from '@solana/web3.js';
import { C_VAULT_PROGRAM_ID } from '../constants';

/**
 * Live cluster probe: is the RPC reachable, and is c_vault deployed
 * (executable program account present)?
 *
 * Solana has no separate "if exists" opcode for this — we use JSON-RPC:
 *   - getSlot        → RPC is up
 *   - getAccountInfo → program account exists and is executable
 */

export type ClusterHealth = {
  /** True when the RPC answered within the timeout. */
  rpcOnline: boolean;
  /** True when C_VAULT_PROGRAM_ID is an executable account on this cluster. */
  programDeployed: boolean;
  /** Latest processed slot when RPC is online; null when offline. */
  slot: number | null;
  /** Human-readable reason when something is wrong; null when healthy. */
  detail: string | null;
  checkedAt: number;
};

const DEFAULT_TIMEOUT_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Probe RPC reachability + program deployment on the given connection.
 * Safe to call from the browser; never throws — failures become fields on
 * the returned status object.
 */
export async function probeClusterHealth(
  connection: Connection,
  options?: {
    programId?: PublicKey;
    timeoutMs?: number;
    commitment?: Commitment;
  },
): Promise<ClusterHealth> {
  const programId = options?.programId ?? C_VAULT_PROGRAM_ID;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const commitment = options?.commitment ?? 'processed';
  const checkedAt = Date.now();

  let slot: number;
  try {
    slot = await withTimeout(connection.getSlot(commitment), timeoutMs, 'getSlot');
  } catch (err) {
    return {
      rpcOnline: false,
      programDeployed: false,
      slot: null,
      detail: errorMessage(err),
      checkedAt,
    };
  }

  try {
    // dataSlice length 0: we only need existence + executable bit, not bytecode.
    const info = await withTimeout(
      connection.getAccountInfo(programId, {
        commitment: 'confirmed',
        dataSlice: { offset: 0, length: 0 },
      }),
      timeoutMs,
      'getAccountInfo',
    );

    if (info === null) {
      return {
        rpcOnline: true,
        programDeployed: false,
        slot,
        detail: `No account at program id ${programId.toBase58().slice(0, 8)}…`,
        checkedAt,
      };
    }

    if (!info.executable) {
      return {
        rpcOnline: true,
        programDeployed: false,
        slot,
        detail: 'Account exists but is not executable (not a deployed program)',
        checkedAt,
      };
    }

    return {
      rpcOnline: true,
      programDeployed: true,
      slot,
      detail: null,
      checkedAt,
    };
  } catch (err) {
    return {
      rpcOnline: true,
      programDeployed: false,
      slot,
      detail: errorMessage(err),
      checkedAt,
    };
  }
}

/** True when both RPC and the program are ready for txs. */
export function isClusterReady(health: ClusterHealth | null): boolean {
  return Boolean(health?.rpcOnline && health?.programDeployed);
}
