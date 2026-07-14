'use client';

import { useEffect, useState } from 'react';
import type { Network } from '@/app/providers';
import { btnGhostClass, fieldLabelClass } from '../ui-classes';

type RegistryRow = {
  asset_id: string;
  mint: string;
  pool_address: string;
  pyth_feed_id: string;
  decimals: number;
  route: string;
  swap_kind: string;
  token_program_tag: number;
  active: boolean;
};

function short(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function ActiveToggle({
  network,
  row,
  onChanged,
}: {
  network: Network;
  row: RegistryRow;
  onChanged: (r: RegistryRow) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/asset-registry', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network, asset_id: Number(row.asset_id), active: !row.active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to toggle active flag.');
      onChanged({ ...row, active: !row.active });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={toggle} disabled={saving} className={btnGhostClass}>
        {saving ? 'Saving…' : `Set active=${!row.active} (DB flag only)`}
      </button>
      {error && <p className="font-mono text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function RegistryDetail({ row, network, onChanged }: { row: RegistryRow; network: Network; onChanged: (r: RegistryRow) => void }) {
  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><dt className={fieldLabelClass}>Mint</dt><dd className="font-mono text-[11px] text-foreground">{short(row.mint)}</dd></div>
        <div><dt className={fieldLabelClass}>Pool</dt><dd className="font-mono text-[11px] text-foreground">{short(row.pool_address)}</dd></div>
        <div><dt className={fieldLabelClass}>Pyth feed</dt><dd className="truncate font-mono text-[11px] text-foreground">{row.pyth_feed_id.slice(0, 10)}…</dd></div>
        <div><dt className={fieldLabelClass}>Decimals</dt><dd className="font-mono text-[11px] text-foreground">{row.decimals}</dd></div>
        <div><dt className={fieldLabelClass}>Route</dt><dd className="font-mono text-[11px] text-foreground">{row.route}</dd></div>
        <div><dt className={fieldLabelClass}>Swap kind</dt><dd className="font-mono text-[11px] text-foreground">{row.swap_kind}</dd></div>
        <div><dt className={fieldLabelClass}>Token program</dt><dd className="font-mono text-[11px] text-foreground">{row.token_program_tag}</dd></div>
        <div><dt className={fieldLabelClass}>Active (DB)</dt><dd className="font-mono text-[11px] text-foreground">{String(row.active)}</dd></div>
      </dl>
      <ActiveToggle network={network} row={row} onChanged={onChanged} />
    </div>
  );
}

export function DbRegistryTable({ network }: { network: Network }) {
  const [rows, setRows] = useState<RegistryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    fetch(`/api/asset-registry?network=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRows(d.assets);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [network]);

  if (error) return <p className="font-mono text-[11px] text-destructive">{error}</p>;
  if (!rows) return <p className="font-mono text-[11px] text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="font-mono text-[11px] text-muted-foreground">No registry entries for {network}.</p>;

  return (
    <div className="flex flex-col divide-y divide-border">
      {rows.map((r) => (
        <div key={r.asset_id}>
          <button
            type="button"
            onClick={() => setExpanded(expanded === r.asset_id ? null : r.asset_id)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-foreground/[0.02]"
          >
            <span className="font-mono text-[11px] text-foreground">
              #{r.asset_id} · {short(r.mint)} · {r.route} · {r.swap_kind} · active={String(r.active)}
            </span>
            <span className={btnGhostClass}>{expanded === r.asset_id ? 'Collapse' : 'Expand'}</span>
          </button>
          {expanded === r.asset_id && (
            <RegistryDetail
              row={r}
              network={network}
              onChanged={(updated) => setRows((prev) => prev!.map((row) => (row.asset_id === updated.asset_id ? updated : row)))}
            />
          )}
        </div>
      ))}
    </div>
  );
}
