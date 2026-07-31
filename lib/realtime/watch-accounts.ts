import { PublicKey } from '@solana/web3.js';
import { pythFeedAccount, type VaultChainCtx } from '@/lib/cvault';
import { PRICE_SOURCE_DEX, SOL_USD_PYTH_FEED_ID } from '@/lib/constants';

/** Whirlpool pricing reads the two token vaults; `priceDexKind === 0`. */
const DEX_KIND_WHIRLPOOL = 0;

/**
 * Every account whose change can move a vault's NAV, deduplicated.
 *
 * Mirrors the price block of `navRemainingAccounts` (`lib/cvault.tsx:449`)
 * plus the balance and share-supply inputs `sum_nav` reads
 * (`nav_view.rs:72,85,90`). If that stride changes on-chain, this must change
 * with it — `__tests__/watch-accounts.test.ts` pins each pricing shape.
 *
 * `whirlpoolVaults` maps pool address (base58) → [tokenVaultA, tokenVaultB].
 * It is passed in rather than fetched so this stays pure and testable; the
 * caller (`nav-room.ts`) pre-fetches via `fetchPoolCtx`. A Whirlpool asset
 * whose vaults are absent from the map contributes only its pool — the room
 * still recomputes, just on a slightly coarser trigger.
 */
export function resolveWatchAccounts(
  ctx: VaultChainCtx,
  whirlpoolVaults: Map<string, [PublicKey, PublicKey]>,
): PublicKey[] {
  const seen = new Set<string>();
  const out: PublicKey[] = [];

  const push = (key: PublicKey) => {
    const s = key.toBase58();
    if (seen.has(s)) return;
    seen.add(s);
    out.push(key);
  };

  // total_shares / reserved_assets / total_pending_usdc all feed the result.
  push(ctx.vaultPda);

  for (const asset of ctx.assets.slice(0, ctx.numAssets)) {
    push(asset.vaultAssetAtaKey);

    if (asset.priceSourceTag === PRICE_SOURCE_DEX) {
      push(asset.pricePoolAddress);
      if (asset.priceDexKind === DEX_KIND_WHIRLPOOL) {
        const vaults = whirlpoolVaults.get(asset.pricePoolAddress.toBase58());
        if (vaults) {
          push(vaults[0]);
          push(vaults[1]);
        }
      }
      // token×SOL → USD needs the SOL/USD feed (calculate_nav.rs).
      if (asset.route === 'ViaSol') push(pythFeedAccount(SOL_USD_PYTH_FEED_ID));
    } else {
      push(pythFeedAccount(asset.pythFeedId));
    }
  }

  return out;
}
