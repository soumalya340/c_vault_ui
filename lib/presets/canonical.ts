import "server-only";

import { ASSET_PRESETS, VAULT_PRESETS } from "./canonical-data";

export interface CanonicalAssetPreset {
  key: string;
  aliases: readonly string[];
  asset_name: string;
  mint: string;
  pool_address: string;
  pyth_feed_id: string;
  decimals: number;
  route: "ViaSol" | "DirectUsdc";
  price_source_tag: number;
  price_dex_kind: number;
  swap_kind: "Whirlpool" | "DammV2";
  token_program_tag: number;
}

export interface VaultPresetAsset {
  assetId: number;
  allocationBps: number;
  role: string;
}

export interface CanonicalVaultPreset {
  vault: number;
  name: string;
  symbol: string;
  theme: string;
  assets: readonly VaultPresetAsset[];
}

export const CANONICAL_ASSET_PRESETS = ASSET_PRESETS as readonly CanonicalAssetPreset[];
export const CANONICAL_VAULT_PRESETS = VAULT_PRESETS as readonly CanonicalVaultPreset[];

export const EXPECTED_ASSET_PRESET_COUNT = CANONICAL_ASSET_PRESETS.length;
export const EXPECTED_VAULT_PRESET_COUNT = CANONICAL_VAULT_PRESETS.length;