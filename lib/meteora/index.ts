/**
 * Meteora DAMM v2 helpers for c_vault_ui.
 *
 * Transaction builders only — callers sign with the wallet (and any returned
 * position NFT keypair) then send. See docs/Meteora.md for SDK patterns.
 *
 * @example Create a customizable pool
 * ```ts
 * import { createPool, parseUiAmount } from '@/lib/meteora';
 *
 * const result = await createPool({
 *   connection,
 *   payer: wallet.publicKey,
 *   tokenA: { mint: mintA, amount: parseUiAmount('1000', 6), decimals: 6 },
 *   tokenB: { mint: mintB, amount: parseUiAmount('1000', 6), decimals: 6 },
 *   initPrice: '1',
 * });
 * // sign with [wallet, result.positionNft], then send result.tx
 * ```
 *
 * @example Add liquidity (new position)
 * ```ts
 * import { addLiquidity } from '@/lib/meteora';
 *
 * const result = await addLiquidity({
 *   connection,
 *   owner: wallet.publicKey,
 *   pool,
 *   maxAmountTokenA: new BN(1_000_000),
 *   maxAmountTokenB: new BN(1_000_000),
 *   mode: { kind: 'new_position' },
 * });
 * ```
 */

export { getCpAmm } from './client';
export { createPool } from './create-pool';
export {
  addLiquidity,
  addLiquidityToPosition,
  createPositionAndAddLiquidity,
} from './add-liquidity';
export {
  deriveVaultShareUsdcPool,
  resolveVaultShareUsdcPool,
} from './pool';
export type { VaultShareUsdcPoolInfo } from './pool';
export {
  applySlippageMax,
  parseUiAmount,
  prepareTransaction,
  resolveMintDecimals,
  resolveTokenProgram,
} from './utils';
export { sendMeteoraTx } from './send';
export type { WalletSigner } from './send';
export type {
  AddLiquidityMode,
  AddLiquidityParams,
  AddLiquidityResult,
  CreatePoolFeeConfig,
  CreatePoolParams,
  CreatePoolResult,
  MeteoraActor,
  TokenAmountInput,
} from './types';

// Re-export commonly needed SDK symbols so UI code can import from one place.
export {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  CpAmm,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  deriveCustomizablePoolAddress,
  derivePositionAddress,
  derivePositionNftAccount,
  getSqrtPriceFromPrice,
  getTokenProgram,
} from '@meteora-ag/cp-amm-sdk';
