import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Pyth feed-id registry backed by the Supabase `PythInfo` table. Unlike pools,
 * a missing pyth id CAN be supplied manually from the UI (Plan.md §5) — the
 * POST below records it so the next vault creation finds it automatically.
 */
export type PythRow = {
  token_name: string;
  pyth_id: string; // 64-char hex feed id, no 0x prefix
  mint_address: string;
};

const FEED_ID_RE = /^[0-9a-fA-F]{64}$/;

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
}

export async function GET(request: Request) {
  try {
    const mint = new URL(request.url).searchParams.get("mint");
    if (!mint) {
      return NextResponse.json({ error: "mint query param is required" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("PythInfo")
      .select("token_name, pyth_id, mint_address")
      .eq("mint_address", mint)
      .limit(1);

    if (error) throw error;

    return NextResponse.json({ pyth: (data?.[0] as PythRow | undefined) ?? null });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<PythRow>;
    const mint = body.mint_address?.trim();
    const pythId = body.pyth_id?.trim().replace(/^0x/, "");
    const tokenName = body.token_name?.trim() || mint;

    if (!mint || !pythId) {
      return NextResponse.json(
        { error: "mint_address and pyth_id are required" },
        { status: 400 },
      );
    }
    if (!FEED_ID_RE.test(pythId)) {
      return NextResponse.json(
        { error: "pyth_id must be 64 hex characters" },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();
    // One feed id per mint — a manual re-entry corrects the previous value.
    const { data: existing, error: selErr } = await supabase
      .from("PythInfo")
      .select("id")
      .eq("mint_address", mint)
      .limit(1);
    if (selErr) throw selErr;

    const row = { token_name: tokenName, pyth_id: pythId, mint_address: mint };
    const { error } = existing?.[0]
      ? await supabase.from("PythInfo").update(row).eq("mint_address", mint)
      : await supabase.from("PythInfo").insert(row);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
