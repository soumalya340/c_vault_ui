'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Providers,
  getRpcEndpoint,
  getStoredNetwork,
  setStoredNetwork,
  isLocalOrigin,
  type Network,
} from '@/app/providers';
import { SiteNav } from '@/app/components/site-nav';
import { ClusterHealthProvider } from '@/app/components/cluster-status';
import {
  ConsoleNetworkProvider,
  VaultBreadcrumbProvider,
} from '@/app/components/console-shell';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<Network>('mainnet');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setNetwork(getStoredNetwork());
    setReady(true);
  }, []);

  const handleNetworkChange = (next: Network) => {
    const resolved: Network =
      next === 'localhost' && !isLocalOrigin() ? 'mainnet' : next;
    setStoredNetwork(resolved);
    setNetwork(resolved);
  };

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-text-faint">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em]">
          loading…
        </span>
      </main>
    );
  }

  return (
    <Providers endpoint={getRpcEndpoint(network)} network={network} key={network}>
      <ConsoleNetworkProvider network={network} onNetworkChange={handleNetworkChange}>
        <VaultBreadcrumbProvider>
          <ClusterHealthProvider network={network}>
            <main className="flex min-h-screen flex-col bg-background text-foreground">
              <SiteNav />
              <div className="flex flex-1 flex-col">{children}</div>
            </main>
          </ClusterHealthProvider>
        </VaultBreadcrumbProvider>
      </ConsoleNetworkProvider>
    </Providers>
  );
}
