'use client';

import { useEffect, useState } from 'react';
import type { Network } from '@/app/providers';
import { btnGhostClass, fieldLabelClass } from '../ui-classes';
import { displayTokenProgram } from '../view-display';
import { DbRowSkeleton } from './db-panel';

type AssetPresetRow = {
  preset_key: string;
  asset_name: string;
  mint: string;
  pool_address: string;
  route: string;
  swap_kind: string;
  decimals: number;
  token_program_tag: number;
  aliases: string[];
};

function short(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function PresetDetail({ row }: { row: AssetPresetRow }) {
  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><dt className={fieldLabelClass}>Key</dt><dd className="font-mono text-[11px] text-foreground">{row.preset_key}</dd></div>
        <div><dt className={fieldLabelClass}>Name</dt><dd className="font-mono text-[11px] text-foreground">{row.asset_name}</dd></div>
        <div><dt className={fieldLabelClass}>Mint</dt><dd className="font-mono text-[11px] text-foreground">{short(row.mint)}</dd></div>
        <div><dt className={fieldLabelClass}>Pool</dt><dd className="font-mono text-[11px] text-foreground">{short(row.pool_address)}</dd></div>
        <div><dt className={fieldLabelClass}>Route</dt><dd className="font-mono text-[11px] text-foreground">{row.route}</dd></div>
        <div><dt className={fieldLabelClass}>Swap kind</dt><dd className="font-mono text-[11px] text-foreground">{row.swap_kind}</dd></div>
        <div><dt className={fieldLabelClass}>Decimals</dt><dd className="font-mono text-[11px] text-foreground">{row.decimals}</dd></div>
        <div><dt className={fieldLabelClass}>Token program</dt><dd className="font-mono text-[11px] text-foreground">{displayTokenProgram(row.token_program_tag)}</dd></div>
        <div className="md:col-span-4"><dt className={fieldLabelClass}>Aliases</dt><dd className="font-mono text-[11px] text-foreground">{row.aliases.join(', ')}</dd></div>
      </dl>
    </div>
  );
}

// Mount with `key={network}` at the call site so a network switch remounts fresh
// (skeleton, then fetch) instead of showing stale rows from the other network.
export function DbAssetPresetsTable({ network }: { network: Network }) {
  const [rows, setRows] = useState<AssetPresetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/presets?network=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setRows(d.assetPresets);
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
        setRows(d.assetPresets);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 px-1 py-2">
        <p className="font-mono text-[11px] text-destructive">Couldn&rsquo;t load asset presets — {error}</p>
        <button type="button" onClick={load} className={btnGhostClass}>
          Retry
        </button>
      </div>
    );
  }
  if (!rows) return <DbRowSkeleton rows={4} />;
  if (rows.length === 0) {
    // The API auto-seeds from Pools.md on read, so an empty list here means the seed itself failed.
    return (
      <div className="flex flex-col items-start gap-2 px-1 py-2">
        <p className="font-mono text-[11px] text-muted-foreground">Auto-seed from Pools.md returned no rows.</p>
        <button type="button" onClick={load} className={btnGhostClass}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      {rows.map((r) => (
        <div key={r.preset_key}>
          <button
            type="button"
            onClick={() => setExpanded(expanded === r.preset_key ? null : r.preset_key)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-foreground/[0.02]"
          >
            <span className="font-mono text-[11px] text-foreground">
              {r.preset_key} · {r.asset_name} · {r.route} · {r.swap_kind}
            </span>
            <span className={btnGhostClass}>{expanded === r.preset_key ? 'Collapse' : 'Expand'}</span>
          </button>
          {expanded === r.preset_key && <PresetDetail row={r} />}
        </div>
      ))}
    </div>
  );
}