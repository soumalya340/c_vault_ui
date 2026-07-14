'use client';

import { useEffect, useState } from 'react';
import type { Network } from '@/app/providers';
import { btnGhostClass, fieldLabelClass } from '../ui-classes';
import { DbRowSkeleton } from './db-panel';

type VaultPresetAsset = {
  assetId: number;
  allocationBps: number;
  role: string;
};

type VaultPresetRow = {
  vault_num: number;
  name: string;
  symbol: string;
  theme: string;
  fund_type: string;
  deposit_fee_bps: number;
  redeem_fee_bps: number;
  assets: VaultPresetAsset[];
};

function PresetDetail({ row }: { row: VaultPresetRow }) {
  const totalBps = row.assets.reduce((sum, a) => sum + a.allocationBps, 0);
  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
      <p className="font-mono text-[11px] text-muted-foreground">{row.theme}</p>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><dt className={fieldLabelClass}>Symbol</dt><dd className="font-mono text-[11px] text-foreground">{row.symbol}</dd></div>
        <div><dt className={fieldLabelClass}>Fund type</dt><dd className="font-mono text-[11px] text-foreground">{row.fund_type}</dd></div>
        <div><dt className={fieldLabelClass}>Deposit fee bps</dt><dd className="font-mono text-[11px] text-foreground">{row.deposit_fee_bps}</dd></div>
        <div><dt className={fieldLabelClass}>Redeem fee bps</dt><dd className="font-mono text-[11px] text-foreground">{row.redeem_fee_bps}</dd></div>
        <div><dt className={fieldLabelClass}>Assets</dt><dd className="font-mono text-[11px] text-foreground">{row.assets.length}</dd></div>
        <div><dt className={fieldLabelClass}>Total bps</dt><dd className="font-mono text-[11px] text-foreground">{totalBps}</dd></div>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-2 py-1.5">asset_id</th>
              <th className="px-2 py-1.5">bps</th>
              <th className="px-2 py-1.5">%</th>
              <th className="px-2 py-1.5">role</th>
            </tr>
          </thead>
          <tbody>
            {row.assets.map((a) => (
              <tr key={`${row.vault_num}-${a.assetId}`} className="border-b border-border/60">
                <td className="px-2 py-1.5 text-foreground tabular-nums">{a.assetId}</td>
                <td className="px-2 py-1.5 text-foreground tabular-nums">{a.allocationBps}</td>
                <td className="px-2 py-1.5 text-foreground tabular-nums">{(a.allocationBps / 100).toFixed(a.allocationBps % 100 ? 2 : 0)}%</td>
                <td className="px-2 py-1.5 text-foreground">{a.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Mount with `key={network}` at the call site so a network switch remounts fresh
// (skeleton, then fetch) instead of showing stale rows from the other network.
export function DbVaultPresetsTable({ network }: { network: Network }) {
  const [rows, setRows] = useState<VaultPresetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/presets?network=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setRows(d.vaultPresets);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount via `key={network}` handles network changes
  }, []);

  const load = () => {
    setRows(null);
    setError(null);
    fetch(`/api/presets?network=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRows(d.vaultPresets);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 px-1 py-2">
        <p className="font-mono text-[11px] text-destructive">Couldn&rsquo;t load vault presets — {error}</p>
        <button type="button" onClick={load} className={btnGhostClass}>
          Retry
        </button>
      </div>
    );
  }
  if (!rows) return <DbRowSkeleton rows={4} />;
  if (rows.length === 0) {
    // The API auto-seeds from Vault.md on read, so an empty list here means the seed itself failed.
    return (
      <div className="flex flex-col items-start gap-2 px-1 py-2">
        <p className="font-mono text-[11px] text-muted-foreground">Auto-seed from Vault.md returned no rows.</p>
        <button type="button" onClick={load} className={btnGhostClass}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      {rows.map((r) => (
        <div key={r.vault_num}>
          <button
            type="button"
            onClick={() => setExpanded(expanded === r.vault_num ? null : r.vault_num)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-foreground/[0.02]"
          >
            <span className="font-mono text-[11px] text-foreground">
              #{r.vault_num} · {r.name} ({r.symbol}) · {r.assets.length} assets
            </span>
            <span className={btnGhostClass}>{expanded === r.vault_num ? 'Collapse' : 'Expand'}</span>
          </button>
          {expanded === r.vault_num && <PresetDetail row={r} />}
        </div>
      ))}
    </div>
  );
}