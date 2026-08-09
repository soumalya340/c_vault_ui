'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import type { Network } from '@/lib/constants';
import { USDC_DECIMALS } from '@/lib/constants';
import {
  fetchVaults,
  updateVaultGenesisStatus,
  updateVaultPoolCreated,
  type VaultRecord,
} from '@/lib/registryClient';
import {
  formatUnits,
  getVaultState,
  NETWORK_CONSTANTS,
} from '@/lib/onchain/cvault';
import { PublicKey } from '@solana/web3.js';
import {
  fetchWalletPortfolio,
  type PortfolioHolding,
  type PortfolioSnapshot,
} from '@/lib/onchain/portfolio';
import {
  displayVaultName,
  formatTokenUi,
  formatUsdUi,
} from '@/app/components/view-display';
import { Skeleton } from '@/components/ui/skeleton';
import { RedeemModal } from './redeem-modal';
import { VaultInfoPopover } from './vault-info-popover';
import { ConsoleHero } from './console-hero';
import {
  MetricStripSkeleton,
  PortfolioListSkeleton,
} from './loading-skeletons';
import {
  btnPrimaryClass,
  btnSecondaryClass,
} from './ui-classes';
import { manageVaultPath, sectionPath, vaultDetailPath } from './console-routes';

const ASSET_COLORS = [
  '#C8FF3D',
  '#5AC8E8',
  '#B78CFF',
  '#FF9E4D',
  '#FF6B4D',
  '#7DE8A8',
] as const;

const PORTFOLIO_CHIPS = [
  'manager of record',
  'bearer certificates',
  'pro-rata book value',
] as const;

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function formatOwnership(bps: number | null): string {
  if (bps == null) return '—';
  return `${(bps / 100).toFixed(2)}%`;
}

function ownershipPct(bps: number | null): number {
  if (bps == null) return 0;
  return Math.min(100, Math.max(0, bps / 100));
}

function redeemStatusLabel(h: PortfolioHolding): string | null {
  const pending = h.redeemPendingUsdc;
  if (!pending || BigInt(pending) <= 0n) {
    if (h.isRedeemActive) {
      return 'Redeem in progress';
    }
    return null;
  }
  return `Claim ready · ${formatTokenUi(pending, USDC_DECIMALS)} USDC`;
}

function dotsForVault(vaultId: number, numAssets: number) {
  const count = Math.max(1, Math.min(numAssets || 3, 5));
  return Array.from({ length: count }, (_, i) => {
    const idx = (vaultId + i * 2) % ASSET_COLORS.length;
    return ASSET_COLORS[idx];
  });
}

function allocationSegments(v: VaultRecord) {
  const bps = v.asset_allocation_bps ?? [];
  const colors = dotsForVault(v.vault_id, v.num_assets);
  if (bps.length === 0) {
    // Equal fallback slices so the bar still reads as multi-asset.
    const n = Math.max(1, Math.min(v.num_assets || 1, colors.length));
    return colors.slice(0, n).map((c) => ({ color: c, pct: 100 / n }));
  }
  return bps.map((b, i) => ({
    color: colors[i % colors.length],
    pct: Math.max(0, b / 100),
  }));
}

