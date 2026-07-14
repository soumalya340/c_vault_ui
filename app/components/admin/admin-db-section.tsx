'use client';

import type { Network } from '@/app/providers';
import { panelClass } from '../ui-classes';
import { DbVaultsTable } from './db-vaults-table';
import { DbRegistryTable } from './db-registry-table';
import { DbDangerZone } from './db-danger-zone';

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${panelClass} overflow-hidden`}>
      <div className="border-b border-border-strong px-5 py-3.5 md:px-6">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
          {title}
        </span>
      </div>
      <div className="px-3 py-3 md:px-4">{children}</div>
    </div>
  );
}

export function AdminDbSection({ network }: { network: Network }) {
  return (
    <section aria-label="DB management" className="flex flex-col gap-4">
      <Panel title="Vaults">
        <DbVaultsTable network={network} />
      </Panel>
      <Panel title="Asset registry">
        <DbRegistryTable network={network} />
      </Panel>
      <DbDangerZone network={network} />
    </section>
  );
}
