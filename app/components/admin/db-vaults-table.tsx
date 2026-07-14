'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import type { Network } from '@/app/providers';
import { formatSyncStatus, syncVaultsFromChain } from '@/lib/db-sync';
import { inputClass, fieldLabelClass, btnGhostClass, btnPrimaryClass } from '../ui-classes';
import { DbPanel, DbRowSkeleton } from './db-panel';

type VaultRow = {
  vault_address: string;
  vault_id: number;
  name: string;
  symbol: string;
  fund_type: string;
  creator: string;
  tx_signature: string;
  alt_address: string | null;
  deposit_alt_address?: string | null;
  redeem_alt_address?: string | null;
  asset_ids: number[];
  asset_allocation_bps: number[];
  num_assets: number;
  deposit_fee_bps: number;
  redeem_fee_bps: number;
  paused: number;
  admin_locked: number;
};

function short(addr: string | null) {
  if (!addr) return '—';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function isValidPubkeyOrBlank(v: string) {
  if (!v.trim()) return true;
  try {
    // eslint-disable-next-line no-new
    new PublicKey(v.trim());
    return true;
  } catch {
    return false;
  }
}

function AltEditor({
  network,
  vault,
  onSaved,
}: {
  network: Network;
  vault: VaultRow;
  onSaved: (v: VaultRow) => void;
}) {
  const [deposit, setDeposit] = useState(vault.deposit_alt_address ?? vault.alt_address ?? '');
  const [redeem, setRedeem] = useState(vault.redeem_alt_address ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (!isValidPubkeyOrBlank(deposit) || !isValidPubkeyOrBlank(redeem)) {
      setError('ALT addresses must be valid base58 pubkeys, or blank to clear.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/vaults', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          network,
          vault_id: vault.vault_id,
          deposit_alt_address: deposit.trim() || null,
          redeem_alt_address: redeem.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update ALT addresses.');
      onSaved(data.vault);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <label className={fieldLabelClass} htmlFor={`deposit-alt-${vault.vault_id}`}>Deposit ALT address</label>
        <input
          id={`deposit-alt-${vault.vault_id}`}
          className={inputClass}
          value={deposit}
          onChange={(e) => {
            setDeposit(e.target.value);
            setSaved(false);
          }}
          placeholder="blank to clear"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div>
        <label className={fieldLabelClass} htmlFor={`redeem-alt-${vault.vault_id}`}>Redeem ALT address</label>
        <input
          id={`redeem-alt-${vault.vault_id}`}
          className={inputClass}
          value={redeem}
          onChange={(e) => {
            setRedeem(e.target.value);
            setSaved(false);
          }}
          placeholder="blank to clear"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {error && <p className="md:col-span-2 font-mono text-[11px] text-destructive">{error}</p>}
      <div className="flex items-center gap-3 md:col-span-2">
        <button type="button" onClick={save} disabled={saving} className={`${btnPrimaryClass} w-fit`}>
          {saving ? 'Saving…' : 'Save ALT addresses'}
        </button>
        {saved && <span className="font-mono text-[11px] text-accent">Saved.</span>}
      </div>
    </div>
  );
}

function VaultDetail({ vault, network, onUpdated }: { vault: VaultRow; network: Network; onUpdated: (v: VaultRow) => void }) {
  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><dt className={fieldLabelClass}>Vault address</dt><dd className="font-mono text-[11px] text-foreground">{short(vault.vault_address)}</dd></div>
        <div><dt className={fieldLabelClass}>Creator</dt><dd className="font-mono text-[11px] text-foreground">{short(vault.creator)}</dd></div>
        <div><dt className={fieldLabelClass}>Fund type</dt><dd className="font-mono text-[11px] text-foreground">{vault.fund_type}</dd></div>
        <div><dt className={fieldLabelClass}>Assets</dt><dd className="font-mono text-[11px] text-foreground">{JSON.stringify(vault.asset_ids)}</dd></div>
        <div><dt className={fieldLabelClass}>Allocation bps</dt><dd className="font-mono text-[11px] text-foreground">{JSON.stringify(vault.asset_allocation_bps)}</dd></div>
        <div><dt className={fieldLabelClass}>Deposit fee bps</dt><dd className="font-mono text-[11px] text-foreground">{vault.deposit_fee_bps}</dd></div>
        <div><dt className={fieldLabelClass}>Redeem fee bps</dt><dd className="font-mono text-[11px] text-foreground">{vault.redeem_fee_bps}</dd></div>
        <div><dt className={fieldLabelClass}>Tx signature</dt><dd className="truncate font-mono text-[11px] text-foreground">{short(vault.tx_signature)}</dd></div>
      </dl>
      <AltEditor network={network} vault={vault} onSaved={onUpdated} />
    </div>
  );
}

export function DbVaultsTable({ network }: { network: Network }) {
  const { connection } = useConnection();
  const [rows, setRows] = useState<VaultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(() => {
    setError(null);
    return fetch(`/api/vaults?network=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRows(d.vaults);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [network]);

  useEffect(() => {
    setRows(null);
    setSyncStatus(null);
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const report = await syncVaultsFromChain(connection, network);
      setSyncStatus(formatSyncStatus('vault', report));
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
        <p className="font-mono text-[11px] text-destructive">Couldn&rsquo;t load vaults — {error}</p>
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
        <p className="font-mono text-[11px] text-muted-foreground">No vaults recorded for {network} yet.</p>
        <button type="button" onClick={refresh} disabled={syncing} className={btnGhostClass}>
          {syncing ? 'Syncing…' : 'Sync from chain'}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col divide-y divide-border">
        {rows.map((v) => (
          <div key={v.vault_address}>
            <button
              type="button"
              onClick={() => setExpanded(expanded === v.vault_id ? null : v.vault_id)}
              className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-foreground/[0.02]"
              aria-expanded={expanded === v.vault_id}
            >
              <span className="font-mono text-[11px] text-foreground">
                <span className="tabular-nums">#{v.vault_id}</span> · {v.name} ({v.symbol}) · <span className="tabular-nums">{v.num_assets}</span> assets
              </span>
              <span className={btnGhostClass}>{expanded === v.vault_id ? 'Collapse' : 'Expand'}</span>
            </button>
            {expanded === v.vault_id && (
              <VaultDetail
                vault={v}
                network={network}
                onUpdated={(updated) => {
                  setRows((prev) => prev!.map((r) => (r.vault_id === updated.vault_id ? { ...r, ...updated } : r)));
                }}
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <DbPanel title="Vaults" onRefresh={refresh} refreshing={syncing} status={syncStatus}>
      {body}
    </DbPanel>
  );
}
