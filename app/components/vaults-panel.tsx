'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useConnection } from '@solana/wallet-adapter-react';
import { useReducedMotion } from 'motion/react';
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
import { assetNameForMint, displayAssetName } from '@/lib/presets/canonical-data';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/animate-ui/components/radix/popover';
import { SECTION_STYLE } from './function-defs';
import { vaultDetailPath } from './console-routes';
import { AssetRowsSkeleton, VaultListSkeleton } from './loading-skeletons';
import { btnGhostClass, btnSecondaryClass, panelClass, sectionLabelClass } from './ui-classes';

const VAULTS_PER_PAGE = 6;

// Vault catalogue: rows from the Supabase `vaults` table. Deposit / redeem /
// claim live on the vault detail page — this list is browse + inspect only.

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** `vaults.deposit_fee_bps` / `redeem_fee_bps` → percent for list display. */
function formatFeeBps(bps: number): string {
  const n = Number(bps);
  if (!Number.isFinite(n)) return '—';
  return `${(n / 100).toFixed(2)}%`;
}

/** Display label for a vault basket leg — registry name first, then presets. */
function resolveAssetLabel(
  mint: string,
  assetId: number,
  byMint: Map<string, AssetRegistryEntry>,
  byId: Map<number, AssetRegistryEntry>,
): string {
  const fromDb = byMint.get(mint) ?? byId.get(assetId);
  return (
    displayAssetName(fromDb?.asset_name ?? '') ||
    assetNameForMint(mint) ||
    shorten(mint)
  );
}

/**
 * Click-to-open specimen card for a vault basket.
 * Animate UI / Radix Popover (spring scale) — opens on click, not hover.
 * Loads on-chain assets with fetchVaultCtx only while open. Names resolve via
 * pre_approved_token_registry, then Pools.md presets, then shortened mint.
 */
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
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<VaultChainAsset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cache last successful fetch key so re-open does not thrash RPC.
  const loadedKeyRef = useRef<string | null>(null);
  const fetchKey = `${network}:${vaultId}`;

  useEffect(() => {
    if (!open) return;
    if (loadedKeyRef.current === fetchKey) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setAssets(null);

    fetchVaultCtx(connection, vaultId, network)
      .then((ctx) => {
        if (cancelled) return;
        setAssets(ctx.assets);
        loadedKeyRef.current = fetchKey;
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        loadedKeyRef.current = null;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, connection, vaultId, network, fetchKey]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Hide vault assets' : 'View vault assets on-chain'}
          className="group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:text-accent"
        >
          <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-border-strong leading-none transition-colors duration-150 group-hover:border-accent group-data-[state=open]:border-accent">
            {open ? '×' : 'i'}
          </span>
          <span className="underline-offset-4 group-hover:underline">
            {open ? 'Hide assets' : 'View assets'}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={10}
        className="w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-[2px] border-border-strong bg-background p-0 text-foreground shadow-[0_18px_48px_-18px_rgba(23,37,28,0.35),inset_0_0_0_1px_rgba(23,37,28,0.06)] outline-hidden"
        transition={
          reduceMotion
            ? { duration: 0.01 }
            : { type: 'spring', stiffness: 320, damping: 28 }
        }
      >
        {/* Specimen plate header — certificate ledger language */}
        <div className="flex items-center justify-between gap-3 border-b border-border-strong bg-foreground/[0.03] px-4 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-accent">
              Basket plate
            </span>
            <span className="font-mono text-[11px] font-bold tabular-nums tracking-[0.08em] text-seal">
              &#8470;&nbsp;CVLT-{vaultId}
            </span>
          </div>
          <span className={`${sectionLabelClass} shrink-0 uppercase`}>
            {loading
              ? 'reading…'
              : assets
                ? `${assets.length} asset${assets.length === 1 ? '' : 's'}`
                : 'on-chain'}
          </span>
        </div>

        <div className="max-h-[min(20rem,50vh)] overflow-y-auto">
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
            <ul className="divide-y divide-border">
              {assets.map((asset, i) => {
                const mint = asset.mint.toBase58();
                const title = resolveAssetLabel(
                  mint,
                  asset.assetId,
                  byMint,
                  byId,
                );
                const pct = (asset.allocationBps / 100).toFixed(2);
                return (
                  <li key={`${mint}-${i}`} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium tracking-[-0.01em] text-foreground">
                        {title}
                      </span>
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
                      mint {shorten(mint)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-4 py-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Asset preview · open vault for deposit
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function VaultsPanel({ network }: { network: Network }) {
  const style = SECTION_STYLE.vaults;

  const [vaults, setVaults] = useState<VaultRecord[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    <section aria-label="Discover" className="flex flex-col gap-4">
      <div className={`${panelClass} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-5 py-3.5 md:px-6">
          <span
            className="font-display text-base font-semibold uppercase tracking-[0.18em]"
            style={{ color: style.accent }}
          >
            Discover
          </span>
          <span className={`${sectionLabelClass} uppercase`}>
            {loading
              ? 'loading · series 2026'
              : `${vaults.length} ETF${vaults.length === 1 ? '' : 's'} · series 2026`}
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
              <div
                key={vault.vault_address}
                className="group/row relative flex flex-col gap-3 px-2 py-4 md:px-3"
              >
                {/* Full-row hit target to detail — View assets sits above (z-10). */}
                <Link
                  href={vaultDetailPath(vault.vault_id)}
                  aria-label={`Open vault ${vault.symbol} · ${vault.name}`}
                  className="absolute inset-0 z-0 rounded-[2px] transition-colors duration-150 group-hover/row:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                />

                <div className="relative z-0 flex min-w-0 flex-col gap-3 pointer-events-none">
                  <div className="flex flex-wrap items-baseline gap-4">
                    <span className="flex-shrink-0 font-mono text-xs font-bold tabular-nums tracking-[0.08em] text-seal">
                      &#8470;&nbsp;CVLT-{vault.vault_id}
                    </span>
                    <span className="text-sm font-medium tracking-[-0.01em] text-foreground transition-colors duration-150 group-hover/row:text-accent">
                      {vault.symbol} · {vault.name}
                    </span>
                  </div>

                  <span className="font-mono text-[11px] text-muted-foreground">
                    vault {shorten(vault.vault_address)} · base{' '}
                    {shorten(NETWORK_CONSTANTS[network].usdcMint.toBase58())} ·{' '}
                    {vault.num_assets} asset{vault.num_assets === 1 ? '' : 's'}
                    {/* vaults.deposit_fee_bps / redeem_fee_bps from DB — the
                        pipe marks the step up from identity to economics. */}
                    <span aria-hidden="true" className="mx-2 text-border-strong">
                      |
                    </span>
                    entry fee{' '}
                    <span className="tabular-nums text-foreground">
                      {formatFeeBps(vault.deposit_fee_bps)}
                    </span>{' '}
                    · exit fee{' '}
                    <span className="tabular-nums text-foreground">
                      {formatFeeBps(vault.redeem_fee_bps)}
                    </span>
                  </span>
                </div>

                <div className="relative z-10">
                  <VaultAssetsView
                    vaultId={vault.vault_id}
                    byMint={byMint}
                    byId={byId}
                    network={network}
                  />
                </div>
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
    </section>
  );
}
