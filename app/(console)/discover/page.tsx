'use client';

import { VaultsPanel } from '@/app/components/vaults-panel';
import { useConsoleNetwork } from '@/app/components/console-shell';

export default function DiscoverPage() {
  const { network } = useConsoleNetwork();
  return <VaultsPanel network={network} />;
}
