/**
 * Pure NAV aggregation math — no network calls, no RPC, no Anchor. Kept
 * separate from lib/cvault.tsx so the formula is independently testable and
 * has one obvious place to look when a NAV number looks wrong.
 *
 * All money math here is bigint. Jupiter's price is the one place a float
 * enters (usdPrice from their API) — priceToFixedPoint converts it to a
 * PRICE_SCALE-denominated bigint immediately, and every calculation after
 * that point is exact integer arithmetic. This mirrors the rest of the
 * codebase's convention (see lib/cvault.tsx bookSharePriceRaw, parseUnits,
 * formatUnits) of never doing float math on money.
 */

/** Matches PRICE_SCALE (1e9) in lib/constants.ts, redeclared as bigint so
 *  this module has no import dependency on that file. */
export const PRICE_SCALE_BIGINT = 1_000_000_000n;

/** Converts a Jupiter Price API `usdPrice` float into a PRICE_SCALE-denominated
 *  bigint. This is the only place a float is read in this module. */
export function priceToFixedPoint(usdPrice: number): bigint {
  return BigInt(Math.round(usdPrice * 1e9));
}

/** One vault-held asset with its (possibly null, for the quote asset) price. */
export interface AssetHolding {
  mint: string;
  /** Raw balance in the asset's own decimals (vault ATA balance). */
  balanceRaw: bigint;
  decimals: number;
  /** True for the vault's USDC holding — skip pricing, count balance as-is. */
  isQuoteAsset: boolean;
}

export interface PricedAsset extends AssetHolding {
  /** PRICE_SCALE-denominated USD price; null only when isQuoteAsset is true. */
  priceScaled: bigint | null;
}

/**
 * One asset's contribution to total NAV, in USDC base units.
 *
 * assetValueUsdc = balanceRaw * priceScaled / 10^(decimals + PRICE_SCALE_exp - usdcDecimals)
 * where PRICE_SCALE_exp = 9 (PRICE_SCALE = 1e9).
 */
export function assetUsdValue(asset: PricedAsset, usdcDecimals: number): bigint {
  if (asset.balanceRaw === 0n) return 0n;
  if (asset.isQuoteAsset) return asset.balanceRaw;
  if (asset.priceScaled === null) {
    throw new Error(`Asset ${asset.mint} has a nonzero balance but no price.`);
  }
  const scaleExponent = asset.decimals + 9 - usdcDecimals;
  if (scaleExponent >= 0) {
    return (asset.balanceRaw * asset.priceScaled) / 10n ** BigInt(scaleExponent);
  }
  // Only reachable if usdcDecimals > asset.decimals + 9, which never happens
  // for any real token/USDC decimal pair — kept for completeness/safety.
  return asset.balanceRaw * asset.priceScaled * 10n ** BigInt(-scaleExponent);
}

/** Sums `assetUsdValue` across every basket asset. */
export function totalUsdcValue(assets: PricedAsset[], usdcDecimals: number): bigint {
  let total = 0n;
  for (const asset of assets) {
    total += assetUsdValue(asset, usdcDecimals);
  }
  return total;
}

/** USDC-per-share, PRICE_SCALE-denominated. 0n when there are no shares yet. */
export function sharePriceRaw(totalUsdcValueRaw: bigint, totalShares: bigint): bigint {
  if (totalShares <= 0n) return 0n;
  return (totalUsdcValueRaw * PRICE_SCALE_BIGINT) / totalShares;
}

/** Estimated shares minted for a given USDC deposit, at the current share price. */
export function previewSharesToMint(usdcInRaw: bigint, sharePriceRawValue: bigint): bigint {
  if (sharePriceRawValue <= 0n) return 0n;
  return (usdcInRaw * PRICE_SCALE_BIGINT) / sharePriceRawValue;
}

/** Estimated USDC out for a given share redemption, at the current share price. */
export function previewUsdcOut(sharesInRaw: bigint, sharePriceRawValue: bigint): bigint {
  return (sharesInRaw * sharePriceRawValue) / PRICE_SCALE_BIGINT;
}
