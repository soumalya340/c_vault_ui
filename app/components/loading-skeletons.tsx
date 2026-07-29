import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Form control placeholder — matches h-11 inputs / selects. */
export function FieldSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn('h-11 w-full rounded-[2px]', className)}
      aria-hidden
    />
  );
}

/** Compact value under a label (admin status strip, metrics). */
export function StatValueSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn('mt-0.5 h-3 w-16 rounded-[2px]', className)}
      aria-hidden
    />
  );
}

/** Table / list rows — used by admin DB panels and generic lists. */
export function ListRowsSkeleton({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col divide-y divide-border', className)}
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 px-4 py-3">
          <Skeleton
            className={cn(
              'h-3.5 max-w-xs rounded-[2px]',
              i % 3 === 0 ? 'w-2/3' : i % 3 === 1 ? 'w-1/2' : 'w-3/5',
            )}
          />
          {i % 2 === 0 && (
            <Skeleton className="h-2.5 w-1/3 max-w-[140px] rounded-[2px]" />
          )}
        </div>
      ))}
    </div>
  );
}

/** Vault catalogue cards (Vaults panel). */
export function VaultListSkeleton({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col divide-y divide-border px-3 py-1 md:px-4',
        className,
      )}
      aria-busy="true"
      aria-label="Loading vaults"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 px-2 py-4 md:px-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-4">
                <Skeleton className="h-3.5 w-20 rounded-[2px]" />
                <Skeleton className="h-3.5 w-40 rounded-[2px]" />
              </div>
              <Skeleton className="h-2.5 w-56 max-w-full rounded-[2px]" />
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Skeleton className="h-3 w-16 rounded-[2px]" />
              <Skeleton className="h-3 w-16 rounded-[2px]" />
            </div>
          </div>
          <Skeleton className="h-2.5 w-24 rounded-[2px]" />
        </div>
      ))}
    </div>
  );
}

/** On-chain asset basket rows inside a vault. */
export function AssetRowsSkeleton({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn('divide-y divide-border', className)} aria-busy="true" aria-label="Loading assets">
      <div className="border-b border-border px-4 py-2.5">
        <Skeleton className="h-2.5 w-28 rounded-[2px]" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Skeleton className="h-3.5 w-24 rounded-[2px]" />
            <Skeleton className="h-3 w-10 rounded-[2px]" />
          </div>
          <Skeleton className="h-1 w-full rounded-full" />
          <Skeleton className="h-2.5 w-28 rounded-[2px]" />
        </div>
      ))}
    </div>
  );
}

/** Portfolio identity strip metrics (4-up grid). */
export function MetricStripSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 divide-x divide-border border-b border-border sm:grid-cols-4',
        className,
      )}
      aria-busy="true"
      aria-label="Loading portfolio"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 px-5 py-4 md:px-6">
          <Skeleton className="h-2.5 w-20 rounded-[2px]" />
          <Skeleton className="h-5 w-12 rounded-[2px]" />
        </div>
      ))}
    </div>
  );
}

/** Portfolio holdings / vault rows under the tab strip. */
export function PortfolioListSkeleton({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col divide-y divide-border', className)}
      aria-busy="true"
      aria-label="Loading holdings"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 px-5 py-4 md:px-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <Skeleton className="h-3.5 w-16 rounded-[2px]" />
              <Skeleton className="h-3.5 w-32 rounded-[2px]" />
            </div>
            <Skeleton className="h-3.5 w-20 rounded-[2px]" />
          </div>
          <Skeleton className="h-2.5 w-48 max-w-full rounded-[2px]" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20 rounded-[2px]" />
            <Skeleton className="h-8 w-28 rounded-[2px]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Ledger / view output panel while an on-chain read is in flight. */
export function OutputPanelSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[2px] border border-border-strong bg-foreground/[0.04]',
        className,
      )}
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="border-b border-border px-4 py-2">
        <Skeleton className="h-2.5 w-14 rounded-[2px]" />
      </div>
      <div className="space-y-2.5 px-4 py-3">
        <Skeleton className="h-3 w-full rounded-[2px]" />
        <Skeleton className="h-3 w-5/6 rounded-[2px]" />
        <Skeleton className="h-3 w-2/3 rounded-[2px]" />
        <Skeleton className="h-3 w-3/4 rounded-[2px]" />
      </div>
    </div>
  );
}
