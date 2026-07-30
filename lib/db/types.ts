export type DbNetwork = "localhost" | "mainnet";

export interface UnifiedVaultRow {
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
  /** Legacy single-ALT column (Supabase-era). SQLite has no such column — driver aliases it to deposit_alt_address. */
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
  /** Mirrors on-chain `Vault.genesis_done` — false until genesis_deposit succeeds. */
  genesis_deposit_status: boolean;
  /** True once DAMM v2 shares×USDC customizable pool exists on-chain. */
  is_pool_created: boolean;
  created_at: string | null;
}

export interface UnifiedRegistryRow {
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
}

export interface UnifiedAssetPresetRow {
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

export interface UnifiedVaultPresetAsset {
  assetId: number;
  allocationBps: number;
  role: string;
}

export interface UnifiedVaultPresetRow {
  vault_num: number;
  name: string;
  symbol: string;
  theme: string;
  fund_type: "dynamic" | "fixed";
  deposit_fee_bps: number;
  redeem_fee_bps: number;
  assets: UnifiedVaultPresetAsset[];
}

export interface TableColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
  dflt_value: string | null;
}

export interface DbDriver {
  backend: "sqlite" | "supabase";
  /** Status-strip badge, e.g. "SQLITE · c_vault_script/data/c_vault.sqlite". */
  label: string;

  listVaults(network: DbNetwork): Promise<UnifiedVaultRow[]>;
  getVault(network: DbNetwork, vaultId: number): Promise<UnifiedVaultRow | null>;
  /** Upsert on vault_address (the PK in both backends). */
  upsertVault(network: DbNetwork, row: UnifiedVaultRow): Promise<void>;
  updateVaultAlts(
    network: DbNetwork,
    vaultId: number,
    alts: { deposit_alt_address: string | null; redeem_alt_address: string | null },
  ): Promise<UnifiedVaultRow>;
  /** Mark genesis_deposit as done (one-way true). Idempotent. */
  updateVaultGenesisStatus(
    network: DbNetwork,
    vaultId: number,
    genesisDepositStatus: boolean,
  ): Promise<UnifiedVaultRow>;
  /** Mark DAMM v2 shares×USDC pool as created (one-way true). Idempotent. */
  updateVaultPoolCreated(
    network: DbNetwork,
    vaultId: number,
    isPoolCreated: boolean,
  ): Promise<UnifiedVaultRow>;

  listRegistry(network: DbNetwork): Promise<UnifiedRegistryRow[]>;
  getAsset(network: DbNetwork, assetId: number): Promise<UnifiedRegistryRow | null>;
  findAssetByMint(network: DbNetwork, mint: string): Promise<UnifiedRegistryRow | null>;
  insertRegistryEntry(network: DbNetwork, row: Omit<UnifiedRegistryRow, "created_at">): Promise<void>;
  setAssetActive(network: DbNetwork, assetId: number, active: boolean): Promise<void>;

  listTables(): Promise<string[]>;
  tableSchema(table: string): Promise<TableColumnInfo[]>;
  /** Full row dump, capped (default 500). */
  tableData(table: string, limit?: number): Promise<Record<string, unknown>[]>;

  listAssetPresets(): Promise<UnifiedAssetPresetRow[]>;
  listVaultPresets(): Promise<UnifiedVaultPresetRow[]>;
  /** Upsert canonical presets from Pools.md / Vault.md (idempotent). */
  seedPresets(): Promise<{ assetPresets: number; vaultPresets: number }>;

  /** Deletes vaults + asset-registry rows for the network; presets and schema are kept. */
  clearAllData(network: DbNetwork): Promise<{ vaultsDeleted: number; registryDeleted: number }>;
}
