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
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="relative flex flex-1 flex-col px-5 py-6 md:px-14 md:py-8">
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

        <div className="mt-10 flex flex-1 flex-col gap-8 pb-10 md:mt-14 lg:gap-10">
          <header className="flex flex-col gap-5 lg:max-w-[52ch]">
            <div className="font-mono text-xs tracking-[0.22em] text-accent motion-safe:animate-[forge-fadeup_0.8s_ease_0.1s_both]">
              {'/// ON-CHAIN ETF OPS CONSOLE'}
            </div>
            <h1 className="m-0 text-[clamp(36px,5vw,72px)] font-semibold leading-[1.04] tracking-[-0.04em] motion-safe:animate-[forge-fadeup_0.9s_ease_0.2s_both]">
              run vault instructions
              <span className="text-accent">.</span>
            </h1>
            <p className="m-0 text-[clamp(15px,1.2vw,17px)] leading-[1.55] text-muted-foreground motion-safe:animate-[forge-fadeup_1s_ease_0.35s_both]">
              Deposit, redeem, read NAV, and admin the multi-asset vault — one
              instruction per control, zero mainnet until we flip the switch.
            </p>
          </header>

          <div
            className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground motion-safe:animate-[forge-fadeup_1s_ease_0.45s_both]"
            role="status"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-foreground/5 px-2.5 py-1">
              <span
                className="h-2 w-2 rounded-full bg-accent motion-safe:animate-[forge-blink_1.6s_ease_infinite]"
                aria-hidden
              />
              <span className="font-bold tracking-[0.08em] text-accent">devnet live</span>
            </span>
            <span>
              vault {DEFAULT_VAULT_ID}:{' '}
              <span className="font-bold tabular-nums text-foreground">{vaultShort}</span>
            </span>
            <span className="hidden sm:inline text-muted-foreground/80">
              program {C_VAULT_PROGRAM_ID.toBase58().slice(0, 8)}…
            </span>
          </div>

          <div className="motion-safe:animate-[forge-fadeup_1s_ease_0.55s_both]">
            <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />
          </div>

          <div className="space-y-6 motion-safe:animate-[forge-fadeup_1s_ease_0.65s_both]">
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

          <footer className="border-t border-border pt-6 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground motion-safe:animate-[forge-fadeup_1s_ease_0.8s_both]">
            cVault v1.1 · devnet · one instruction per control
          </footer>
        </div>
      </div>
    </main>
  );
}
