'use client';

import { useState } from 'react';
import type { PythFeedRow } from '@/lib/pythFeedsClient';
import { saveFeed, removeFeed } from '@/lib/pythFeedsClient';
import { btnGhostClass, btnPrimaryClass, inputClass, panelClass } from './ui-classes';

export function FeedsPanel({
  savedFeeds,
  onChange,
}: {
  savedFeeds: PythFeedRow[];
  onChange: () => void;
}) {
  const [pair, setPair] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveFeed(pair, address);
      setPair('');
      setAddress('');
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    await removeFeed(id);
    onChange();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Pyth feed registry
        </h2>
        <span className="font-mono text-xs text-muted-foreground">{savedFeeds.length} saved</span>
      </div>

      <form onSubmit={handleAdd} className={`${panelClass} flex flex-col gap-3 p-4 sm:flex-row`}>
        <input
          value={pair}
          onChange={(e) => setPair(e.target.value)}
          placeholder="Pair label, e.g. SOL/USD"
          className={inputClass}
        />
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="PriceUpdateV2 account address"
          className={inputClass}
        />
        <button type="submit" disabled={busy || !pair || !address} className={btnPrimaryClass}>
          Save feed
        </button>
      </form>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className={`${panelClass} overflow-hidden`}>
        {savedFeeds.length === 0 ? (
          <p className="p-4 text-sm italic text-muted-foreground">
            No feeds saved. Add SOL, BTC, and ETH feeds before running NAV views.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-4 py-2.5">Pair</th>
                <th className="px-4 py-2.5">Address</th>
                <th className="px-4 py-2.5">Updated</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {savedFeeds.map((f) => (
                <tr key={f.id} className="border-t border-border">
                  <td className="px-4 py-2.5 text-foreground">{f.pair}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-accent">{f.address}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {new Date(f.updated_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => handleDelete(f.id)} className={btnGhostClass}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
