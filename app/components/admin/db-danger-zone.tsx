'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { Network } from '@/app/providers';
import { inputClass, fieldLabelClass, panelClass, btnGhostClass } from '../ui-classes';

// Mount with `key={network}` at the call site — a network switch should reset every
// piece of confirm state, and remounting gets that for free instead of a reset effect.
export function DbDangerZone({ network }: { network: Network }) {
  const { signMessage, publicKey } = useWallet();
  const [confirmText, setConfirmText] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ vaultsDeleted: number; registryDeleted: number } | null>(null);

  const expectedText = `CLEAR ${network.toUpperCase()}`;
  const textMatches = confirmText === expectedText;

  const runClear = async () => {
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
      setArmed(false);
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
        Removes all <strong>Vaults</strong> and <strong>Asset registry</strong> rows for{' '}
        <strong>{network}</strong> only. Asset presets, vault presets, schema, and every other
        table are left untouched. Requires a wallet signature from the admin key.
      </p>
      <div className="mt-3 max-w-sm">
        <label className={fieldLabelClass} htmlFor="db-clear-confirm">{`Type "${expectedText}" to confirm`}</label>
        <input
          id="db-clear-confirm"
          className={inputClass}
          value={confirmText}
          onChange={(e) => {
            setConfirmText(e.target.value);
            setError(null);
          }}
          placeholder={expectedText}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={confirmText.length > 0 && !textMatches}
        />
      </div>
      {error && <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>}
      {result && (
        <p className="mt-2 font-mono text-[11px] text-foreground">
          Cleared. vaults={result.vaultsDeleted}, asset registry={result.registryDeleted}
        </p>
      )}

      {!armed ? (
        <button
          type="button"
          onClick={() => setArmed(true)}
          disabled={!textMatches}
          className="mt-3 rounded-[2px] border border-destructive bg-destructive px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-[0.14em] text-background transition-[filter] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {`Clear vaults + asset registry (${network})`}
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3 border border-destructive/50 bg-destructive/[0.06] px-3 py-2.5">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-destructive">
            This cannot be undone.
          </p>
          <button
            type="button"
            onClick={runClear}
            disabled={busy}
            className="rounded-[2px] border border-destructive bg-destructive px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.14em] text-background transition-[filter] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {busy ? 'Clearing…' : 'Yes, delete permanently'}
          </button>
          <button
            type="button"
            onClick={() => setArmed(false)}
            disabled={busy}
            className={btnGhostClass}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
