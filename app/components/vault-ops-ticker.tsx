'use client';

const TICKER_TEXT = 'CVAULT · ON-CHAIN ETF OPERATIONS · MAINNET READY · ';
const REPEAT = 6;

export function VaultOpsTicker() {
  return (
    <div className="overflow-hidden border-y border-border bg-foreground/[0.03] py-2">
      <div className="ticker-track flex whitespace-nowrap font-mono text-[8.5px] uppercase tracking-[0.3em] text-muted-foreground">
        {Array.from({ length: REPEAT }).map((_, i) => (
          <span key={i} className="px-6">
            {TICKER_TEXT.split('·').map((part, j) => (
              <span key={j}>
                {part}
                {j < TICKER_TEXT.split('·').length - 1 && (
                  <span className="mx-1 text-seal">·</span>
                )}
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
