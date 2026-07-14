import "server-only";
import {
  CANONICAL_ASSET_PRESETS,
  CANONICAL_VAULT_PRESETS,
  type CanonicalAssetPreset,
  type CanonicalVaultPreset,
} from "./canonical";

export interface AssetPresetRow {
  preset_key: string;
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
  aliases: string[];
}

export interface VaultPresetRow {
  vault_num: number;
  name: string;
  symbol: string;
  theme: string;
  fund_type: "dynamic" | "fixed";
  deposit_fee_bps: number;
  redeem_fee_bps: number;
  assets: CanonicalVaultPreset["assets"];
}

export function assetPresetToRow(p: CanonicalAssetPreset): AssetPresetRow {
  return {
    preset_key: p.key,
    asset_name: p.asset_name,
    mint: p.mint,
    pool_address: p.pool_address,
    pyth_feed_id: p.pyth_feed_id,
    decimals: p.decimals,
    route: p.route,
    price_source_tag: p.price_source_tag,
    price_dex_kind: p.price_dex_kind,
    swap_kind: p.swap_kind,
    token_program_tag: p.token_program_tag,
    aliases: [...p.aliases],
  };
}

export function vaultPresetToRow(p: CanonicalVaultPreset): VaultPresetRow {
  return {
    vault_num: p.vault,
    name: p.name,
    symbol: p.symbol,
    theme: p.theme,
    fund_type: "dynamic",
    deposit_fee_bps: 0,
    redeem_fee_bps: 100,
    assets: p.assets.map((a) => ({ ...a })),
  };
}

export function allAssetPresetRows(): AssetPresetRow[] {
  return CANONICAL_ASSET_PRESETS.map(assetPresetToRow);
}

export function allVaultPresetRows(): VaultPresetRow[] {
  return CANONICAL_VAULT_PRESETS.map(vaultPresetToRow);
}