'use client';

import { VaultOpsHero } from '@/app/components/vault-ops-hero';
import { VaultOpsTicker } from '@/app/components/vault-ops-ticker';
import { VaultOpsCreatePanel } from '@/app/components/vault-ops-create-panel';
import { VaultOpsToast } from '@/app/components/vault-ops-toast';
import { useConsoleNetwork } from '@/app/components/console-shell';

export default function CreatePage() {
  const { network } = useConsoleNetwork();

  return (
    <div className="mx-auto w-full max-w-[1360px] space-y-6">
      <VaultOpsTicker />
      <VaultOpsHero network={network} />
      <VaultOpsCreatePanel key={`create-${network}`} network={network} />
      <VaultOpsToast />
    </div>
  );
}
