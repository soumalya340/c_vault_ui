/**
 * Q64.64 price conversion for the DEX TWAP keeper (`update_dex_twap`).
 *
 * The on-chain TWAP does not store a USD price. `sum_nav` prices DEX assets in
 * **raw-USDC-per-raw-asset, Q64.64 fixed point** — see
 * `programs/vault/src/pricing/fetch_dex_price.rs` (`price_asset_in_quote_x64`,
 * "Q64.64 raw quote units per raw asset unit"). `update_dex_twap` feeds its
 * `twap_live_state` straight into `TwapState::record_observation`, so the
 * keeper must supply a value in exactly that scale.
 *
 * Two properties make this value impossible to enter by hand, which is why it
 * is derived here rather than typed into the console:
 *
 * 1. It folds in the asset's decimals, not just its price. A $200 9-decimal
 *    asset is a *smaller* x64 number than a $1 6-decimal one.
 * 2. It is ~1.8e19 at the top of its range — past `Number.MAX_SAFE_INTEGER`
 *    (9.0e15), so a JS `number` silently loses precision before the value ever
 *    reaches a BN. All math here stays in bigint.
 */

/** Q64.64 scale factor: 2^64. */
const Q64 = 1n << 64n;

/** Largest value the on-chain `twap_live_state: u64` parameter can carry. */
export const U64_MAX = (1n << 64n) - 1n;

/**
 * Decimal places kept when turning the float price from Jupiter into integer
 * space. Well beyond any real quote's significance, so it never truncates a
 * meaningful digit.
 */
const PRICE_PRECISION = 12;

/**
 * Thrown when a correct Q64.64 price does not fit the on-chain `u64`
 * parameter. This is a limitation of the `update_dex_twap` signature
 * (`twap_live_state: u64`) while `TwapState::last_price_x64` is `u128` — an
 * asset whose raw-USDC-per-raw-asset ratio is >= 1.0 cannot be expressed.
 * In practice that means a 6-decimal asset priced at or above ~$1.00.
 */
export class TwapPriceRangeError extends Error {
  constructor(
    readonly value: bigint,
    readonly usdPrice: number,
    readonly decimals: number,
  ) {
    super(
      `Q64.64 price ${value} exceeds the u64 max (${U64_MAX}) that update_dex_twap accepts. ` +
        `A ${decimals}-decimal asset at $${usdPrice} has a raw-USDC-per-raw-asset ratio >= 1.0. ` +
        'Widening `twap_live_state` to u128 on-chain is required to price this asset.',
    );
    this.name = 'TwapPriceRangeError';
  }
}

/** USDC is the quote leg; its 6 decimals set the numerator scale. */
const USDC_DECIMALS = 6;

/**
 * Convert a USD price into the Q64.64 raw-USDC-per-raw-asset value that
 * `update_dex_twap` expects.
 *
 * `ratio = usdPrice * 10^USDC_DECIMALS / 10^assetDecimals`, then `* 2^64`.
 * Computed entirely in bigint so the result is exact.
 *
 * @throws {TwapPriceRangeError} when the result overflows the on-chain u64.
 */
export function usdPriceToQ64(usdPrice: number, assetDecimals: number): bigint {
  if (!Number.isFinite(usdPrice) || usdPrice <= 0) {
    throw new Error(`Invalid USD price: ${usdPrice}. Expected a finite positive number.`);
  }
  if (!Number.isInteger(assetDecimals) || assetDecimals < 0 || assetDecimals > 24) {
    throw new Error(`Invalid asset decimals: ${assetDecimals}. Expected an integer in 0..24.`);
  }

  // Move the price into integer space before any bigint work — toFixed avoids
  // the float artefacts a naive `usdPrice * 10 ** PRICE_PRECISION` would leave.
  const priceScaled = BigInt(usdPrice.toFixed(PRICE_PRECISION).replace('.', ''));
  const priceDenom = 10n ** BigInt(PRICE_PRECISION);

  // x64 = usdPrice * 10^6 / 10^assetDecimals * 2^64, kept exact by multiplying
  // through before the single trailing division.
  const numerator = priceScaled * 10n ** BigInt(USDC_DECIMALS) * Q64;
  const denominator = priceDenom * 10n ** BigInt(assetDecimals);
  const value = numerator / denominator;

  if (value <= 0n) {
    throw new Error(
      `USD price $${usdPrice} for a ${assetDecimals}-decimal asset rounds to zero in Q64.64.`,
    );
  }
  if (value > U64_MAX) {
    throw new TwapPriceRangeError(value, usdPrice, assetDecimals);
  }
  return value;
}

/**
 * Human-readable check line for the console, so the keeper can eyeball what is
 * about to be pushed instead of trusting an opaque 19-digit integer.
 */
export function describeQ64Price(
  usdPrice: number,
  assetDecimals: number,
  value: bigint,
): string {
  return `$${usdPrice} · ${assetDecimals}-dec → ${value.toString()} (Q64.64)`;
}
