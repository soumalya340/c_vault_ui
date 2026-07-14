'use client';

import type { Network } from '@/app/providers';
import { NetworkToggle } from './network-toggle';
import { UnwrapWsolButton } from './unwrap-wsol-button';
import { WalletButton } from './wallet-button';
import { ClusterStatusBanner, ClusterStatusChip } from './cluster-status';
import { SECTION_STYLE, type SectionId } from './function-defs';
import { SECTION_META } from './section-header';

export type ActiveView = 'home' | SectionId;

// Admin lives at the gated /admin dashboard now, not as a main-console tab.
const SECTION_IDS: SectionId[] = ['view', 'vaults', 'vault-ops'];

function NavTabs({
  active,
  onNavigate,
  className,
}: {
  active: ActiveView;
  onNavigate: (view: ActiveView) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Sections" className={className}>
      {SECTION_IDS.map((id) => {
        const meta = SECTION_META[id];
        const accent = SECTION_STYLE[id].accent;
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onNavigate(id)}
            className={`relative flex min-h-12 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent lg:flex-none lg:px-4 lg:text-[11px] ${
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
            }`}
          >
            <span
              aria-hidden
              className="text-[9px]"
              style={{ color: accent }}
            >
              {meta.no}
            </span>
            {meta.nav}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-[2.5px]"
                style={{ background: accent }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function SiteNav({
  network,
  onNetworkChange,
  active,
  onNavigate,
}: {
  network: Network;
  onNetworkChange: (network: Network) => void;
  active: ActiveView;
  onNavigate: (view: ActiveView) => void;
}) {
  return (
    <header className="sticky top-0 z-50 border-b-[1.5px] border-border-strong bg-background/95 backdrop-blur-sm">
      <div className="flex min-h-14 items-center gap-3 px-4 md:gap-6 md:px-8">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          aria-label="cVault home"
          className="flex shrink-0 items-baseline gap-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="font-display text-xl font-bold tracking-[0.02em] text-foreground">
            cVault<span className="text-seal">&#8314;</span>
          </span>
          <span className="hidden font-mono text-[8px] uppercase tracking-[0.24em] text-muted-foreground xl:inline">
            Operations console
          </span>
        </button>

        <NavTabs
          active={active}
          onNavigate={onNavigate}
          className="hidden self-stretch divide-x divide-border border-x border-border lg:flex"
        />

        <div className="ml-auto flex shrink-0 items-center gap-2 py-2 md:gap-3">
          <ClusterStatusChip />
          <NetworkToggle network={network} onChange={onNetworkChange} />
          <div className="hidden sm:block">
            <UnwrapWsolButton network={network} />
          </div>
          <WalletButton />
        </div>
      </div>

      {/* Compact tab rail below the brand row on smaller screens */}
      <NavTabs
        active={active}
        onNavigate={onNavigate}
        className="flex divide-x divide-border border-t border-border lg:hidden"
      />

      <ClusterStatusBanner />
    </header>
  );
}
