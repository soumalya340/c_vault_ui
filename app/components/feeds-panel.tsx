'use client';

import { useState } from 'react';
import type { PythFeedRow } from '@/lib/pythFeedsClient';
import { saveFeed, removeFeed } from '@/lib/pythFeedsClient';
import {
  btnGhostClass,
  btnPrimaryClass,
  fieldLabelClass,
  inputClass,
  panelClass,
  sectionLabelClass,
} from './ui-classes';

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
    <section aria-label="Pyth feed registry" className="flex flex-col gap-4">
      <div className={`${panelClass} p-4 md:p-5`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <span className={`${sectionLabelClass} font-bold uppercase`}>Pyth feed registry</span>
          <span className="font-mono text-[11px] text-muted-foreground/80">
            {savedFeeds.length} saved
          </span>
        </div>

        <form onSubmit={handleAdd} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className={fieldLabelClass} htmlFor="feed-pair">
              Pair label
            </label>
            <input
              id="feed-pair"
              value={pair}
              onChange={(e) => setPair(e.target.value)}
              placeholder="SOL/USD"
              className={inputClass}
            />
          </div>
          <div>
            <label className={fieldLabelClass} htmlFor="feed-address">
              Feed account
            </label>
            <input
              id="feed-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="PriceUpdateV2 account address"
              className={inputClass}
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy || !pair || !address}
              className={`${btnPrimaryClass} w-full sm:w-auto`}
            >
              Save feed
            </button>
          </div>
        </form>

        {error && (
          <p className="mt-3 font-mono text-xs text-destructive">
            <span className="mr-1 text-muted-foreground/50">&gt;</span>
            {error}
          </p>
        )}
      </div>

      <div className={`${panelClass} overflow-hidden`}>
        <div className="border-b border-border px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground md:px-5">
          REGISTRY
        </div>
        {savedFeeds.length === 0 ? (
          <p className="px-4 py-8 text-center font-mono text-xs leading-relaxed text-muted-foreground/60 md:px-5">
            no feeds saved — add SOL, BTC, and ETH feeds before running NAV views
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-4 py-2.5 md:px-5">Pair</th>
                  <th className="px-4 py-2.5 md:px-5">Address</th>
                  <th className="px-4 py-2.5 md:px-5">Updated</th>
                  <th className="px-4 py-2.5 md:px-5" />
                </tr>
              </thead>
              <tbody>
                {savedFeeds.map((f) => (
                  <tr
                    key={f.id}
                    className="border-t border-border transition-colors hover:bg-foreground/[0.03]"
                  >
                    <td className="px-4 py-2.5 font-medium md:px-5">{f.pair}</td>
                    <td className="max-w-[200px] truncate px-4 py-2.5 font-mono text-[11px] text-accent md:max-w-none md:px-5">
                      {f.address}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground md:px-5">
                      {new Date(f.updated_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right md:px-5">
                      <button type="button" onClick={() => handleDelete(f.id)} className={btnGhostClass}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
