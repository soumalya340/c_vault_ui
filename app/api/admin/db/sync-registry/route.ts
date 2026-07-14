import { NextResponse } from 'next/server';
import { getDb, type DbNetwork } from '@/lib/db';

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
}

function toDbNetwork(v: string | null | undefined): DbNetwork {
  return v === 'localhost' ? 'localhost' : 'mainnet';
}

/**
 * Admin-only registry upsert used by DB refresh. Bypasses the duplicate-mint
 * guard on POST /api/asset-registry — sync is keyed by asset_id from chain.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      network?: string;
      row?: {
        asset_id: string;
        asset_name?: string;
        mint: string;
        pool_address: string;
        pyth_feed_id: string;
        decimals: number;
        route: 'ViaSol' | 'DirectUsdc';
        price_source_tag: number;
        price_dex_kind: number;
        price_pool_address: string;
        swap_kind: 'Whirlpool' | 'DammV2';
        token_program_tag: number;
        active?: boolean;
      };
    };

    if (!body.row?.asset_id || !body.row.mint) {
      return NextResponse.json({ error: 'row.asset_id and row.mint are required.' }, { status: 400 });
    }

    const network = toDbNetwork(body.network ?? null);
    await getDb(network).insertRegistryEntry(network, {
      asset_id: body.row.asset_id,
      asset_name: body.row.asset_name ?? '',
      network,
      mint: body.row.mint,
      pool_address: body.row.pool_address,
      pyth_feed_id: body.row.pyth_feed_id,
      decimals: body.row.decimals,
      route: body.row.route,
      price_source_tag: body.row.price_source_tag,
      price_dex_kind: body.row.price_dex_kind,
      price_pool_address: body.row.price_pool_address,
      swap_kind: body.row.swap_kind,
      token_program_tag: body.row.token_program_tag,
      active: body.row.active ?? true,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}