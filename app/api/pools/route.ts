import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Whirlpool lookup backed by the Supabase `orca_pools` table. Pools are only
 * ever created by the pool-deployment tooling — the UI reads them, it never
 * writes them, and there is deliberately no way to enter a pool address by
 * hand (Plan.md §4).
 */
export type PoolRow = {
  pool_address: string;
  mint_a: string;
  mint_b: string;
  symbol_a: string;
  symbol_b: string;
  decimals_a: number;
  decimals_b: number;
  tick_spacing: number;
  network: string;
};

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const mintA = params.get("mintA");
    const mintB = params.get("mintB");
    const network = params.get("network") ?? "devnet";

    if (!mintA || !mintB) {
      return NextResponse.json(
        { error: "mintA and mintB query params are required" },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();
    // A pool for (X, Y) may be stored in either mint order.
    const { data, error } = await supabase
      .from("orca_pools")
      .select(
        "pool_address, mint_a, mint_b, symbol_a, symbol_b, decimals_a, decimals_b, tick_spacing, network",
      )
      .eq("network", network)
      .or(
        `and(mint_a.eq.${mintA},mint_b.eq.${mintB}),and(mint_a.eq.${mintB},mint_b.eq.${mintA})`,
      )
      .limit(1);

    if (error) throw error;

    return NextResponse.json({ pool: (data?.[0] as PoolRow | undefined) ?? null });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
