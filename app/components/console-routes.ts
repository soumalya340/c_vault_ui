import type { SectionId } from './function-defs';

/** URL paths for main-console sections (admin is a separate gated route). */
export const SECTION_ROUTES: Record<Exclude<SectionId, 'admin'>, string> = {
  view: '/view',
  vaults: '/vaults-all',
  'vault-ops': '/create',
};

export const ADMIN_ROUTE = '/admin';
export const PORTFOLIO_ROUTE = '/portfolio';
export const HOME_ROUTE = '/';

/**
 * Per-vault detail page. Keyed by `vault_id` — the on-chain primary key — so
 * the URL stays unique and stable even if a vault's display name changes.
 */
export function vaultDetailPath(vaultId: number): string {
  return `${SECTION_ROUTES.vaults}/${vaultId}`;
}

export type ConsoleView = 'home' | SectionId;

export function sectionPath(id: Exclude<SectionId, 'admin'>): string {
  return SECTION_ROUTES[id];
}

export function consoleViewPath(view: ConsoleView): string {
  if (view === 'home') return HOME_ROUTE;
  if (view === 'admin') return ADMIN_ROUTE;
  return sectionPath(view);
}

export function pathnameToConsoleView(pathname: string): ConsoleView | null {
  if (pathname === HOME_ROUTE) return 'home';
  if (pathname === ADMIN_ROUTE) return 'admin';
  // Exact match first, then prefix — so nested pages (e.g. the per-vault
  // detail route /vaults-all/12) keep their parent section tab highlighted.
  for (const [id, path] of Object.entries(SECTION_ROUTES)) {
    if (pathname === path) return id as SectionId;
  }
  for (const [id, path] of Object.entries(SECTION_ROUTES)) {
    if (pathname.startsWith(`${path}/`)) return id as SectionId;
  }
  return null;
}