'use client';

import { useEffect, useState } from 'react';
import {
  Providers,
  getRpcEndpoint,
  getStoredNetwork,
  setStoredNetwork,
  type Network,
} from '@/app/providers';
import { SiteNav, type ActiveView } from '@/app/components/site-nav';
import { SectionBlock } from '@/app/components/section-block';
import { SectionHeader } from '@/app/components/section-header';
import { VaultsPanel } from '@/app/components/vaults-panel';
import { CreateEtfPanel } from '@/app/components/create-etf-panel';
import { HeroSection } from '@/app/components/hero-section';
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

const MICROPRINT = 'CVAULT · ON-CHAIN ETF OPERATIONS · MAINNET READY · '.repeat(24);

export default function Home() {
  const [network, setNetwork] = useState<Network>('mainnet');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setNetwork(getStoredNetwork());
    setReady(true);
  }, []);

  const handleNetworkChange = (next: Network) => {
    setStoredNetwork(next);
    setNetwork(next);
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
      <HomeInner network={network} onNetworkChange={handleNetworkChange} />
    </Providers>
  );
}

function SectionView({
  section,
  network,
}: {
  section: SectionId;
  network: Network;
}) {
  return (
    <div className="flex flex-col gap-8">
      <SectionHeader id={section} network={network} />

      {section === 'view' && (
        <SectionBlock
          id="view"
          label="Read operations"
          functions={VIEW_FUNCTIONS}
          network={network}
        />
      )}
      {section === 'vaults' && <VaultsPanel network={network} />}
      {section === 'vault-ops' && (
        <div className="space-y-6">
          <CreateEtfPanel network={network} />
          <SectionBlock
            id="vault-ops"
            label="Vault operations"
            functions={VAULT_OPS_FUNCTIONS}
            network={network}
          />
        </div>
      )}
      {section === 'admin' && (
        <SectionBlock
          id="admin"
          label="Admin operations"
          functions={ADMIN_FUNCTIONS}
          network={network}
        />
      )}
    </div>
  );
}

function HomeInner({
  network,
  onNetworkChange,
}: {
  network: Network;
  onNetworkChange: (network: Network) => void;
}) {
  const [view, setView] = useState<ActiveView>('home');

  const { vaultPda } = deriveVaultPdas(DEFAULT_VAULT_ID, network);
  const vaultShort = `${vaultPda.toBase58().slice(0, 8)}…${vaultPda.toBase58().slice(-8)}`;
  const programShort = `${C_VAULT_PROGRAM_ID.toBase58().slice(0, 8)}…${C_VAULT_PROGRAM_ID.toBase58().slice(-8)}`;

  const navigate = (next: ActiveView) => {
    setView(next);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteNav
        network={network}
        onNetworkChange={onNetworkChange}
        active={view}
        onNavigate={navigate}
      />

      <div className="flex flex-1 flex-col p-3 md:p-6">
        <div className="cert-frame relative flex flex-1 flex-col overflow-hidden bg-background px-4 py-6 md:px-12 md:py-9">
          <div className="microprint border-y border-border py-1" aria-hidden>
            {MICROPRINT}
          </div>

          <div className="mt-8 flex flex-1 flex-col gap-8 pb-8 md:mt-10">
            {view === 'home' ? (
              <HeroSection
                network={network}
                vaultId={DEFAULT_VAULT_ID}
                vaultShort={vaultShort}
                programShort={programShort}
                onNavigate={navigate}
              />
            ) : (
              <SectionView key={view} section={view} network={network} />
            )}

            <footer className="mt-auto">
              <div className="microprint border-y border-border py-1" aria-hidden>
                {MICROPRINT}
              </div>
              <p className="pt-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                cVault series 2026 · {network} · one instruction per control
              </p>
            </footer>
          </div>
        </div>
      </div>
    </main>
  );
}
