'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { Network } from '@/app/providers';
import { inputClass, fieldLabelClass, panelClass } from '../ui-classes';

export function DbDangerZone({ network }: { network: Network }) {
  const { signMessage, publicKey } = useWallet();
  const [confirmText, setConfirmText] = useState('');
  const [confirmedOnce, setConfirmedOnce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ vaultsDeleted: number; registryDeleted: number } | null>(null);

  const expectedText = `CLEAR ${network.toUpperCase()}`;

  const runClear = async () => {
    if (confirmText !== expectedText) {
      setError(`Type "${expectedText}" exactly to confirm.`);
      return;
    }
    if (!confirmedOnce) {
      setConfirmedOnce(true);
      setError('Click again to confirm — this is irreversible.');
      return;
    }
    if (!publicKey || !signMessage) {
      setError('Connect a wallet that supports message signing.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const message = `cvault-admin:clear:${network}:${Date.now()}`;
      const signatureBytes = await signMessage(new TextEncoder().encode(message));
      const signature = Buffer.from(signatureBytes).toString('base64');
      const res = await fetch('/api/admin/db/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network, message, signature }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Clear failed.');
      setResult(data);
      setConfirmText('');
      setConfirmedOnce(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${panelClass} border-destructive/40 px-5 py-4 md:px-6`}>
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-destructive">
        Danger zone
      </p>
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        Deletes vaults + pre_approved_token_registry rows for <strong>{network}</strong> (schema kept).
        Requires a wallet signature from the admin key.
      </p>
      <div className="mt-3 max-w-sm">
        <label className={fieldLabelClass}>{`Type "${expectedText}" to confirm`}</label>
        <input
          className={inputClass}
          value={confirmText}
          onChange={(e) => {
            setConfirmText(e.target.value);
            setConfirmedOnce(false);
            setError(null);
          }}
          placeholder={expectedText}
        />
      </div>
      {error && <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>}
      {result && (
        <p className="mt-2 font-mono text-[11px] text-foreground">
          Cleared. vaults={result.vaultsDeleted}, registry={result.registryDeleted}
        </p>
      )}
      <button
        type="button"
        onClick={runClear}
        disabled={busy}
        className="mt-3 rounded-[2px] border border-destructive bg-destructive px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-[0.14em] text-background transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? 'Clearing…' : confirmedOnce ? 'Confirm again — irreversible' : `Clear all ${network} data`}
      </button>
    </div>
  );
}
