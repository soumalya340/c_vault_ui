import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import type { Connection } from '@solana/web3.js';
import {
  initGlobalState,
  setEmergency,
  setPaused,
  setFeeRecipient,
  setVaultEmergencyLock,
  createAsset,
  setAssetActive,
  updateTreasuryAddr,
  setTwapKeeper,
  updateDexTwap,
  getVaultState,
  getTotalNavView,
  getUserPosition,
  getVaultAssetBalances,
  genesisDepositAndDeploy,
  getAssetState,
  parseUnits,
  PRICE_SOURCE_PYTH,
  PRICE_SOURCE_DEX,
  PRICE_SCALE_DECIMALS,
  DEFAULT_VAULT_ID,
  WSOL_MINT,
  WSOL_ASSET_ID,
  SOL_USD_PYTH_FEED_ID,
  NETWORK_CONSTANTS,
  type Network,
} from '@/lib/cvault';
import { WSOL_DECIMALS } from '@/lib/constants';
import { assetNameForMint } from '@/lib/presets/canonical-data';
import {
  fetchTokens,
  fetchAssetRegistry,
  saveAssetRegistryEntry,
  fetchVaults,
  updateVaultAlts,
  FieldError,
} from '@/lib/registryClient';
import { assertPoolExists } from '@/lib/poolExists';
import { humanizeViewResult, withCommas } from './view-display';

/** Write ALT to Supabase/SQLite after on-chain create. Soft-fails with a note. */
async function persistVaultAlt(
  network: Network,
  vaultId: number,
  altAddress: string,
  altCreated: boolean,
): Promise<string> {
  if (!altAddress) return '';
  try {
    await updateVaultAlts(network, vaultId, {
      deposit_alt_address: altAddress,
      redeem_alt_address: altAddress,
    });
    return altCreated
      ? `\nALT created + saved: ${altAddress}`
      : `\nALT confirmed + saved: ${altAddress}`;
  } catch (err) {
    return (
      `\nALT is live on-chain (${altAddress}) but saving to DB failed: ` +
      `${err instanceof Error ? err.message : String(err)}. ` +
      `Paste it under Admin → Vaults ALT fields, or re-run genesis/deposit.`
    );
  }
}

function bn(v: string | undefined, fallback = '0'): BN {
  return new BN(v && v.length > 0 ? v : fallback);
}

function pk(v: string | undefined): PublicKey {
  if (!v || v.trim().length === 0) throw new Error('Missing required address');
  return new PublicKey(v.trim());
}

/** Parse a 0-based on-chain id field. Empty → fallback (vault defaults to 0). */
function parseId(
  raw: string | undefined,
  label: string,
  fallback?: number,
): number {
  const trimmed = raw?.trim() ?? '';
  const field = label === 'Vault ID' ? 'vault_id' : 'asset_id';
  if (!trimmed) {
    if (fallback !== undefined) return fallback;
    throw new FieldError(`${label} is required.`, field);
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) {
    throw new FieldError(
      `${label} must be a non-negative integer (0-based). You entered “${trimmed}”.`,
      field,
    );
  }
  return n;
}

function vaultId(v: Record<string, string>): number {
  return parseId(v.vault_id, 'Vault ID', DEFAULT_VAULT_ID);
}

function assetId(v: Record<string, string>): number {
  return parseId(v.asset_id, 'Asset ID', 0);
}

