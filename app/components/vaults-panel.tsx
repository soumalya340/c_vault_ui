'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useConnection } from '@solana/wallet-adapter-react';
import {
  fetchVaultCtx,
  NETWORK_CONSTANTS,
  type Network,
  type VaultChainAsset,
} from '@/lib/cvault';
import {
  fetchVaults,
  fetchAssetRegistry,
  type VaultRecord,
  type AssetRegistryEntry,
} from '@/lib/registryClient';
import { assetNameForMint } from '@/lib/presets/canonical-data';
import { DepositModal } from './deposit-modal';
import { RedeemModal } from './redeem-modal';
import { PendingClaimButton } from './pending-claim-button';
import { SECTION_STYLE } from './function-defs';
import { vaultDetailPath } from './console-routes';
import { AssetRowsSkeleton, VaultListSkeleton } from './loading-skeletons';
import { btnGhostClass, btnPrimaryClass, btnSecondaryClass, panelClass, sectionLabelClass } from './ui-classes';

const VAULTS_PER_PAGE = 6;

// Single source of truth for the Vaults tab: rows come from the Supabase
// `vaults` table (db/supabase/migration/0001_vaults.sql), populated right
// after create_etf lands on-chain. Deposit and Redeem are the only two
// actions exposed per row — no standalone Deposit/Redeem sections exist.

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Display label for a vault basket leg — registry name first, then presets. */
function resolveAssetLabel(
  mint: string,
  assetId: number,
  byMint: Map<string, AssetRegistryEntry>,
  byId: Map<number, AssetRegistryEntry>,
): { title: string; subtitle: string | null } {
  const fromDb = byMint.get(mint) ?? byId.get(assetId);
  const name =
    fromDb?.asset_name?.trim() ||
    assetNameForMint(mint) ||
    '';
  if (name) {
    return {
      title: name,
      subtitle: fromDb ? `#${fromDb.asset_id}` : assetId >= 0 ? `#${assetId}` : null,
    };
  }
  return {
    title: shorten(mint),
    subtitle: assetId >= 0 ? `asset #${assetId}` : null,
  };
}

// NAV is intentionally not fetched here — getTotalNavView() is an Anchor
// .view() call (simulateTransaction under the hood) per row, which burns
// RPC quota on every mount. Disabled until we have a cached/manual-refresh
// path; this label is static decoration for now.
function VaultNav() {
  return <span className="font-mono text-[11px] text-muted-foreground/60">loading NAV…</span>;
}

