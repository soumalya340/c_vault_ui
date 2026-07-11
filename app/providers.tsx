'use client';

import { Buffer as NodeBuffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !('Buffer' in globalThis)) {
  (globalThis as { Buffer?: typeof NodeBuffer }).Buffer = NodeBuffer;
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { WalletProvider, useWallet, ConnectionContext } from '@solana/wallet-adapter-react';
import { WalletModalContext } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { ADMIN_PUBKEY } from '@/lib/constants';
import { createFailoverConnection } from '@/lib/connection';
import { WalletModal } from './components/wallet-modal';

export type Network = 'devnet' | 'mainnet';

const NETWORK_STORAGE_KEY = 'cvault-network';

/** Default to mainnet — program quote mint is mainnet USDC. */
export const DEFAULT_NETWORK: Network = 'mainnet';

export function getStoredNetwork(): Network {
  if (typeof window === 'undefined') return DEFAULT_NETWORK;
  try {
    const saved = window.localStorage.getItem(NETWORK_STORAGE_KEY);
    if (saved === 'mainnet' || saved === 'devnet') return saved;
  } catch {
    // ignore storage failures
  }
  return DEFAULT_NETWORK;
}

export function setStoredNetwork(network: Network): void {
  try {
    window.localStorage.setItem(NETWORK_STORAGE_KEY, network);
  } catch {
    // ignore storage failures
  }
}

export function getRpcEndpoint(network: Network): string {
  if (network === 'mainnet') {
    return process.env.NEXT_PUBLIC_MAINNET_RPC ?? 'https://api.mainnet-beta.solana.com';
  }
  return process.env.NEXT_PUBLIC_DEVNET_RPC ?? 'https://api.devnet.solana.com';
}

/**
 * Arms/disarms the public-RPC-retry-then-Helius-failover behavior based on
 * whether the connected wallet is ADMIN_PUBKEY. Every other wallet always
 * uses the public endpoint, no retries, no fallback.
 */
function AdminFailoverArmer({ connection }: { connection: ReturnType<typeof createFailoverConnection> }) {
  const { publicKey } = useWallet();

  useEffect(() => {
    const isAdmin = publicKey?.equals(ADMIN_PUBKEY) ?? false;
    (connection as unknown as { setFailoverAdminMode?: (on: boolean) => void }).setFailoverAdminMode?.(
      isAdmin,
    );
  }, [connection, publicKey]);

  return null;
}

export function Providers({
  children,
  endpoint,
  network,
}: {
  children: ReactNode;
  endpoint: string;
  network: Network;
}) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );
  const [visible, setVisible] = useState(false);

  const connection = useMemo(
    () => createFailoverConnection(endpoint, network, 'confirmed'),
    [endpoint, network],
  );

  return (
    <ConnectionContext.Provider value={{ connection }}>
      <WalletProvider wallets={wallets} autoConnect>
        <AdminFailoverArmer connection={connection} />
        <WalletModalContext.Provider value={{ visible, setVisible }}>
          {children}
          <WalletModal />
        </WalletModalContext.Provider>
      </WalletProvider>
    </ConnectionContext.Provider>
  );
}
