import { Connection, PublicKey } from '@solana/web3.js';
import {
  deriveCustomizablePoolAddress,
  getPriceFromSqrtPrice,
} from '@meteora-ag/cp-amm-sdk';
import { getCpAmm } from './client';

/**
 * DAMM v2 **customizable** pool PDA for vault share mint (token A) × USDC
 * (token B). Keys are sorted inside the SDK (`getFirstKey` / `getSecondKey`),
 * so mint order is stable regardless of call argument order.
 *
 * Create path (`createPool` → `createCustomPool`) uses the same PDA — no DB
 * row needed to find the pool after creation.
 */
export function deriveVaultShareUsdcPool(
  sharesMint: PublicKey,
  usdcMint: PublicKey,
): PublicKey {
  return deriveCustomizablePoolAddress(sharesMint, usdcMint);
}

export type VaultShareUsdcPoolInfo = {
  pool: PublicKey;
  exists: boolean;
  /** Live pool sqrt price as human tokenB-per-tokenA when exists. */
  priceUi: string | null;
  tokenAMint: string | null;
  tokenBMint: string | null;
};

/**
 * Resolve the shares/USDC customizable pool and whether it is initialized.
 */
export async function resolveVaultShareUsdcPool(
  connection: Connection,
  sharesMint: PublicKey,
  usdcMint: PublicKey,
): Promise<VaultShareUsdcPoolInfo> {
  const pool = deriveVaultShareUsdcPool(sharesMint, usdcMint);
  const info = await connection.getAccountInfo(pool, 'confirmed');
  if (!info) {
    return {
      pool,
      exists: false,
      priceUi: null,
      tokenAMint: null,
      tokenBMint: null,
    };
  }

  try {
    const cpAmm = getCpAmm(connection);
    const state = await cpAmm.fetchPoolState(pool);
    // Prefer on-chain mint order from the account for display.
    let priceUi: string | null = null;
    try {
      // Token-2022 shares + USDC are both 6 decimals in this product.
      const price = getPriceFromSqrtPrice(state.sqrtPrice, 6, 6);
      priceUi =
        typeof price === 'string'
          ? price
          : typeof price === 'number'
            ? String(price)
            : price != null && typeof (price as { toString?: () => string }).toString === 'function'
              ? (price as { toString: () => string }).toString()
              : null;
    } catch {
      priceUi = null;
    }
    return {
      pool,
      exists: true,
      priceUi,
      tokenAMint: state.tokenAMint.toBase58(),
      tokenBMint: state.tokenBMint.toBase58(),
    };
  } catch {
    // Account exists but isn't a valid pool state — treat as missing.
    return {
      pool,
      exists: false,
      priceUi: null,
      tokenAMint: null,
      tokenBMint: null,
    };
  }
}
