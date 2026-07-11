import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Pre-approved asset catalog for the Create ETF token picker — read straight
 * from `PreApprovedTokenRegistryDevnet` (devnet-only; no network column,
 * no mainnet counterpart yet). Mirrors the on-chain `AssetInfo` shape so an
 * asset_id picked here maps 1:1 to the admin-listed `AssetInfo` PDA.
 */
export type AssetRegistryRow = {
  asset_id: string;
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

export async function GET() {
  try {
    const supabase = createServiceClient();
    // asset_id cast to text: PostgREST returns bigint as a JS number, which
    // loses precision above Number.MAX_SAFE_INTEGER.
    const { data, error } = await supabase
      .from("PreApprovedTokenRegistryDevnet")
      .select(
        "asset_id::text, mint, pool_address, pyth_feed_id, decimals, route, price_source_tag, price_dex_kind, price_pool_address, swap_kind, token_program_tag, active",
      )
      .order("asset_id", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ assets: (data ?? []) as AssetRegistryRow[] });
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
    const body = (await request.json()) as Partial<AssetRegistryRow>;

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

    const supabase = createServiceClient();

    const { data: existing, error: existingErr } = await supabase
      .from("PreApprovedTokenRegistryDevnet")
      .select("asset_id::text, mint")
      .eq("mint", body.mint)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) {
      return NextResponse.json(
        { error: `Mint already listed as asset #${existing.asset_id}.`, field: "mint" },
        { status: 409 },
      );
    }

    const row = {
      asset_id: body.asset_id,
      mint: body.mint,
      pool_address: body.pool_address,
      pyth_feed_id: body.pyth_feed_id,
      decimals: body.decimals,
      route: body.route,
      price_source_tag: body.price_source_tag,
      price_dex_kind: body.price_dex_kind,
      price_pool_address: body.price_pool_address,
      swap_kind: body.swap_kind,
      token_program_tag: body.token_program_tag,
      active: body.active ?? true,
    };

    const { error: insertErr } = await supabase
      .from("PreApprovedTokenRegistryDevnet")
      .insert(row);
    if (insertErr) throw insertErr;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
