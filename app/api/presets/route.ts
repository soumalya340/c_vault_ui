import { NextResponse } from "next/server";
import {
  EXPECTED_ASSET_PRESET_COUNT,
  EXPECTED_VAULT_PRESET_COUNT,
} from "@/lib/presets/canonical";
import { getDb, type DbNetwork } from "@/lib/db";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toDbNetwork(v: string | null): DbNetwork {
  return v === "localhost" ? "localhost" : "mainnet";
}

// Presets (Pools.md / Vault.md) are seeded identically into both backends —
// content has no network dimension, but the row lives in whichever physical
// DB `network` selects (SQLite for localhost, Supabase for mainnet).
export async function GET(request: Request) {
  try {
    const network = toDbNetwork(new URL(request.url).searchParams.get("network"));
    const db = getDb(network);

    let assetPresets = await db.listAssetPresets();
    let vaultPresets = await db.listVaultPresets();

    if (
      assetPresets.length < EXPECTED_ASSET_PRESET_COUNT ||
      vaultPresets.length < EXPECTED_VAULT_PRESET_COUNT
    ) {
      await db.seedPresets();
      assetPresets = await db.listAssetPresets();
      vaultPresets = await db.listVaultPresets();
    }

    return NextResponse.json({ assetPresets, vaultPresets, backend: db.backend });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}