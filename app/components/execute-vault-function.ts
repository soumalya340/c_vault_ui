import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import type { Connection } from '@solana/web3.js';
import {
  initGlobalState,
  addEligibleBaseMint,
  removeEligibleBaseMint,
  setEmergency,
  setDepositDisable,
  resume,
  setPaused,
  setRedeemCooldown,
  setFeeRecipient,
  updatePlatformFeeBps,
  updateTreasuryAddr,
  getGlobalState,
  getVaultState,
  getTotalNavView,
  previewDeposit,
  previewRedeem,
  getUserPosition,
  DEFAULT_VAULT_ID,
  type Network,
} from '@/lib/cvault';

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

/**
 * Runs every instruction on the View / Vault Ops / Admin accordion tabs
 * (`app/components/function-defs.ts`). Create ETF, Deposit, and Redeem each
 * have their own dedicated panels (create-etf-panel.tsx, vaults-panel.tsx)
 * and are not dispatched from here.
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
      return getVaultState(connection, id);
    case 'view_nav':
      return getTotalNavView(connection, id);
    case 'preview_deposit':
      return previewDeposit(connection, id, bn(v.usdc_amount));
    case 'preview_redeem':
      return previewRedeem(connection, id, bn(v.shares));
    case 'view_my_position':
      if (!publicKey) throw new Error('Connect wallet');
      return getUserPosition(connection, id, publicKey);
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
      const r = await setPaused(connection, anchorWallet, id, v.paused === 'true', net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'resume': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await resume(connection, anchorWallet, id, net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'set_redeem_cooldown': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setRedeemCooldown(connection, anchorWallet, id, Number(v.cooldown_secs || 86400), net);
      return { tx: r.tx, solscan: r.link };
    }
    case 'set_fee_recipient': {
      if (!anchorWallet) throw new Error('Wallet required');
      const r = await setFeeRecipient(connection, anchorWallet, id, pk(v.fee_recipient), net);
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
