/** One mint's price/decimals as returned by Jupiter Price API V3. */
export interface JupiterPrice {
  usdPrice: number;
  decimals: number;
}

type PricesResponse = Record<string, { usdPrice: number; decimals: number }>;

/**
 * Fetches USD prices for the given mints via the server-side proxy
 * (`app/api/prices/route.ts`) — never calls Jupiter directly from the
 * browser, since that would require exposing `JUP_API_KEY`.
 *
 * Jupiter silently omits any mint it can't price (untraded 7+ days, or fails
 * its reliability heuristics) rather than returning an error or `null` — see
 * docs/Jup/Doc1.md "Limitations". This function treats that omission as a
 * hard failure: it throws naming every mint that came back missing, so a
 * caller never mistakes "no price" for "$0".
 */
export async function fetchUsdPrices(mints: string[]): Promise<Map<string, JupiterPrice>> {
  if (mints.length === 0) return new Map();

  const unique = Array.from(new Set(mints));
  const res = await fetch(`/api/prices?ids=${unique.join(',')}`);
  const body = await res.json();
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new Error(`Price lookup failed: ${message}`);
  }

  const data = body as PricesResponse;
  const missing = unique.filter((mint) => !(mint in data));
  if (missing.length > 0) {
    throw new Error(`Missing Jupiter price for: ${missing.join(', ')}`);
  }

  const out = new Map<string, JupiterPrice>();
  for (const mint of unique) {
    out.set(mint, { usdPrice: data[mint].usdPrice, decimals: data[mint].decimals });
  }
  return out;
}
