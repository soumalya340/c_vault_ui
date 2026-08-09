'use client';

const SEGMENTS = [
  { text: 'CVAULT', accent: false },
  { text: 'ON-CHAIN ETF OPERATIONS', accent: false },
  { text: 'MAINNET READY', accent: true },
] as const;

const REPEAT = 6;

export function VaultOpsTicker() {
  return (
    <div className="overflow-hidden border-b border-border bg-bg-elevated py-[9px]">
      <div className="ticker-track flex w-max whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-[#5E5E64]">
        {Array.from({ length: REPEAT }).map((_, i) => (
          <span key={i} className="inline-flex items-center gap-[26px] pr-[26px]">
            {SEGMENTS.map((seg, j) => (
              <span key={j} className="inline-flex items-center gap-[26px]">
                <span className={seg.accent ? 'text-accent' : undefined}>{seg.text}</span>
                <span className="text-[#3A3A3F]" aria-hidden>
                  ·
                </span>
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
