'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Network } from '@/app/providers';
import { btnPrimaryClass, btnSecondaryClass } from '@/app/components/ui-classes';
import { ClusterLiveLabel, LocalhostStamp } from './cluster-status';
import { SECTION_STYLE, type SectionId } from './function-defs';
import { SECTION_META } from './section-header';
import { sectionPath } from './console-routes';

const TICKER_ITEMS = [
  'DEP · Deposit',
  'RDM · Redeem',
  'NAV · Read NAV',
  'CRT · Create',
  'USDC · Quote mint',
  'ORCA · Whirlpool',
  'DAMM · V2 pools',
  'PYTH · Oracle',
] as const;

// Admin lives at the gated /admin dashboard — wallet menu "Dashboard" only.
const SECTION_IDS = ['view', 'vaults', 'vault-ops'] as const satisfies readonly Exclude<
  SectionId,
  'admin'
>[];

export function GuillocheRosette({ className }: { className?: string }) {
  const petals = Array.from({ length: 18 }, (_, i) => i * 10);
  const inner = Array.from({ length: 12 }, (_, i) => i * 15 + 5);
  return (
    <svg
      viewBox="0 0 400 400"
      className={className}
      aria-hidden
      fill="none"
      stroke="currentColor"
    >
      <g className="guilloche">
        {petals.map((deg) => (
          <ellipse
            key={`p${deg}`}
            cx="200"
            cy="200"
            rx="192"
            ry="56"
            strokeWidth="0.6"
            transform={`rotate(${deg} 200 200)`}
          />
        ))}
        {inner.map((deg) => (
          <ellipse
            key={`i${deg}`}
            cx="200"
            cy="200"
            rx="118"
            ry="26"
            strokeWidth="0.5"
            transform={`rotate(${deg} 200 200)`}
          />
        ))}
        <circle cx="200" cy="200" r="196" strokeWidth="0.8" />
        <circle cx="200" cy="200" r="122" strokeWidth="0.5" />
        <circle cx="200" cy="200" r="58" strokeWidth="0.5" />
      </g>
    </svg>
  );
}

function SerialRail({ side, text }: { side: 'left' | 'right'; text: string }) {
  return (
    <span
      aria-hidden
      className={`serial-rail pointer-events-none absolute inset-y-0 hidden items-center justify-center font-mono text-[9px] uppercase tracking-[0.5em] text-muted-foreground/70 lg:flex ${
        side === 'left'
          ? 'left-0 border-r border-border'
          : 'right-0 rotate-180 border-l border-border'
      } w-9`}
    >
      {text}
    </span>
  );
}

export function HeroSection({
  network,
  vaultId,
  vaultShort,
  programShort,
}: {
  network: Network;
  vaultId: number;
  vaultShort: string;
  programShort: string;
}) {
  const tickerRun = [...TICKER_ITEMS, ...TICKER_ITEMS];
  const [heroShown, setHeroShown] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setHeroShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <section className="flex flex-col gap-6" aria-label="cVault overview">
      <div className="relative isolate overflow-hidden border-[1.5px] border-border-strong bg-background">
        <GuillocheRosette className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 text-accent opacity-[0.16] sm:h-[720px] sm:w-[720px] md:h-[880px] md:w-[880px]" />

        <SerialRail side="left" text={`Series 2026 · № CVLT-${vaultId}`} />
        <SerialRail side="right" text={`Solana · ${network} · c-vault`} />

        <div
          className={`t-stagger relative flex flex-col items-center gap-6 px-6 py-14 text-center sm:py-16 md:py-20 lg:px-16 ${
            heroShown ? 'is-shown' : ''
          }`}
        >
          <p className="t-stagger-line t-stagger-line--1 m-0 font-mono text-[10px] font-medium uppercase tracking-[0.4em] text-muted-foreground">
            Decentralized token fund · Solana
          </p>

          <div className="t-stagger-line t-stagger-line--2 relative">
            <h1 className="m-0 font-display text-[clamp(52px,12vw,164px)] font-bold uppercase leading-[0.9] tracking-[0.01em] text-foreground">
              <span className="block">Vault</span>
              <span className="type-engraved block">Operations</span>
            </h1>

            <LocalhostStamp />
          </div>

          <p className="t-stagger-line t-stagger-line--3 m-0 max-w-[46ch] font-display text-[clamp(17px,1.6vw,22px)] font-medium leading-[1.55] tracking-[0.01em] text-muted-foreground">
            Deposit once.{' '}
            <span className="text-foreground">Own the fund.</span>{' '}
            Exit on your terms.
          </p>

          <p className="motto-band t-stagger-line t-stagger-line--3 m-0 max-w-[38ch] font-display text-[clamp(12px,1.1vw,14px)] italic leading-[1.5] tracking-[0.01em]">
            <span className="motto-mark" aria-hidden>&#10022;</span>
            A share is not a promise to pay you later — it is a claim you already own.
            <span className="motto-mark" aria-hidden>&#10022;</span>
          </p>

          <div className="mt-2 flex w-full flex-col items-stretch justify-center gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
            <Link
              href={sectionPath('vaults')}
              className={`${btnPrimaryClass} min-h-11`}
            >
              Browse vaults
            </Link>
            <Link
              href={sectionPath('vault-ops')}
              className={`${btnSecondaryClass} min-h-11`}
            >
              Open create
            </Link>
          </div>
        </div>

        <div
          aria-hidden
          className="relative flex overflow-hidden border-t-[1.5px] border-border-strong bg-foreground py-2.5"
        >
          <div className="ticker-track flex w-max shrink-0 items-center">
            {tickerRun.map((item, i) => (
              <span
                key={`${item}-${i}`}
                className="flex items-center gap-6 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-background"
              >
                {item}
                <span className="text-background/40">&#10022;</span>
              </span>
            ))}
          </div>
        </div>

        <div
          className="relative flex flex-col items-center justify-between gap-2 border-t border-border px-6 py-3 font-mono text-[10px] font-bold tracking-[0.1em] text-seal sm:flex-row sm:text-[11px]"
          role="status"
        >
          <span className="tabular-nums">
            &#8470; CVLT-{vaultId} · {vaultShort}
          </span>
          <ClusterLiveLabel />
          <span className="tabular-nums">PROGRAM · {programShort}</span>
        </div>
      </div>

      <nav
        aria-label="Section index"
        className="grid grid-cols-2 gap-px border border-border-strong bg-border md:grid-cols-3 motion-safe:animate-[cert-fadeup_0.9s_ease_0.35s_both]"
      >
        {SECTION_IDS.map((id) => {
          const meta = SECTION_META[id];
          const accent = SECTION_STYLE[id].accent;
          return (
            <Link
              key={id}
              href={sectionPath(id)}
              className="group flex flex-col items-start gap-2 bg-background px-4 py-4 text-left transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--background))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent md:px-5 md:py-5"
            >
              <span
                className="font-mono text-[10px] font-bold tracking-[0.14em]"
                style={{ color: accent }}
              >
                &#8470; {meta.no}
              </span>
              <span className="font-display text-lg font-semibold uppercase leading-none tracking-[0.06em] text-foreground">
                {meta.title}
              </span>
              <span className="text-[12px] leading-[1.55] text-muted-foreground">
                {meta.description}
              </span>
              <span
                aria-hidden
                className="mt-auto pt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors group-hover:text-foreground"
              >
                Open &#8594;
              </span>
            </Link>
          );
        })}
      </nav>
    </section>
  );
}