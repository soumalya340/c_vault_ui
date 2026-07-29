import { Keypair } from '@solana/web3.js';
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  getBaseFeeParams,
  getDynamicFeeParams,
  getSqrtPriceFromPrice,
  type PoolFeesParams,
} from '@meteora-ag/cp-amm-sdk';
import { getCpAmm } from './client';
import type { CreatePoolParams, CreatePoolResult } from './types';
import {
  assertPositiveAmount,
  prepareTransaction,
  resolveMintDecimals,
  resolveTokenProgram,
} from './utils';

/**
 * Create a Meteora DAMM v2 **customizable** pool with initial liquidity.
 *
 * Builds (does not send) the transaction from `@meteora-ag/cp-amm-sdk`
 * `createCustomPool`. The returned `positionNft` keypair **must co-sign**
 * with the payer before broadcast.
 *
 * Based on docs/Meteora.md → "Create A Customizable Pool".
 */
export async function createPool(
  params: CreatePoolParams,
): Promise<CreatePoolResult> {
  const {
    connection,
    payer,
    tokenA,
    tokenB,
    initPrice = '1',
    fee = {},
    activationType = ActivationType.Timestamp,
    collectFeeMode = CollectFeeMode.BothToken,
    activationPoint = null,
    hasAlphaVault = false,
    isLockLiquidity = false,
  } = params;

  const creator = params.creator ?? payer;
  assertPositiveAmount(tokenA.amount, 'tokenA.amount');
  assertPositiveAmount(tokenB.amount, 'tokenB.amount');

  if (tokenA.mint.equals(tokenB.mint)) {
    throw new Error('tokenA and tokenB mints must be different');
  }

  const [tokenAProgram, tokenBProgram] = await Promise.all([
    tokenA.tokenProgram
      ? Promise.resolve(tokenA.tokenProgram)
      : resolveTokenProgram(connection, tokenA.mint),
    tokenB.tokenProgram
      ? Promise.resolve(tokenB.tokenProgram)
      : resolveTokenProgram(connection, tokenB.mint),
  ]);

  const [tokenADecimals, tokenBDecimals] = await Promise.all([
    resolveMintDecimals(
      connection,
      tokenA.mint,
      tokenAProgram,
      tokenA.decimals,
    ),
    resolveMintDecimals(
      connection,
      tokenB.mint,
      tokenBProgram,
      tokenB.decimals,
    ),
  ]);

  const sqrtMinPrice = params.sqrtMinPrice ?? MIN_SQRT_PRICE;
  const sqrtMaxPrice = params.sqrtMaxPrice ?? MAX_SQRT_PRICE;
  if (sqrtMinPrice.gte(sqrtMaxPrice)) {
    throw new Error('sqrtMinPrice must be < sqrtMaxPrice');
  }

  const initSqrtPrice = getSqrtPriceFromPrice(
    initPrice,
    tokenADecimals,
    tokenBDecimals,
  );
  if (initSqrtPrice.lt(sqrtMinPrice) || initSqrtPrice.gt(sqrtMaxPrice)) {
    throw new Error(
      `initPrice "${initPrice}" maps to sqrt price outside [sqrtMinPrice, sqrtMaxPrice]`,
    );
  }

  const startingFeeBps = fee.startingFeeBps ?? 25;
  const endingFeeBps = fee.endingFeeBps ?? startingFeeBps;
  const numberOfPeriod = fee.numberOfPeriod ?? 0;
  const totalDuration = fee.totalDuration ?? 0;
  const baseFeeMode =
    fee.baseFeeMode ?? BaseFeeMode.FeeTimeSchedulerLinear;

  const baseFee = getBaseFeeParams(
    {
      baseFeeMode,
      feeTimeSchedulerParam: {
        startingFeeBps,
        endingFeeBps,
        numberOfPeriod,
        totalDuration,
      },
    },
    tokenBDecimals,
    activationType,
  );

  const dynamicFee =
    fee.dynamicFeeBaseBps === null
      ? null
      : getDynamicFeeParams(fee.dynamicFeeBaseBps ?? 25);

  const poolFees: PoolFeesParams = {
    baseFee,
    compoundingFeeBps: fee.compoundingFeeBps ?? 0,
    padding: 0,
    dynamicFee,
  };

  const cpAmm = getCpAmm(connection);
  const liquidityDelta = cpAmm.getLiquidityDelta({
    maxAmountTokenA: tokenA.amount,
    maxAmountTokenB: tokenB.amount,
    sqrtPrice: initSqrtPrice,
    sqrtMinPrice,
    sqrtMaxPrice,
    collectFeeMode,
  });

  if (liquidityDelta.isZero()) {
    throw new Error(
      'Computed liquidityDelta is zero — increase seed amounts or check initPrice',
    );
  }

  const positionNft = params.positionNft ?? Keypair.generate();

  const {
    tx: builtTx,
    pool,
    position,
  } = await cpAmm.createCustomPool({
    payer,
    creator,
    positionNft: positionNft.publicKey,
    tokenAMint: tokenA.mint,
    tokenBMint: tokenB.mint,
    tokenAAmount: tokenA.amount,
    tokenBAmount: tokenB.amount,
    sqrtMinPrice,
    sqrtMaxPrice,
    liquidityDelta,
    initSqrtPrice,
    poolFees,
    hasAlphaVault,
    activationType,
    collectFeeMode,
    activationPoint,
    tokenAProgram,
    tokenBProgram,
    isLockLiquidity,
  });

  const tx = await prepareTransaction(connection, builtTx, payer);

  return {
    tx,
    pool,
    position,
    positionNft,
    liquidityDelta,
    initSqrtPrice,
    tokenAAmount: tokenA.amount,
    tokenBAmount: tokenB.amount,
    tokenADecimals,
    tokenBDecimals,
    tokenAProgram,
    tokenBProgram,
  };
}
