'use client';

import type { Network } from '@/app/providers';
import { panelClass, sectionLabelClass } from '../ui-classes';
import { DbVaultsTable } from './db-vaults-table';
import { DbRegistryTable } from './db-registry-table';
import { DbAssetPresetsTable } from './db-asset-presets-table';
import { DbVaultPresetsTable } from './db-vault-presets-table';
import { DbDangerZone } from './db-danger-zone';

function Panel({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${panelClass} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 border-b border-border-strong px-5 py-3.5 md:px-6">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
          {title}
        </span>
        {badge && (
          <span className="rounded-[2px] border border-border-strong px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {badge}
          </span>
        )}
      </div>
      <div className="px-3 py-3 md:px-4">{children}</div>
    </div>
  );
}

export function AdminDbSection({ network }: { network: Network }) {
  return (
    <section aria-label="DB management" className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <p className={sectionLabelClass}>
          Scoped to <span className="text-foreground">{network}</span>
        </p>
        <DbVaultsTable network={network} />
        <DbRegistryTable network={network} />
        <DbDangerZone key={network} network={network} />
      </div>

      <div className="flex flex-col gap-4">
        <p className={sectionLabelClass}>
          Reference data, seeded identically on every network — not vault or registry state
        </p>
        <Panel title="Asset presets (Pools.md)" badge="Seeded">
          <DbAssetPresetsTable key={network} network={network} />
        </Panel>
        <Panel title="Vault presets (Vault.md)" badge="Seeded">
          <DbVaultPresetsTable key={network} network={network} />
        </Panel>
      </div>
    </section>
  );
}
