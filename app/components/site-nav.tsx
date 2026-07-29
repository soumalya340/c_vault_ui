'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletButton } from './wallet-button';
import { ClusterStatusBanner, ClusterStatusChip } from './cluster-status';
import { SECTION_STYLE, type SectionId } from './function-defs';
import { SECTION_META } from './section-header';
import {
  HOME_ROUTE,
  PORTFOLIO_ROUTE,
  pathnameToConsoleView,
  sectionPath,
} from './console-routes';
import { useConsoleNetwork } from './console-shell';

// Admin lives at the gated /admin dashboard — wallet menu "Dashboard" only, not a tab.
// View read-ops live on each vault detail page (/discover/{id}), not a top-level tab.
const NAV_SECTION_IDS = ['vaults', 'vault-ops'] as const satisfies readonly Exclude<
  SectionId,
  'admin' | 'view'
>[];

function NavTabs({ className }: { className?: string }) {
  const pathname = usePathname();
  const active = pathnameToConsoleView(pathname) ?? 'home';

  return (
    <nav aria-label="Sections" className={className}>
      {NAV_SECTION_IDS.map((id) => {
        const meta = SECTION_META[id];
        const accent = SECTION_STYLE[id].accent;
        const isActive = active === id;

        return (
          <Link
            key={id}
            href={sectionPath(id)}
            aria-current={isActive ? 'page' : undefined}
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
          </Link>
        );
      })}
    </nav>
  );
}

function BackToApp() {
  return (
    <Link
      href={HOME_ROUTE}
      className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
    >
      <span aria-hidden>&larr;</span> Back to app
    </Link>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const { network, onNetworkChange } = useConsoleNetwork();
  const isHome = pathname === HOME_ROUTE;
  const isPortfolio = pathname === PORTFOLIO_ROUTE;

  return (
    <header className="sticky top-0 z-50 border-b-[1.5px] border-border-strong bg-background/95 backdrop-blur-sm">
      <div className="flex min-h-14 items-center gap-3 px-4 md:gap-6 md:px-8">
        <Link
          href={HOME_ROUTE}
          aria-label="cVault home"
          aria-current={isHome ? 'page' : undefined}
          className="flex shrink-0 items-baseline gap-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="font-display text-xl font-bold tracking-[0.02em] text-foreground">
            cVault<span className="text-seal">&#8314;</span>
          </span>
          <span className="hidden font-mono text-[8px] uppercase tracking-[0.24em] text-muted-foreground xl:inline">
            {isPortfolio ? 'Portfolio' : 'Operations console'}
          </span>
        </Link>

        {isPortfolio ? (
          <BackToApp />
        ) : (
          <NavTabs className="hidden self-stretch divide-x divide-border border-x border-border lg:flex" />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2 py-2 md:gap-3">
          <ClusterStatusChip />
          <WalletButton network={network} onNetworkChange={onNetworkChange} />
        </div>
      </div>

      {!isPortfolio && (
        <NavTabs className="flex divide-x divide-border border-t border-border lg:hidden" />
      )}

      <ClusterStatusBanner />
    </header>
  );
}