/** 32-byte Pyth feed id as hex (with or without 0x); blank => zero feed. */
function pythFeedIdBytes(v: string | undefined): number[] {
  const hex = (v ?? '').trim().replace(/^0x/i, '');
  if (hex.length === 0) return Array(32).fill(0);
  if (hex.length !== 64) throw new Error('Pyth feed ID must be 64 hex chars (32 bytes)');
  const bytes: number[] = [];
  for (let i = 0; i < 64; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes;
}

/**
 * Runs every instruction on the View / Vault Ops / Admin accordion tabs
 * (`app/components/function-defs.ts`). Create ETF, Deposit, and Redeem each
 * have their own dedicated panels and are not dispatched from here.
 */
export async function executeVaultFunction(
  fnId: string,
  values: Record<string, string>,
  ctx: {
    connection: Connection;
    anchorWallet: AnchorWallet | null;
    publicKey: PublicKey | null;
    network: Network;
  },
): Promise<unknown> {
  const { connection, anchorWallet, publicKey, network } = ctx;
  const v = values;
  const net = network;
  const id = vaultId(v);

  switch (fnId) {
    case 'view_vault_state':
      return humanizeViewResult(fnId, await getVaultState(connection, id, net));
    case 'view_nav':
      // Pass wallet so missing vault ATAs can be simulated as preInstructions.
      return humanizeViewResult(
        fnId,
        await getTotalNavView(connection, id, net, anchorWallet),
      );
    case 'view_vault_asset_balances': {
      const [balances, tokens, registry] = await Promise.all([
        getVaultAssetBalances(connection, id, net),
        fetchTokens().catch(() => []),
        fetchAssetRegistry(net).catch(() => []),
      ]);
      const symbolByMint = new Map(tokens.map((t) => [t.mint, t.symbol]));
      for (const entry of registry) {
        if (entry.asset_name && !symbolByMint.has(entry.mint)) {
          symbolByMint.set(entry.mint, entry.asset_name);
        }
      }
      if (balances.length === 0) {
        return { note: 'No vault asset balances on-chain yet.' };
      }
      // Flat map asset → human amount so LedgerOutput renders certificate rows.
      const out: Record<string, string> = {};
      for (const b of balances) {
        const label =
          symbolByMint.get(b.mint) ||
          assetNameForMint(b.mint) ||
          `${b.mint.slice(0, 4)}…${b.mint.slice(-4)}`;
        out[label] = withCommas(b.uiAmount);
      }
      return out;
    }
    case 'view_my_position':
      if (!publicKey) throw new Error('Connect wallet');
      return humanizeViewResult(fnId, await getUserPosition(connection, id, publicKey, net));
    case 'view_asset_state':
      return humanizeViewResult(fnId, await getAssetState(connection, assetId(v)));
    case 'init_global_state': {
      if (!anchorWallet) throw new Error('Wallet required');
      // Nothing is read from the form — the genesis wSOL asset is fully
      // fixed: per-network USDC/wSOL Whirlpool, Pyth SOL/USD pricing. The
      // Admin №01 fields only display these same constants to the admin.
      const poolAddress = NETWORK_CONSTANTS[net].wsolUsdcPool;
      const pythFeedId = [...SOL_USD_PYTH_FEED_ID];

      // Guard before signing: this pool becomes the canonical USDC↔wSOL
      // Whirlpool that swap_usdc_to_sol / swap_sol_to_usdc validate against,
      // so it must decode as a Whirlpool and carry both legs (USDC and wSOL).
      try {
        await assertPoolExists(connection, poolAddress, 'whirlpool', 'DirectUsdc', net);
        await assertPoolExists(connection, poolAddress, 'whirlpool', 'ViaSol', net);
      } catch (err) {
        throw new FieldError(err instanceof Error ? err.message : String(err), 'pool_address');
      }

      const r = await initGlobalState(
        connection,
        anchorWallet,
        {
          mint: WSOL_MINT,
          poolAddress,
          pythFeedId,
          route: { directUsdc: {} },
          priceSourceTag: PRICE_SOURCE_PYTH,
          priceDexKind: 0,
          pricePoolAddress: PublicKey.default,
          swapKind: { whirlpool: {} },
          tokenProgramTag: 0,
        },
        net,
      );

      // Record the genesis wSOL asset (id 0) in the registry like create_asset
      // does, so it shows up in asset lists and the duplicate-mint guard.
      try {
        await saveAssetRegistryEntry({
          network: net,
          asset_id: String(WSOL_ASSET_ID),
          asset_name: 'Wrapped SOL',
          mint: WSOL_MINT.toBase58(),
          pool_address: poolAddress.toBase58(),
          pyth_feed_id: pythFeedId.map((b) => b.toString(16).padStart(2, '0')).join(''),
          decimals: WSOL_DECIMALS,
          route: 'DirectUsdc',
          price_source_tag: PRICE_SOURCE_PYTH,
          price_dex_kind: 0,
          price_pool_address: PublicKey.default.toBase58(),
          swap_kind: 'Whirlpool',
          token_program_tag: 0,
          active: true,
        });
      } catch (err) {
        return {
          tx: r.tx,
          solscan: r.link,
          wsolAssetId: WSOL_ASSET_ID,
          registryWarning: `Global state initialized on-chain but recording the genesis wSOL asset in the registry failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }

      return { tx: r.tx, solscan: r.link, wsolAssetId: WSOL_ASSET_ID };
    }
    case 'set_emergency': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setEmergency(connection, anchorWallet, v.is_emergency === 'true', net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'genesis_deposit': {
      if (!anchorWallet) throw new Error('Wallet required');
      let baselineSharePrice: BN;
      try {
        baselineSharePrice = parseUnits(v.baseline_share_price || '0', PRICE_SCALE_DECIMALS);
      } catch (err) {
        throw new FieldError(
          err instanceof Error ? err.message : String(err),
          'baseline_share_price',
        );
      }
      // Reuse DB ALT if live; otherwise create one before signing. Multi-asset
      // genesis cannot fit without an ALT — ensureVaultAlt hard-fails if build
      // fails. Always re-persist the address to Supabase/SQLite after success.
      const vaults = await fetchVaults(net).catch(() => []);
      const row = vaults.find((vrow) => vrow.vault_id === id);
      const altAddress = row?.alt_address ?? null;
      const r = await genesisDepositAndDeploy(
        connection,
        anchorWallet,
        id,
        baselineSharePrice,
        altAddress,
        net,
      );
      // Always write ALT when we have one (created or reused but missing in DB).
      const shouldSave =
        Boolean(r.altAddress) &&
        (r.altCreated || !altAddress || altAddress !== r.altAddress);
      const altNote = shouldSave
        ? await persistVaultAlt(net, id, r.altAddress, r.altCreated)
        : r.altAddress
          ? `\nALT: ${r.altAddress}`
          : '';
      const multiTxNote =
        r.signatures.length > 1
          ? `Sent in ${r.signatures.length} transactions (>4 assets).`
          : '';
      const note = [multiTxNote, altNote.trim()].filter(Boolean).join('') || undefined;
      return {
        tx: r.tx,
        solscan: r.link,
        altAddress: r.altAddress,
        altCreated: r.altCreated,
        signatures: r.signatures,
        note,
      };
    }
    case 'set_paused': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setPaused(connection, anchorWallet, id, v.paused === 'true', net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'set_fee_recipient': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setFeeRecipient(connection, anchorWallet, id, pk(v.fee_recipient), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'set_vault_emergency_lock': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setVaultEmergencyLock(connection, anchorWallet, id, v.locked === 'true', net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'create_asset': {
      if (!anchorWallet) throw new Error('Wallet required');
      const mint = pk(v.mint);

      // Guard before signing: the program itself has no duplicate-mint check
      // (each create_asset call gets a fresh asset_id regardless), so a
      // second listing of the same mint would just create a shadow entry.
      const existingAssets = await fetchAssetRegistry(net).catch(() => []);
      const dupe = existingAssets.find((a) => a.mint === mint.toBase58());
      if (dupe) {
        throw new FieldError(`Mint already listed as asset #${dupe.asset_id}.`, 'mint');
      }

      // Display name for pre_approved_token_registry — resolve before signing
      // so we never land an on-chain asset without a registry label ready.
      const tokens = await fetchTokens().catch(() => []);
      const token = tokens.find((t) => t.mint === mint.toBase58());
      const assetName =
        v.asset_name?.trim() ||
        assetNameForMint(mint.toBase58()) ||
        token?.name?.trim() ||
        token?.symbol?.trim() ||
        '';
      if (!assetName) {
        throw new FieldError(
          'Asset name is required — enter a name or use a preset mint.',
          'asset_name',
        );
      }

      const route = v.route === 'directUsdc' ? { directUsdc: {} } : { viaSol: {} };
      const priceSourceTag = Number(v.price_source_tag || 0);
      const priceDexKind = Number(v.price_dex_kind || 0);
      const poolAddress = pk(v.pool_address);
      // Price pool and swap venue are no longer separate inputs — the swap
      // pool doubles as the DEX price pool, and swap_kind mirrors the chosen
      // DEX type, which is the common case and what the remaining-accounts
      // logic in createAsset() assumes.
      const pricePoolAddress = priceSourceTag === PRICE_SOURCE_DEX ? poolAddress : PublicKey.default;
      const swapKind = priceDexKind === 1 ? { dammV2: {} } : { whirlpool: {} };
      const pythFeedId = pythFeedIdBytes(v.pyth_feed_id);
      const tokenProgramTag = Number(v.token_program_tag || 0);

      // Guard before signing: pool exists (Orca Whirlpools SDK or Meteora
      // CpAmm SDK), correct venue, route quote leg, and asset mint is a pool
      // leg (required for swaps even when Price source = Pyth).
      try {
        await assertPoolExists(
          connection,
          poolAddress,
          priceDexKind === 1 ? 'dammV2' : 'whirlpool',
          v.route === 'directUsdc' ? 'DirectUsdc' : 'ViaSol',
          net,
          mint,
        );
      } catch (err) {
        throw new FieldError(
          err instanceof Error ? err.message : String(err),
          'pool_address',
        );
      }

      const r = await createAsset(
        connection,
        anchorWallet,
        {
          mint,
          poolAddress,
          pythFeedId,
          route,
          priceSourceTag,
          priceDexKind,
          pricePoolAddress,
          swapKind,
          tokenProgramTag,
        },
        net,
      );

      try {
        await saveAssetRegistryEntry({
          network: net,
          asset_id: String(r.assetId),
          asset_name: assetName,
          mint: mint.toBase58(),
          pool_address: poolAddress.toBase58(),
          pyth_feed_id: pythFeedId.map((b) => b.toString(16).padStart(2, '0')).join(''),
          decimals: r.decimals,
          route: v.route === 'directUsdc' ? 'DirectUsdc' : 'ViaSol',
          price_source_tag: priceSourceTag,
          price_dex_kind: priceDexKind,
          price_pool_address: pricePoolAddress.toBase58(),
          swap_kind: priceDexKind === 1 ? 'DammV2' : 'Whirlpool',
          token_program_tag: tokenProgramTag,
          active: true,
        });
      } catch (err) {
        return {
          tx: r.tx,
          solscan: r.link,
          assetId: r.assetId,
          registryWarning: `Asset created on-chain but recording it in the registry failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }

      return { tx: r.tx, solscan: r.link, assetId: r.assetId };
    }
    case 'set_asset_active': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setAssetActive(
        connection,
        anchorWallet,
        assetId(v),
        v.active === 'true',
        net,
      );
      return { tx: r.tx, solscan: r.link };
    }
    case 'update_treasury_addr': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await updateTreasuryAddr(connection, anchorWallet, pk(v.treasury), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'set_twap_keeper': {
      if (!anchorWallet) throw new Error('Wallet required');
      const keeper = v.keeper?.trim() ? pk(v.keeper) : PublicKey.default;
      const r = await setTwapKeeper(connection, anchorWallet, keeper, net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'update_dex_twap': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await updateDexTwap(
        connection,
        anchorWallet,
        assetId(v),
        bn(v.twap_live_state),
        net,
      );
      return { tx: r.tx, solscan: r.link };
    }
    default:
      throw new Error(`Unknown function: ${fnId}`);
  }
}

export function formatResult(data: unknown): string {
  if (data == null) return String(data);
  if (typeof data === 'string') return data;
  try {
    const s = JSON.stringify(
      data,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    );
    // JSON.stringify(undefined) → undefined; never hand React an empty text.
    return s ?? String(data);
  } catch {
    return String(data);
  }
}
