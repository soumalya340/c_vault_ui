import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import type { Connection } from '@solana/web3.js';
import {
  initGlobalState,
  addEligibleBaseMint,
  removeEligibleBaseMint,
  createEtf,
  setEmergency,
  setDepositDisable,
  resume,
  setPaused,
  setRedeemCooldown,
  setFeeRecipient,
  updatePlatformFeeBps,
  updateTreasuryAddr,
  deposit,
  requestRedeem,
  claim,
  swapUsdcToSol,
  swapUsdcToAsset,
  swapSolToAsset,
  swapAssetToSol,
  swapSolToUsdc,
  swapAssetToUsdc,
  getGlobalState,
  getVaultState,
  getTotalNavView,
  previewDeposit,
  previewRedeem,
  getUserPosition,
  ensureUserAtas,
  ADMIN_PUBKEY,
  DEFAULT_VAULT_ID,
  type Network,
  type PriceFeeds,
} from '@/lib/cvault';

function bn(v: string | undefined, fallback = '0'): BN {
  return new BN(v && v.length > 0 ? v : fallback);
}

function pk(v: string | undefined): PublicKey {
  if (!v || v.trim().length === 0) throw new Error('Missing required address');
  return new PublicKey(v.trim());
}

function feeds(values: Record<string, string>): PriceFeeds {
  return { sol: pk(values.sol_feed), btc: pk(values.btc_feed), eth: pk(values.eth_feed) };
}

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

  switch (fnId) {
    case 'view_global_state':
      return getGlobalState(connection);
    case 'view_vault_state':
      return getVaultState(connection, DEFAULT_VAULT_ID);
    case 'view_nav':
      return getTotalNavView(connection, DEFAULT_VAULT_ID, feeds(v));
    case 'preview_deposit':
      return previewDeposit(connection, DEFAULT_VAULT_ID, bn(v.usdc_amount), feeds(v));
    case 'preview_redeem':
      return previewRedeem(connection, DEFAULT_VAULT_ID, bn(v.shares), feeds(v));
    case 'view_my_position':
      if (!publicKey) throw new Error('Connect wallet');
      return getUserPosition(connection, DEFAULT_VAULT_ID, publicKey);
    case 'deposit': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await deposit(connection, anchorWallet, DEFAULT_VAULT_ID, bn(v.usdc_amount), bn(v.min_shares_out), feeds(v), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'ensure_atas': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await ensureUserAtas(connection, anchorWallet, DEFAULT_VAULT_ID, net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'swap_usdc_to_sol': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await swapUsdcToSol(connection, anchorWallet, DEFAULT_VAULT_ID, bn(v.min_wsol_out), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'swap_usdc_to_asset': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await swapUsdcToAsset(connection, anchorWallet, DEFAULT_VAULT_ID, Number(v.asset_index || 0), pk(v.pool_address), pk(v.asset_mint), pk(v.asset_ata), bn(v.min_asset_out), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'swap_sol_to_asset': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await swapSolToAsset(connection, anchorWallet, DEFAULT_VAULT_ID, Number(v.asset_index || 0), pk(v.pool_address), pk(v.asset_mint), pk(v.asset_ata), bn(v.min_asset_out), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'request_redeem': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await requestRedeem(connection, anchorWallet, DEFAULT_VAULT_ID, bn(v.shares), feeds(v), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'swap_asset_to_sol': {
      if (!anchorWallet || !publicKey) throw new Error('Wallet required');
      const target = v.user_address?.trim() ? pk(v.user_address) : publicKey;
      const r = await swapAssetToSol(connection, anchorWallet, DEFAULT_VAULT_ID, Number(v.asset_index || 0), pk(v.pool_address), pk(v.asset_mint), pk(v.asset_ata), bn(v.min_wsol_out), target, net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'swap_sol_to_usdc': {
      if (!anchorWallet || !publicKey) throw new Error('Wallet required');
      const target = v.user_address?.trim() ? pk(v.user_address) : publicKey;
      const r = await swapSolToUsdc(connection, anchorWallet, DEFAULT_VAULT_ID, Number(v.asset_index || 0), bn(v.wsol_amount), bn(v.min_usdc_out), target, net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'swap_asset_to_usdc': {
      if (!anchorWallet || !publicKey) throw new Error('Wallet required');
      const target = v.user_address?.trim() ? pk(v.user_address) : publicKey;
      const r = await swapAssetToUsdc(connection, anchorWallet, DEFAULT_VAULT_ID, Number(v.asset_index || 0), pk(v.pool_address), pk(v.asset_mint), pk(v.asset_ata), bn(v.min_usdc_out), target, net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'claim': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await claim(connection, anchorWallet, DEFAULT_VAULT_ID, net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'init_global_state': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await initGlobalState(connection, anchorWallet, Number(v.platform_fee_bps || 0), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'add_eligible_base_mint': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await addEligibleBaseMint(connection, anchorWallet, pk(v.mint), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'remove_eligible_base_mint': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await removeEligibleBaseMint(connection, anchorWallet, pk(v.mint), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'create_etf': {
      if (!anchorWallet) throw new Error('Wallet required');
      const rawAssets = JSON.parse(v.assets_json || '[]');
      const assets = rawAssets.map((a: {
        mint: string;
        poolAddress: string;
        pythFeedId: string;
        allocationBps: number;
        decimals: number;
        route: string;
      }) => ({
        mint: new PublicKey(a.mint),
        poolAddress: new PublicKey(a.poolAddress),
        pythFeedId: Array.from(Buffer.from(a.pythFeedId, 'hex')),
        allocationBps: a.allocationBps,
        decimals: a.decimals,
        route: a.route === 'ViaSol' ? { viaSol: {} } : { directUsdc: {} },
      }));
      const r = await createEtf(
        connection,
        anchorWallet,
        {
          feeRecipient: v.fee_recipient?.trim() ? pk(v.fee_recipient) : null,
          performanceFeeBps: Number(v.performance_fee_bps || 0),
          usdcSolPool: v.usdc_sol_pool?.trim() ? pk(v.usdc_sol_pool) : null,
          assets,
          fundType: v.fund_type === 'fixed' ? { fixed: {} } : { dynamic: {} },
          maxShares: v.max_shares?.trim() ? bn(v.max_shares) : null,
        },
        v.name || '',
        v.symbol || '',
        v.uri || '',
        net,
      );
      return { tx: r.tx, solscan: r.link };
    }
    case 'set_emergency': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setEmergency(connection, anchorWallet, v.is_emergency === 'true', net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'set_deposit_disable': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setDepositDisable(connection, anchorWallet, v.disabled === 'true', net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'set_paused': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setPaused(connection, anchorWallet, DEFAULT_VAULT_ID, v.paused === 'true', net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'resume': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await resume(connection, anchorWallet, DEFAULT_VAULT_ID, net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'set_redeem_cooldown': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setRedeemCooldown(connection, anchorWallet, DEFAULT_VAULT_ID, Number(v.cooldown_secs || 86400), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'set_fee_recipient': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setFeeRecipient(connection, anchorWallet, DEFAULT_VAULT_ID, pk(v.fee_recipient), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'update_platform_fee_bps': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await updatePlatformFeeBps(connection, anchorWallet, Number(v.platform_fee_bps || 0), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'update_treasury_addr': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await updateTreasuryAddr(connection, anchorWallet, pk(v.treasury), net);
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
