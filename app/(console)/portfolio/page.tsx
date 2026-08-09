'use client';

import { PortfolioPanel } from '@/app/components/portfolio-panel';
import { useConsoleNetwork } from '@/app/components/console-shell';

export default function PortfolioPage() {
  const { network } = useConsoleNetwork();
  return (
    <div className="mx-auto w-full max-w-[1360px] px-4 py-6 md:px-8 md:py-8">
      <PortfolioPanel network={network} />
    </div>
  );
}
