'use client';

import { panelClass, btnGhostClass } from '../ui-classes';

export function DbRowSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col divide-y divide-border" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3">
          <div className="h-3.5 w-2/3 max-w-xs animate-pulse rounded-[2px] bg-foreground/[0.08]" />
        </div>
      ))}
    </div>
  );
}

export function DbPanel({
  title,
  onRefresh,
  refreshing,
  status,
  children,
}: {
  title: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  status?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className={`${panelClass} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 border-b border-border-strong px-5 py-3.5 md:px-6">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
          {title}
        </span>
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={refreshing} className={btnGhostClass}>
            {refreshing ? 'Syncing…' : 'Refresh'}
          </button>
        )}
      </div>
      {status && (
        <p className="border-b border-border/60 px-5 py-2 font-mono text-[10px] text-muted-foreground md:px-6">
          {status}
        </p>
      )}
      <div className="px-3 py-3 md:px-4">{children}</div>
    </div>
  );
}