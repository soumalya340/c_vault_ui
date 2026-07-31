import { describe, it, expect } from 'vitest';
import {
  priceToFixedPoint,
  assetUsdValue,
  totalUsdcValue,
  sharePriceRaw,
  previewSharesToMint,
  previewUsdcOut,
  type PricedAsset,
} from '../navCalc';

describe('priceToFixedPoint', () => {
  it('scales a float price to PRICE_SCALE bigint units', () => {
    expect(priceToFixedPoint(1)).toBe(1_000_000_000n);
    // 147.4789340738336 * 1e9 = 147478934073.83362 in IEEE-754; Math.round → 074
    expect(priceToFixedPoint(147.4789340738336)).toBe(147478934074n);
  });

  it('rounds rather than truncates', () => {
    // 0.1 * 1e9 = 100000000 exactly in this case; pick a value that forces rounding
    expect(priceToFixedPoint(0.3333333335)).toBe(333333334n); // Math.round(333333333.5) = 333333334
  });
});

describe('assetUsdValue', () => {
  const usdcDecimals = 6;

  it('quote asset (USDC itself) counts its balance directly, ignoring price', () => {
    const usdc: PricedAsset = {
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      balanceRaw: 5_000_000n, // 5.00 USDC (6dp)
      decimals: 6,
      isQuoteAsset: true,
      priceScaled: null,
    };
    expect(assetUsdValue(usdc, usdcDecimals)).toBe(5_000_000n);
  });

  it('same-decimals asset: balance × price, scaled to USDC decimals', () => {
    // 10 tokens (6dp) @ $2.00 => $20.00 => 20_000_000 (6dp USDC)
    const asset: PricedAsset = {
      mint: 'SomeMint111111111111111111111111111111111',
      balanceRaw: 10_000_000n, // 10.0 @ 6dp
      decimals: 6,
      isQuoteAsset: false,
      priceScaled: priceToFixedPoint(2.0),
    };
    expect(assetUsdValue(asset, usdcDecimals)).toBe(20_000_000n);
  });

  it('higher-decimals asset (e.g. 9dp) converts correctly to 6dp USDC', () => {
    // 1 SOL (9dp) @ $150.00 => $150.00 => 150_000_000 (6dp USDC)
    const sol: PricedAsset = {
      mint: 'So11111111111111111111111111111111111111112',
      balanceRaw: 1_000_000_000n, // 1.0 @ 9dp
      decimals: 9,
      isQuoteAsset: false,
      priceScaled: priceToFixedPoint(150.0),
    };
    expect(assetUsdValue(sol, usdcDecimals)).toBe(150_000_000n);
  });

  it('zero balance contributes zero regardless of price', () => {
    const asset: PricedAsset = {
      mint: 'SomeMint111111111111111111111111111111111',
      balanceRaw: 0n,
      decimals: 6,
      isQuoteAsset: false,
      priceScaled: priceToFixedPoint(999.0),
    };
    expect(assetUsdValue(asset, usdcDecimals)).toBe(0n);
  });
});

describe('totalUsdcValue', () => {
  it('sums quote-asset balance and priced-asset values with no float drift', () => {
    const usdcDecimals = 6;
    const assets: PricedAsset[] = [
      {
        mint: 'usdc',
        balanceRaw: 1_000_000n, // $1
        decimals: 6,
        isQuoteAsset: true,
        priceScaled: null,
      },
      {
        mint: 'sol',
        balanceRaw: 2_000_000_000n, // 2 SOL @ 9dp
        decimals: 9,
        isQuoteAsset: false,
        priceScaled: priceToFixedPoint(150), // $150/SOL
      },
    ];
    // $1 + (2 * $150) = $301
    expect(totalUsdcValue(assets, usdcDecimals)).toBe(301_000_000n);
  });

  it('empty basket totals zero', () => {
    expect(totalUsdcValue([], 6)).toBe(0n);
  });
});

describe('sharePriceRaw', () => {
  it('computes PRICE_SCALE-denominated USDC-per-share', () => {
    // $301 total, 100 shares (6dp raw, matches USDC convention per bookSharePriceRaw)
    // share_price = 301_000_000 * 1e9 / 100_000_000 = 3_010_000_000 (i.e. $3.01/share)
    expect(sharePriceRaw(301_000_000n, 100_000_000n)).toBe(3_010_000_000n);
  });

  it('returns 0n when there are no shares outstanding (never divide by zero)', () => {
    expect(sharePriceRaw(301_000_000n, 0n)).toBe(0n);
  });
});

describe('preview formulas', () => {
  const price = priceToFixedPoint(2.0); // $2.00/share => 2_000_000_000n at PRICE_SCALE

  it('previewSharesToMint: usdc_in / share_price', () => {
    // 10 USDC in @ $2/share => 5 shares (in share raw units, 6dp convention)
    expect(previewSharesToMint(10_000_000n, price)).toBe(5_000_000n);
  });

  it('previewSharesToMint returns 0n when share price is unknown (0n)', () => {
    expect(previewSharesToMint(10_000_000n, 0n)).toBe(0n);
  });

  it('previewUsdcOut: shares_in × share_price', () => {
    // 5 shares out @ $2/share => 10 USDC
    expect(previewUsdcOut(5_000_000n, price)).toBe(10_000_000n);
  });
});
