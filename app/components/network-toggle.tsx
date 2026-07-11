'use client';

import type { Network } from '@/app/providers';

export function NetworkToggle({
  network,
  onChange,
}: {
  network: Network;
  onChange: (network: Network) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded-[2px] border border-border p-0.5"
      role="group"
      aria-label="Network"
    >
      {(['devnet', 'mainnet'] as const).map((n) => {
        const active = network === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={active}
            className={`px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] transition-colors ${
              active
                ? 'bg-accent text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
