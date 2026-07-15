'use client';

import { SectionView } from '@/app/components/section-view';
import { useConsoleNetwork } from '@/app/components/console-shell';

export default function VaultsOpsPage() {
  const { network } = useConsoleNetwork();
  return <SectionView section="vault-ops" network={network} />;
}