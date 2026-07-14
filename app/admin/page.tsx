'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Providers,
  getRpcEndpoint,
  getStoredNetwork,
  setStoredNetwork,
  isLocalOrigin,
  type Network,
} from '@/app/providers';
import { WalletButton } from '@/app/components/wallet-button';
import { ADMIN_PUBKEY } from '@/lib/constants';
import { ClusterHealthProvider } from '@/app/components/cluster-status';
import { AdminStatusStrip } from '@/app/components/admin/admin-status-strip';
import { AdminWorkspace } from '@/app/components/admin/admin-workspace';

const MICROPRINT = 'CVAULT ADMIN · ON-CHAIN CALLS · DB MANAGEMENT · '.repeat(24);

function NetworkTabs({
  network,
  onChange,
}: {
  network: Network;
  onChange: (n: Network) => void;
}) {
  // Deployed hosts (Vercel) can never reach a local validator or the SQLite
  // file on the laptop — only offer localhost when the page itself is local.
  // Matches app/components/network-toggle.tsx.
  const options = isLocalOrigin()
    ? (['localhost', 'mainnet'] as const)
    : (['mainnet'] as const);

  return (
    <div className="flex items-center gap-1 rounded-[2px] border border-border-strong p-1" role="tablist" aria-label="Network">
      {options.map((n) => {
        const active = network === n;
        return (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(n)}
            className={`rounded-[2px] px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.16em] transition-colors ${
              active
                ? 'bg-accent text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function AdminHeader({
  network,
  onNetworkChange,
}: {
  network: Network;
  onNetworkChange: (n: Network) => void;
}) {
  return (
    <header className="sticky top-0 z-50 border-b-[1.5px] border-border-strong bg-background/95 backdrop-blur-sm">
      <div className="flex min-h-16 items-center gap-4 px-4 md:gap-6 md:px-8">
        <Link
          href="/"
          aria-label="Back to cVault"
          className="flex shrink-0 items-baseline gap-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="font-display text-xl font-bold tracking-[0.02em] text-foreground">
            cVault<span className="text-seal">&#8314;</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Admin
          </span>
        </Link>
        <Link
          href="/"
          className="hidden items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground sm:flex"
        >
          <span aria-hidden>&larr;</span> Back to app
        </Link>
        <NetworkTabs network={network} onChange={onNetworkChange} />
        <div className="ml-auto flex items-center gap-3 py-2">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

function AdminDashboard({
  network,
  onNetworkChange,
}: {
  network: Network;
  onNetworkChange: (n: Network) => void;
}) {
  return (
    <ClusterHealthProvider network={network}>
      <main className="flex min-h-screen flex-col bg-background text-foreground">
        <AdminHeader network={network} onNetworkChange={onNetworkChange} />
        <div className="flex flex-1 flex-col p-3 md:p-6">
          <div className="cert-frame relative flex flex-1 flex-col overflow-hidden bg-background px-4 py-6 md:px-12 md:py-9">
            <div className="microprint border-y border-border py-1" aria-hidden>
              {MICROPRINT}
            </div>
            <div className="mt-8 flex flex-1 flex-col gap-6 pb-8 md:mt-10">
              <AdminStatusStrip network={network} />
              <AdminWorkspace network={network} />
              <footer className="mt-auto">
                <div className="microprint border-y border-border py-1" aria-hidden>
                  {MICROPRINT}
                </div>
                <p className="pt-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  cVault admin · {network} · signer-gated
                </p>
              </footer>
            </div>
          </div>
        </div>
      </main>
    </ClusterHealthProvider>
  );
}

function AdminGate({ network, onNetworkChange }: { network: Network; onNetworkChange: (n: Network) => void }) {
  const { publicKey, connected } = useWallet();

  if (!connected || !publicKey) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Connect the admin wallet to continue
        </p>
        <WalletButton />
        <Link
          href="/"
          className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
        >
          &larr; Back to app
        </Link>
      </main>
    );
  }

  if (!publicKey.equals(ADMIN_PUBKEY)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <p className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-destructive">
          Unauthorized
        </p>
        <p className="max-w-md text-center font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Signer {publicKey.toBase58().slice(0, 8)}… is not the on-chain admin.
        </p>
        <WalletButton />
        <Link
          href="/"
          className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
        >
          &larr; Back to app
        </Link>
      </main>
    );
  }

  return <AdminDashboard network={network} onNetworkChange={onNetworkChange} />;
}

export default function AdminPage() {
  const [network, setNetwork] = useState<Network>('mainnet');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // getStoredNetwork() already rejects a persisted 'localhost' when the
    // page is not served from a local origin (Vercel / production).
    setNetwork(getStoredNetwork());
    setReady(true);
  }, []);

  const handleNetworkChange = (next: Network) => {
    // Hard-block localhost on deployed hosts even if a caller tries to set it.
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
      <AdminGate network={network} onNetworkChange={handleNetworkChange} />
    </Providers>
  );
}
