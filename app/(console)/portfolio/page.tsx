'use client';

import { PortfolioPanel } from '@/app/components/portfolio-panel';
import { useConsoleNetwork } from '@/app/components/console-shell';

export default function PortfolioPage() {
  const { network } = useConsoleNetwork();
  return <PortfolioPanel network={network} />;
}
