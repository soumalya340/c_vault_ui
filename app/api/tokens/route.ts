import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Asset catalog for the Create ETF "Add Asset" picker — read straight from
 * the forge `token_registry` table (single source of truth; nothing is
 * hardcoded in c_vault_ui).
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
