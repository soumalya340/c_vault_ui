'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Network } from '@/app/providers';

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

/** Breadcrumb label for vault detail: Discover / {name}. */
type VaultBreadcrumbContextValue = {
  vaultName: string | null;
  setVaultName: (name: string | null) => void;
};

const VaultBreadcrumbContext = createContext<VaultBreadcrumbContextValue | null>(
  null,
);

export function VaultBreadcrumbProvider({ children }: { children: ReactNode }) {
  const [vaultName, setVaultNameState] = useState<string | null>(null);
  const setVaultName = useCallback((name: string | null) => {
    setVaultNameState(name);
  }, []);
  const value = useMemo(
    () => ({ vaultName, setVaultName }),
    [vaultName, setVaultName],
  );
  return (
    <VaultBreadcrumbContext.Provider value={value}>
      {children}
    </VaultBreadcrumbContext.Provider>
  );
}

export function useVaultBreadcrumb(): VaultBreadcrumbContextValue {
  const ctx = useContext(VaultBreadcrumbContext);
  if (!ctx) {
    throw new Error('useVaultBreadcrumb must be used within VaultBreadcrumbProvider');
  }
  return ctx;
}

/** Compact program / vault / network footer bar from the landing mock. */
export function ConsoleFooterBar({
  programShort,
  vaultShort,
  network,
}: {
  programShort?: string;
  vaultShort?: string;
  network: Network;
}) {
  const label = network === 'localhost' ? 'LOCALHOST' : 'MAINNET';

  return (
    <footer className="mt-auto flex flex-col items-center justify-between gap-2 border-t border-border px-[22px] py-[15px] text-center font-mono text-[10.5px] tracking-[0.08em] text-text-ghost sm:flex-row sm:text-left">
      {programShort ? <span>PROGRAM {programShort}</span> : <span />}
      {vaultShort ? <span>VAULT {vaultShort}</span> : <span />}
      <span className="text-accent">{label}</span>
    </footer>
  );
}

/** @deprecated use ConsoleFooterBar — kept for any remaining imports */
export function ConsoleMicroprint() {
  return null;
}

/** @deprecated use ConsoleFooterBar */
export function ConsoleFooter({ network }: { network: Network }) {
  return <ConsoleFooterBar network={network} />;
}
