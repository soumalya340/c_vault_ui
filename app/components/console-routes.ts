import type { SectionId } from './function-defs';

/** URL paths for main-console sections (admin is a separate gated route).
 *  View read-ops are embedded on vault detail pages — not a top-level route. */
export const SECTION_ROUTES: Record<Exclude<SectionId, 'admin' | 'view'>, string> = {
  vaults: '/discover',
  'vault-ops': '/create',
};

/** Legacy /view plate — redirects to Discover (read ops live per-vault). */
export const LEGACY_VIEW_ROUTE = '/view';

export const ADMIN_ROUTE = '/admin';
export const PORTFOLIO_ROUTE = '/portfolio';
export const HOME_ROUTE = '/';

/**
 * Per-vault detail page. Keyed by vault PDA (`vaults.vault_address`) so the
 * URL is a stable base58 pubkey rather than a sequential vault_id.
 */
export function vaultDetailPath(vaultAddress: string): string {
  return `${SECTION_ROUTES.vaults}/${vaultAddress}`;
}

export type ConsoleView = 'home' | SectionId;

export function sectionPath(id: Exclude<SectionId, 'admin' | 'view'>): string {
  return SECTION_ROUTES[id];
}

export function consoleViewPath(view: ConsoleView): string {
  if (view === 'home') return HOME_ROUTE;
  if (view === 'admin') return ADMIN_ROUTE;
  if (view === 'view') return SECTION_ROUTES.vaults;
  return sectionPath(view);
}

export function pathnameToConsoleView(pathname: string): ConsoleView | null {
  if (pathname === HOME_ROUTE) return 'home';
  if (pathname === ADMIN_ROUTE) return 'admin';
  // Exact match first, then prefix — so nested pages (e.g. the per-vault
  // detail route /discover/<pda>) keep their parent section tab highlighted.
  for (const [id, path] of Object.entries(SECTION_ROUTES)) {
    if (pathname === path) return id as SectionId;
  }
  for (const [id, path] of Object.entries(SECTION_ROUTES)) {
    if (pathname.startsWith(`${path}/`)) return id as SectionId;
  }
  return null;
}

/** Extract `/discover/<key>` segment (PDA or legacy numeric id). */
export function vaultKeyFromPathname(pathname: string): string | null {
  const base = SECTION_ROUTES.vaults;
  if (!pathname.startsWith(`${base}/`)) return null;
  const rest = pathname.slice(base.length + 1);
  const key = rest.split('/')[0]?.trim();
  return key || null;
}
