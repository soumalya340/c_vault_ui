import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { allAssetPresetRows, allVaultPresetRows } from "@/lib/presets/seed";
import type {
  DbDriver,
  TableColumnInfo,
  UnifiedAssetPresetRow,
  UnifiedRegistryRow,
  UnifiedVaultPresetRow,
  UnifiedVaultRow,
} from "./types";

const TABLE_FALLBACK = ["vaults", "pre_approved_token_registry", "asset_presets", "vault_presets"];

const REGISTRY_SELECT =
  "asset_id::text, asset_name, network, mint, pool_address, pyth_feed_id, decimals, route, price_source_tag, price_dex_kind, price_pool_address, swap_kind, token_program_tag, active, created_at";

function wrapMissingColumn(err: unknown): never {
  const message = (err as { message?: string } | undefined)?.message ?? String(err);
  if (message.includes("asset_name") || message.includes("deposit_alt_address") || message.includes("redeem_alt_address")) {
    throw new Error(
      "Supabase is missing admin-parity columns — run db/supabase/migration/0004_admin_parity.sql in the Supabase SQL editor.",
    );
  }
  if (message.includes("asset_presets") || message.includes("vault_presets")) {
    throw new Error(
      "Supabase is missing preset tables — run db/supabase/migration/0005_presets.sql in the Supabase SQL editor.",
    );
  }
  throw err instanceof Error ? err : new Error(message);
}

type SupabaseAssetPresetRow = {
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
  aliases: string[] | string;
};

type SupabaseVaultPresetRow = {
  vault_num: number;
  name: string;
  symbol: string;
  theme: string;
  fund_type: "dynamic" | "fixed";
  deposit_fee_bps: number;
  redeem_fee_bps: number;
  assets: UnifiedVaultPresetRow["assets"] | string;
};

function parseAliases(v: string[] | string): string[] {
  return typeof v === "string" ? (JSON.parse(v) as string[]) : v;
}

function toUnifiedAssetPreset(row: SupabaseAssetPresetRow): UnifiedAssetPresetRow {
  return { ...row, aliases: parseAliases(row.aliases) };
}

function toUnifiedVaultPreset(row: SupabaseVaultPresetRow): UnifiedVaultPresetRow {
  const assets =
    typeof row.assets === "string" ? (JSON.parse(row.assets) as UnifiedVaultPresetRow["assets"]) : row.assets;
  return { ...row, assets };
}

type SupabaseVaultRow = {
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
  alt_address: string | null;
  deposit_alt_address: string | null;
  redeem_alt_address: string | null;
  paused: number;
  admin_locked: number;
  vault_manager: string;
  deposit_fee_bps: number;
  redeem_fee_bps: number;
  total_usdc_value: string;
  asset_ids: number[];
  asset_allocation_bps: number[];
  num_assets: number;
  genesis_deposit_status?: boolean | null;
  created_at: string | null;
};

function toUnifiedVault(row: SupabaseVaultRow): UnifiedVaultRow {
  return {
    ...row,
    deposit_alt_address: row.deposit_alt_address ?? row.alt_address,
    redeem_alt_address: row.redeem_alt_address,
    genesis_deposit_status: Boolean(row.genesis_deposit_status),
  };
}

type SupabaseRegistryRow = {
  asset_id: string;
  asset_name: string;
  network: string;
  mint: string;
  pool_address: string;
  pyth_feed_id: string;
  decimals: number;
  route: "ViaSol" | "DirectUsdc";
  price_source_tag: number;
  price_dex_kind: number;
  price_pool_address: string;
  swap_kind: "Whirlpool" | "DammV2";
  token_program_tag: number;
  active: boolean;
  created_at: string | null;
};

function toUnifiedRegistry(row: SupabaseRegistryRow): UnifiedRegistryRow {
  return { ...row };
}

