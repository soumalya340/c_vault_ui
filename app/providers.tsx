'use client';

import { Buffer as NodeBuffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !('Buffer' in globalThis)) {
  (globalThis as { Buffer?: typeof NodeBuffer }).Buffer = NodeBuffer;
}

import { useMemo, useState, type ReactNode } from 'react';
import {
  WalletNotReadyError,
  type Adapter,
  type WalletError,
} from '@solana/wallet-adapter-base';
import { WalletProvider, ConnectionContext } from '@solana/wallet-adapter-react';
import { WalletModalContext } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { createPlatformConnection } from '@/lib/connection';
import { WalletModal } from './components/wallet-modal';

/**
 * True when the user intentionally cancelled a wallet prompt (connect / sign /
 * send). These are expected UX paths, not application failures.
 */
function isUserWalletDismissal(error: {
  name?: string;
  message?: string;
  error?: unknown;
}): boolean {
  if (
    error.name === 'WalletWindowClosedError' ||
    error.name === 'WalletDisconnectedError'
  ) {
    return true;
  }

  const nested =
    error.error instanceof Error
      ? error.error.message
      : typeof error.error === 'string'
        ? error.error
        : error.error != null
          ? String(error.error)
          : '';
  const text = `${error.name ?? ''} ${error.message ?? ''} ${nested}`;
  return /user rejected|rejected the request|approval denied|denied by user|request (was )?rejected|cancelled by user|canceled by user|user closed|window closed|user denied/i.test(
    text,
  );
}

/**
 * Stable onError identity — wallet-adapter stores this in a ref; a new function
 * each render is unnecessary. User dismissals stay quiet; real failures log.
 */
function handleWalletAdapterError(error: WalletError, adapter?: Adapter): void {
  if (isUserWalletDismissal(error)) {
    return;
  }

  if (error instanceof WalletNotReadyError && typeof window !== 'undefined' && adapter) {
    window.open(adapter.url, '_blank', 'noreferrer');
    return;
  }

  console.error('[wallet]', error.name, error.message, adapter?.name);
}

export type Network = 'localhost' | 'mainnet';

const NETWORK_STORAGE_KEY = 'cvault-network';

/** Default to mainnet — program quote mint is mainnet USDC. */
export const DEFAULT_NETWORK: Network = 'mainnet';

/** True when the page itself is served from a local dev origin. */
export function isLocalOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function getStoredNetwork(): Network {
  if (typeof window === 'undefined') return DEFAULT_NETWORK;
  try {
    const saved = window.localStorage.getItem(NETWORK_STORAGE_KEY);
    // Only localhost | mainnet. Legacy values (e.g. 'devnet') fall through.
    // A persisted 'localhost' preference is only honored when the page is
    // served from a local origin — a deployed site can never reach a local
    // validator, and a stale 'localhost' value silently routes mainnet
    // transactions to 127.0.0.1:8899 ("Program is not deployed").
    if (saved === 'mainnet') return saved;
    if (saved === 'localhost') {
      if (isLocalOrigin()) return saved;
      window.localStorage.setItem(NETWORK_STORAGE_KEY, DEFAULT_NETWORK);
      return DEFAULT_NETWORK;
    }
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

/** Public Solana mainnet RPC — used only when `NEXT_PUBLIC_HELIUS_RPC` is unset. */
export const MAINNET_PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';

/**
 * RPC endpoint for the selected network.
 *
 * - mainnet: `NEXT_PUBLIC_HELIUS_RPC`, falling back to {@link MAINNET_PUBLIC_RPC}.
 * - localhost: local validator (`http://127.0.0.1:8899` by default).
 */
export function getRpcEndpoint(network: Network): string {
  if (network === 'mainnet') {
    const helius = process.env.NEXT_PUBLIC_HELIUS_RPC;
    const endpoint = helius ?? MAINNET_PUBLIC_RPC;
    console.log(
      '[rpc]',
      helius ? 'NEXT_PUBLIC_HELIUS_RPC' : 'MAINNET_PUBLIC_RPC',
      endpoint,
    );
    return endpoint;
  }
  const endpoint =
    process.env.NEXT_PUBLIC_LOCALHOST_RPC ?? 'http://127.0.0.1:8899';
  console.log('[rpc]', 'localhost', endpoint);
  return endpoint;
}

export function Providers({
  children,
  endpoint,
}: {
  children: ReactNode;
  endpoint: string;
  /** @deprecated Network is only used by callers for layout; connection uses endpoint. */
  network?: Network;
}) {
  // Explicit adapters so the modal always lists Phantom/Solflare. WalletProvider
  // still merges Wallet Standard wallets via useStandardWalletAdapters.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );
  const [visible, setVisible] = useState(false);

  const connection = useMemo(
    () => createPlatformConnection(endpoint, 'confirmed'),
    [endpoint],
  );

  return (
    <ConnectionContext.Provider value={{ connection }}>
      <WalletProvider
        wallets={wallets}
        autoConnect
        onError={handleWalletAdapterError}
      >
        <WalletModalContext.Provider value={{ visible, setVisible }}>
          {children}
          <WalletModal />
        </WalletModalContext.Provider>
      </WalletProvider>
    </ConnectionContext.Provider>
  );
}
