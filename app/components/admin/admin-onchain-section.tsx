'use client';

import type { Network } from '@/app/providers';
import { SectionBlock } from '../section-block';
import { ADMIN_FUNCTIONS, ADMIN_VIEW_FUNCTIONS } from '../function-defs';
import { GlobalStateCard } from './global-state-card';

/**
 * On-chain admin plate: live global readout, then read instruments (admin view),
 * then write instruments (admin operations). View uses the safe/engrave accent;
 * ops keep the seal/authority accent — same green/red split as the main console.
 */
export function AdminOnChainSection({ network }: { network: Network }) {
  return (
    <section aria-label="On-chain calls" className="flex flex-col gap-5">
      <GlobalStateCard />

      {/* Read plate — engraving green (mechanism / inspection) */}
      <SectionBlock
        id="view"
        label="Admin view"
        functions={ADMIN_VIEW_FUNCTIONS}
        network={network}
      />

      {/* Write plate — seal red (authority / state change) */}
      <SectionBlock
        id="admin"
        label="Admin operations"
        functions={ADMIN_FUNCTIONS}
        network={network}
      />
    </section>
  );
}
