'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { getTotalNavView, fetchVaultCtx, type Network, type VaultChainAsset } from '@/lib/cvault';
import { fetchVaults, fetchTokens, type VaultRecord, type TokenOption } from '@/lib/registryClient';
import { DepositModal } from './deposit-modal';
import { RedeemModal } from './redeem-modal';
import { SECTION_STYLE } from './function-defs';
import { btnGhostClass, btnPrimaryClass, btnSecondaryClass, panelClass, sectionLabelClass } from './ui-classes';

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

// Per-row asset inspector. The ⓘ button toggles an inline panel that reads the
// vault's asset basket fresh from on-chain (fetchVaultCtx) at click time — no
// websockets, no cached Supabase assets. Symbol/name resolve via the shared
// token_registry map, falling back to a shortened mint.
function VaultAssetsView({
  vaultId,
  tokenMap,
}: {
  vaultId: number;
  tokenMap: Map<string, TokenOption>;
}) {
  const { connection } = useConnection();
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<VaultChainAsset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchVaultCtx(connection, vaultId)
      .then((ctx) => {
        setAssets(ctx.assets);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [connection, vaultId]);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      // Fetch on open (and re-fetch on every re-open) so the view always
      // reflects on-chain state at click time.
      if (next) load();
      return next;
    });
  }, [load]);

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? 'Hide vault assets' : 'View vault assets'}
        title="View vault assets on-chain"
        className="group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-border-strong leading-none transition-colors duration-150 group-hover:border-accent">
          {open ? '×' : 'i'}
        </span>
        {open ? 'Hide assets' : 'View assets'}
      </button>

      <div className={`accordion-content ${open ? 'open' : ''}`}>
        <div className="accordion-inner">
          <div className="mt-3 rounded-[2px] border border-border-strong bg-foreground/[0.03]">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className={`${sectionLabelClass} uppercase`}>
                {assets
                  ? `${assets.length} asset${assets.length === 1 ? '' : 's'} on-chain`
                  : 'assets'}
              </span>
              <button type="button" onClick={load} disabled={loading} className={btnGhostClass}>
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            {loading && !assets && (
              <p className="px-4 py-4 font-mono text-xs text-muted-foreground">
                <span className="mr-2 text-muted-foreground/50">&gt;</span>fetching assets…
              </p>
            )}

            {error && (
              <p className="px-4 py-4 font-mono text-xs text-destructive">
                <span className="mr-2 text-muted-foreground/50">&gt;</span>assets unavailable — {error}
              </p>
            )}

            {assets && assets.length > 0 && (
              <ul className="divide-y divide-border">
                {assets.map((asset, i) => {
                  const mint = asset.mint.toBase58();
                  const token = tokenMap.get(mint);
                  const label = token ? token.symbol : shorten(mint);
                  const pct = (asset.allocationBps / 100).toFixed(2);
                  return (
                    <li key={`${mint}-${i}`} className="flex flex-col gap-2 px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium tracking-[-0.01em] text-foreground">
                            {label}
                          </span>
                          {token?.name && (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {token.name}
                            </span>
                          )}
                          <span className="rounded-[2px] border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            {asset.route}
                          </span>
                        </div>
                        <span className="font-mono text-xs tabular-nums text-foreground">{pct}%</span>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.min(asset.allocationBps / 100, 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground/70">
                        mint {shorten(mint)} · {asset.decimals} dp
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function VaultsPanel({ network }: { network: Network }) {
  const style = SECTION_STYLE.vaults;

  const [vaults, setVaults] = useState<VaultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [depositTarget, setDepositTarget] = useState<VaultRecord | null>(null);
  const [redeemTarget, setRedeemTarget] = useState<VaultRecord | null>(null);
  const [tokenMap, setTokenMap] = useState<Map<string, TokenOption>>(new Map());

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

  // Token registry is fetched once and shared with every row's asset view so
  // mints resolve to symbol/name. Failure is non-fatal — the asset view falls
  // back to shortened mints.
  useEffect(() => {
    let cancelled = false;
    fetchTokens()
      .then((tokens) => {
        if (cancelled) return;
        setTokenMap(new Map(tokens.map((t) => [t.mint, t])));
      })
      .catch(() => {
        // Registry unavailable — asset view falls back to shortened mints.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

                <VaultAssetsView vaultId={vault.vault_id} tokenMap={tokenMap} />
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
