'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Providers,
  DEFAULT_NETWORK,
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
  // Start on the default network so server and first client render agree —
  // reading localStorage during render would desync hydration. The stored
  // preference is applied in an effect below; because `Providers` is keyed by
  // network, a differing stored value remounts the tree with the right RPC.
  // Rendering the real UI immediately (instead of a blocking "loading…"
  // screen) lets first paint happen without waiting on hydration.
  const [network, setNetwork] = useState<Network>(DEFAULT_NETWORK);

  useEffect(() => {
    const stored = getStoredNetwork();
    if (stored !== network) setNetwork(stored);
    // Runs once on mount: the stored preference is read a single time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNetworkChange = (next: Network) => {
    const resolved: Network =
      next === 'localhost' && !isLocalOrigin() ? 'mainnet' : next;
    setStoredNetwork(resolved);
    setNetwork(resolved);
  };

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
