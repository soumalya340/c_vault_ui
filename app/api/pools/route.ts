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
    const mint = params.get("mint");
    const counterMints = params.get("counterMints");
    const network = params.get("network") ?? "devnet";

    const poolSelect =
      "pool_address, mint_a, mint_b, symbol_a, symbol_b, decimals_a, decimals_b, tick_spacing, network";

    // All pools involving `mint` (either side) — used before a base mint is picked.
    if (mint && !counterMints && !mintA) {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("orca_pools")
        .select(poolSelect)
        .eq("network", network)
        .or(`mint_a.eq.${mint},mint_b.eq.${mint}`);

      if (error) throw error;

      return NextResponse.json({ pools: (data as PoolRow[] | null) ?? [] });
    }

    // List mode: every pool pairing `mint` with any of `counterMints`
    // (e.g. base mint and wSOL) — powers the pool picker dropdown.
    if (mint && counterMints) {
      const others = counterMints.split(",").map((m) => m.trim()).filter(Boolean);
      if (others.length === 0) {
        return NextResponse.json({ pools: [] });
      }

      const supabase = createServiceClient();
      const orClauses = others.flatMap((other) => [
        `and(mint_a.eq.${mint},mint_b.eq.${other})`,
        `and(mint_a.eq.${other},mint_b.eq.${mint})`,
      ]);
      const { data, error } = await supabase
        .from("orca_pools")
        .select(poolSelect)
        .eq("network", network)
        .or(orClauses.join(","));

      if (error) throw error;

      return NextResponse.json({ pools: (data as PoolRow[] | null) ?? [] });
    }

    // Single-pair lookup mode (exact pair, either mint order).
    if (!mintA || !mintB) {
      return NextResponse.json(
        { error: "mintA and mintB (or mint and counterMints) query params are required" },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("orca_pools")
      .select(poolSelect)
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
