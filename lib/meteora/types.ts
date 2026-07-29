import type { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import type {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
} from '@meteora-ag/cp-amm-sdk';
import type BN from 'bn.js';

/** Wallet / payer identity used to build DAMM v2 txs (signing happens outside). */
export type MeteoraActor = {
  publicKey: PublicKey;
};

export type TokenAmountInput = {
  mint: PublicKey;
  /** Raw on-chain amount (already scaled by decimals). */
  amount: BN;
  /** Optional override; resolved from mint account when omitted. */
  decimals?: number;
  /** Optional override; resolved from mint owner when omitted. */
  tokenProgram?: PublicKey;
};

export type CreatePoolFeeConfig = {
  /**
   * Starting fee in bps for the fee-time scheduler (e.g. 25 = 0.25%).
   * Defaults to 25.
   */
  startingFeeBps?: number;
  /**
   * Ending fee in bps after the schedule completes.
   * Defaults to `startingFeeBps` (flat fee schedule).
   */
  endingFeeBps?: number;
  /** Scheduler periods. Defaults to 0 (static fee). */
  numberOfPeriod?: number;
  /** Total schedule duration in seconds (timestamp activation) or slots. Defaults to 0. */
  totalDuration?: number;
  baseFeeMode?: BaseFeeMode;
  /** Dynamic fee base bps; set `null` to disable. Defaults to 25. */
  dynamicFeeBaseBps?: number | null;
  compoundingFeeBps?: number;
};

export type CreatePoolParams = {
  connection: Connection;
  payer: PublicKey;
  /** Defaults to `payer`. */
  creator?: PublicKey;
  tokenA: TokenAmountInput;
  tokenB: TokenAmountInput;
  /**
   * Initial price as human string: tokenB per 1 tokenA
   * (same units as Meteora `getSqrtPriceFromPrice`). Defaults to `"1"`.
   */
  initPrice?: string;
  /** Defaults to full range [MIN_SQRT_PRICE, MAX_SQRT_PRICE]. */
  sqrtMinPrice?: BN;
  sqrtMaxPrice?: BN;
  fee?: CreatePoolFeeConfig;
  activationType?: ActivationType;
  collectFeeMode?: CollectFeeMode;
  activationPoint?: BN | null;
  hasAlphaVault?: boolean;
  isLockLiquidity?: boolean;
  /**
   * Position NFT mint keypair. Generated when omitted — must co-sign the tx.
   */
  positionNft?: Keypair;
};

export type CreatePoolResult = {
  tx: Transaction;
  pool: PublicKey;
  position: PublicKey;
  /** Must sign the transaction alongside the payer. */
  positionNft: Keypair;
  liquidityDelta: BN;
  initSqrtPrice: BN;
  tokenAAmount: BN;
  tokenBAmount: BN;
  tokenADecimals: number;
  tokenBDecimals: number;
  tokenAProgram: PublicKey;
  tokenBProgram: PublicKey;
};

export type AddLiquidityMode =
  | {
      kind: 'new_position';
      /** Generated when omitted — must co-sign the tx. */
      positionNft?: Keypair;
    }
  | {
      kind: 'existing_position';
      /** Position NFT mint pubkey (not the position PDA). */
      positionNftMint: PublicKey;
    };

export type AddLiquidityParams = {
  connection: Connection;
  owner: PublicKey;
  pool: PublicKey;
  /**
   * Max deposit for token A and/or B. At least one must be > 0.
   * For `existing_position`, one side is the input and the other is derived
   * from `getDepositQuote` when only one side is provided.
   */
  maxAmountTokenA: BN;
  maxAmountTokenB: BN;
  /**
   * Which mint is the primary input when only one side is non-zero for an
   * existing position quote. Defaults to token A when both are set / A > 0.
   */
  isTokenA?: boolean;
  mode: AddLiquidityMode;
  /**
   * Slippage applied to amount thresholds as percent (e.g. 1 = 1%).
   * Defaults to 1. Thresholds = max * (1 + slippage/100) for deposits.
   */
  slippagePercent?: number;
};

export type AddLiquidityResult = {
  tx: Transaction;
  pool: PublicKey;
  position: PublicKey;
  positionNftMint: PublicKey;
  positionNftAccount: PublicKey;
  /** Present when a new position NFT was created — must co-sign. */
  positionNftKeypair: Keypair | null;
  liquidityDelta: BN;
  maxAmountTokenA: BN;
  maxAmountTokenB: BN;
  tokenAAmountThreshold: BN;
  tokenBAmountThreshold: BN;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
};
