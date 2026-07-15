'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Network } from '@/app/providers';

const MICROPRINT = 'CVAULT · ON-CHAIN ETF OPERATIONS · MAINNET READY · '.repeat(24);

type ConsoleNetworkContextValue = {
  network: Network;
  onNetworkChange: (network: Network) => void;
};

const ConsoleNetworkContext = createContext<ConsoleNetworkContextValue | null>(null);

export function ConsoleNetworkProvider({
  network,
  onNetworkChange,
  children,
}: ConsoleNetworkContextValue & { children: ReactNode }) {
  return (
    <ConsoleNetworkContext.Provider value={{ network, onNetworkChange }}>
      {children}
    </ConsoleNetworkContext.Provider>
  );
}

export function useConsoleNetwork(): ConsoleNetworkContextValue {
  const ctx = useContext(ConsoleNetworkContext);
  if (!ctx) {
    throw new Error('useConsoleNetwork must be used within the console layout');
  }
  return ctx;
}

export function ConsoleMicroprint() {
  return (
    <div className="microprint border-y border-border py-1" aria-hidden>
      {MICROPRINT}
    </div>
  );
}

export function ConsoleFooter({ network }: { network: Network }) {
  return (
    <footer className="mt-auto">
      <ConsoleMicroprint />
      <p className="pt-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        cVault series 2026 · {network} · one instruction per control
      </p>
    </footer>
  );
}