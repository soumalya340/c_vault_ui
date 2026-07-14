'use client';

import { isLocalOrigin, type Network } from '@/app/providers';

export function NetworkToggle({
  network,
  onChange,
}: {
  network: Network;
  onChange: (network: Network) => void;
}) {
  // A deployed site can never reach a local validator — only offer the
  // localhost cluster when the page itself is served from a local origin.
  const options = isLocalOrigin()
    ? (['localhost', 'mainnet'] as const)
    : (['mainnet'] as const);
  return (
    <div
      className="flex items-center gap-1 rounded-[2px] border border-border p-0.5"
      role="group"
      aria-label="Network"
    >
      {options.map((n) => {
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
