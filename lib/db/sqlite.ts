import "server-only";
import { getPrisma } from "./prisma";
import type { DbDriver, DbNetwork, TableColumnInfo, UnifiedRegistryRow, UnifiedVaultRow } from "./types";
import type { Vault as PrismaVault, PreApprovedTokenRegistry as PrismaRegistryRow } from "@/lib/generated/prisma";

const TABLE_ALLOWLIST = ["vaults", "pre_approved_token_registry", "asset_presets"] as const;

function wrapMissingDb(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("unable to open database file") || message.includes("no such file")) {
    throw new Error(
      "SQLite DB not found — run the CLI once (c_vault_script) or fix SQLITE_DATABASE_URL.",
    );
  }
  throw err instanceof Error ? err : new Error(message);
}

function toUnifiedVault(row: PrismaVault): UnifiedVaultRow {
  return {
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
    fund_type: row.fund_type as "dynamic" | "fixed",
    max_shares: row.max_shares,
    creator: row.creator,
    tx_signature: row.tx_signature,
    alt_address: row.deposit_alt_address,
    deposit_alt_address: row.deposit_alt_address,
    redeem_alt_address: row.redeem_alt_address,
    paused: row.paused,
    admin_locked: row.admin_locked,
    vault_manager: row.vault_manager,
    deposit_fee_bps: row.deposit_fee_bps,
    redeem_fee_bps: row.redeem_fee_bps,
    total_usdc_value: row.total_usdc_value,
    asset_ids: JSON.parse(row.asset_ids) as number[],
    asset_allocation_bps: JSON.parse(row.asset_allocation_bps) as number[],
    num_assets: row.num_assets,
    created_at: row.created_at || null,
  };
}

function toUnifiedRegistry(row: PrismaRegistryRow): UnifiedRegistryRow {
  return {
    asset_id: String(row.asset_id),
    asset_name: row.asset_name,
    network: row.network,
    mint: row.mint,
    pool_address: row.pool_address,
    pyth_feed_id: row.pyth_feed_id,
    decimals: row.decimals,
    route: row.route as "ViaSol" | "DirectUsdc",
    price_source_tag: row.price_source_tag,
    price_dex_kind: row.price_dex_kind,
    price_pool_address: row.price_pool_address,
    swap_kind: row.swap_kind as "Whirlpool" | "DammV2",
    token_program_tag: row.token_program_tag,
    active: row.active === 1,
    created_at: row.created_at || null,
  };
}

