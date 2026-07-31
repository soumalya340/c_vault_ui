import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { resolveWatchAccounts } from '@/lib/realtime/watch-accounts';
import { pythFeedAccount, type VaultChainAsset, type VaultChainCtx } from '@/lib/cvault';
import { PRICE_SOURCE_DEX, SOL_USD_PYTH_FEED_ID } from '@/lib/constants';

const PRICE_SOURCE_PYTH = 0;
const DEX_KIND_WHIRLPOOL = 0;
const DEX_KIND_DAMM = 1;

/** Deterministic throwaway key so assertions are readable. */
function key(seed: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed)],
    new PublicKey('11111111111111111111111111111112'),
  )[0];
}

function asset(over: Partial<VaultChainAsset>): VaultChainAsset {
  return {
    assetId: 1,
    assetInfoPda: key('assetInfo'),
    mint: key('mint'),
    poolAddress: key('pool'),
    pythFeedId: new Array(32).fill(7),
    allocationBps: 10_000,
    decimals: 9,
    route: 'DirectUsdc',
    priceSourceTag: PRICE_SOURCE_PYTH,
    priceDexKind: DEX_KIND_DAMM,
    pricePoolAddress: key('pricePool'),
    swapKind: 'DammV2',
    tokenProgramTag: 0,
    vaultAssetAtaKey: key('ata'),
    ...over,
  } as VaultChainAsset;
}

function ctx(assets: VaultChainAsset[]): VaultChainCtx {
  return {
    vaultId: 1,
    vaultPda: key('vault'),
    vaultAuthority: key('authority'),
    sharesMint: key('shares'),
    usdcVault: key('usdcVault'),
    baseMint: key('base'),
    usdcSolPool: null,
    feeRecipient: key('fee'),
    numAssets: assets.length,
    assets,
  } as VaultChainCtx;
}

describe('resolveWatchAccounts', () => {
  it('always watches the vault account itself', () => {
    const c = ctx([asset({})]);
    expect(resolveWatchAccounts(c, new Map()).map(String)).toContain(
      c.vaultPda.toBase58(),
    );
  });

  it('watches each asset ATA', () => {
    const ata = key('ata-a');
    const result = resolveWatchAccounts(ctx([asset({ vaultAssetAtaKey: ata })]), new Map());
    expect(result.map(String)).toContain(ata.toBase58());
  });

  it('watches the pyth feed for a pyth-priced asset', () => {
    const feedId = new Array(32).fill(3);
    const result = resolveWatchAccounts(
      ctx([asset({ priceSourceTag: PRICE_SOURCE_PYTH, pythFeedId: feedId })]),
      new Map(),
    );
    expect(result.map(String)).toContain(pythFeedAccount(feedId).toBase58());
  });

  it('watches the pool for a DAMM DirectUsdc asset and adds no vaults', () => {
    const pool = key('damm-pool');
    const result = resolveWatchAccounts(
      ctx([
        asset({
          priceSourceTag: PRICE_SOURCE_DEX,
          priceDexKind: DEX_KIND_DAMM,
          route: 'DirectUsdc',
          pricePoolAddress: pool,
        }),
      ]),
      new Map(),
    );
    const strs = result.map(String);
    expect(strs).toContain(pool.toBase58());
    expect(strs).not.toContain(pythFeedAccount(SOL_USD_PYTH_FEED_ID).toBase58());
  });

  it('watches whirlpool token vaults when priceDexKind is 0', () => {
    const pool = key('whirl-pool');
    const vaultA = key('vault-a');
    const vaultB = key('vault-b');
    const result = resolveWatchAccounts(
      ctx([
        asset({
          priceSourceTag: PRICE_SOURCE_DEX,
          priceDexKind: DEX_KIND_WHIRLPOOL,
          pricePoolAddress: pool,
        }),
      ]),
      new Map([[pool.toBase58(), [vaultA, vaultB] as [PublicKey, PublicKey]]]),
    );
    const strs = result.map(String);
    expect(strs).toContain(pool.toBase58());
    expect(strs).toContain(vaultA.toBase58());
    expect(strs).toContain(vaultB.toBase58());
  });

  it('adds the SOL/USD feed once for ViaSol assets', () => {
    const result = resolveWatchAccounts(
      ctx([
        asset({
          assetId: 1,
          priceSourceTag: PRICE_SOURCE_DEX,
          priceDexKind: DEX_KIND_DAMM,
          route: 'ViaSol',
          pricePoolAddress: key('p1'),
          vaultAssetAtaKey: key('ata1'),
        }),
        asset({
          assetId: 2,
          priceSourceTag: PRICE_SOURCE_DEX,
          priceDexKind: DEX_KIND_DAMM,
          route: 'ViaSol',
          pricePoolAddress: key('p2'),
          vaultAssetAtaKey: key('ata2'),
        }),
      ]),
      new Map(),
    );
    const solFeed = pythFeedAccount(SOL_USD_PYTH_FEED_ID).toBase58();
    expect(result.map(String).filter((k) => k === solFeed)).toHaveLength(1);
  });

  it('returns no duplicates', () => {
    const shared = key('shared-ata');
    const result = resolveWatchAccounts(
      ctx([
        asset({ assetId: 1, vaultAssetAtaKey: shared }),
        asset({ assetId: 2, vaultAssetAtaKey: shared }),
      ]),
      new Map(),
    );
    const strs = result.map(String);
    expect(new Set(strs).size).toBe(strs.length);
  });

  it('ignores assets beyond numAssets', () => {
    const c = ctx([asset({ assetId: 1 }), asset({ assetId: 2, vaultAssetAtaKey: key('extra') })]);
    c.numAssets = 1;
    expect(resolveWatchAccounts(c, new Map()).map(String)).not.toContain(
      key('extra').toBase58(),
    );
  });
});