export function PortfolioPanel({ network }: { network: Network }) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [createdVaults, setCreatedVaults] = useState<VaultRecord[]>([]);
  const [tab, setTab] = useState<'vaults' | 'positions'>('vaults');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeemTarget, setRedeemTarget] = useState<{
    vault: PortfolioHolding['vault'];
    shares: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!publicKey) {
      setSnapshot(null);
      setCreatedVaults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let vaults = await fetchVaults(network);

      // DB false → check on-chain once; if true, pin the DB flag.
      const pendingGenesis = vaults.filter((v) => !v.genesis_deposit_status);
      if (pendingGenesis.length > 0) {
        const reconciled = await Promise.all(
          pendingGenesis.map(async (v) => {
            try {
              const state = await getVaultState(connection, v.vault_id, network);
              if (!state.genesisDone) return null;
              return await updateVaultGenesisStatus(network, v.vault_id, true);
            } catch {
              return null;
            }
          }),
        );
        const byId = new Map(
          reconciled
            .filter((r): r is VaultRecord => r != null)
            .map((r) => [r.vault_id, r]),
        );
        if (byId.size > 0) {
          vaults = vaults.map((v) => byId.get(v.vault_id) ?? v);
        }
      }

      // DB false → derive shares×USDC DAMM pool; if account exists, pin true.
      const pendingPool = vaults.filter((v) => !v.is_pool_created);
      if (pendingPool.length > 0) {
        // Lazy: the Meteora DAMM SDK (~6MB source) is only needed to reconcile
        // pools that the DB has not yet marked created. Importing it here keeps
        // it out of the initial page bundle.
        const { resolveVaultShareUsdcPool } = await import('@/lib/meteora/pool');
        const usdcMint = NETWORK_CONSTANTS[network].usdcMint;
        const reconciled = await Promise.all(
          pendingPool.map(async (v) => {
            try {
              const info = await resolveVaultShareUsdcPool(
                connection,
                new PublicKey(v.shares_mint),
                usdcMint,
              );
              if (!info.exists) return null;
              return await updateVaultPoolCreated(network, v.vault_id, true);
            } catch {
              return null;
            }
          }),
        );
        const byId = new Map(
          reconciled
            .filter((r): r is VaultRecord => r != null)
            .map((r) => [r.vault_id, r]),
        );
        if (byId.size > 0) {
          vaults = vaults.map((v) => byId.get(v.vault_id) ?? v);
        }
      }

      const next = await fetchWalletPortfolio(
        connection,
        publicKey,
        vaults,
        network,
      );
      setSnapshot(next);
      setCreatedVaults(
        vaults.filter((v) => v.creator === publicKey.toBase58()),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSnapshot(null);
      setCreatedVaults([]);
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey, network]);

  useEffect(() => {
    load();
  }, [load]);

  const holdings = useMemo(() => snapshot?.holdings ?? [], [snapshot]);
  const holdingsByVaultId = useMemo(() => {
    const map = new Map<number, PortfolioHolding>();
    for (const h of holdings) map.set(h.vault.vault_id, h);
    return map;
  }, [holdings]);

  return (
    <section aria-label="Portfolio" className="flex min-h-0 flex-1 flex-col">
      {/* Masthead — same console plate as the Create page */}
      <ConsoleHero
        title="Portfolio"
        chips={connected ? PORTFOLIO_CHIPS : undefined}
      >
        Everything this wallet stands behind — vaults it charters as manager, and{' '}
        <span className="text-foreground">
          share certificates it carries as bearer.
        </span>
      </ConsoleHero>

      {connected && (
        <div className="flex items-center gap-4 px-[22px] pt-5 font-mono text-[10px] uppercase tracking-[0.14em]">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="text-accent transition-opacity hover:opacity-80 disabled:opacity-40"
          >
            {loading ? 'Reading…' : 'Refresh ↻'}
          </button>
        </div>
      )}

      {/* Metric strip */}
      {connected && loading && (
        <div className="border-b border-border">
          <MetricStripSkeleton />
        </div>
      )}

      {connected && snapshot && !loading && (
        <div className="px-[22px] pt-6">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-border-strong bg-white/[0.07] sm:grid-cols-4">
            <Metric
              label="Vaults chartered"
              value={String(createdVaults.length)}
              hint="as manager"
              hintAccent
            />
            <Metric
              label="Positions held"
              value={String(snapshot.positionCount)}
              hint="as bearer"
            />
            <Metric
              label="Book value"
              value={formatUsdUi(snapshot.totalEstimatedUsdc, USDC_DECIMALS)}
              hint="pro-rata vault book"
            />
            <Metric
              label="Open redeems"
              value={String(snapshot.pendingRedeemCount)}
              hint="queued"
            />
          </div>
        </div>
      )}

      {!connected && (
        <div className="flex flex-col items-start gap-4 px-[22px] py-10">
          <p className="max-w-[48ch] text-sm leading-relaxed text-muted-foreground">
            Connect a wallet to open its register. We&apos;ll show the vaults it charters
            as manager, and the share certificates it carries as bearer.
          </p>
          <button
            type="button"
            onClick={() => setVisible(true)}
            className={btnPrimaryClass}
          >
            Connect wallet
          </button>
        </div>
      )}

      {connected && !loading && error && (
        <div className="flex flex-col gap-3 px-[22px] py-8">
          <p className="font-mono text-xs text-destructive">{error}</p>
          <button type="button" onClick={() => void load()} className={btnSecondaryClass}>
            Try again
          </button>
        </div>
      )}

      {connected && loading && (
        <div className="border-b border-border">
          <div className="border-b border-white/[0.07] px-5 py-3.5">
            <Skeleton className="h-3 w-28 rounded-[2px]" />
          </div>
          <PortfolioListSkeleton rows={3} />
        </div>
      )}

      {connected && !loading && !error && (
        <div className="flex min-h-0 flex-1 flex-col p-[22px] pt-3.5">
          {/* Register panel — tabs and their contents share one visible frame */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[3px] border border-border-strong bg-background">
            {/* PF-A / PF-B tabs — active plate is filled, matching the basket tabs */}
            <div
              role="tablist"
              aria-label="Portfolio view"
              className="grid grid-cols-2 divide-x divide-border-strong border-b border-border-strong bg-foreground/[0.015]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'vaults'}
                onClick={() => setTab('vaults')}
                className={`flex items-center justify-between gap-3 px-[22px] py-3.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                  tab === 'vaults'
                    ? 'bg-accent text-background'
                    : 'text-text-ghost hover:bg-foreground/[0.04] hover:text-foreground'
                }`}
              >
                <span className="font-mono text-[12px] uppercase tracking-[0.12em]">
                  <span className={tab === 'vaults' ? 'text-background/60' : 'text-[#4A4A50]'}>
                    PF-A
                  </span>{' '}
                  My vaults
                </span>
                <span
                  className={`font-mono text-[11.5px] tabular-nums ${
                    tab === 'vaults' ? 'text-background/60' : 'text-[#4A4A50]'
                  }`}
                >
                  {createdVaults.length}
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'positions'}
                onClick={() => setTab('positions')}
                className={`flex items-center justify-between gap-3 px-[22px] py-3.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                  tab === 'positions'
                    ? 'bg-accent text-background'
                    : 'text-text-ghost hover:bg-foreground/[0.04] hover:text-foreground'
                }`}
              >
                <span className="font-mono text-[12px] uppercase tracking-[0.12em]">
                  <span
                    className={tab === 'positions' ? 'text-background/60' : 'text-[#4A4A50]'}
                  >
                    PF-B
                  </span>{' '}
                  My positions
                </span>
                <span
                  className={`font-mono text-[11.5px] tabular-nums ${
                    tab === 'positions' ? 'text-background/60' : 'text-[#4A4A50]'
                  }`}
                >
                  {holdings.length}
                </span>
              </button>
            </div>

          {tab === 'vaults' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-[22px] py-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-ghost">
                <span>
                  Chartered as manager · {createdVaults.length} vault
                  {createdVaults.length === 1 ? '' : 's'}
                </span>
                <span className="hidden sm:inline">Weights shown at last rebalance</span>
              </div>

              {createdVaults.length === 0 ? (
                <div className="flex flex-col items-start gap-4 px-[22px] py-10">
                  <p className="text-sm text-muted-foreground">
                    This wallet hasn&apos;t chartered a vault on {network}.
                  </p>
                  <p className="max-w-[48ch] text-sm leading-relaxed text-text-dim">
                    Creating a vault makes this wallet its manager of record — fee
                    recipient and operational authority until reassigned.
                  </p>
                  <Link href={sectionPath('vault-ops')} className={btnSecondaryClass}>
                    Charter a new vault
                  </Link>
                </div>
              ) : (
                /* 2-column vault cards — MyVaults mockup */
                <div className="grid grid-cols-1 gap-px bg-white/[0.07] sm:grid-cols-2">
                  {createdVaults.map((v) => {
                    const holding = holdingsByVaultId.get(v.vault_id);
                    const colors = dotsForVault(v.vault_id, v.num_assets);
                    const segments = allocationSegments(v);
                    const isBearer =
                      holding != null && BigInt(holding.shareBalance) > 0n;
                    const sharesUi =
                      holding != null
                        ? formatTokenUi(holding.shareBalance, holding.sharesDecimals)
                        : null;

                    return (
                      <article
                        key={v.vault_address}
                        className="flex flex-col gap-[18px] bg-background px-[22px] py-[22px] pb-[18px]"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="font-mono text-[10.5px] tracking-[0.14em] text-accent">
                              Nº CVLT-{v.vault_id}
                            </div>
                            <div className="mt-2 flex flex-wrap items-baseline gap-x-[11px] gap-y-1">
                              <span className="text-[26px] font-semibold tracking-[-0.035em] text-foreground">
                                {displayVaultName(v.name)}
                              </span>
                              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
                                {v.num_assets} assets ·{' '}
                                {v.fund_type === 'fixed' ? 'static' : 'dynamic'}
                              </span>
                            </div>
                          </div>
                          <span className="flex shrink-0">
                            {colors.map((c, i) => (
                              <span
                                key={i}
                                className="inline-block h-5 w-5 rounded-full shadow-[0_0_0_2px_#0A0A0B]"
                                style={{
                                  background: c,
                                  marginLeft: i === 0 ? 0 : -7,
                                }}
                              />
                            ))}
                          </span>
                        </div>

                        <div className="flex h-[5px] overflow-hidden rounded-full bg-white/[0.06]">
                          {segments.map((seg, i) => (
                            <span
                              key={i}
                              className="h-full"
                              style={{
                                width: `${seg.pct}%`,
                                background: seg.color,
                              }}
                            />
                          ))}
                        </div>

                        <div className="grid grid-cols-2 gap-x-[18px] gap-y-3.5">
                          <div>
                            <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-ghost">
                              Vault
                            </div>
                            <div className="mt-1.5 font-mono text-[12.5px] text-[#DADADE]">
                              {shorten(v.vault_address)}
                            </div>
                          </div>
                          <div>
                            <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-ghost">
                              Your shares
                            </div>
                            <div className="mt-1.5 font-mono text-[12.5px] text-[#DADADE]">
                              {sharesUi ?? '—'}
                              {holding?.ownershipBps != null && (
                                <span className="text-text-ghost">
                                  {' '}
                                  · {formatOwnership(holding.ownershipBps)} of supply
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-[7px]">
                          {v.genesis_deposit_status && (
                            <span className="rounded-[5px] bg-accent/10 px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-accent">
                              Genesis-deposit-done
                            </span>
                          )}
                          {v.is_pool_created && (
                            <span className="rounded-[5px] bg-[rgba(90,200,232,0.12)] px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[#5AC8E8]">
                              Stake &amp; earn
                            </span>
                          )}
                          {isBearer && (
                            <span className="rounded-[5px] border border-white/[0.12] px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-faint">
                              Bearer + manager
                            </span>
                          )}
                          {v.paused ? (
                            <span className="rounded-[5px] bg-destructive/10 px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-destructive">
                              Paused
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/[0.07] pt-[15px] font-mono text-[10.5px] uppercase tracking-[0.12em]">
                          <VaultInfoPopover
                            vaultId={v.vault_id}
                            name={v.name}
                            network={network}
                          />
                          <Link
                            href={manageVaultPath(v.vault_address)}
                            className="text-accent transition-opacity hover:opacity-80"
                          >
                            Manage →
                          </Link>
                        </div>
                      </article>
                    );
                  })}

                  <Link
                    href={sectionPath('vault-ops')}
                    className="flex min-h-[220px] flex-col items-start justify-center gap-3 border border-dashed border-white/[0.08] bg-background px-[22px] py-[22px] transition-colors hover:border-accent/40 hover:bg-accent/[0.03]"
                  >
                    <span className="text-[22px] font-light leading-none text-accent">+</span>
                    <span className="text-base font-semibold tracking-[-0.02em] text-foreground">
                      Charter a new vault
                    </span>
                    <span className="max-w-[260px] text-[13px] leading-relaxed text-text-ghost">
                      Pick a basket from the admin-approved registry and mint shares at
                      your opening price.
                    </span>
                  </Link>
                </div>
              )}

              <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border px-[22px] py-[15px] font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-ghost">
                <span>cVault series 2026</span>
                <span className="hidden sm:inline">Bearer register</span>
                <span className="text-accent">{network}</span>
              </footer>
            </>
          )}

          {tab === 'positions' && (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3 px-[22px] pb-5 pt-6">
                <div>
                  <h2 className="m-0 text-[30px] font-semibold tracking-[-0.035em] text-foreground">
                    Holdings ledger
                  </h2>
                  <p className="mt-1.5 text-sm text-text-dim">
                    {holdings.length} instrument{holdings.length === 1 ? '' : 's'} · share
                    certificates carried by this wallet
                  </p>
                </div>
                <span className="rounded-full border border-[rgba(255,158,77,0.3)] bg-[rgba(255,158,77,0.08)] px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#FF9E4D]">
                  Book ≠ live NAV
                </span>
              </div>

              {holdings.length === 0 ? (
                <div className="flex flex-col items-start gap-4 px-[22px] py-10">
                  <p className="text-sm text-muted-foreground">
                    No share certificates for this wallet on {network}.
                  </p>
                  <p className="max-w-[48ch] text-sm leading-relaxed text-text-dim">
                    Deposit USDC into a vault to mint shares. Your position will
                    appear here after the transaction confirms.
                  </p>
                  <Link href={sectionPath('vaults')} className={btnPrimaryClass}>
                    Browse vaults
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col">
                  <div className="hidden grid-cols-[1.5fr_1fr_1.3fr_0.9fr_250px] gap-[18px] border-b border-white/[0.07] bg-bg-elevated px-[22px] py-3 font-mono text-[9.5px] uppercase tracking-[0.13em] text-text-ghost lg:grid">
                    <span>Instrument</span>
                    <span className="text-right">Shares</span>
                    <span>Supply share</span>
                    <span className="text-right">Book</span>
                    <span className="text-right">Actions</span>
                  </div>

                  <ul>
                    {holdings.map((h, idx) => {
                      const redeemLabel = redeemStatusLabel(h);
                      const sharesUi = formatTokenUi(
                        h.shareBalance,
                        h.sharesDecimals,
                      );
                      const bookUi =
                        h.estimatedUsdc != null
                          ? formatUsdUi(h.estimatedUsdc, USDC_DECIMALS)
                          : '—';
                      const hasShares = BigInt(h.shareBalance) > 0n;
                      const pct = ownershipPct(h.ownershipBps);
                      const colors = dotsForVault(
                        h.vault.vault_id,
                        h.vault.num_assets,
                      );
                      const symbol = (h.vault.symbol || `V${h.vault.vault_id}`).toUpperCase();

                      return (
                        <li
                          key={h.vault.vault_address}
                          className={`border-b border-white/[0.06] px-[22px] py-5 transition-colors hover:bg-white/[0.015] ${
                            idx === 0 ? 'bg-accent/[0.03]' : ''
                          }`}
                        >
                          <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-[1.5fr_1fr_1.3fr_0.9fr_250px] lg:gap-[18px]">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex shrink-0">
                                {colors.map((c, i) => (
                                  <span
                                    key={i}
                                    className="inline-block h-5 w-5 rounded-full shadow-[0_0_0_2px_#0A0A0B]"
                                    style={{
                                      background: c,
                                      marginLeft: i === 0 ? 0 : -7,
                                    }}
                                  />
                                ))}
                              </span>
                              <span className="min-w-0">
                                <span className="font-mono text-[11px] tracking-[0.08em] text-accent">
                                  CVLT-{h.vault.vault_id}
                                </span>
                                <span className="ml-2 text-base font-semibold tracking-[-0.02em] text-foreground">
                                  {displayVaultName(h.vault.name)}
                                </span>
                                <div className="mt-1 font-mono text-[11px] text-text-ghost">
                                  {shorten(h.vault.vault_address)} ·{' '}
                                  {h.vault.fund_type === 'fixed' ? 'static' : 'dynamic'} ·{' '}
                                  {h.vault.num_assets} asset
                                  {h.vault.num_assets === 1 ? '' : 's'}
                                </div>
                              </span>
                            </div>

                            <div className="text-left lg:text-right">
                              <div className="font-mono text-[17px] tabular-nums text-foreground">
                                {sharesUi}
                              </div>
                              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-ghost">
                                {symbol} shares
                              </div>
                            </div>

                            <div>
                              <div className="flex items-baseline justify-between font-mono text-[11px] text-text-dim">
                                <span className="uppercase tracking-[0.08em]">
                                  Of supply
                                </span>
                                <span className="text-[13px] text-foreground">
                                  {formatOwnership(h.ownershipBps)}
                                </span>
                              </div>
                              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                                <span
                                  className="block h-full rounded-full bg-accent"
                                  style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
                                />
                              </div>
                            </div>

                            <div className="text-left lg:text-right">
                              <div className="font-mono text-[15px] tabular-nums text-[#5E5E64]">
                                {bookUi}
                              </div>
                              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-ghost">
                                Book value
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2 lg:justify-end">
                              <Link
                                href={vaultDetailPath(h.vault.vault_address)}
                                className="rounded-full border border-white/14 px-[22px] py-[11px] text-[13.5px] font-medium text-foreground transition-colors hover:bg-white/[0.06]"
                              >
                                Deposit
                              </Link>
                              <button
                                type="button"
                                onClick={() =>
                                  setRedeemTarget({
                                    vault: h.vault,
                                    // Full position; claim-only when pending and no shares.
                                    shares: hasShares
                                      ? formatUnits(h.shareBalance, h.sharesDecimals)
                                      : '',
                                  })
                                }
                                disabled={
                                  !hasShares &&
                                  !(
                                    h.redeemPendingUsdc &&
                                    BigInt(h.redeemPendingUsdc) > 0n
                                  )
                                }
                                className="rounded-full bg-accent px-[22px] py-[11px] text-[13.5px] font-semibold text-background transition-[transform,background] hover:-translate-y-px hover:bg-[#d4ff5c] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                              >
                                Redeem
                              </button>
                            </div>
                          </div>

                          {redeemLabel && (
                            <div className="mt-3 border-t border-white/[0.06] pt-2.5 font-mono text-[11px] text-accent">
                              {redeemLabel}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  <div className="flex flex-wrap items-center justify-between gap-3 px-[22px] py-4 font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-ghost">
                    <span>cVault series 2026</span>
                    <span>Redeem burns shares pro rata</span>
                    <span className="text-accent">{network}</span>
                  </div>
                </div>
              )}
            </>
          )}
          </div>
        </div>
      )}

      {redeemTarget && (
        <RedeemModal
          vault={redeemTarget.vault}
          network={network}
          shares={redeemTarget.shares}
          onClose={() => {
            setRedeemTarget(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  hintAccent,
}: {
  label: string;
  value: string;
  hint?: string;
  hintAccent?: boolean;
}) {
  return (
    <div className="bg-background px-[22px] py-5">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-faint">
        {label}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <span className="text-[34px] font-semibold leading-none tracking-[-0.04em] text-foreground">
          {value}
        </span>
        {hint && (
          <span
            className={`font-mono text-[11px] ${
              hintAccent ? 'text-accent' : 'text-text-ghost'
            }`}
          >
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}
