import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { getDb, type DbNetwork } from "@/lib/db";

/**
 * `vaults` table — single source of truth for vaults shown in c_vault_ui.
 * Backed by SQLite (localhost, shared with c_vault_script) or Supabase
 * (mainnet) via lib/db. Rows are written by the UI right after an on-chain
 * create_etf succeeds.
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
  /** Mirrors on-chain `Vault.genesis_done` — false until genesis_deposit succeeds. */
  genesis_deposit_status: boolean;
  created_at?: string;
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
    const rows = await getDb(network).listVaults(network);
    const vaults: VaultRow[] = rows.map((v) => ({
      vault_address: v.vault_address,
      vault_id: v.vault_id,
      network: v.network,
      vault_authority: v.vault_authority,
      shares_mint: v.shares_mint,
      usdc_vault: v.usdc_vault,
      name: v.name,
      symbol: v.symbol,
      uri: v.uri,
      fee_recipient: v.fee_recipient,
      fund_type: v.fund_type,
      max_shares: v.max_shares,
      creator: v.creator,
      tx_signature: v.tx_signature,
      alt_address: v.deposit_alt_address ?? v.alt_address,
      paused: v.paused,
      admin_locked: v.admin_locked,
      vault_manager: v.vault_manager,
      deposit_fee_bps: v.deposit_fee_bps,
      redeem_fee_bps: v.redeem_fee_bps,
      total_usdc_value: v.total_usdc_value,
      asset_ids: v.asset_ids,
      asset_allocation_bps: v.asset_allocation_bps,
      num_assets: v.num_assets,
      genesis_deposit_status: Boolean(v.genesis_deposit_status),
      created_at: v.created_at ?? undefined,
    }));
    return NextResponse.json({ vaults });
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

    const network = toDbNetwork(body.network ?? null);

    await getDb(network).upsertVault(network, {
      vault_address: body.vault_address!,
      vault_id: body.vault_id!,
      network,
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
      deposit_alt_address: body.alt_address ?? null,
      redeem_alt_address: null,
      paused: body.paused ?? 0,
      admin_locked: body.admin_locked ?? 0,
      vault_manager: body.vault_manager!,
      deposit_fee_bps: body.deposit_fee_bps!,
      redeem_fee_bps: body.redeem_fee_bps!,
      total_usdc_value: body.total_usdc_value ?? "0",
      asset_ids: body.asset_ids,
      asset_allocation_bps: body.asset_allocation_bps,
      num_assets: body.num_assets!,
      genesis_deposit_status: body.genesis_deposit_status ?? false,
      created_at: null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function isValidPubkeyOrNull(v: unknown): v is string | null {
  if (v === null || v === undefined) return true;
  if (typeof v !== "string") return false;
  try {
    // eslint-disable-next-line no-new
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}

/**
 * Patch existing vault fields:
 * - deposit/redeem ALT addresses (admin / auto-create paths)
 * - genesis_deposit_status (after genesis_deposit or on-chain reconcile)
 */
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      network?: string;
      vault_id?: number;
      deposit_alt_address?: string | null;
      redeem_alt_address?: string | null;
      genesis_deposit_status?: boolean;
    };
    if (body.vault_id === undefined || body.vault_id === null) {
      return NextResponse.json({ error: "vault_id is required." }, { status: 400 });
    }
    const network = toDbNetwork(body.network ?? null);
    const vaultId = Number(body.vault_id);
    const db = getDb(network);

    // Genesis flag only — prefer a dedicated write so ALT-only callers stay unchanged.
    if (
      typeof body.genesis_deposit_status === "boolean" &&
      body.deposit_alt_address === undefined &&
      body.redeem_alt_address === undefined
    ) {
      const updated = await db.updateVaultGenesisStatus(
        network,
        vaultId,
        body.genesis_deposit_status,
      );
      return NextResponse.json({ vault: updated });
    }

    if (!isValidPubkeyOrNull(body.deposit_alt_address) || !isValidPubkeyOrNull(body.redeem_alt_address)) {
      return NextResponse.json({ error: "ALT addresses must be valid base58 pubkeys or blank." }, { status: 400 });
    }

    let updated = await db.updateVaultAlts(network, vaultId, {
      deposit_alt_address: body.deposit_alt_address || null,
      redeem_alt_address: body.redeem_alt_address || null,
    });

    if (typeof body.genesis_deposit_status === "boolean") {
      updated = await db.updateVaultGenesisStatus(
        network,
        vaultId,
        body.genesis_deposit_status,
      );
    }

    return NextResponse.json({ vault: updated });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
