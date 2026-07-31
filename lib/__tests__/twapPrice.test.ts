import { describe, it, expect } from 'vitest';
import { U64_MAX, usdPriceToQ64, TwapPriceRangeError } from '../twapPrice';

const Q64 = 1n << 64n;

describe('usdPriceToQ64', () => {
  it('converts a 6-decimal asset at $1.00 to exactly 2^64', () => {
    // raw-USDC-per-raw-asset = 1 * 10^6 / 10^6 = 1  ->  1 * 2^64
    // Note this is already u64 max + 1, so it must be rejected (see below).
    expect(() => usdPriceToQ64(1, 6)).toThrow(TwapPriceRangeError);
  });

  it('converts a 6-decimal asset at $0.50 to 2^63', () => {
    expect(usdPriceToQ64(0.5, 6)).toBe(Q64 / 2n);
  });

  it('converts a 9-decimal asset at $200 to 0.2 * 2^64', () => {
    // 200 * 10^6 / 10^9 = 0.2
    expect(usdPriceToQ64(200, 9)).toBe((Q64 * 2n) / 10n);
  });

  it('scales with asset decimals, not just price', () => {
    // Same USD price, different decimals -> different x64 (the trap that makes
    // hand-typed values wrong).
    expect(usdPriceToQ64(1, 9)).not.toBe(usdPriceToQ64(0.5, 6));
    expect(usdPriceToQ64(1, 9)).toBe(Q64 / 1000n);
  });

  it('keeps full precision for prices far beyond float-safe integers', () => {
    // 2^64 scale means the result exceeds Number.MAX_SAFE_INTEGER; the value
    // must be exact, which is only possible in bigint space.
    const v = usdPriceToQ64(0.25, 6);
    expect(v).toBe(Q64 / 4n);
    expect(v > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('rejects a value that overflows the on-chain u64 parameter', () => {
    // 6-decimal asset at $2.00 -> 2 * 2^64, far past u64 max.
    expect(() => usdPriceToQ64(2, 6)).toThrow(TwapPriceRangeError);
  });

  it('accepts the largest value that still fits u64', () => {
    const v = usdPriceToQ64(0.999999, 6);
    expect(v <= U64_MAX).toBe(true);
  });

  it('rejects non-finite or non-positive prices', () => {
    expect(() => usdPriceToQ64(0, 6)).toThrow();
    expect(() => usdPriceToQ64(-1, 6)).toThrow();
    expect(() => usdPriceToQ64(Number.NaN, 6)).toThrow();
    expect(() => usdPriceToQ64(Number.POSITIVE_INFINITY, 6)).toThrow();
  });

  it('rejects implausible decimals', () => {
    expect(() => usdPriceToQ64(1, -1)).toThrow();
    expect(() => usdPriceToQ64(1, 25)).toThrow();
  });
});
