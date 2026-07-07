'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { getTotalNavView, type Network } from '@/lib/cvault';
import { fetchVaults, type VaultRecord } from '@/lib/registryClient';
import { DepositModal } from './deposit-modal';
import { RedeemModal } from './redeem-modal';
import { SECTION_STYLE } from './function-defs';
import { btnPrimaryClass, btnSecondaryClass, panelClass, sectionLabelClass } from './ui-classes';

// Single source of truth for the Vaults tab: rows come from the Supabase
// `vaults` table (forge/supabase/migrations/0004_vaults.sql), populated right
// after create_etf lands on-chain. Deposit and Redeem are the only two
// actions exposed per row — no standalone Deposit/Redeem sections exist.

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function VaultNav({ vaultId }: { vaultId: number }) {
  const [nav, setNav] = useState<{ totalNav: string; sharePrice: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { connection } = useConnection();

  useEffect(() => {
    let cancelled = false;
    getTotalNavView(connection, vaultId)
      .then((r) => {
        if (!cancelled) setNav({ totalNav: r.totalNav, sharePrice: r.sharePrice });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultId, connection]);

  if (error) return <span className="font-mono text-[11px] text-muted-foreground/60">NAV unavailable</span>;
  if (!nav) return <span className="font-mono text-[11px] text-muted-foreground/60">loading NAV…</span>;

  return (
    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
      NAV {nav.totalNav} · price {nav.sharePrice}
    </span>
  );
}

export function VaultsPanel({ network }: { network: Network }) {
  const style = SECTION_STYLE.vaults;

  const [vaults, setVaults] = useState<VaultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [depositTarget, setDepositTarget] = useState<VaultRecord | null>(null);
  const [redeemTarget, setRedeemTarget] = useState<VaultRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchVaults(network);
      setVaults(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section aria-label="Vaults" className="flex flex-col gap-4">
      <div className={`${panelClass} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-5 py-3.5 md:px-6">
          <span
            className="font-display text-base font-semibold uppercase tracking-[0.18em]"
            style={{ color: style.accent }}
          >
            Vaults
          </span>
          <div className="flex items-center gap-3">
            <span className={`${sectionLabelClass} uppercase`}>
              {vaults.length} instrument{vaults.length === 1 ? '' : 's'} · series 2026
            </span>
            <button type="button" onClick={load} className={btnSecondaryClass}>
              Refresh
            </button>
          </div>
        </div>

        {loading && (
          <p className="px-5 py-6 font-mono text-xs text-muted-foreground md:px-6">
            <span className="mr-2 text-muted-foreground/50">&gt;</span>
            Fetching vaults…
          </p>
        )}

        {!loading && error && (
          <p className="px-5 py-6 font-mono text-xs text-destructive md:px-6">
            <span className="mr-2 text-muted-foreground/50">&gt;</span>
            {error}
          </p>
        )}

        {!loading && !error && vaults.length === 0 && (
          <p className="px-5 py-6 font-mono text-xs text-muted-foreground md:px-6">
            <span className="mr-2 text-muted-foreground/50">&gt;</span>
            No vaults yet — create one from Vault Ops.
          </p>
        )}

        {!loading && !error && vaults.length > 0 && (
          <div className="flex flex-col divide-y divide-border px-3 py-1 md:px-4">
            {vaults.map((vault) => (
              <div key={vault.vault_address} className="flex flex-col gap-3 px-2 py-4 md:px-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-4">
                    <span className="flex-shrink-0 font-mono text-xs font-bold tabular-nums tracking-[0.08em] text-seal">
                      &#8470;&nbsp;CVLT-{vault.vault_id}
                    </span>
                    <span className="text-sm font-medium tracking-[-0.01em] text-foreground">
                      {vault.symbol} · {vault.name}
                    </span>
                  </div>
                  <VaultNav vaultId={vault.vault_id} />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    vault {shorten(vault.vault_address)} · base {shorten(vault.base_mint)} ·{' '}
                    {vault.assets.length} asset{vault.assets.length === 1 ? '' : 's'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDepositTarget(vault)}
                      className={btnSecondaryClass}
                    >
                      Deposit
                    </button>
                    <button
                      type="button"
                      onClick={() => setRedeemTarget(vault)}
                      className={btnPrimaryClass}
                      style={{ borderColor: SECTION_STYLE['vault-ops'].accent, background: SECTION_STYLE['vault-ops'].accent }}
                    >
                      Redeem &amp; Claim
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {depositTarget && (
        <DepositModal
          vault={depositTarget}
          network={network}
          onClose={() => setDepositTarget(null)}
        />
      )}
      {redeemTarget && (
        <RedeemModal
          vault={redeemTarget}
          network={network}
          onClose={() => setRedeemTarget(null)}
        />
      )}
    </section>
  );
}
