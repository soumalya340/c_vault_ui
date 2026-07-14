'use client';

import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import type { Network } from '@/app/providers';
import { inputClass, fieldLabelClass, btnGhostClass, btnPrimaryClass } from '../ui-classes';

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <label className={fieldLabelClass}>Deposit ALT address</label>
        <input className={inputClass} value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="blank to clear" />
      </div>
      <div>
        <label className={fieldLabelClass}>Redeem ALT address</label>
        <input className={inputClass} value={redeem} onChange={(e) => setRedeem(e.target.value)} placeholder="blank to clear" />
      </div>
      {error && <p className="md:col-span-2 font-mono text-[11px] text-destructive">{error}</p>}
      <button type="button" onClick={save} disabled={saving} className={`${btnPrimaryClass} md:col-span-2 w-fit`}>
        {saving ? 'Saving…' : 'Save ALT addresses'}
      </button>
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
  const [rows, setRows] = useState<VaultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = () => {
    setError(null);
    fetch(`/api/vaults?network=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRows(d.vaults);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(() => {
    setRows(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  if (error) return <p className="font-mono text-[11px] text-destructive">{error}</p>;
  if (!rows) return <p className="font-mono text-[11px] text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="font-mono text-[11px] text-muted-foreground">No vaults for {network}.</p>;

  return (
    <div className="flex flex-col divide-y divide-border">
      {rows.map((v) => (
        <div key={v.vault_address}>
          <button
            type="button"
            onClick={() => setExpanded(expanded === v.vault_id ? null : v.vault_id)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-foreground/[0.02]"
          >
            <span className="font-mono text-[11px] text-foreground">
              #{v.vault_id} · {v.name} ({v.symbol}) · {v.num_assets} assets
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
