import { Keypair, PublicKey } from '@solana/web3.js';
import {
  derivePositionAddress,
  derivePositionNftAccount,
  getTokenProgram,
} from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';
import { getCpAmm } from './client';
import type { AddLiquidityParams, AddLiquidityResult } from './types';
import {
  applySlippageMax,
  assertPositiveAmount,
  prepareTransaction,
} from './utils';

/**
 * Add liquidity to a DAMM v2 pool.
 *
 * - `mode.kind === 'new_position'`: `createPositionAndAddLiquidity` (position NFT + deposit).
 * - `mode.kind === 'existing_position'`: quote via `getDepositQuote` then `addLiquidity`.
 *
 * Builds (does not send) the transaction. When a new position is created, the
 * returned `positionNftKeypair` **must co-sign** with the owner.
 *
 * Based on docs/Meteora.md → "Create A Position And Add Liquidity" /
 * "Add Liquidity To An Existing Position".
 */
export async function addLiquidity(
  params: AddLiquidityParams,
): Promise<AddLiquidityResult> {
  const {
    connection,
    owner,
    pool,
    maxAmountTokenA,
    maxAmountTokenB,
    mode,
    slippagePercent = 1,
  } = params;

  if (maxAmountTokenA.isNeg() || maxAmountTokenB.isNeg()) {
    throw new Error('Token amounts must be non-negative');
  }
  if (maxAmountTokenA.isZero() && maxAmountTokenB.isZero()) {
    throw new Error('Provide a positive maxAmountTokenA and/or maxAmountTokenB');
  }

  const cpAmm = getCpAmm(connection);
  const poolState = await cpAmm.fetchPoolState(pool);

  const tokenAProgram = getTokenProgram(poolState.tokenAFlag);
  const tokenBProgram = getTokenProgram(poolState.tokenBFlag);

  if (mode.kind === 'new_position') {
    assertPositiveAmount(maxAmountTokenA, 'maxAmountTokenA');
    assertPositiveAmount(maxAmountTokenB, 'maxAmountTokenB');

    const positionNft = mode.positionNft ?? Keypair.generate();
    const position = derivePositionAddress(positionNft.publicKey);
    const positionNftAccount = derivePositionNftAccount(positionNft.publicKey);

    const liquidityDelta = cpAmm.getLiquidityDelta({
      maxAmountTokenA,
      maxAmountTokenB,
      sqrtPrice: poolState.sqrtPrice,
      sqrtMinPrice: poolState.sqrtMinPrice,
      sqrtMaxPrice: poolState.sqrtMaxPrice,
      collectFeeMode: poolState.collectFeeMode,
      // Compounding pools need live reserves for an accurate delta.
      tokenAAmount: poolState.tokenAAmount,
      tokenBAmount: poolState.tokenBAmount,
      liquidity: poolState.liquidity,
    });

    if (liquidityDelta.isZero()) {
      throw new Error(
        'Computed liquidityDelta is zero — increase deposit amounts',
      );
    }

    const tokenAAmountThreshold = applySlippageMax(
      maxAmountTokenA,
      slippagePercent,
    );
    const tokenBAmountThreshold = applySlippageMax(
      maxAmountTokenB,
      slippagePercent,
    );

    const builtTx = await cpAmm.createPositionAndAddLiquidity({
      owner,
      pool,
      positionNft: positionNft.publicKey,
      liquidityDelta,
      maxAmountTokenA,
      maxAmountTokenB,
      tokenAAmountThreshold,
      tokenBAmountThreshold,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAProgram,
      tokenBProgram,
    });

    const tx = await prepareTransaction(connection, builtTx, owner);

    return {
      tx,
      pool,
      position,
      positionNftMint: positionNft.publicKey,
      positionNftAccount,
      positionNftKeypair: positionNft,
      liquidityDelta,
      maxAmountTokenA,
      maxAmountTokenB,
      tokenAAmountThreshold,
      tokenBAmountThreshold,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
    };
  }

  // ── existing position ──────────────────────────────────────────────
  const positionNftMint = mode.positionNftMint;
  const position = derivePositionAddress(positionNftMint);
  const positionNftAccount = derivePositionNftAccount(positionNftMint);

  let depositMaxA: BN;
  let depositMaxB: BN;
  let liquidityDelta: BN;

  const bothSides = !maxAmountTokenA.isZero() && !maxAmountTokenB.isZero();

  if (bothSides) {
    // Dual-sided deposit: compute liquidity from both caps (same path as new position).
    liquidityDelta = cpAmm.getLiquidityDelta({
      maxAmountTokenA,
      maxAmountTokenB,
      sqrtPrice: poolState.sqrtPrice,
      sqrtMinPrice: poolState.sqrtMinPrice,
      sqrtMaxPrice: poolState.sqrtMaxPrice,
      collectFeeMode: poolState.collectFeeMode,
      tokenAAmount: poolState.tokenAAmount,
      tokenBAmount: poolState.tokenBAmount,
      liquidity: poolState.liquidity,
    });
    depositMaxA = maxAmountTokenA;
    depositMaxB = maxAmountTokenB;
  } else {
    // Single-sided input → quote the counterpart amount.
    const isTokenA =
      params.isTokenA ?? !maxAmountTokenA.isZero();
    const inAmount = isTokenA ? maxAmountTokenA : maxAmountTokenB;
    assertPositiveAmount(inAmount, isTokenA ? 'maxAmountTokenA' : 'maxAmountTokenB');

    const depositQuote = cpAmm.getDepositQuote({
      inAmount,
      isTokenA,
      sqrtPrice: poolState.sqrtPrice,
      minSqrtPrice: poolState.sqrtMinPrice,
      maxSqrtPrice: poolState.sqrtMaxPrice,
      collectFeeMode: poolState.collectFeeMode,
      tokenAAmount: poolState.tokenAAmount,
      tokenBAmount: poolState.tokenBAmount,
      liquidity: poolState.liquidity,
    });

    liquidityDelta = depositQuote.liquidityDelta;
    if (isTokenA) {
      depositMaxA = depositQuote.actualInputAmount;
      depositMaxB = depositQuote.outputAmount;
    } else {
      depositMaxB = depositQuote.actualInputAmount;
      depositMaxA = depositQuote.outputAmount;
    }
  }

  if (liquidityDelta.isZero()) {
    throw new Error(
      'Computed liquidityDelta is zero — increase deposit amounts',
    );
  }

  const tokenAAmountThreshold = applySlippageMax(
    depositMaxA,
    slippagePercent,
  );
  const tokenBAmountThreshold = applySlippageMax(
    depositMaxB,
    slippagePercent,
  );

  const builtTx = await cpAmm.addLiquidity({
    owner,
    pool,
    position,
    positionNftAccount,
    liquidityDelta,
    maxAmountTokenA: depositMaxA,
    maxAmountTokenB: depositMaxB,
    tokenAAmountThreshold,
    tokenBAmountThreshold,
    tokenAMint: poolState.tokenAMint,
    tokenBMint: poolState.tokenBMint,
    tokenAVault: poolState.tokenAVault,
    tokenBVault: poolState.tokenBVault,
    tokenAProgram,
    tokenBProgram,
  });

  const tx = await prepareTransaction(connection, builtTx, owner);

  return {
    tx,
    pool,
    position,
    positionNftMint,
    positionNftAccount,
    positionNftKeypair: null,
    liquidityDelta,
    maxAmountTokenA: depositMaxA,
    maxAmountTokenB: depositMaxB,
    tokenAAmountThreshold,
    tokenBAmountThreshold,
    tokenAMint: poolState.tokenAMint,
    tokenBMint: poolState.tokenBMint,
  };
}

/**
 * Convenience: open a fresh position and seed it with liquidity.
 * Same as `addLiquidity({ mode: { kind: 'new_position' }, ... })`.
 */
export async function createPositionAndAddLiquidity(
  params: Omit<AddLiquidityParams, 'mode'> & {
    positionNft?: Keypair;
  },
): Promise<AddLiquidityResult> {
  return addLiquidity({
    ...params,
    mode: {
      kind: 'new_position',
      positionNft: params.positionNft,
    },
  });
}

/**
 * Convenience: deposit into an existing position by NFT mint.
 */
export async function addLiquidityToPosition(
  params: Omit<AddLiquidityParams, 'mode'> & {
    positionNftMint: PublicKey;
  },
): Promise<AddLiquidityResult> {
  return addLiquidity({
    ...params,
    mode: {
      kind: 'existing_position',
      positionNftMint: params.positionNftMint,
    },
  });
}