export const sqliteDriver: DbDriver = {
  backend: "sqlite",
  label: "SQLITE · c_vault_script/data/c_vault.sqlite",

  async listVaults(network) {
    try {
      const rows = await getPrisma().vault.findMany({
        where: { network },
        orderBy: { vault_id: "asc" },
      });
      return rows.map(toUnifiedVault);
    } catch (err) {
      wrapMissingDb(err);
    }
  },

  async getVault(network, vaultId) {
    try {
      const row = await getPrisma().vault.findUnique({
        where: { network_vault_id: { network, vault_id: vaultId } },
      });
      return row ? toUnifiedVault(row) : null;
    } catch (err) {
      wrapMissingDb(err);
    }
  },

  async upsertVault(_network, row) {
    const prisma = getPrisma();
    await prisma.vault.upsert({
      where: { vault_address: row.vault_address },
      create: {
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
        deposit_alt_address: row.deposit_alt_address ?? row.alt_address,
        redeem_alt_address: row.redeem_alt_address,
        paused: row.paused,
        admin_locked: row.admin_locked,
        vault_manager: row.vault_manager,
        deposit_fee_bps: row.deposit_fee_bps,
        redeem_fee_bps: row.redeem_fee_bps,
        total_usdc_value: row.total_usdc_value,
        asset_ids: JSON.stringify(row.asset_ids),
        asset_allocation_bps: JSON.stringify(row.asset_allocation_bps),
        num_assets: row.num_assets,
      },
      update: {
        paused: row.paused,
        admin_locked: row.admin_locked,
        total_usdc_value: row.total_usdc_value,
        deposit_alt_address: row.deposit_alt_address ?? row.alt_address,
        redeem_alt_address: row.redeem_alt_address,
      },
    });
  },

  async updateVaultAlts(network, vaultId, alts) {
    const prisma = getPrisma();
    const row = await prisma.vault.update({
      where: { network_vault_id: { network, vault_id: vaultId } },
      data: {
        deposit_alt_address: alts.deposit_alt_address,
        redeem_alt_address: alts.redeem_alt_address,
      },
    });
    return toUnifiedVault(row);
  },

  async listRegistry(network) {
    try {
      const rows = await getPrisma().preApprovedTokenRegistry.findMany({
        where: { network },
        orderBy: { asset_id: "asc" },
      });
      return rows.map(toUnifiedRegistry);
    } catch (err) {
      wrapMissingDb(err);
    }
  },

  async getAsset(network, assetId) {
    const row = await getPrisma().preApprovedTokenRegistry.findUnique({
      where: { network_asset_id: { network, asset_id: assetId } },
    });
    return row ? toUnifiedRegistry(row) : null;
  },

  async findAssetByMint(network, mint) {
    const row = await getPrisma().preApprovedTokenRegistry.findUnique({
      where: { network_mint: { network, mint } },
    });
    return row ? toUnifiedRegistry(row) : null;
  },

  async insertRegistryEntry(network, row) {
    const prisma = getPrisma();
    await prisma.preApprovedTokenRegistry.upsert({
      where: { network_asset_id: { network, asset_id: Number(row.asset_id) } },
      create: {
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
        active: row.active ? 1 : 0,
      },
      update: {
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
        active: row.active ? 1 : 0,
      },
    });
  },

  async setAssetActive(network, assetId, active) {
    const prisma = getPrisma();
    await prisma.preApprovedTokenRegistry.update({
      where: { network_asset_id: { network, asset_id: assetId } },
      data: { active: active ? 1 : 0 },
    });
  },

  async listTables() {
    return [...TABLE_ALLOWLIST];
  },

  async tableSchema(table) {
    if (!TABLE_ALLOWLIST.includes(table as (typeof TABLE_ALLOWLIST)[number])) {
      throw new Error(`Unknown table "${table}".`);
    }
    const prisma = getPrisma();
    // sqlite3 returns cid/notnull/pk as BigInt via Prisma's raw query driver —
    // Number()-coerce before this crosses the NextResponse.json() boundary.
    const rows = await prisma.$queryRawUnsafe<
      { cid: bigint | number; name: string; type: string; notnull: bigint | number; dflt_value: string | null; pk: bigint | number }[]
    >(`PRAGMA table_info(${table})`);
    return rows.map<TableColumnInfo>((r) => ({
      cid: Number(r.cid),
      name: r.name,
      type: r.type,
      notnull: Number(r.notnull) === 1,
      pk: Number(r.pk) > 0,
      dflt_value: r.dflt_value,
    }));
  },

  async tableData(table, limit = 500) {
    if (!TABLE_ALLOWLIST.includes(table as (typeof TABLE_ALLOWLIST)[number])) {
      throw new Error(`Unknown table "${table}".`);
    }
    const prisma = getPrisma();
    return prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM ${table} LIMIT ${Number(limit)}`,
    );
  },

  async clearAllData(network) {
    const prisma = getPrisma();
    const [vaultsDeleted, registryDeleted] = await prisma.$transaction([
      prisma.vault.deleteMany({ where: { network } }),
      prisma.preApprovedTokenRegistry.deleteMany({ where: { network } }),
    ]);
    return {
      vaultsDeleted: vaultsDeleted.count,
      registryDeleted: registryDeleted.count,
    };
  },
};
