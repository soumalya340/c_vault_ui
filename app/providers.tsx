'use client';

import { Buffer as NodeBuffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !('Buffer' in globalThis)) {
  (globalThis as { Buffer?: typeof NodeBuffer }).Buffer = NodeBuffer;
}

import { useMemo, useState, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalContext } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { WalletModal } from './components/wallet-modal';

export type Network = 'devnet' | 'mainnet';

/** UI is devnet-only; mainnet types remain for solscan links and future enablement. */
export const ACTIVE_NETWORK: Network = 'devnet';

export function getRpcEndpoint(network: Network): string {
  if (network === 'mainnet') {
    return process.env.NEXT_PUBLIC_MAINNET_RPC ?? 'https://api.mainnet-beta.solana.com';
  }
  return process.env.NEXT_PUBLIC_DEVNET_RPC ?? 'https://api.devnet.solana.com';
}

export function Providers({
  children,
  endpoint,
}: {
  children: ReactNode;
  endpoint: string;
}) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );
  const [visible, setVisible] = useState(false);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalContext.Provider value={{ visible, setVisible }}>
          {children}
          <WalletModal />
        </WalletModalContext.Provider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
