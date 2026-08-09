'use client';

import { PortfolioPanel } from '@/app/components/portfolio-panel';
import { useConsoleNetwork } from '@/app/components/console-shell';

export default function PortfolioPage() {
  const { network } = useConsoleNetwork();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PortfolioPanel network={network} />
    </div>
  );
}
