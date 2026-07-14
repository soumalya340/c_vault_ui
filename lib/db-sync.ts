import type { Connection } from '@solana/web3.js';
import {
  deriveVaultPdas,
  getAssetState,
  getGlobalState,
  getVaultState,
  type Network,
} from './cvault';
import { fetchDecodedVault } from './vaultAccount';
import { ASSET_PRESETS, VAULT_PRESETS } from './presets/canonical-data';
import { fetchAssetRegistry, fetchVaults, saveVault } from './registryClient';

export type SyncReport = {
  onChainTotal: number;
  dbCount: number;
  syncedIds: number[];
  inSync: boolean;
};

function pythFeedHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function assetNameForMint(mint: string): string {
  const preset = ASSET_PRESETS.find((p) => p.mint === mint);
  return preset?.asset_name ?? '';
}

function vaultMetaForId(vaultId: number): { name: string; symbol: string } {
  const preset = VAULT_PRESETS.find((p) => p.vault === vaultId + 1);
  if (preset) return { name: preset.name, symbol: preset.symbol };
  return { name: `Vault ${vaultId}`, symbol: `V${vaultId}` };
}

function missingIds(onChainTotal: number, dbIds: Set<number>): number[] {
  const missing: number[] = [];
  for (let id = 0; id < onChainTotal; id++) {
    if (!dbIds.has(id)) missing.push(id);
  }
  return missing;
}

async function upsertRegistryRow(
  network: Network,
  row: {
    asset_id: string;
    asset_name: string;
    mint: string;
    pool_address: string;
    pyth_feed_id: string;
    decimals: number;
    route: 'ViaSol' | 'DirectUsdc';
    price_source_tag: number;
    price_dex_kind: number;
    price_pool_address: string;
    swap_kind: 'Whirlpool' | 'DammV2';
    token_program_tag: number;
    active: boolean;
  },
): Promise<void> {
  const res = await fetch('/api/admin/db/sync-registry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ network, row }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Registry sync failed (${res.status})`,
    );
  }
}

/**
 * Compare on-chain `totalAssets` with the DB registry. For each missing
 * asset id in `0 .. totalAssets-1`, fetch AssetInfo from chain and upsert.
 */
export async function syncRegistryFromChain(
  connection: Connection,
  network: Network,
): Promise<SyncReport> {
  const gs = await getGlobalState(connection);
  const onChainTotal = Number(gs.totalAssets);
  const dbAssets = await fetchAssetRegistry(network);
  const dbIds = new Set(dbAssets.map((a) => Number(a.asset_id)));
  const toSync = missingIds(onChainTotal, dbIds);

  const syncedIds: number[] = [];
  for (const id of toSync) {
    const asset = await getAssetState(connection, id);
    await upsertRegistryRow(network, {
      asset_id: String(asset.assetId),
      asset_name: assetNameForMint(asset.mint),
      mint: asset.mint,
      pool_address: asset.poolAddress,
      pyth_feed_id: pythFeedHex(asset.pythFeedId),
      decimals: asset.decimals,
      route: asset.route,
      price_source_tag: asset.priceSourceTag,
      price_dex_kind: asset.priceDexKind,
      price_pool_address: asset.pricePoolAddress,
      swap_kind: asset.swapKind,
      token_program_tag: asset.tokenProgramTag,
      active: asset.active,
    });
    syncedIds.push(id);
  }

  return {
    onChainTotal,
    dbCount: dbAssets.length,
    syncedIds,
    inSync: toSync.length === 0,
  };
}

/**
 * Compare on-chain `totalVaults` with the DB vaults table. For each missing
 * vault id in `0 .. totalVaults-1`, fetch vault state from chain and upsert.
 */
export async function syncVaultsFromChain(
  connection: Connection,
  network: Network,
): Promise<SyncReport> {
  const gs = await getGlobalState(connection);
  const onChainTotal = Number(gs.totalVaults);
  const dbVaults = await fetchVaults(network);
  const dbIds = new Set(dbVaults.map((v) => v.vault_id));
  const toSync = missingIds(onChainTotal, dbIds);

  const syncedIds: number[] = [];
  for (const id of toSync) {
    const state = await getVaultState(connection, id, network);
    const pdas = deriveVaultPdas(id, network);
    const decoded = await fetchDecodedVault(connection, pdas.vaultPda);
    const meta = vaultMetaForId(id);
    const manager = decoded?.vaultManager.toBase58() ?? state.feeRecipient;
    const fundType = decoded?.fundType ?? 'dynamic';
    const maxShares =
      decoded && !decoded.maxShares.isZero() ? decoded.maxShares.toString() : null;

    await saveVault({
      vault_address: state.address,
      vault_id: id,
      network,
      vault_authority: pdas.vaultAuthority.toBase58(),
      shares_mint: pdas.sharesMint.toBase58(),
      usdc_vault: pdas.usdcVault.toBase58(),
      name: meta.name,
      symbol: meta.symbol,
      uri: '',
      fee_recipient: state.feeRecipient,
      fund_type: fundType,
      max_shares: maxShares,
      creator: manager,
      tx_signature: 'synced-from-chain',
      alt_address: null,
      paused: state.paused ? 1 : 0,
      admin_locked: state.adminLocked ? 1 : 0,
      vault_manager: manager,
      deposit_fee_bps: state.depositFeeBps,
      redeem_fee_bps: state.redeemFeeBps,
      total_usdc_value: state.totalUsdcValue,
      asset_ids: state.assetIds,
      asset_allocation_bps: state.assetAllocationBps,
      num_assets: state.numAssets,
    });
    syncedIds.push(id);
  }

  return {
    onChainTotal,
    dbCount: dbVaults.length,
    syncedIds,
    inSync: toSync.length === 0,
  };
}

export function formatSyncStatus(kind: 'vault' | 'asset', report: SyncReport): string {
  const label = kind === 'vault' ? 'vaults' : 'assets';
  if (report.inSync) {
    return `In sync — ${report.onChainTotal} on-chain, ${report.dbCount} in DB`;
  }
  const ids = report.syncedIds.map((id) => `#${id}`).join(', ');
  return `Synced ${report.syncedIds.length} ${label} from chain (${ids}) — ${report.onChainTotal} on-chain, ${report.dbCount + report.syncedIds.length} in DB`;
}