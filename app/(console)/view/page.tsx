'use client';

import { SectionView } from '@/app/components/section-view';
import { useConsoleNetwork } from '@/app/components/console-shell';

export default function ViewPage() {
  const { network } = useConsoleNetwork();
  return <SectionView section="view" network={network} />;
}