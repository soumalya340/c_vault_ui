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
  ConsoleFooter,
  ConsoleMicroprint,
  ConsoleNetworkProvider,
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
      <main className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em]">loading…</span>
      </main>
    );
  }

  return (
    <Providers endpoint={getRpcEndpoint(network)} network={network} key={network}>
      <ConsoleNetworkProvider network={network} onNetworkChange={handleNetworkChange}>
        <ClusterHealthProvider network={network}>
          <main className="flex min-h-screen flex-col bg-background text-foreground">
            <SiteNav />

            <div className="flex flex-1 flex-col p-3 md:p-6">
              <div className="cert-frame relative flex flex-1 flex-col overflow-hidden bg-background px-4 py-6 md:px-12 md:py-9">
                <ConsoleMicroprint />

                <div className="mt-8 flex flex-1 flex-col gap-8 pb-8 md:mt-10">
                  {children}
                  <ConsoleFooter network={network} />
                </div>
              </div>
            </div>
          </main>
        </ClusterHealthProvider>
      </ConsoleNetworkProvider>
    </Providers>
  );
}