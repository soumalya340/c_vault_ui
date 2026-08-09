'use client';

const CHIPS = [
  '3 instruments',
  'one instruction per control',
  'admin-approved registry',
];

export function VaultOpsHero() {
  return (
    <header className="relative overflow-hidden border-b border-border px-[22px] pb-[34px] pt-9">
      {/* Soft lime wash — matches new_ui Create plate */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(46% 120% at 8% 0%, rgba(200,255,61,0.09), transparent 70%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '44px 100%',
          maskImage: 'linear-gradient(#000, transparent 90%)',
          WebkitMaskImage: 'linear-gradient(#000, transparent 90%)',
        }}
      />
      <div
        aria-hidden
        className="hero-scan-line pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(200,255,61,0.5), transparent)',
        }}
      />

      <div className="relative grid min-w-0 items-end gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] lg:gap-12">
        <div className="min-w-0">
          <h1 className="m-0 text-[clamp(48px,8vw,76px)] font-semibold leading-[0.9] tracking-[-0.05em] text-foreground">
            Create <span className="text-accent">ETF</span>
          </h1>
          <div className="mt-[26px] flex flex-wrap items-center gap-2.5 sm:gap-[11px]">
            <span
              aria-hidden
              className="font-mono text-[13px] font-medium tracking-[0.1em] text-accent"
            >
              Plate 02
            </span>
            {CHIPS.map((label) => (
              <span
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] px-[13px] py-[7px] font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
              >
                <span className="h-[5px] w-[5px] shrink-0 bg-accent" />
                {label}
              </span>
            ))}
          </div>
        </div>

        <p className="max-w-[42ch] border-l border-white/[0.14] pl-[18px] text-[15px] leading-[1.6] text-muted-foreground lg:justify-self-end">
          Create ETF vaults, execute basket swaps, and run the operational instruction set —{' '}
          <span className="text-foreground">
            every control below maps to exactly one on-chain instruction.
          </span>
        </p>
      </div>
    </header>
  );
}
