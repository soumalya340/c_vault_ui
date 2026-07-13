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
  getGlobalState,
  getVaultState,
  getTotalNavView,
  previewDeposit,
  previewRedeem,
  getUserPosition,
  getVaultAssetBalances,
  getAssetState,
  describePreviewError,
  PRICE_SOURCE_DEX,
  DEFAULT_VAULT_ID,
  type Network,
} from '@/lib/cvault';
import { fetchTokens, fetchAssetRegistry, saveAssetRegistryEntry, FieldError } from '@/lib/registryClient';
import { assertPoolExists } from '@/lib/poolExists';

function bn(v: string | undefined, fallback = '0'): BN {
  return new BN(v && v.length > 0 ? v : fallback);
}

function pk(v: string | undefined): PublicKey {
  if (!v || v.trim().length === 0) throw new Error('Missing required address');
  return new PublicKey(v.trim());
}

function vaultId(v: Record<string, string>): number {
  return v.vault_id?.trim() ? Number(v.vault_id) : DEFAULT_VAULT_ID;
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
    case 'view_global_state':
      return getGlobalState(connection);
    case 'view_vault_state':
      return getVaultState(connection, id, net);
    case 'view_nav':
      return getTotalNavView(connection, id, net);
    case 'preview_deposit':
      try {
        return await previewDeposit(connection, id, bn(v.usdc_amount), net);
      } catch (err) {
        throw new Error(describePreviewError(err));
      }
    case 'preview_redeem':
      try {
        return await previewRedeem(connection, id, bn(v.shares), net);
      } catch (err) {
        throw new Error(describePreviewError(err));
      }
    case 'view_vault_asset_balances': {
      const [balances, tokens] = await Promise.all([
        getVaultAssetBalances(connection, id, net),
        fetchTokens().catch(() => []),
      ]);
      const symbolByMint = new Map(tokens.map((t) => [t.mint, t.symbol]));
      return balances.map((b) => ({
        asset: symbolByMint.get(b.mint) ?? b.mint,
        balance: b.uiAmount,
        raw: b.raw,
        decimals: b.decimals,
        mint: b.mint,
      }));
    }
    case 'view_my_position':
      if (!publicKey) throw new Error('Connect wallet');
      return getUserPosition(connection, id, publicKey, net);
    case 'view_asset_state':
      return getAssetState(connection, Number(v.asset_id || 0));
    case 'init_global_state': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await initGlobalState(connection, anchorWallet, net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'set_emergency': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setEmergency(connection, anchorWallet, v.is_emergency === 'true', net);
      return { tx: r.tx, solscan: r.link };
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
      const existingAssets = await fetchAssetRegistry().catch(() => []);
      const dupe = existingAssets.find((a) => a.mint === mint.toBase58());
      if (dupe) {
        throw new FieldError(`Mint already listed as asset #${dupe.asset_id}.`, 'mint');
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

      // Guard before signing: verify the swap pool actually exists, decodes
      // as the selected DEX Type, and includes the mint the chosen route
      // requires — so a typo'd, wrong-venue, or wrong-route address fails
      // here (next to the field) instead of as an on-chain rejection.
      try {
        await assertPoolExists(
          connection,
          poolAddress,
          priceDexKind === 1 ? 'dammV2' : 'whirlpool',
          v.route === 'directUsdc' ? 'DirectUsdc' : 'ViaSol',
          net,
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
          asset_id: String(r.assetId),
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
        Number(v.asset_id || 0),
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
        Number(v.asset_id || 0),
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
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}
