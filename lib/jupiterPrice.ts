/** One mint's price/decimals as returned by Jupiter Price API V3. */
export interface JupiterPrice {
  usdPrice: number;
  decimals: number;
}

type PricesResponse = Record<string, { usdPrice: number; decimals: number }>;

const JUPITER_PRICE_URL = 'https://api.jup.ag/price/v3';

/**
 * Server-side Jupiter fetch — used by the streaming NAV path (and any other
 * Node caller) where a relative `/api/prices` URL has no host. Browser callers
 * go through the proxy so `JUP_API_KEY` never ships to the client.
 */
async function fetchPricesServer(ids: string[]): Promise<PricesResponse> {
  const apiKey = process.env.JUP_API_KEY;
  if (!apiKey) {
    throw new Error('JUP_API_KEY is not configured on the server.');
  }
  const res = await fetch(`${JUPITER_PRICE_URL}?ids=${ids.join(',')}`, {
    headers: { 'x-api-key': apiKey },
    cache: 'no-store',
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `Price lookup failed: Jupiter Price API returned ${res.status}: ${JSON.stringify(body)}`,
    );
  }
  return body as PricesResponse;
}

/**
 * Fetches USD prices for the given mints via the server-side proxy
 * (`app/api/prices/route.ts`) — never calls Jupiter directly from the
 * browser, since that would require exposing `JUP_API_KEY`.
 *
 * On the server (e.g. `/api/vaults/stream`), calls Jupiter directly with the
 * env key — relative `/api/prices` fetch has no origin in Node.
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

  let data: PricesResponse;
  if (typeof window === 'undefined') {
    data = await fetchPricesServer(unique);
  } else {
    const res = await fetch(`/api/prices?ids=${unique.join(',')}`);
    const body = await res.json();
    if (!res.ok) {
      const message = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
      throw new Error(`Price lookup failed: ${message}`);
    }
    data = body as PricesResponse;
  }

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
