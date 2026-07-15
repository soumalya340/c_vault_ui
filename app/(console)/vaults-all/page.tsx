'use client';

import { SectionView } from '@/app/components/section-view';
import { useConsoleNetwork } from '@/app/components/console-shell';

export default function VaultsAllPage() {
  const { network } = useConsoleNetwork();
  return <SectionView section="vaults" network={network} />;
}