'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import type { Network } from '@/app/providers';
import { formatSyncStatus, syncRegistryFromChain } from '@/lib/db-sync';
import { btnGhostClass, fieldLabelClass } from '../ui-classes';
import { displayTokenProgram } from '../view-display';
import { DbPanel, DbRowSkeleton } from './db-panel';
import { DbPagination, DB_PAGE_SIZE } from './db-pagination';

type RegistryRow = {
  asset_id: string;
  asset_name: string;
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
  const [saved, setSaved] = useState(false);

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
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <button type="button" onClick={toggle} disabled={saving} className={btnGhostClass}>
          {saving ? 'Saving…' : `Set active=${!row.active} (DB flag only)`}
        </button>
        {saved && <span className="font-mono text-[11px] text-accent">Saved.</span>}
      </div>
      {error && <p className="font-mono text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function RegistryDetail({ row, network, onChanged }: { row: RegistryRow; network: Network; onChanged: (r: RegistryRow) => void }) {
  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><dt className={fieldLabelClass}>Asset</dt><dd className="font-mono text-[11px] text-foreground">{row.asset_name}</dd></div>
        <div><dt className={fieldLabelClass}>Mint</dt><dd className="font-mono text-[11px] text-foreground">{short(row.mint)}</dd></div>
        <div><dt className={fieldLabelClass}>Pool</dt><dd className="font-mono text-[11px] text-foreground">{short(row.pool_address)}</dd></div>
        <div><dt className={fieldLabelClass}>Pyth feed</dt><dd className="truncate font-mono text-[11px] text-foreground">{row.pyth_feed_id.slice(0, 10)}…</dd></div>
        <div><dt className={fieldLabelClass}>Decimals</dt><dd className="font-mono text-[11px] text-foreground">{row.decimals}</dd></div>
        <div><dt className={fieldLabelClass}>Route</dt><dd className="font-mono text-[11px] text-foreground">{row.route}</dd></div>
        <div><dt className={fieldLabelClass}>Swap kind</dt><dd className="font-mono text-[11px] text-foreground">{row.swap_kind}</dd></div>
        <div><dt className={fieldLabelClass}>Token program</dt><dd className="font-mono text-[11px] text-foreground">{displayTokenProgram(row.token_program_tag)}</dd></div>
        <div><dt className={fieldLabelClass}>Active (DB)</dt><dd className="font-mono text-[11px] text-foreground">{String(row.active)}</dd></div>
      </dl>
      <ActiveToggle network={network} row={row} onChanged={onChanged} />
    </div>
  );
}

export function DbRegistryTable({ network }: { network: Network }) {
  const { connection } = useConnection();
  const [rows, setRows] = useState<RegistryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const load = useCallback(() => {
    setError(null);
    return fetch(`/api/asset-registry?network=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRows(d.assets);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [network]);

  useEffect(() => {
    setRows(null);
    setSyncStatus(null);
    setPage(0);
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const report = await syncRegistryFromChain(connection, network);
      setSyncStatus(formatSyncStatus('asset', report));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSyncStatus(null);
    } finally {
      setSyncing(false);
    }
  }, [connection, network, load]);

  let body: React.ReactNode;
  if (error) {
    body = (
      <div className="flex flex-col items-start gap-2 px-1 py-2">
        <p className="font-mono text-[11px] text-destructive">Couldn&rsquo;t load the asset registry — {error}</p>
        <button type="button" onClick={load} className={btnGhostClass}>
          Retry
        </button>
      </div>
    );
  } else if (!rows) {
    body = <DbRowSkeleton />;
  } else if (rows.length === 0) {
    body = (
      <div className="flex flex-col items-start gap-2 px-1 py-2">
        <p className="font-mono text-[11px] text-muted-foreground">No registry entries for {network} yet.</p>
        <button type="button" onClick={refresh} disabled={syncing} className={btnGhostClass}>
          {syncing ? 'Syncing…' : 'Sync from chain'}
        </button>
      </div>
    );
  } else {
    const pageCount = Math.max(1, Math.ceil(rows.length / DB_PAGE_SIZE));
    const pageRows = rows.slice(page * DB_PAGE_SIZE, page * DB_PAGE_SIZE + DB_PAGE_SIZE);
    body = (
      <>
        <div className="max-h-[28rem] overflow-y-auto">
          <div className="flex flex-col divide-y divide-border">
            {pageRows.map((r) => (
              <div key={r.asset_id}>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === r.asset_id ? null : r.asset_id)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-foreground/[0.02]"
                  aria-expanded={expanded === r.asset_id}
                >
                  <span className="font-mono text-[11px] text-foreground">
                    <span className="tabular-nums">{r.asset_id}</span> · {r.asset_name} · {short(r.mint)}
                    {!r.active && <span className="text-destructive"> · inactive</span>}
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
        </div>
        <DbPagination page={page} pageCount={pageCount} onPageChange={setPage} totalCount={rows.length} />
      </>
    );
  }

  return (
    <DbPanel title="Asset registry" onRefresh={refresh} refreshing={syncing} status={syncStatus}>
      {body}
    </DbPanel>
  );
}
