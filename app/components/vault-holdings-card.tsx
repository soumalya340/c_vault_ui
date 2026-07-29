'use client';

import { useState } from 'react';
import type { Connection } from '@solana/web3.js';
import type { VaultChainAsset } from '@/lib/cvault';
import { assetNameForMint, displayAssetName } from '@/lib/presets/canonical-data';
import type { AssetRegistryEntry } from '@/lib/registryClient';
import { panelClass, sectionLabelClass } from './ui-classes';

export function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Display label for a vault basket leg — registry name first, then presets. */
export function resolveAssetLabel(
  mint: string,
  assetId: number,
  byMint: Map<string, AssetRegistryEntry>,
  byId: Map<number, AssetRegistryEntry>,
): string {
  const fromDb = byMint.get(mint) ?? byId.get(assetId);
  return (
    displayAssetName(fromDb?.asset_name ?? '') ||
    assetNameForMint(mint) ||
    shorten(mint)
  );
}

/** Parses a formatted "$1,234.56" string back to a number for weight × NAV math. */
function parseUsd(value: string): number {
  const n = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function HeldCell({
  connection,
  ataKey,
}: {
  connection: Connection;
  ataKey: string;
}) {
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'ready'; ui: string } | { status: 'error' }
  >({ status: 'idle' });

  if (state.status === 'ready') {
    return <span className="font-mono text-xs tabular-nums text-foreground">{state.ui}</span>;
  }

  return (
    <button
      type="button"
      disabled={state.status === 'loading'}
      onClick={async () => {
        setState({ status: 'loading' });
        try {
          const { PublicKey } = await import('@solana/web3.js');
          const bal = await connection.getTokenAccountBalance(new PublicKey(ataKey));
          setState({ status: 'ready', ui: bal.value.uiAmountString ?? bal.value.amount });
        } catch {
          setState({ status: 'error' });
        }
      }}
      className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent transition-colors hover:text-foreground disabled:opacity-50"
    >
      {state.status === 'loading' ? 'loading…' : state.status === 'error' ? 'retry' : 'reveal'}
    </button>
  );
}

export function VaultHoldingsCard({
  assets,
  assetsLoading,
  assetsError,
  totalNavUsd,
  byMint,
  byId,
  connection,
}: {
  assets: VaultChainAsset[] | null;
  assetsLoading: boolean;
  assetsError: string | null;
  totalNavUsd: string | null;
  byMint: Map<string, AssetRegistryEntry>;
  byId: Map<number, AssetRegistryEntry>;
  connection: Connection;
}) {
  const navValue = totalNavUsd ? parseUsd(totalNavUsd) : null;

  return (
    <div className={`${panelClass} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-border-strong px-5 py-3 md:px-6">
        <span className={`${sectionLabelClass} uppercase`}>Holdings</span>
        {assets && (
          <span className={`${sectionLabelClass} uppercase`}>
            {assets.length} constituent{assets.length === 1 ? '' : 's'} · live weights
          </span>
        )}
      </div>

      {assetsLoading && (
        <p className="px-5 py-5 font-mono text-xs text-muted-foreground md:px-6">
          <span className="t-shimmer" data-text="loading basket…">
            loading basket…
          </span>
        </p>
      )}

      {!assetsLoading && assetsError && (
        <p className="px-5 py-5 font-mono text-xs text-destructive md:px-6">
          <span className="mr-2 text-muted-foreground/50">&gt;</span>
          assets unavailable — {assetsError}
        </p>
      )}

      {!assetsLoading && !assetsError && assets && assets.length === 0 && (
        <p className="px-5 py-5 font-mono text-xs text-muted-foreground md:px-6">
          <span className="mr-2 text-muted-foreground/50">&gt;</span>
          no assets on-chain
        </p>
      )}

      {!assetsLoading && !assetsError && assets && assets.length > 0 && (
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:px-6">
                Token
              </th>
              <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Weight
              </th>
              <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Value
              </th>
              <th className="px-5 py-2 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:px-6">
                Held
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {assets.map((asset, i) => {
              const mint = asset.mint.toBase58();
              const title = resolveAssetLabel(mint, asset.assetId, byMint, byId);
              const weightPct = asset.allocationBps / 100;
              const valueUsd =
                navValue !== null ? `$${((navValue * weightPct) / 100).toFixed(2)}` : '—';
              return (
                <tr key={`${mint}-${i}`}>
                  <td className="px-5 py-3 text-sm font-medium tracking-[-0.01em] text-foreground md:px-6">
                    {title}
                    <div className="font-mono text-[11px] text-muted-foreground/70">
                      mint {shorten(mint)}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-foreground">
                    {weightPct.toFixed(2)}%
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-foreground">
                    {valueUsd}
                  </td>
                  <td className="px-5 py-3 text-right md:px-6">
                    <HeldCell connection={connection} ataKey={asset.vaultAssetAtaKey.toBase58()} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
