'use client';

import { panelClass, sectionLabelClass } from './ui-classes';

export function VaultStatCard({
  label,
  value,
  loading = false,
  onRefresh,
  refreshing = false,
}: {
  label: string;
  value: string;
  loading?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className={`${panelClass} flex flex-col gap-2 px-5 py-4 md:px-6`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`${sectionLabelClass} uppercase`}>{label}</span>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={`Refresh ${label}`}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors duration-150 hover:text-accent disabled:opacity-40"
          >
            {refreshing ? '…' : '↻'}
          </button>
        )}
      </div>
      <span className="font-display text-2xl font-semibold tabular-nums tracking-[0.01em] text-foreground">
        {loading ? '—' : value}
      </span>
    </div>
  );
}
