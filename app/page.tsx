'use client';

import { useState } from 'react';
import { Providers, getRpcEndpoint, ACTIVE_NETWORK } from '@/app/providers';
import { TabBar } from '@/app/components/tab-bar';
import { SectionBlock } from '@/app/components/section-block';
import { VaultsPanel } from '@/app/components/vaults-panel';
import { CreateEtfPanel } from '@/app/components/create-etf-panel';
import { NetworkStatus } from '@/app/components/network-toggle';
import { WalletButton } from '@/app/components/wallet-button';
import {
  VIEW_FUNCTIONS,
  VAULT_OPS_FUNCTIONS,
  ADMIN_FUNCTIONS,
  type SectionId,
} from '@/app/components/function-defs';
import {
  C_VAULT_PROGRAM_ID,
  DEFAULT_VAULT_ID,
  deriveVaultPdas,
} from '@/lib/cvault';

const MICROPRINT = 'CVAULT · ON-CHAIN ETF OPERATIONS · DEVNET SPECIMEN · '.repeat(24);

function GuillocheRosette({ className }: { className?: string }) {
  const petals = Array.from({ length: 18 }, (_, i) => i * 10);
  const inner = Array.from({ length: 12 }, (_, i) => i * 15 + 5);
  return (
    <svg
      viewBox="0 0 400 400"
      className={className}
      aria-hidden
      fill="none"
      stroke="currentColor"
    >
      <g className="guilloche">
        {petals.map((deg) => (
          <ellipse
            key={`p${deg}`}
            cx="200"
            cy="200"
            rx="192"
            ry="56"
            strokeWidth="0.6"
            transform={`rotate(${deg} 200 200)`}
          />
        ))}
        {inner.map((deg) => (
          <ellipse
            key={`i${deg}`}
            cx="200"
            cy="200"
            rx="118"
            ry="26"
            strokeWidth="0.5"
            transform={`rotate(${deg} 200 200)`}
          />
        ))}
        <circle cx="200" cy="200" r="196" strokeWidth="0.8" />
        <circle cx="200" cy="200" r="122" strokeWidth="0.5" />
        <circle cx="200" cy="200" r="58" strokeWidth="0.5" />
      </g>
    </svg>
  );
}

export default function Home() {
  return (
    <Providers endpoint={getRpcEndpoint(ACTIVE_NETWORK)}>
      <HomeInner />
    </Providers>
  );
}

function HomeInner() {
  const [activeTab, setActiveTab] = useState<SectionId>('view');

  const { vaultPda } = deriveVaultPdas(DEFAULT_VAULT_ID);
  const vaultShort = `${vaultPda.toBase58().slice(0, 8)}…${vaultPda.toBase58().slice(-8)}`;
  const programShort = `${C_VAULT_PROGRAM_ID.toBase58().slice(0, 8)}…${C_VAULT_PROGRAM_ID.toBase58().slice(-8)}`;

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 flex-col p-3 md:p-6">
        <div className="cert-frame relative flex flex-1 flex-col overflow-hidden bg-background px-4 py-5 md:px-12 md:py-8">
          <GuillocheRosette className="pointer-events-none absolute -right-32 -top-32 h-[420px] w-[420px] text-accent opacity-[0.11] md:-right-24 md:-top-28 md:h-[520px] md:w-[520px]" />

          <nav
            aria-label="Primary"
            className="relative flex items-center justify-between gap-4"
          >
            <div className="font-display text-2xl font-bold tracking-[0.02em]">
              cVault<span className="text-seal">⁺</span>
            </div>
            <div className="flex items-center gap-3 md:gap-4">
              <NetworkStatus />
              <WalletButton />
            </div>
          </nav>

          <div className="microprint mt-5 border-y border-border py-1" aria-hidden>
            {MICROPRINT}
          </div>

          <div className="relative mt-10 flex flex-1 flex-col gap-8 pb-8 md:mt-12 lg:gap-10">
            <header className="flex flex-col items-center gap-4 text-center">
              <div className="font-mono text-[9px] uppercase tracking-[0.34em] text-muted-foreground motion-safe:animate-[cert-fadeup_0.8s_ease_0.1s_both]">
                this console executes instructions against the c-vault program
              </div>
              <h1 className="m-0 font-display text-[clamp(40px,7vw,92px)] font-bold uppercase leading-[1.02] tracking-[0.06em] motion-safe:animate-[cert-fadeup_0.9s_ease_0.2s_both]">
                Vault Operations
              </h1>
              <p className="m-0 max-w-[52ch] text-[clamp(14px,1.2vw,16px)] leading-[1.6] text-muted-foreground motion-safe:animate-[cert-fadeup_1s_ease_0.35s_both]">
                Deposit, redeem, read NAV, and administer the multi-asset vault —
                one instruction per control, zero mainnet until we flip the switch.
              </p>

              <div
                className="mt-2 flex w-full flex-col items-center justify-between gap-2 font-mono text-[11px] font-bold tracking-[0.1em] text-seal sm:flex-row motion-safe:animate-[cert-fadeup_1s_ease_0.45s_both]"
                role="status"
              >
                <span className="tabular-nums">
                  &#8470; CVLT-{DEFAULT_VAULT_ID} · {vaultShort}
                </span>
                <span className="inline-flex items-center gap-1.5 font-normal tracking-[0.14em] text-accent">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-[cert-blink_1.6s_ease_infinite]"
                    aria-hidden
                  />
                  devnet live
                </span>
                <span className="tabular-nums">PROGRAM · {programShort}</span>
              </div>
            </header>

            <div className="motion-safe:animate-[cert-fadeup_1s_ease_0.55s_both]">
              <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />
            </div>

            <div className="space-y-6 motion-safe:animate-[cert-fadeup_1s_ease_0.65s_both]">
              {activeTab === 'view' && (
                <SectionBlock
                  id="view"
                  label="Read operations"
                  functions={VIEW_FUNCTIONS}
                  network={ACTIVE_NETWORK}
                />
              )}
              {activeTab === 'vaults' && <VaultsPanel network={ACTIVE_NETWORK} />}
              {activeTab === 'vault-ops' && (
                <div className="space-y-6">
                  <CreateEtfPanel network={ACTIVE_NETWORK} />
                  <SectionBlock
                    id="vault-ops"
                    label="Vault operations"
                    functions={VAULT_OPS_FUNCTIONS}
                    network={ACTIVE_NETWORK}
                  />
                </div>
              )}
              {activeTab === 'admin' && (
                <SectionBlock
                  id="admin"
                  label="Admin operations"
                  functions={ADMIN_FUNCTIONS}
                  network={ACTIVE_NETWORK}
                />
              )}
            </div>

            <footer className="mt-auto motion-safe:animate-[cert-fadeup_1s_ease_0.8s_both]">
              <div className="microprint border-y border-border py-1" aria-hidden>
                {MICROPRINT}
              </div>
              <p className="pt-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                cVault series 2026 · devnet specimen · one instruction per control
              </p>
            </footer>
          </div>
        </div>
      </div>
    </main>
  );
}
