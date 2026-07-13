import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * `vaults` table — single source of truth for vaults shown in c_vault_ui.
 * Schema matches live Supabase (see docs/Supabase_Info.md). Rows are written
 * by the UI right after an on-chain create_etf succeeds.
 *
 * Note: base_mint / full asset basket JSON are not stored here. Quote mint is
 * always network USDC; asset details are loaded on-chain via fetchVaultCtx.
 */
export type VaultRow = {
  vault_address: string;
  vault_id: number;
  network: string;
  vault_authority: string;
  shares_mint: string;
  usdc_vault: string;
  name: string;
  symbol: string;
  uri: string;
  fee_recipient: string;
  fund_type: "dynamic" | "fixed";
  max_shares: string | null;
  creator: string;
  tx_signature: string;
  /** Address Lookup Table created at vault-creation time. */
  alt_address: string | null;
  paused: number;
  admin_locked: number;
  vault_manager: string;
  deposit_fee_bps: number;
  redeem_fee_bps: number;
  total_usdc_value: string;
  /** Global asset ids in basket order (length = num_assets). */
  asset_ids: number[];
  /** Target weights in bps, indexed with asset_ids (sum = 10_000). */
  asset_allocation_bps: number[];
  num_assets: number;
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
      "name",
      "symbol",
      "uri",
      "fee_recipient",
      "fund_type",
      "creator",
      "tx_signature",
      "vault_manager",
      "deposit_fee_bps",
      "redeem_fee_bps",
      "asset_ids",
      "asset_allocation_bps",
      "num_assets",
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
    if (!Array.isArray(body.asset_ids) || body.asset_ids.length === 0) {
      return NextResponse.json(
        { error: "asset_ids must be a non-empty array" },
        { status: 400 },
      );
    }
    if (
      !Array.isArray(body.asset_allocation_bps) ||
      body.asset_allocation_bps.length !== body.asset_ids.length
    ) {
      return NextResponse.json(
        { error: "asset_allocation_bps must match asset_ids length" },
        { status: 400 },
      );
    }
    if (body.num_assets !== body.asset_ids.length) {
      return NextResponse.json(
        { error: "num_assets must equal asset_ids.length" },
        { status: 400 },
      );
    }

    const row: VaultRow = {
      vault_address: body.vault_address!,
      vault_id: body.vault_id!,
      network: body.network ?? "devnet",
      vault_authority: body.vault_authority!,
      shares_mint: body.shares_mint!,
      usdc_vault: body.usdc_vault!,
      name: body.name!,
      symbol: body.symbol!,
      uri: body.uri!,
      fee_recipient: body.fee_recipient!,
      fund_type: body.fund_type,
      max_shares: body.max_shares ?? null,
      creator: body.creator!,
      tx_signature: body.tx_signature!,
      alt_address: body.alt_address ?? null,
      paused: body.paused ?? 0,
      admin_locked: body.admin_locked ?? 0,
      vault_manager: body.vault_manager!,
      deposit_fee_bps: body.deposit_fee_bps!,
      redeem_fee_bps: body.redeem_fee_bps!,
      total_usdc_value: body.total_usdc_value ?? "0",
      asset_ids: body.asset_ids,
      asset_allocation_bps: body.asset_allocation_bps,
      num_assets: body.num_assets!,
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