// Per-row asset inspector. "View assets" expands the panel and loads the
// vault basket from on-chain at that moment (fetchVaultCtx) — no separate
// refresh control, no polling. Names resolve via pre_approved_token_registry
// (network-scoped), then the Pools.md preset catalog, then a shortened mint.
function VaultAssetsView({
  vaultId,
  byMint,
  byId,
  network,
}: {
  vaultId: number;
  byMint: Map<string, AssetRegistryEntry>;
  byId: Map<number, AssetRegistryEntry>;
  network: Network;
}) {
  const { connection } = useConnection();
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<VaultChainAsset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load on-chain whenever the panel is open and the vault/cluster changes.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setAssets(null);

    fetchVaultCtx(connection, vaultId, network)
      .then((ctx) => {
        if (cancelled) return;
        setAssets(ctx.assets);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, connection, vaultId, network]);

  return (
    <div className="t-acc w-full" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? 'Hide vault assets' : 'View vault assets on-chain'}
        className="t-acc-head group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-border-strong leading-none transition-colors duration-150 group-hover:border-accent">
          {open ? '×' : 'i'}
        </span>
        {open ? 'Hide assets' : 'View assets'}
      </button>

      <div className="t-acc-panel">
        <div className="t-acc-panel-inner">
          <div className="mt-3 rounded-[2px] border border-border-strong bg-foreground/[0.03]">
            {loading && <AssetRowsSkeleton rows={3} />}

            {!loading && error && (
              <p className="px-4 py-4 font-mono text-xs text-destructive">
                <span className="mr-2 text-muted-foreground/50">&gt;</span>
                assets unavailable — {error}
              </p>
            )}

            {!loading && !error && assets && assets.length === 0 && (
              <p className="px-4 py-4 font-mono text-xs text-muted-foreground">
                <span className="mr-2 text-muted-foreground/50">&gt;</span>
                no assets on-chain
              </p>
            )}

            {!loading && !error && assets && assets.length > 0 && (
              <>
                <div className="border-b border-border px-4 py-2.5">
                  <span className={`${sectionLabelClass} uppercase`}>
                    {assets.length} asset{assets.length === 1 ? '' : 's'} on-chain
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {assets.map((asset, i) => {
                    const mint = asset.mint.toBase58();
                    const { title, subtitle } = resolveAssetLabel(
                      mint,
                      asset.assetId,
                      byMint,
                      byId,
                    );
                    const pct = (asset.allocationBps / 100).toFixed(2);
                    return (
                      <li key={`${mint}-${i}`} className="flex flex-col gap-2 px-4 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-medium tracking-[-0.01em] text-foreground">
                              {title}
                            </span>
                            {subtitle && (
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {subtitle}
                              </span>
                            )}
                            <span className="rounded-[2px] border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              {asset.route}
                            </span>
                          </div>
                          <span className="font-mono text-xs tabular-nums text-foreground">
                            {pct}%
                          </span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{
                              width: `${Math.min(asset.allocationBps / 100, 100)}%`,
                            }}
                          />
                        </div>
                        <span className="font-mono text-[11px] text-muted-foreground/70">
                          mint {shorten(mint)} · {asset.decimals} dp
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
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
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [depositTarget, setDepositTarget] = useState<VaultRecord | null>(null);
  const [redeemTarget, setRedeemTarget] = useState<VaultRecord | null>(null);
  // pre_approved_token_registry — the table that actually stores asset_name.
  // (The old token_registry path is a separate, often-empty forge table.)
  const [byMint, setByMint] = useState<Map<string, AssetRegistryEntry>>(new Map());
  const [byId, setById] = useState<Map<number, AssetRegistryEntry>>(new Map());

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

  useEffect(() => {
    setPage(1);
  }, [network]);

  const totalPages = Math.max(1, Math.ceil(vaults.length / VAULTS_PER_PAGE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageVaults = useMemo(() => {
    const start = (page - 1) * VAULTS_PER_PAGE;
    return vaults.slice(start, start + VAULTS_PER_PAGE);
  }, [vaults, page]);

  const pageStart = vaults.length === 0 ? 0 : (page - 1) * VAULTS_PER_PAGE + 1;
  const pageEnd = Math.min(page * VAULTS_PER_PAGE, vaults.length);

  // Network-scoped asset registry so mints resolve to asset_name. Failure is
  // non-fatal — resolveAssetLabel still falls back to Pools.md presets.
  useEffect(() => {
    let cancelled = false;
    fetchAssetRegistry(network)
      .then((assets) => {
        if (cancelled) return;
        const mintMap = new Map<string, AssetRegistryEntry>();
        const idMap = new Map<number, AssetRegistryEntry>();
        for (const a of assets) {
          mintMap.set(a.mint, a);
          const id = Number(a.asset_id);
          if (Number.isFinite(id)) idMap.set(id, a);
        }
        setByMint(mintMap);
        setById(idMap);
      })
      .catch(() => {
        if (cancelled) return;
        setByMint(new Map());
        setById(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [network]);

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
          <span className={`${sectionLabelClass} uppercase`}>
            {loading
              ? 'loading · series 2026'
              : `${vaults.length} instrument${vaults.length === 1 ? '' : 's'} · series 2026`}
          </span>
        </div>

        {loading && <VaultListSkeleton rows={3} />}

        {!loading && error && (
          <p className="px-5 py-6 font-mono text-xs text-destructive md:px-6">
            <span className="mr-2 text-muted-foreground/50">&gt;</span>
            {error}
          </p>
        )}

        {!loading && !error && vaults.length === 0 && (
          <p className="px-5 py-6 font-mono text-xs text-muted-foreground md:px-6">
            <span className="mr-2 text-muted-foreground/50">&gt;</span>
            No vaults yet — open Create to mint one.
          </p>
        )}

        {!loading && !error && vaults.length > 0 && (
          <div className="flex flex-col divide-y divide-border px-3 py-1 md:px-4">
            {pageVaults.map((vault) => (
              <div key={vault.vault_address} className="flex flex-col gap-3 px-2 py-4 md:px-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-4">
                    <span className="flex-shrink-0 font-mono text-xs font-bold tabular-nums tracking-[0.08em] text-seal">
                      &#8470;&nbsp;CVLT-{vault.vault_id}
                    </span>
                    <Link
                      href={vaultDetailPath(vault.vault_id)}
                      className="text-sm font-medium tracking-[-0.01em] text-foreground underline-offset-4 transition-colors duration-150 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {vault.symbol} · {vault.name}
                    </Link>
                  </div>
                  <VaultNav />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    vault {shorten(vault.vault_address)} · base{' '}
                    {shorten(NETWORK_CONSTANTS[network].usdcMint.toBase58())} ·{' '}
                    {vault.num_assets} asset{vault.num_assets === 1 ? '' : 's'}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <PendingClaimButton vault={vault} network={network} />
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

                <VaultAssetsView
                  vaultId={vault.vault_id}
                  byMint={byMint}
                  byId={byId}
                  network={network}
                />
              </div>
            ))}
          </div>
        )}

        {!loading && !error && vaults.length > VAULTS_PER_PAGE && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-strong px-5 py-3.5 md:px-6">
            <span className={`${sectionLabelClass} uppercase`}>
              Showing {pageStart}–{pageEnd} of {vaults.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className={btnGhostClass}
                aria-label="Previous page"
              >
                Previous
              </button>
              <span className="px-2 font-mono text-[11px] tabular-nums tracking-[0.12em] text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className={btnSecondaryClass}
                aria-label="Next page"
              >
                Next
              </button>
            </div>
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
