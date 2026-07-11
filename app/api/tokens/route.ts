import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Asset catalog for the Create ETF "Add Asset" picker — read straight from
 * the forge `token_registry` table (single source of truth; nothing is
 * hardcoded in c_vault_ui). New tokens used at create-time are POSTed here.
 */
export type TokenRow = {
  token_index: string;
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  uri: string;
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
    // token_index cast to text: PostgREST returns bigint as a JS number,
    // which loses precision above Number.MAX_SAFE_INTEGER.
    const { data, error } = await supabase
      .from("token_registry")
      .select("token_index::text, mint, symbol, name, decimals, uri")
      .order("token_index", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ tokens: (data ?? []) as TokenRow[] });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/**
 * Insert a newly used mint into token_registry so future vaults can pick it.
 * Columns: token_index, pda, mint, decimals, daily_cap, name, symbol, uri, created_at.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mint?: string;
      symbol?: string;
      name?: string;
      decimals?: number;
      uri?: string;
      pda?: string;
      daily_cap?: string;
    };

    const mint = body.mint?.trim();
    const symbol = body.symbol?.trim();
    const name = body.name?.trim();
    const decimals = body.decimals;

    if (!mint || !symbol || !name || decimals == null || !Number.isFinite(decimals)) {
      return NextResponse.json(
        { error: "mint, symbol, name, and decimals are required" },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();

    // Upsert by mint: if the token already exists, return it.
    const { data: existing, error: existingErr } = await supabase
      .from("token_registry")
      .select("token_index::text, mint, symbol, name, decimals, uri")
      .eq("mint", mint)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) {
      return NextResponse.json({ token: existing as TokenRow, created: false });
    }

    const { data: maxRow, error: maxErr } = await supabase
      .from("token_registry")
      .select("token_index")
      .order("token_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxErr) throw maxErr;

    const nextIndex =
      maxRow && maxRow.token_index != null
        ? Number(maxRow.token_index) + 1
        : 0;

    const row = {
      token_index: nextIndex,
      pda: body.pda?.trim() || mint,
      mint,
      decimals: Math.trunc(decimals),
      daily_cap: body.daily_cap?.trim() || "0",
      name,
      symbol,
      uri: body.uri?.trim() || "",
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("token_registry")
      .insert(row)
      .select("token_index::text, mint, symbol, name, decimals, uri")
      .single();
    if (insertErr) throw insertErr;

    return NextResponse.json({ token: inserted as TokenRow, created: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
