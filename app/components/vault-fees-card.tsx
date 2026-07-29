'use client';

import { panelClass, sectionLabelClass } from './ui-classes';

export function VaultFeesCard({
  depositFeeBps,
  redeemFeeBps,
}: {
  depositFeeBps: number;
  redeemFeeBps: number;
}) {
  return (
    <div className={`${panelClass} overflow-hidden`}>
      <div className="border-b border-border-strong px-5 py-3 md:px-6">
        <span className={`${sectionLabelClass} uppercase`}>Fees</span>
      </div>
      <dl className="flex flex-col gap-2.5 px-5 py-4 md:px-6">
        <div className="flex items-center justify-between">
          <dt className="font-mono text-xs text-muted-foreground">Entry fee</dt>
          <dd className="font-mono text-xs tabular-nums text-foreground">
            {(depositFeeBps / 100).toFixed(2)}%
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="font-mono text-xs text-muted-foreground">Exit fee</dt>
          <dd className="font-mono text-xs tabular-nums text-foreground">
            {(redeemFeeBps / 100).toFixed(2)}%
          </dd>
        </div>
      </dl>
    </div>
  );
}
