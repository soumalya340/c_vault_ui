'use client';

import type { Network } from '@/app/providers';
import { btnPrimaryClass, btnSecondaryClass } from '@/app/components/ui-classes';
import { SECTION_STYLE, type SectionId } from './function-defs';
import { SECTION_META } from './section-header';

const TICKER_ITEMS = [
  'DEP · Deposit',
  'RDM · Redeem',
  'NAV · Read NAV',
  'OPS · Vault Ops',
  'USDC · Quote mint',
  'ORCA · Whirlpool',
  'DAMM · V2 pools',
  'PYTH · Oracle',
] as const;

const SECTION_IDS: SectionId[] = ['view', 'vaults', 'vault-ops', 'admin'];

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
  onNavigate,
}: {
  network: Network;
  vaultId: number;
  vaultShort: string;
  programShort: string;
  onNavigate: (section: SectionId) => void;
}) {
  const isDevnet = network === 'devnet';
  const tickerRun = [...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <section className="flex flex-col gap-6" aria-label="cVault overview">
      {/* Master plate */}
      <div className="relative isolate overflow-hidden border-[1.5px] border-border-strong bg-background motion-safe:animate-[cert-fadeup_0.8s_ease_0.1s_both]">
        <GuillocheRosette className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 text-accent opacity-[0.16] sm:h-[720px] sm:w-[720px] md:h-[880px] md:w-[880px]" />

        <SerialRail side="left" text={`Series 2026 · № CVLT-${vaultId}`} />
        <SerialRail side="right" text={`Solana · ${network} · c-vault`} />

        <div className="relative flex flex-col items-center gap-6 px-6 py-14 text-center sm:py-16 md:py-20 lg:px-16">
          <p className="m-0 font-mono text-[9px] uppercase tracking-[0.34em] text-muted-foreground">
            On-chain multi-asset ETF instrument
          </p>

          <div className="relative">
            <h1 className="m-0 font-display text-[clamp(52px,12vw,164px)] font-bold uppercase leading-[0.92] tracking-[0.02em] text-foreground">
              <span className="block">Vault</span>
              <span className="type-engraved block">Operations</span>
            </h1>

            {isDevnet && (
              <div
                className="stamp absolute -right-2 -top-4 font-mono text-[10px] sm:-right-8 sm:top-0 motion-safe:animate-[cert-fadeup_0.8s_ease_0.5s_both]"
                role="status"
                aria-label="Devnet specimen network"
              >
                Specimen · Devnet
              </div>
            )}
          </div>

          <p className="m-0 max-w-[46ch] text-[clamp(14px,1.2vw,17px)] leading-[1.65] text-muted-foreground">
            Deposit, redeem, read NAV, and administer multi-asset vaults — one
            instruction per control. Quote mint is mainnet USDC; pools may be
            Whirlpool or DAMM v2.
          </p>

          <div className="mt-1 flex w-full flex-col items-stretch justify-center gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={() => onNavigate('vaults')}
              className={`${btnPrimaryClass} min-h-11`}
            >
              Browse vaults
            </button>
            <button
              type="button"
              onClick={() => onNavigate('vault-ops')}
              className={`${btnSecondaryClass} min-h-11`}
            >
              Open vault ops
            </button>
          </div>
        </div>

        {/* Instrument ticker band */}
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

        {/* Serial register */}
        <div
          className="relative flex flex-col items-center justify-between gap-2 border-t border-border px-6 py-3 font-mono text-[10px] font-bold tracking-[0.1em] text-seal sm:flex-row sm:text-[11px]"
          role="status"
        >
          <span className="tabular-nums">
            &#8470; CVLT-{vaultId} · {vaultShort}
          </span>
          <span className="inline-flex items-center gap-1.5 font-normal tracking-[0.14em] text-accent">
            <span
              className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-[cert-blink_1.6s_ease_infinite]"
              aria-hidden
            />
            {network} live
          </span>
          <span className="tabular-nums">PROGRAM · {programShort}</span>
        </div>
      </div>

      {/* Plate index — one cell per section */}
      <nav
        aria-label="Section index"
        className="grid grid-cols-2 gap-px border border-border-strong bg-border md:grid-cols-4 motion-safe:animate-[cert-fadeup_0.9s_ease_0.35s_both]"
      >
        {SECTION_IDS.map((id) => {
          const meta = SECTION_META[id];
          const accent = SECTION_STYLE[id].accent;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
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
            </button>
          );
        })}
      </nav>
    </section>
  );
}
