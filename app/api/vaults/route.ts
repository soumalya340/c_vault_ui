import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * `vaults` table (forge/supabase/migrations/0004_vaults.sql) — the single
 * source of truth for vaults shown in c_vault_ui. Rows are inserted by the
 * UI right after an on-chain create_etf succeeds.
 */
export type VaultAssetRow = {
  mint: string;
  pool_address: string;
  allocation_bps: number;
  decimals: number;
  route: "ViaSol" | "DirectUsdc";
  pyth_feed_id: string; // 64-char hex, no 0x prefix
};

export type VaultRow = {
  vault_address: string;
  vault_id: number;
  network: string;
  vault_authority: string;
  shares_mint: string;
  usdc_vault: string;
  base_mint: string;
  name: string;
  symbol: string;
  uri: string;
  fee_recipient: string;
  performance_fee_bps: number;
  fund_type: "dynamic" | "fixed";
  max_shares: string | null;
  usdc_sol_pool: string | null;
  assets: VaultAssetRow[];
  creator: string;
  tx_signature: string;
  /** Address Lookup Table created at vault-creation time — used to bundle
   *  deposit/redeem swap legs into single v0 transactions (Plan.md §6-7). */
  alt_address: string | null;
  created_at?: string;
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
    const network = new URL(request.url).searchParams.get("network") ?? "devnet";
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("vaults")
      .select("*")
      .eq("network", network)
      .order("vault_id", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ vaults: (data ?? []) as VaultRow[] });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<VaultRow>;

    const required: (keyof VaultRow)[] = [
      "vault_address",
      "vault_id",
      "vault_authority",
      "shares_mint",
      "usdc_vault",
      "base_mint",
      "name",
      "symbol",
      "uri",
      "fee_recipient",
      "performance_fee_bps",
      "fund_type",
      "assets",
      "creator",
      "tx_signature",
    ];
    const missing = required.filter((key) => body[key] === undefined || body[key] === null);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required field(s): ${missing.join(", ")}` },
        { status: 400 },
      );
    }
    if (body.fund_type !== "dynamic" && body.fund_type !== "fixed") {
      return NextResponse.json(
        { error: `fund_type must be "dynamic" or "fixed"` },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.assets) || body.assets.length === 0) {
      return NextResponse.json({ error: "assets must be a non-empty array" }, { status: 400 });
    }

    const row: VaultRow = {
      vault_address: body.vault_address!,
      vault_id: body.vault_id!,
      network: body.network ?? "devnet",
      vault_authority: body.vault_authority!,
      shares_mint: body.shares_mint!,
      usdc_vault: body.usdc_vault!,
      base_mint: body.base_mint!,
      name: body.name!,
      symbol: body.symbol!,
      uri: body.uri!,
      fee_recipient: body.fee_recipient!,
      performance_fee_bps: body.performance_fee_bps!,
      fund_type: body.fund_type,
      max_shares: body.max_shares ?? null,
      usdc_sol_pool: body.usdc_sol_pool ?? null,
      assets: body.assets,
      creator: body.creator!,
      tx_signature: body.tx_signature!,
      alt_address: body.alt_address ?? null,
    };

    const supabase = createServiceClient();
    // Upsert on the PK so retrying after a partial failure (tx landed,
    // insert raced/failed) repairs the row instead of raising duplicate-key.
    const { error } = await supabase
      .from("vaults")
      .upsert(row, { onConflict: "vault_address" });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
