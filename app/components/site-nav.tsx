'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletButton } from './wallet-button';
import { ClusterStatusBanner, ClusterStatusChip } from './cluster-status';
import {
  HOME_ROUTE,
  PORTFOLIO_ROUTE,
  SECTION_ROUTES,
  isManagePath,
  pathnameToConsoleView,
  sectionPath,
  vaultKeyFromPathname,
} from './console-routes';
import { useConsoleNetwork, useVaultBreadcrumb } from './console-shell';

const NAV_LINKS = [
  { href: SECTION_ROUTES.vaults, label: 'Discover', match: 'vaults' as const },
  { href: SECTION_ROUTES['vault-ops'], label: 'Create', match: 'vault-ops' as const },
  { href: PORTFOLIO_ROUTE, label: 'Portfolio', match: 'portfolio' as const },
  { href: '#', label: 'Docs', match: null, external: false },
] as const;

function isLinkActive(
  pathname: string,
  match: (typeof NAV_LINKS)[number]['match'],
): boolean {
  if (match === 'portfolio') {
    return pathname === PORTFOLIO_ROUTE || isManagePath(pathname);
  }
  if (match === 'vaults') {
    return (
      pathname === SECTION_ROUTES.vaults ||
      pathname.startsWith(`${SECTION_ROUTES.vaults}/`)
    );
  }
  if (match === 'vault-ops') {
    return (
      pathname === SECTION_ROUTES['vault-ops'] ||
      pathname.startsWith(`${SECTION_ROUTES['vault-ops']}/`)
    );
  }
  return false;
}

export function SiteNav() {
  const pathname = usePathname();
  const { network, onNetworkChange } = useConsoleNetwork();
  const { vaultName } = useVaultBreadcrumb();
  const isHome = pathname === HOME_ROUTE;
  const activeView = pathnameToConsoleView(pathname);
  const isVaultDetail =
    activeView === 'vaults' && pathname !== SECTION_ROUTES.vaults;
  const vaultKey = vaultKeyFromPathname(pathname);

  // Prefer loaded vault name; fall back to a short PDA while loading.
  const crumbLabel =
    vaultName?.trim() ||
    (vaultKey && vaultKey.length > 12
      ? `${vaultKey.slice(0, 4)}…${vaultKey.slice(-4)}`
      : vaultKey) ||
    '…';

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="flex h-[60px] items-center justify-between gap-4 px-[22px] md:px-7">
        <div className="flex min-w-0 items-center gap-[26px]">
          <Link
            href={HOME_ROUTE}
            aria-label="cVault home"
            aria-current={isHome ? 'page' : undefined}
            className="flex shrink-0 items-start gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="text-[19px] font-semibold tracking-[-0.03em] text-foreground">
              cVault
            </span>
            <span className="text-[10px] font-semibold text-accent">+</span>
          </Link>

          {isVaultDetail && vaultKey ? (
            <nav
              aria-label="Breadcrumb"
              className="hidden min-w-0 items-center gap-2.5 text-[13.5px] text-text-faint sm:flex"
            >
              <Link
                href={sectionPath('vaults')}
                className="shrink-0 transition-colors hover:text-foreground"
              >
                Discover
              </Link>
              <span className="shrink-0 text-[#3A3A3F]" aria-hidden>
                /
              </span>
              <span className="truncate text-foreground" title={vaultName ?? vaultKey}>
                {crumbLabel}
              </span>
            </nav>
          ) : (
            <nav
              aria-label="Sections"
              className="hidden items-center gap-[18px] text-[13.5px] font-medium md:flex"
            >
              {NAV_LINKS.map((link) => {
                const active = isLinkActive(pathname, link.match);
                if (link.href === '#') {
                  return (
                    <span
                      key={link.label}
                      className="cursor-default text-text-faint"
                    >
                      {link.label}
                    </span>
                  );
                }
                return (
                  <Link
                    key={link.label}
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    className={`transition-colors duration-150 ${
                      active
                        ? 'text-accent'
                        : 'text-text-faint hover:text-foreground'
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <ClusterStatusChip />
          <WalletButton network={network} onNetworkChange={onNetworkChange} />
        </div>
      </div>

      {/* Mobile nav */}
      {!isVaultDetail && (
        <nav
          aria-label="Sections mobile"
          className="flex gap-4 overflow-x-auto border-t border-border px-[22px] py-2.5 text-[13px] font-medium md:hidden"
        >
          {NAV_LINKS.map((link) => {
            if (link.href === '#') {
              return (
                <span key={link.label} className="shrink-0 text-text-faint">
                  {link.label}
                </span>
              );
            }
            const active = isLinkActive(pathname, link.match);
            return (
              <Link
                key={link.label}
                href={link.href}
                className={`shrink-0 ${active ? 'text-accent' : 'text-text-faint'}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      )}

      {isVaultDetail && vaultKey && (
        <nav
          aria-label="Breadcrumb mobile"
          className="flex min-w-0 items-center gap-2 overflow-hidden border-t border-border px-[22px] py-2.5 text-[13px] text-text-faint sm:hidden"
        >
          <Link href={sectionPath('vaults')} className="shrink-0 hover:text-foreground">
            Discover
          </Link>
          <span className="text-[#3A3A3F]" aria-hidden>
            /
          </span>
          <span className="truncate text-foreground">{crumbLabel}</span>
        </nav>
      )}

      <ClusterStatusBanner />
    </header>
  );
}
