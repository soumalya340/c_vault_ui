'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { getGlobalState, type GlobalStateView } from '@/lib/cvault';
import { panelClass } from '../ui-classes';

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

export function GlobalStateCard() {
  const { connection } = useConnection();
  const [state, setState] = useState<GlobalStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    getGlobalState(connection)
      .then(setState)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [connection]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={`${panelClass} px-5 py-4 md:px-6`}>
      <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
        Global state
      </span>
      {error && (
        <p className="mt-3 font-mono text-[11px] text-destructive">{error}</p>
      )}
      {state && !error && (
        <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          <div>
            <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Emergency</dt>
            <dd className="font-mono text-[12px] text-foreground">{state.isEmergency ? 'true' : 'false'}</dd>
          </div>
          <div>
            <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Treasury</dt>
            <dd className="font-mono text-[12px] text-foreground">{short(state.treasuryAddr)}</dd>
          </div>
          <div>
            <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">TWAP keeper</dt>
            <dd className="font-mono text-[12px] text-foreground">{short(state.twapKeeper)}</dd>
          </div>
          <div>
            <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Total vaults</dt>
            <dd className="font-mono text-[12px] text-foreground">{state.totalVaults}</dd>
          </div>
          <div>
            <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Total assets</dt>
            <dd className="font-mono text-[12px] text-foreground">{state.totalAssets}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
