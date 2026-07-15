'use client';

import type { Network } from '@/app/providers';
import { SectionBlock } from '@/app/components/section-block';
import { SectionHeader } from '@/app/components/section-header';
import { VaultsPanel } from '@/app/components/vaults-panel';
import { CreateEtfPanel } from '@/app/components/create-etf-panel';
import {
  VIEW_FUNCTIONS,
  VAULT_OPS_FUNCTIONS,
  type SectionId,
} from '@/app/components/function-defs';

export function SectionView({
  section,
  network,
}: {
  section: SectionId;
  network: Network;
}) {
  return (
    <div className="flex flex-col gap-8">
      <SectionHeader id={section} network={network} />

      {section === 'view' && (
        <SectionBlock
          id="view"
          label="Read operations"
          functions={VIEW_FUNCTIONS}
          network={network}
        />
      )}
      {section === 'vaults' && <VaultsPanel network={network} />}
      {section === 'vault-ops' && (
        <div className="space-y-6">
          <CreateEtfPanel network={network} />
          <SectionBlock
            id="vault-ops"
            label="Vault operations"
            functions={VAULT_OPS_FUNCTIONS}
            network={network}
          />
        </div>
      )}
    </div>
  );
}