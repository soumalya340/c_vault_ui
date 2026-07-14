'use client';

import type { Network } from '@/app/providers';
import { SectionBlock } from '../section-block';
import { ADMIN_FUNCTIONS } from '../function-defs';
import { GlobalStateCard } from './global-state-card';

export function AdminOnChainSection({ network }: { network: Network }) {
  return (
    <section aria-label="On-chain calls" className="flex flex-col gap-4">
      <GlobalStateCard />
      <SectionBlock id="admin" label="Admin operations" functions={ADMIN_FUNCTIONS} network={network} />
    </section>
  );
}
