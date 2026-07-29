'use client';

import type { Network } from '@/lib/cvault';
import { solscanAccountLink } from '@/lib/solscanLink';
import { panelClass, sectionLabelClass } from './ui-classes';

export function VaultContractCard({
  vaultAddress,
  network,
}: {
  vaultAddress: string;
  network: Network;
}) {
  return (
    <div className={`${panelClass} overflow-hidden`}>
      <div className="border-b border-border-strong px-5 py-3 md:px-6">
        <span className={`${sectionLabelClass} uppercase`}>Contract</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-6">
        <span className="break-all font-mono text-xs text-foreground">{vaultAddress}</span>
        <a
          href={solscanAccountLink(vaultAddress, network)}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.12em] text-accent underline transition-colors hover:text-foreground"
        >
          View on Solscan ↗
        </a>
      </div>
    </div>
  );
}
