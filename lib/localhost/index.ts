/**
 * Localhost / Surfpool-only helpers.
 *
 * Keep all validator cheatcodes and synthetic oracle rewrites here so mainnet
 * paths never depend on them. Call `ensureLocalhostSwapPreflight` before any
 * deposit / preview / redeem / NAV that reads Pyth or swaps on Whirlpool.
 */

export { surfnetRpc, isSurfnetFail } from './surfnet';
export {
  ensureFreshPythFeeds,
  setPythFeed,
  solUiPriceFromPool,
  sqrtPriceToUi,
  buildPriceUpdateV2Data,
  PYTH_RECEIVER_PROGRAM_ID,
  type PythRefreshAsset,
  type PythRefreshResult,
} from './pyth';
export {
  ensureWhirlpoolClock,
  WHIRLPOOL_REWARD_TS_OFFSET,
  type WhirlpoolClockAsset,
  type WhirlpoolClockResult,
} from './whirlpool-clock';
export {
  ensureLocalhostSwapPreflight,
  type LocalhostPreflightCtx,
  type LocalhostPreflightResult,
  type ProgressFn,
} from './preflight';
