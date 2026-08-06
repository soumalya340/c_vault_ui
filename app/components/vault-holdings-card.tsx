'use client';

import { useCallback, useState } from 'react';
import type { Connection } from '@solana/web3.js';
import type { VaultChainAsset } from '@/lib/onchain/cvault';
import { formatTokenUi } from './pending-claim-button';
import { VaultPanel } from './vault-panel';

export type HoldingRow = {
  key: string;
  symbol: string;
  mint: string;
  targetPct: number;
  vaultAssetAtaKey: VaultChainAsset['vaultAssetAtaKey'];
  decimals: number;
};

/**
 * Basket table — target weights from vault config; held balances only on demand
 * (zero extra RPC on page load).
 */
export function VaultHoldingsCard({
  rows,
  connection,
}: {
  rows: HoldingRow[];
  connection: Connection;
}) {
  // mint → ui balance string once revealed
  const [held, setHeld] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reveal = useCallback(
    async (row: HoldingRow) => {
      if (held[row.key] || loading[row.key]) return;
      setLoading((m) => ({ ...m, [row.key]: true }));
      setErrors((m) => {
        const next = { ...m };
        delete next[row.key];
        return next;
      });
      try {
        const bal = await connection.getTokenAccountBalance(row.vaultAssetAtaKey);
        const raw = bal.value.amount;
        const dec = bal.value.decimals ?? row.decimals;
        setHeld((m) => ({ ...m, [row.key]: formatTokenUi(raw, dec) }));
      } catch (err) {
        setErrors((m) => ({
          ...m,
          [row.key]:
            err instanceof Error ? err.message : 'balance unavailable',
        }));
      } finally {
        setLoading((m) => {
          const next = { ...m };
          delete next[row.key];
          return next;
        });
      }
    },
    [connection, held, loading],
  );

  return (
    <VaultPanel
      label="Basket"
      right={
        <>
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {rows.length} asset{rows.length === 1 ? '' : 's'}
          </span>
        </>
      }
      flush
    >
      <div className="hidden grid-cols-[1.4fr_0.8fr_1fr] gap-2.5 border-b border-border bg-foreground/[0.04] px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground md:grid md:px-5">
        <span>Asset</span>
        <span className="text-right">Target</span>
        <span className="text-right">Held on-chain</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 font-mono text-xs text-muted-foreground md:px-5">
          no assets on-chain
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.key}
            className="border-b border-border px-4 py-3 last:border-b-0 md:px-5"
          >
            <div className="grid grid-cols-2 items-center gap-2 md:grid-cols-[1.4fr_0.8fr_1fr]">
              <span className="text-[15px] font-bold tracking-[-0.01em] text-foreground">
                {row.symbol}
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground md:text-[12px]">
                {row.targetPct.toFixed(2)}%
              </span>
              <div className="col-span-2 flex justify-end md:col-span-1">
                {held[row.key] ? (
                  <span className="font-mono text-xs tabular-nums text-foreground md:text-[12px]">
                    {held[row.key]}
                  </span>
                ) : errors[row.key] ? (
                  <button
                    type="button"
                    onClick={() => void reveal(row)}
                    className="font-mono text-[10px] uppercase tracking-[0.1em] text-seal hover:underline"
                    title={errors[row.key]}
                  >
                    retry
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void reveal(row)}
                    disabled={!!loading[row.key]}
                    className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent transition-opacity hover:opacity-80 disabled:opacity-40"
                  >
                    {loading[row.key] ? 'reading…' : 'reveal'}
                  </button>
                )}
              </div>
            </div>
            <div className="relative mt-2.5 h-[3px] bg-border">
              <div
                className="absolute inset-y-0 left-0 bg-accent"
                style={{ width: `${Math.min(row.targetPct, 100)}%` }}
              />
              <div
                className="absolute top-[-2px] h-[7px] w-px bg-foreground"
                style={{ left: `${Math.min(row.targetPct, 100)}%` }}
              />
            </div>
            <div className="mt-1.5 font-mono text-[10px] text-muted-foreground">
              mint {row.mint.slice(0, 4)}…{row.mint.slice(-4)}
            </div>
          </div>
        ))
      )}

      <div className="border-t border-border-strong px-4 py-2.5 md:px-5">
        <span className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
          weights from vault config · held is an on-demand RPC read
        </span>
      </div>
    </VaultPanel>
  );
}
