import type { ReactNode } from 'react';
import { VaultSourceTag } from './vault-source-tag';

export function VaultStatCard({
  label,
  value,
  sub,
  subLive,
  source,
  tone,
  pulse,
  trailing,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Marks `sub` as a live-status line — prefixes it with the accent dot. */
  subLive?: boolean;
  source?: 'rpc' | 'mock' | 'db';
  tone?: 'up' | 'dn';
  pulse?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={`border-border px-4 py-3.5 transition-colors duration-300 first:border-l-0 md:border-l ${
        pulse ? 'bg-foreground/[0.06]' : ''
      }`}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-2">
          {trailing}
          {source ? <VaultSourceTag kind={source} /> : null}
        </div>
      </div>
      <div
        className={`font-mono text-[22px] font-medium leading-none tracking-[-0.02em] tabular-nums ${
          tone === 'up'
            ? 'text-accent'
            : tone === 'dn'
              ? 'text-seal'
              : 'text-foreground'
        }`}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
          {subLive ? (
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
            />
          ) : null}
          <span>{sub}</span>
        </div>
      ) : null}
    </div>
  );
}