export const supabaseDriver: DbDriver = {
  backend: "supabase",
  label: "SUPABASE",

  async listVaults(network) {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("vaults")
      .select("*")
      .eq("network", network)
      .order("vault_id", { ascending: true });
    if (error) wrapMissingColumn(error);
    return ((data ?? []) as SupabaseVaultRow[]).map(toUnifiedVault);
  },

  async getVault(network, vaultId) {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("vaults")
      .select("*")
      .eq("network", network)
      .eq("vault_id", vaultId)
      .maybeSingle();
    if (error) wrapMissingColumn(error);
    return data ? toUnifiedVault(data as SupabaseVaultRow) : null;
  },

  async upsertVault(_network, row) {
    const supabase = createServiceClient();
    const { error } = await supabase.from("vaults").upsert(
      {
        vault_address: row.vault_address,
        vault_id: row.vault_id,
        network: row.network,
        vault_authority: row.vault_authority,
        shares_mint: row.shares_mint,
        usdc_vault: row.usdc_vault,
        name: row.name,
        symbol: row.symbol,
        uri: row.uri,
        fee_recipient: row.fee_recipient,
        fund_type: row.fund_type,
        max_shares: row.max_shares,
        creator: row.creator,
        tx_signature: row.tx_signature,
        alt_address: row.deposit_alt_address ?? row.alt_address,
        deposit_alt_address: row.deposit_alt_address ?? row.alt_address,
        redeem_alt_address: row.redeem_alt_address,
        paused: row.paused,
        admin_locked: row.admin_locked,
        vault_manager: row.vault_manager,
        deposit_fee_bps: row.deposit_fee_bps,
        redeem_fee_bps: row.redeem_fee_bps,
        total_usdc_value: row.total_usdc_value,
        asset_ids: row.asset_ids,
        asset_allocation_bps: row.asset_allocation_bps,
        num_assets: row.num_assets,
        genesis_deposit_status: row.genesis_deposit_status ?? false,
      },
      { onConflict: "vault_address" },
    );
    if (error) wrapMissingColumn(error);
  },

  async updateVaultAlts(network, vaultId, alts) {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("vaults")
      .update({
        deposit_alt_address: alts.deposit_alt_address,
        redeem_alt_address: alts.redeem_alt_address,
        alt_address: alts.deposit_alt_address,
      })
      .eq("network", network)
      .eq("vault_id", vaultId)
      .select("*")
      .single();
    if (error) wrapMissingColumn(error);
    return toUnifiedVault(data as SupabaseVaultRow);
  },

  async updateVaultGenesisStatus(network, vaultId, genesisDepositStatus) {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("vaults")
      .update({ genesis_deposit_status: genesisDepositStatus })
      .eq("network", network)
      .eq("vault_id", vaultId)
      .select("*")
      .single();
    if (error) wrapMissingColumn(error);
    return toUnifiedVault(data as SupabaseVaultRow);
  },

  async listRegistry(network) {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pre_approved_token_registry")
      .select(REGISTRY_SELECT)
      .eq("network", network)
      .order("asset_id", { ascending: true });
    if (error) wrapMissingColumn(error);
    return ((data ?? []) as unknown as SupabaseRegistryRow[]).map(toUnifiedRegistry);
  },

  async getAsset(network, assetId) {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pre_approved_token_registry")
      .select(REGISTRY_SELECT)
      .eq("network", network)
      .eq("asset_id", assetId)
      .maybeSingle();
    if (error) wrapMissingColumn(error);
    return data ? toUnifiedRegistry(data as unknown as SupabaseRegistryRow) : null;
  },

  async findAssetByMint(network, mint) {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("pre_approved_token_registry")
      .select(REGISTRY_SELECT)
      .eq("network", network)
      .eq("mint", mint)
      .maybeSingle();
    if (error) wrapMissingColumn(error);
    return data ? toUnifiedRegistry(data as unknown as SupabaseRegistryRow) : null;
  },

  async insertRegistryEntry(network, row) {
    const supabase = createServiceClient();
    const { error } = await supabase.from("pre_approved_token_registry").upsert(
      {
        network,
        asset_id: Number(row.asset_id),
        asset_name: row.asset_name,
        mint: row.mint,
        pool_address: row.pool_address,
        pyth_feed_id: row.pyth_feed_id,
        decimals: row.decimals,
        route: row.route,
        price_source_tag: row.price_source_tag,
        price_dex_kind: row.price_dex_kind,
        price_pool_address: row.price_pool_address,
        swap_kind: row.swap_kind,
        token_program_tag: row.token_program_tag,
        active: row.active,
      },
      { onConflict: "network,asset_id" },
    );
    if (error) wrapMissingColumn(error);
  },

  async setAssetActive(network, assetId, active) {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("pre_approved_token_registry")
      .update({ active })
      .eq("network", network)
      .eq("asset_id", assetId);
    if (error) wrapMissingColumn(error);
  },

  async listTables() {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) return TABLE_FALLBACK;
    try {
      const res = await fetch(`${url}/rest/v1/`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });
      if (!res.ok) return TABLE_FALLBACK;
      const spec = (await res.json()) as { definitions?: Record<string, unknown> };
      const tables = Object.keys(spec.definitions ?? {});
      return tables.length > 0 ? tables : TABLE_FALLBACK;
    } catch {
      return TABLE_FALLBACK;
    }
  },

  async tableSchema(table) {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY.");
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch schema (${res.status}).`);
    const spec = (await res.json()) as {
      definitions?: Record<string, { properties?: Record<string, { type?: string; format?: string }>; required?: string[] }>;
    };
    const def = spec.definitions?.[table];
    if (!def) throw new Error(`Unknown table "${table}".`);
    const required = new Set(def.required ?? []);
    const props = def.properties ?? {};
    return Object.keys(props).map<TableColumnInfo>((name, i) => ({
      cid: i,
      name,
      type: props[name].format ?? props[name].type ?? "—",
      notnull: required.has(name),
      pk: name.endsWith("_address") && (table === "vaults" ? name === "vault_address" : false),
      dflt_value: null,
    }));
  },

  async tableData(table, limit = 500) {
    const supabase = createServiceClient();
    const { data, error } = await supabase.from(table).select("*").limit(limit);
    if (error) wrapMissingColumn(error);
    return (data ?? []) as Record<string, unknown>[];
  },

  async listAssetPresets() {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("asset_presets")
      .select("*")
      .order("preset_key", { ascending: true });
    if (error) wrapMissingColumn(error);
    return ((data ?? []) as SupabaseAssetPresetRow[]).map(toUnifiedAssetPreset);
  },

  async listVaultPresets() {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("vault_presets")
      .select("*")
      .order("vault_num", { ascending: true });
    if (error) wrapMissingColumn(error);
    return ((data ?? []) as SupabaseVaultPresetRow[]).map(toUnifiedVaultPreset);
  },

  async seedPresets() {
    const supabase = createServiceClient();
    const assetRows = allAssetPresetRows().map((row) => ({
      preset_key: row.preset_key,
      asset_name: row.asset_name,
      mint: row.mint,
      pool_address: row.pool_address,
      pyth_feed_id: row.pyth_feed_id,
      decimals: row.decimals,
      route: row.route,
      price_source_tag: row.price_source_tag,
      price_dex_kind: row.price_dex_kind,
      swap_kind: row.swap_kind,
      token_program_tag: row.token_program_tag,
      aliases: row.aliases,
    }));
    const { error: assetErr } = await supabase.from("asset_presets").upsert(assetRows, { onConflict: "preset_key" });
    if (assetErr) wrapMissingColumn(assetErr);

    const vaultRows = allVaultPresetRows().map((row) => ({
      vault_num: row.vault_num,
      name: row.name,
      symbol: row.symbol,
      theme: row.theme,
      fund_type: row.fund_type,
      deposit_fee_bps: row.deposit_fee_bps,
      redeem_fee_bps: row.redeem_fee_bps,
      assets: row.assets,
    }));
    const { error: vaultErr } = await supabase.from("vault_presets").upsert(vaultRows, { onConflict: "vault_num" });
    if (vaultErr) wrapMissingColumn(vaultErr);

    return {
      assetPresets: assetRows.length,
      vaultPresets: vaultRows.length,
    };
  },

  async clearAllData(network) {
    const supabase = createServiceClient();
    const { count: vaultsDeleted, error: vaultsErr } = await supabase
      .from("vaults")
      .delete({ count: "exact" })
      .eq("network", network);
    if (vaultsErr) wrapMissingColumn(vaultsErr);
    const { count: registryDeleted, error: registryErr } = await supabase
      .from("pre_approved_token_registry")
      .delete({ count: "exact" })
      .eq("network", network);
    if (registryErr) wrapMissingColumn(registryErr);
    return { vaultsDeleted: vaultsDeleted ?? 0, registryDeleted: registryDeleted ?? 0 };
  },
};
