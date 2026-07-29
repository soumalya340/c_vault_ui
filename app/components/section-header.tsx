'use client';

import type { Network } from '@/app/providers';
import { SECTION_STYLE, type SectionId } from './function-defs';

export const SECTION_META: Record<
  SectionId,
  { no: string; nav: string; title: string; description: string }
> = {
  view: {
    no: '01',
    nav: 'View',
    title: 'Read Operations',
    description:
      'Inspect vault state without signing — NAV, share supply, registry entries, and account data.',
  },
  vaults: {
    no: '02',
    nav: 'Vaults',
    title: 'Vault Registry',
    description:
      'Browse every vault in the series. Deposit USDC into a basket or redeem shares back out.',
  },
  'vault-ops': {
    no: '03',
    nav: 'Create',
    title: 'Create ETF',
    description:
      'Create ETF vaults, execute basket swaps, and run the operational instruction set.',
  },
  admin: {
    no: '04',
    nav: 'Admin',
    title: 'Admin Operations',
    description:
      'Program administration — token registry, fee configuration, and authority controls.',
  },
};

export function SectionHeader({
  id,
  network,
}: {
  id: SectionId;
  network: Network;
}) {
  const meta = SECTION_META[id];
  const accent = SECTION_STYLE[id].accent;

  return (
    <header className="relative border-b-[1.5px] border-border-strong pb-6 motion-safe:animate-[cert-fadeup_0.6s_ease_both]">
      <div className="flex items-baseline justify-between gap-3 font-mono text-[9px] uppercase tracking-[0.28em] text-muted-foreground">
        <span>
          Plate <span style={{ color: accent }}>&#8470; {meta.no}</span> · Series
          2026
        </span>
        <span className="hidden sm:inline">Solana · {network}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
        <h1 className="m-0 flex items-baseline gap-4 font-display text-[clamp(30px,4.5vw,54px)] font-bold uppercase leading-none tracking-[0.04em] text-foreground">
          <span
            aria-hidden
            className="font-mono text-[clamp(14px,1.6vw,20px)] font-bold tracking-[0.1em]"
            style={{ color: accent }}
          >
            {meta.no}
          </span>
          {meta.title}
        </h1>
        <p className="m-0 max-w-[52ch] pb-1 text-sm leading-[1.6] text-muted-foreground">
          {meta.description}
        </p>
      </div>

      <span
        aria-hidden
        className="absolute -bottom-[1.5px] left-0 h-[3px] w-20"
        style={{ background: accent }}
      />
    </header>
  );
}
