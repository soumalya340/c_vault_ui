'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import type { Network } from '@/lib/constants';
import { USDC_DECIMALS } from '@/lib/constants';
import { fetchVaults, type VaultRecord } from '@/lib/registryClient';
import {
  fetchWalletPortfolio,
  type PortfolioHolding,
  type PortfolioSnapshot,
} from '@/lib/portfolio';
import { formatTokenUi, formatUsdUi } from '@/app/components/view-display';
import { Skeleton } from '@/components/ui/skeleton';
import { DepositModal } from './deposit-modal';
import { RedeemModal } from './redeem-modal';
import {
  MetricStripSkeleton,
  PortfolioListSkeleton,
} from './loading-skeletons';
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  panelClass,
  sectionLabelClass,
} from './ui-classes';
import { SECTION_STYLE } from './function-defs';
import { sectionPath } from './console-routes';

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function formatOwnership(bps: number | null): string {
  if (bps == null) return '—';
  return `${(bps / 100).toFixed(2)}%`;
}

function redeemStatusLabel(h: PortfolioHolding, nowSec: number): string | null {
  const pending = h.redeemPendingUsdc;
  if (!pending || BigInt(pending) <= 0n) {
    if (h.redeemableShares && BigInt(h.redeemableShares) > 0n) {
      return 'Redeem in progress';
    }
    return null;
  }
  const unlock = h.redeemUnlockTime ?? 0;
  if (unlock > nowSec) {
    return `Pending ${formatTokenUi(pending, USDC_DECIMALS)} USDC · unlocks ${new Date(unlock * 1000).toLocaleString()}`;
  }
  return `Claim ready · ${formatTokenUi(pending, USDC_DECIMALS)} USDC`;
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
  const [depositTarget, setDepositTarget] = useState<
    PortfolioHolding['vault'] | null
  >(null);
  const [redeemTarget, setRedeemTarget] = useState<
    PortfolioHolding['vault'] | null
  >(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

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
      const vaults = await fetchVaults(network);
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
      setNowSec(Math.floor(Date.now() / 1000));
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
  const walletLabel = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : null;
  const heldVaultIds = useMemo(
    () =>
      new Set(
        holdings
          .filter((h) => BigInt(h.shareBalance) > 0n)
          .map((h) => h.vault.vault_id),
      ),
    [holdings],
  );

  return (
    <section aria-label='Portfolio' className='flex flex-col gap-6'>
      {/* Masthead — bearer register, not a SaaS hero */}
      <header className='relative border-b-[1.5px] border-border-strong pb-6 motion-safe:animate-[cert-fadeup_0.6s_ease_both]'>
        <div className='flex items-baseline justify-between gap-3 font-mono text-[9px] uppercase tracking-[0.28em] text-muted-foreground'>
          <span>
            Plate <span className='text-accent'>&#8470; PF</span> · Bearer
            register
          </span>
          <span className='hidden sm:inline'>Solana · {network}</span>
        </div>

        <div className='mt-4 flex flex-wrap items-end gap-x-8 gap-y-3'>
          <h1 className='m-0 flex items-baseline gap-4 font-display text-[clamp(30px,4.5vw,54px)] font-bold uppercase leading-none tracking-[0.04em] text-foreground'>
            <span
              aria-hidden
              className='font-mono text-[clamp(14px,1.6vw,20px)] font-bold tracking-[0.1em] text-accent'
            >
              PF
            </span>
            Portfolio
          </h1>
          <p className='m-0 max-w-[52ch] pb-1 text-sm leading-[1.6] text-muted-foreground'>
            Everything this wallet stands behind — vaults it charters as
            manager, and share certificates it carries as bearer.
          </p>
        </div>

        <span
          aria-hidden
          className='absolute -bottom-[1.5px] left-0 h-[3px] w-20 bg-accent'
        />
      </header>

      {/* Identity strip */}
      <div className={`${panelClass} overflow-hidden`}>
        <div className='flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-5 py-3.5 md:px-6'>
          <div className='flex flex-col gap-1'>
            <span className='font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground'>
              Bearer
            </span>
            {connected && publicKey ? (
              <span className='font-mono text-sm tabular-nums tracking-[0.04em] text-foreground'>
                <span className='text-seal'>&#8470;</span>{' '}
                <span title={publicKey.toBase58()}>{walletLabel}</span>
              </span>
            ) : (
              <span className='font-mono text-sm text-muted-foreground'>
                Not connected
              </span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {connected && (
              <button
                type='button'
                onClick={load}
                disabled={loading}
                className={btnSecondaryClass}
              >
                {loading ? 'Reading…' : 'Refresh'}
              </button>
            )}
          </div>
        </div>

        {connected && loading && <MetricStripSkeleton />}

        {connected && snapshot && !loading && (
          <div className='grid grid-cols-2 divide-x divide-border border-b border-border sm:grid-cols-4'>
            <Metric
              label='Vaults chartered'
              value={String(createdVaults.length)}
            />
            <Metric
              label='Positions held'
              value={String(snapshot.positionCount)}
            />
            <Metric
              label='Book value'
              value={formatUsdUi(snapshot.totalEstimatedUsdc, USDC_DECIMALS)}
              hint='Pro-rata vault book'
            />
            <Metric
              label='Open redeems'
              value={String(snapshot.pendingRedeemCount)}
              className='col-span-2 sm:col-span-1'
            />
          </div>
        )}

        {!connected && (
          <div className='flex flex-col items-start gap-4 px-5 py-10 md:px-6'>
            <p className='max-w-[48ch] text-sm leading-relaxed text-muted-foreground'>
              Connect a wallet to open its register. We&apos;ll show the vaults
              it charters as manager, and the share certificates it carries as
              bearer.
            </p>
            <button
              type='button'
              onClick={() => setVisible(true)}
              className={btnPrimaryClass}
            >
              Connect wallet
            </button>
          </div>
        )}

        {connected && !loading && error && (
          <div className='flex flex-col gap-3 px-5 py-8 md:px-6'>
            <p className='font-mono text-xs text-destructive'>
              <span className='mr-2 text-muted-foreground/50'>&gt;</span>
              {error}
            </p>
            <button type='button' onClick={load} className={btnGhostClass}>
              Try again
            </button>
          </div>
        )}
      </div>

      {connected && loading && (
        <div className={`${panelClass} overflow-hidden`}>
          <div className='border-b border-border-strong px-5 py-3.5 md:px-6'>
            <Skeleton className='h-3 w-28 rounded-[2px]' />
          </div>
          <PortfolioListSkeleton rows={3} />
        </div>
      )}

      {connected && !loading && !error && (
        <div className={`${panelClass} overflow-hidden`}>
          {/* PF-A / PF-B toggle — one register, two views of the same wallet */}
          <div
            role='tablist'
            aria-label='Portfolio view'
            className='flex divide-x divide-border-strong border-b border-border-strong'
          >
            <button
              type='button'
              role='tab'
              aria-selected={tab === 'vaults'}
              onClick={() => setTab('vaults')}
              className={`flex flex-1 items-center justify-between gap-3 px-5 py-3.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset md:px-6 ${
                tab === 'vaults'
                  ? 'bg-accent text-background'
                  : 'text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground'
              }`}
            >
              <span className='flex items-baseline gap-2.5'>
                <span
                  className={`font-mono text-[10px] font-bold tracking-[0.14em] ${tab === 'vaults' ? 'text-background/70' : 'text-seal'}`}
                >
                  PF-A
                </span>
                <span className='font-mono text-[11px] font-bold uppercase tracking-[0.16em]'>
                  My vaults
                </span>
              </span>
              <span
                className={`font-mono text-[10px] tabular-nums ${tab === 'vaults' ? 'text-background/70' : 'text-muted-foreground/70'}`}
              >
                {createdVaults.length}
              </span>
            </button>
            <button
              type='button'
              role='tab'
              aria-selected={tab === 'positions'}
              onClick={() => setTab('positions')}
              className={`flex flex-1 items-center justify-between gap-3 px-5 py-3.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset md:px-6 ${
                tab === 'positions'
                  ? 'bg-accent text-background'
                  : 'text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground'
              }`}
            >
              <span className='flex items-baseline gap-2.5'>
                <span
                  className={`font-mono text-[10px] font-bold tracking-[0.14em] ${tab === 'positions' ? 'text-background/70' : 'text-seal'}`}
                >
                  PF-B
                </span>
                <span className='font-mono text-[11px] font-bold uppercase tracking-[0.16em]'>
                  My positions
                </span>
              </span>
              <span
                className={`font-mono text-[10px] tabular-nums ${tab === 'positions' ? 'text-background/70' : 'text-muted-foreground/70'}`}
              >
                {holdings.length}
              </span>
            </button>
          </div>

          {tab === 'vaults' && (
            <>
              <div className='flex items-center justify-end border-b border-border px-5 py-2.5 md:px-6'>
                <span className='font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground'>
                  Chartered as manager
                </span>
              </div>

              {createdVaults.length === 0 ? (
                <div className='flex flex-col items-start gap-4 px-5 py-10 md:px-6'>
                  <p className='font-mono text-xs text-muted-foreground'>
                    <span className='mr-2 text-muted-foreground/50'>&gt;</span>
                    This wallet hasn&apos;t chartered a vault on {network}.
                  </p>
                  <p className='max-w-[48ch] text-sm leading-relaxed text-muted-foreground'>
                    Creating a vault makes this wallet its manager of record —
                    fee recipient and operational authority until reassigned.
                  </p>
                  <Link
                    href={sectionPath('vault-ops')}
                    className={btnSecondaryClass}
                  >
                    Create a vault
                  </Link>
                </div>
              ) : (
                <ul className='divide-y divide-border'>
                  {createdVaults.map((v) => (
                    <li
                      key={v.vault_address}
                      className='flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-foreground/[0.02] sm:flex-row sm:items-center sm:justify-between md:px-6'
                    >
                      <div className='min-w-0'>
                        <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1.5'>
                          <span className='font-mono text-xs font-bold tabular-nums tracking-[0.08em] text-seal'>
                            &#8470;&nbsp;CVLT-{v.vault_id}
                          </span>
                          <span className='text-sm font-medium tracking-[-0.01em] text-foreground'>
                            {v.symbol}
                          </span>
                          <span className='truncate text-sm text-muted-foreground'>
                            {v.name}
                          </span>
                          <span
                            className='rounded-[2px] border border-border-strong px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase leading-none tracking-[0.1em] text-muted-foreground'
                            title={`${v.fund_type === 'fixed' ? 'Fixed' : 'Dynamic'} basket · ${v.num_assets} asset${v.num_assets === 1 ? '' : 's'}`}
                          >
                            {v.fund_type === 'fixed' ? 'Fixed' : 'Dynamic'} ·{' '}
                            {v.num_assets}
                          </span>
                        </div>
                        <div className='mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground'>
                          <span>vault {shorten(v.vault_address)}</span>
                          {v.paused ? (
                            <span className='text-destructive'>paused</span>
                          ) : null}
                          {heldVaultIds.has(v.vault_id) && (
                            <span>you also hold shares</span>
                          )}
                        </div>
                      </div>
                      <div className='flex items-center gap-4 sm:text-right'>
                        <div>
                          <span className='block font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground'>
                            Vault TVL
                          </span>
                          <span className='font-mono text-sm font-semibold tabular-nums text-foreground'>
                            {formatUsdUi(v.total_usdc_value, USDC_DECIMALS)}
                          </span>
                        </div>
                        <Link
                          href={sectionPath('vault-ops')}
                          className={btnGhostClass}
                        >
                          Manage &rarr;
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'positions' && (
            <>
              <div className='flex items-center justify-end border-b border-border px-5 py-2.5 md:px-6'>
                <span className='font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground'>
                  Book &ne; live NAV
                </span>
              </div>

              {holdings.length === 0 ? (
                <div className='flex flex-col items-start gap-4 px-5 py-10 md:px-6'>
                  <p className='font-mono text-xs text-muted-foreground'>
                    <span className='mr-2 text-muted-foreground/50'>&gt;</span>
                    No share certificates for this wallet on {network}.
                  </p>
                  <p className='max-w-[48ch] text-sm leading-relaxed text-muted-foreground'>
                    Deposit USDC into a vault to mint shares. Your position will
                    appear here after the transaction confirms.
                  </p>
                  <Link
                    href={sectionPath('vaults')}
                    className={btnPrimaryClass}
                  >
                    Browse vaults
                  </Link>
                </div>
              ) : (
                <div className='flex flex-col'>
                  <div className='flex items-center justify-between gap-3 border-b border-border px-5 py-2.5 md:px-6'>
                    <span className={`${sectionLabelClass} uppercase`}>
                      Holdings ledger · {holdings.length} instrument
                      {holdings.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {/* Column legend — wide layouts only (this panel runs at half width from xl up) */}
                  <div className='hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 border-b border-border px-5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground 2xl:grid md:px-6'>
                    <span>Instrument</span>
                    <span className='text-right'>Shares</span>
                    <span className='text-right'>Book value</span>
                    <span className='min-w-[17rem] text-right'>Actions</span>
                  </div>

                  <ul className='divide-y divide-border'>
                    {holdings.map((h) => {
                      const redeemLabel = redeemStatusLabel(h, nowSec);
                      const sharesUi = formatTokenUi(
                        h.shareBalance,
                        h.sharesDecimals,
                      );
                      const bookUi =
                        h.estimatedUsdc != null
                          ? formatUsdUi(h.estimatedUsdc, USDC_DECIMALS)
                          : '—';
                      const hasShares = BigInt(h.shareBalance) > 0n;

                      return (
                        <li
                          key={h.vault.vault_address}
                          className='flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-foreground/[0.02] md:px-6'
                        >
                          <div className='grid grid-cols-1 items-start gap-3 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] 2xl:gap-4'>
                            <div className='min-w-0'>
                              <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
                                <span className='font-mono text-xs font-bold tabular-nums tracking-[0.08em] text-seal'>
                                  &#8470;&nbsp;CVLT-{h.vault.vault_id}
                                </span>
                                <span className='text-sm font-medium tracking-[-0.01em] text-foreground'>
                                  {h.vault.symbol}
                                </span>
                                <span className='truncate text-sm text-muted-foreground'>
                                  {h.vault.name}
                                </span>
                              </div>
                              <div className='mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground'>
                                <span>
                                  vault {shorten(h.vault.vault_address)}
                                </span>
                                <span>
                                  {h.vault.fund_type} · {h.vault.num_assets}{' '}
                                  asset
                                  {h.vault.num_assets === 1 ? '' : 's'}
                                </span>
                                {h.ownershipBps != null && (
                                  <span>
                                    {formatOwnership(h.ownershipBps)} of supply
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className='flex items-baseline justify-between gap-2 2xl:block 2xl:text-right'>
                              <span className='font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground 2xl:hidden'>
                                Shares
                              </span>
                              <div>
                                <span className='font-mono text-sm font-semibold tabular-nums text-foreground'>
                                  {sharesUi}
                                </span>
                                <span className='ml-1.5 font-mono text-[11px] text-muted-foreground'>
                                  {h.vault.symbol}
                                </span>
                              </div>
                            </div>

                            <div className='flex items-baseline justify-between gap-2 2xl:block 2xl:text-right'>
                              <span className='font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground 2xl:hidden'>
                                Book value
                              </span>
                              <span className='font-mono text-sm font-semibold tabular-nums text-foreground'>
                                {bookUi}
                              </span>
                            </div>

                            <div className='flex flex-wrap items-center gap-2 2xl:min-w-[17rem] 2xl:justify-end'>
                              <button
                                type='button'
                                onClick={() => setDepositTarget(h.vault)}
                                className={btnSecondaryClass}
                              >
                                Deposit
                              </button>
                              <button
                                type='button'
                                onClick={() => setRedeemTarget(h.vault)}
                                disabled={
                                  !hasShares &&
                                  !(
                                    h.redeemPendingUsdc &&
                                    BigInt(h.redeemPendingUsdc) > 0n
                                  )
                                }
                                className={btnPrimaryClass}
                                style={{
                                  borderColor:
                                    SECTION_STYLE['vault-ops'].accent,
                                  background: SECTION_STYLE['vault-ops'].accent,
                                }}
                              >
                                Redeem
                              </button>
                            </div>
                          </div>

                          {(redeemLabel || h.totalUsdcDeposited) && (
                            <div className='flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-2.5 font-mono text-[11px] text-muted-foreground'>
                              {redeemLabel && (
                                <span className='text-seal'>{redeemLabel}</span>
                              )}
                              {h.totalUsdcDeposited &&
                                BigInt(h.totalUsdcDeposited) > 0n && (
                                  <span>
                                    Tracked deposits{' '}
                                    {formatTokenUi(
                                      h.totalUsdcDeposited,
                                      USDC_DECIMALS,
                                    )}{' '}
                                    USDC
                                    {h.lastDepositTs
                                      ? ` · last ${new Date(h.lastDepositTs * 1000).toLocaleDateString()}`
                                      : ''}
                                  </span>
                                )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <p className='font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/80'>
        Book value = pro-rata share of vault total_usdc_value. Live oracle NAV
        is available under View · Read NAV.
      </p>

      {depositTarget && (
        <DepositModal
          vault={depositTarget}
          network={network}
          onClose={() => {
            setDepositTarget(null);
            void load();
          }}
        />
      )}
      {redeemTarget && (
        <RedeemModal
          vault={redeemTarget}
          network={network}
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
  className = '',
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 px-5 py-4 md:px-6 ${className}`}>
      <span className='font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground'>
        {label}
      </span>
      <span className='font-mono text-lg font-semibold tabular-nums tracking-tight text-foreground'>
        {value}
      </span>
      {hint && (
        <span className='font-mono text-[10px] text-muted-foreground/70'>
          {hint}
        </span>
      )}
    </div>
  );
}
