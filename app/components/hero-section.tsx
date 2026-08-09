'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Network } from '@/app/providers';
import { btnPrimaryClass, btnSecondaryClass } from '@/app/components/ui-classes';
import { sectionPath } from './console-routes';
import { ConsoleFooterBar } from './console-shell';
import { fetchAssetRegistry, fetchVaults } from '@/lib/registryClient';

const TICKER_ITEMS = [
  { sym: 'SOL5', nav: '1.0847', chg: '+2.31', up: true },
  { sym: 'DEFI7', nav: '0.9612', chg: '−0.84', up: false },
  { sym: 'LSTX', nav: '1.2410', chg: '+1.07', up: true },
  { sym: 'STBL', nav: '1.0192', chg: '+0.02', up: true },
  { sym: 'AI3', nav: '0.8104', chg: '+5.62', up: true },
  { sym: 'MEME4', nav: '0.4471', chg: '−7.18', up: false },
] as const;

const STEPS = [
  {
    num: '01',
    title: 'Pick a vault',
    body: 'Every vault publishes its basket, weights, fees and program address before you deposit.',
  },
  {
    num: '02',
    title: 'Deposit USDC',
    body: 'One transaction routes the basket swap and mints shares at live NAV.',
  },
  {
    num: '03',
    title: 'Redeem anytime',
    body: 'Burn shares to take the underlying tokens pro rata, or exit straight to USDC.',
  },
] as const;

function formatCompactUsd(raw: string | number | null | undefined): string {
  const n = typeof raw === 'string' ? Number(raw.replace(/[$,\s]/g, '')) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function HeroSection({
  network,
  vaultShort,
  programShort,
}: {
  network: Network;
  vaultId: number;
  vaultShort: string;
  programShort: string;
}) {
  const [vaultCount, setVaultCount] = useState<number | null>(null);
  const [assetCount, setAssetCount] = useState<number | null>(null);
  const [tvlLabel, setTvlLabel] = useState<string>('—');
  const [creators, setCreators] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    // ASSETS = full pre_approved_token_registry (not unique ids in vault baskets).
    fetchAssetRegistry(network)
      .then((assets) => {
        if (cancelled) return;
        const active = assets.filter((a) => a.active !== false);
        setAssetCount(active.length > 0 ? active.length : assets.length);
      })
      .catch(() => {
        if (!cancelled) setAssetCount(null);
      });

    fetchVaults(network)
      .then((rows) => {
        if (cancelled) return;
        // Stats only count vaults that finished genesis (live / investable).
        const live = rows.filter((v) => Boolean(v.genesis_deposit_status));
        setVaultCount(live.length);
        const creatorsSet = new Set(live.map((r) => r.creator).filter(Boolean));
        setCreators(creatorsSet.size);

        let tvl = 0;
        let any = false;
        for (const r of live) {
          const n = Number(String(r.total_usdc_value ?? '').replace(/[$,\s]/g, ''));
          if (Number.isFinite(n) && n > 0) {
            tvl += n;
            any = true;
          }
        }
        setTvlLabel(any ? formatCompactUsd(tvl) : '—');
      })
      .catch(() => {
        if (cancelled) return;
        setVaultCount(null);
        setCreators(null);
        setTvlLabel('—');
      });
    return () => {
      cancelled = true;
    };
  }, [network]);

  const tickerRun = [...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <div className="flex flex-1 flex-col">
      {/* Ticker */}
      <div
        className="overflow-hidden border-b border-border bg-bg-elevated py-[9px]"
        aria-hidden
      >
        <div className="ticker-track flex w-max gap-7 whitespace-nowrap font-mono text-[11px] text-text-dim">
          {tickerRun.map((item, i) => (
            <span key={`${item.sym}-${i}`} className="inline-flex items-center gap-7">
              <span>
                {item.sym} {item.nav}{' '}
                <span className={item.up ? 'text-accent' : 'text-destructive'}>
                  {item.up ? '▲' : '▼'}
                  {item.chg.replace(/^[+−-]/, '')}
                </span>
              </span>
              <span className="text-[#3A3A3F]">|</span>
            </span>
          ))}
        </div>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden px-[22px] pb-[84px] pt-24 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 50% at 50% 0%, rgba(200, 255, 61, 0.10), transparent 70%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-full"
          style={{
            backgroundImage:
              'linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px)',
            backgroundSize: '44px 100%',
            maskImage: 'linear-gradient(#000, transparent 85%)',
            WebkitMaskImage: 'linear-gradient(#000, transparent 85%)',
          }}
        />
        <div
          aria-hidden
          className="hero-scan-line pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(200, 255, 61, 0.55), transparent)',
          }}
        />

        <div className="relative mx-auto max-w-[960px]">
          <div className="inline-flex items-center gap-2.5 rounded-full border border-border-strong px-3.5 py-1.5 font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground">
            <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden />
            DECENTRALIZED TOKEN FUND · SOLANA
          </div>

          <h1 className="mx-auto mt-[26px] max-w-[900px] text-[clamp(48px,8vw,94px)] font-semibold leading-[0.9] tracking-[-0.05em] text-foreground">
            Own the basket,
            <br />
            not the bag
          </h1>

          <p className="mx-auto mt-6 max-w-[560px] text-[19px] leading-[1.5] text-muted-foreground">
            Deposit once. Own the fund. Exit on your terms.
          </p>

          <div className="mt-[34px] flex flex-wrap items-center justify-center gap-[11px]">
            <Link href={sectionPath('vaults')} className={btnPrimaryClass}>
              Browse vaults
            </Link>
            <Link href={sectionPath('vault-ops')} className={btnSecondaryClass}>
              Create an ETF
            </Link>
          </div>

          <p className="mx-auto mt-11 max-w-[420px] text-sm leading-[1.6] text-text-faint">
            A share is not a promise to pay you later — it is a claim you already own.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="grid grid-cols-1 gap-px border-t border-border bg-border md:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.num} className="bg-background px-6 py-[30px]">
            <div className="font-mono text-[11px] tracking-[0.1em] text-accent">
              {step.num}
            </div>
            <h3 className="mt-3 text-[19px] font-semibold tracking-[-0.01em]">
              {step.title}
            </h3>
            <p className="mt-2 text-sm leading-[1.55] text-text-dim">{step.body}</p>
          </div>
        ))}
      </section>

      {/* Stats */}
      <section className="flex flex-wrap border-t border-border">
        <StatCell label="TVL" value={tvlLabel} />
        <StatCell
          label="VAULTS"
          value={vaultCount != null ? String(vaultCount) : '—'}
        />
        <StatCell
          label="ASSETS"
          value={assetCount != null ? String(assetCount) : '—'}
        />
        <StatCell
          label="CREATORS"
          value={creators != null ? String(creators) : '—'}
        />
      </section>

      <ConsoleFooterBar
        programShort={programShort}
        vaultShort={vaultShort}
        network={network}
      />
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[45%] flex-1 border-b border-r border-border px-6 py-[26px] last:border-r-0 sm:min-w-0 sm:border-b-0 even:sm:border-r md:even:border-r">
      <div className="font-mono text-[10px] tracking-[0.14em] text-text-faint">
        {label}
      </div>
      <div className="mt-[7px] text-[30px] font-semibold tracking-[-0.03em]">
        {value}
      </div>
    </div>
  );
}
