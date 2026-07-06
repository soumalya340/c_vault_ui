'use client';

import { useEffect, useState } from 'react';
import { Providers, getRpcEndpoint, ACTIVE_NETWORK } from '@/app/providers';
import { TabBar } from '@/app/components/tab-bar';
import { SectionBlock } from '@/app/components/section-block';
import { FeedsPanel } from '@/app/components/feeds-panel';
import { NetworkStatus } from '@/app/components/network-toggle';
import { WalletButton } from '@/app/components/wallet-button';
import {
  VIEW_FUNCTIONS,
  DEPOSIT_FUNCTIONS,
  REDEEM_FUNCTIONS,
  ADMIN_FUNCTIONS,
  type SectionId,
} from '@/app/components/function-defs';
import {
  C_VAULT_PROGRAM_ID,
  DEFAULT_VAULT_ID,
  deriveVaultPdas,
} from '@/lib/cvault';
import { fetchFeeds, type PythFeedRow } from '@/lib/pythFeedsClient';

export default function Home() {
  return (
    <Providers endpoint={getRpcEndpoint(ACTIVE_NETWORK)}>
      <HomeInner />
    </Providers>
  );
}

function HomeInner() {
  const [activeTab, setActiveTab] = useState<SectionId>('view');
  const [savedFeeds, setSavedFeeds] = useState<PythFeedRow[]>([]);

  const loadFeeds = () => {
    fetchFeeds().then(setSavedFeeds).catch(() => setSavedFeeds([]));
  };

  useEffect(() => {
    loadFeeds();
  }, []);

  const { vaultPda } = deriveVaultPdas(DEFAULT_VAULT_ID);
  const vaultShort = `${vaultPda.toBase58().slice(0, 8)}…${vaultPda.toBase58().slice(-8)}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 px-4 py-4 md:px-6">
        <div className="mx-auto max-w-4xl">
          <nav
            aria-label="Primary"
            className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-foreground/5 px-4.5 py-2.5 shadow-sm backdrop-blur-sm"
          >
            <div className="flex items-center gap-3">
              <div className="text-xl font-bold tracking-[-0.03em]">
                cVault<span className="text-accent">⁺</span>
              </div>
              <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em] text-neutral-900">
                devnet
              </span>
            </div>
            <div className="flex items-center gap-2">
              <NetworkStatus />
              <WalletButton />
            </div>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 md:px-6">
        <div className="font-mono text-xs text-muted-foreground motion-safe:animate-[forge-fadeup_0.5s_ease_both]">
          <div className="mb-3 font-mono text-[11px] tracking-[0.18em] text-accent">
            {'/// ON-CHAIN ETF OPS CONSOLE'}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1">
              <span className="h-2 w-2 rounded-full bg-accent motion-safe:animate-[forge-blink_1.6s_ease_infinite]" />
              <span className="text-accent">devnet live</span>
            </span>
            <span>
              Vault {DEFAULT_VAULT_ID}:{' '}
              <span className="font-bold text-foreground">{vaultShort}</span>
            </span>
            <span className="hidden sm:inline">
              Program: {C_VAULT_PROGRAM_ID.toBase58().slice(0, 8)}…
            </span>
          </div>
        </div>

        <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />

        <div className="space-y-6">
          {activeTab === 'view' && (
            <SectionBlock
              id="view"
              label="Read operations"
              functions={VIEW_FUNCTIONS}
              network={ACTIVE_NETWORK}
              savedFeeds={savedFeeds}
            />
          )}
          {activeTab === 'deposit' && (
            <SectionBlock
              id="deposit"
              label="Deposit flow"
              functions={DEPOSIT_FUNCTIONS}
              network={ACTIVE_NETWORK}
              savedFeeds={savedFeeds}
            />
          )}
          {activeTab === 'redeem' && (
            <SectionBlock
              id="redeem"
              label="Redeem flow"
              functions={REDEEM_FUNCTIONS}
              network={ACTIVE_NETWORK}
              savedFeeds={savedFeeds}
            />
          )}
          {activeTab === 'feeds' && (
            <FeedsPanel savedFeeds={savedFeeds} onChange={loadFeeds} />
          )}
          {activeTab === 'admin' && (
            <SectionBlock
              id="admin"
              label="Admin operations"
              functions={ADMIN_FUNCTIONS}
              network={ACTIVE_NETWORK}
              savedFeeds={savedFeeds}
            />
          )}
        </div>

        <footer className="border-t border-border pt-6 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          cVault v1.1 · devnet · one instruction per control
        </footer>
      </main>
    </div>
  );
}
