import { NextResponse } from 'next/server';

const JUPITER_PRICE_URL = 'https://api.jup.ag/price/v3';
/** Jupiter's own limit — see docs/Jup/Doc1.md "Limitations". */
const MAX_IDS_PER_REQUEST = 50;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Server-only proxy for Jupiter Price API V3. `JUP_API_KEY` never reaches the
 * browser — the client (`lib/jupiterPrice.ts`) calls this route, not Jupiter
 * directly.
 */
export async function GET(request: Request) {
  const idsParam = new URL(request.url).searchParams.get('ids');
  if (!idsParam || idsParam.trim() === '') {
    return NextResponse.json({ error: 'ids query param is required.' }, { status: 400 });
  }

  const ids = idsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids query param is required.' }, { status: 400 });
  }
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Too many mints (${ids.length}) — Jupiter allows up to ${MAX_IDS_PER_REQUEST} per request.`,
      },
      { status: 400 },
    );
  }

  const apiKey = process.env.JUP_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'JUP_API_KEY is not configured on the server.' },
      { status: 500 },
    );
  }

  try {
    const upstream = await fetch(`${JUPITER_PRICE_URL}?ids=${ids.join(',')}`, {
      headers: { 'x-api-key': apiKey },
      // Prices move quickly; never serve a cached response for this route.
      cache: 'no-store',
    });
    const body = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Jupiter Price API returned ${upstream.status}: ${JSON.stringify(body)}` },
        { status: 502 },
      );
    }
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to reach Jupiter Price API: ${errorMessage(err)}` },
      { status: 502 },
    );
  }
}
