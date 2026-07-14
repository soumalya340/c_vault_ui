import { NextResponse } from "next/server";
import { getDb, type DbNetwork } from "@/lib/db";
import { assetNameForMint } from "@/lib/presets/canonical-data";

/**
 * Pre-approved asset catalog for the Create ETF token picker, scoped by the
 * `network` column (`localhost` | `mainnet`). Mirrors the on-chain `AssetInfo`
 * shape so an asset_id picked here maps 1:1 to the admin-listed `AssetInfo`
 * PDA. Backed by SQLite (localhost, shared with c_vault_script) or Supabase
 * (mainnet) via lib/db.
 */
export type AssetRegistryRow = {
  asset_id: string;
  asset_name: string;
  mint: string;
  pool_address: string;
  pyth_feed_id: string;
  decimals: number;
  route: "ViaSol" | "DirectUsdc";
  price_source_tag: number;
  price_dex_kind: number;
  price_pool_address: string;
  swap_kind: "Whirlpool" | "DammV2";
  token_program_tag: number;
  active: boolean;
};

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
}

function toDbNetwork(v: string | null): DbNetwork {
  return v === "localhost" ? "localhost" : "mainnet";
}

export async function GET(request: Request) {
  try {
    const network = toDbNetwork(new URL(request.url).searchParams.get("network"));
    const rows = await getDb(network).listRegistry(network);
    const assets: AssetRegistryRow[] = rows.map((r) => ({
      asset_id: r.asset_id,
      asset_name: r.asset_name?.trim() || assetNameForMint(r.mint),
      mint: r.mint,
      pool_address: r.pool_address,
      pyth_feed_id: r.pyth_feed_id,
      decimals: r.decimals,
      route: r.route,
      price_source_tag: r.price_source_tag,
      price_dex_kind: r.price_dex_kind,
      price_pool_address: r.price_pool_address,
      swap_kind: r.swap_kind,
      token_program_tag: r.token_program_tag,
      active: r.active,
    }));
    return NextResponse.json({ assets });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * Insert a row right after `create_asset` lands on-chain. Rejects with 409
 * when `mint` is already listed — one AssetInfo per mint, so a duplicate
 * here would just shadow the earlier asset_id.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AssetRegistryRow> & {
      network?: string;
      asset_name?: string;
    };

    const required: (keyof AssetRegistryRow)[] = [
      "asset_id",
      "mint",
      "pool_address",
      "pyth_feed_id",
      "decimals",
      "route",
      "price_source_tag",
      "price_dex_kind",
      "price_pool_address",
      "swap_kind",
      "token_program_tag",
    ];
    const missing = required.filter((key) => body[key] === undefined || body[key] === null);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required field(s): ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    const network = toDbNetwork(body.network ?? null);
    const db = getDb(network);

    const existing = await db.findAssetByMint(network, body.mint!);
    if (existing) {
      return NextResponse.json(
        { error: `Mint already listed as asset #${existing.asset_id}.`, field: "mint" },
        { status: 409 },
      );
    }

    await db.insertRegistryEntry(network, {
      asset_id: String(body.asset_id),
      asset_name: body.asset_name ?? "",
      network,
      mint: body.mint!,
      pool_address: body.pool_address!,
      pyth_feed_id: body.pyth_feed_id!,
      decimals: body.decimals!,
      route: body.route!,
      price_source_tag: body.price_source_tag!,
      price_dex_kind: body.price_dex_kind!,
      price_pool_address: body.price_pool_address!,
      swap_kind: body.swap_kind!,
      token_program_tag: body.token_program_tag!,
      active: body.active ?? true,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * DB-only active flag toggle (does not touch on-chain AssetInfo). Used by the
 * admin dashboard's registry panel — see c_vault_script menus/db.js choice '6'.
 */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { network?: string; asset_id?: number; active?: boolean };
    if (body.asset_id === undefined || body.asset_id === null || typeof body.active !== "boolean") {
      return NextResponse.json({ error: "asset_id and active are required." }, { status: 400 });
    }
    const network = toDbNetwork(body.network ?? null);
    await getDb(network).setAssetActive(network, Number(body.asset_id), body.active);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
