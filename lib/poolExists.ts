import { Connection, PublicKey } from '@solana/web3.js';
import { ParsableWhirlpool } from '@orca-so/whirlpools-sdk';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import {
  WHIRLPOOL_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  WSOL_MINT,
  NETWORK_CONSTANTS,
  type Network,
} from './constants';
import type { AssetRoute } from './cvault';

export type DexKindLabel = 'whirlpool' | 'dammV2';

export type PoolCheckResult =
  | {
      ok: true;
      venue: DexKindLabel;
      mintA: string;
      mintB: string;
      /** Short label for UI (which SDK decoded the pool). */
      source: 'orca-whirlpools-sdk' | 'meteora-cp-amm-sdk';
    }
  | { ok: false; message: string };

/** DirectUsdc pools must include USDC; ViaSol swap pools must include wSOL —
 *  mirrors `require_pool_matches_route` (fetch_dex_price.rs). Pure altcoin–
 *  altcoin pairs are rejected on both routes, same as on-chain. */
function checkRouteMatch(
  mintA: PublicKey,
  mintB: PublicKey,
  route: AssetRoute,
  usdcMint: PublicKey,
): PoolCheckResult {
  const hasUsdc = mintA.equals(usdcMint) || mintB.equals(usdcMint);
  const hasSol = mintA.equals(WSOL_MINT) || mintB.equals(WSOL_MINT);

  if (!hasUsdc && !hasSol) {
    return { ok: false, message: 'Pool must include USDC or wSOL as one leg.' };
  }
  if (route === 'DirectUsdc' && !hasUsdc) {
    return {
      ok: false,
      message: `DirectUsdc route needs the network USDC mint (${usdcMint.toBase58().slice(0, 8)}…) as one leg of this pool.`,
    };
  }
  if (route === 'ViaSol' && !hasSol) {
    return { ok: false, message: 'ViaSol route needs wSOL as one leg of this pool.' };
  }
  // Satisfies the union only when ok — callers ignore success fields here.
  return {
    ok: true,
    venue: 'whirlpool',
    mintA: mintA.toBase58(),
    mintB: mintB.toBase58(),
    source: 'orca-whirlpools-sdk',
  };
}

/**
 * Swap (+ DEX pricing) requires the pool pair to be exactly
 * `{asset mint, quote mint}` — quote is wSOL (ViaSol) or USDC (DirectUsdc).
 */
function checkAssetIsPoolLeg(
  mintA: PublicKey,
  mintB: PublicKey,
  assetMint: PublicKey,
  route: AssetRoute,
  usdcMint: PublicKey,
): PoolCheckResult {
  const quote = route === 'ViaSol' ? WSOL_MINT : usdcMint;
  const hasAsset = mintA.equals(assetMint) || mintB.equals(assetMint);
  const hasQuote = mintA.equals(quote) || mintB.equals(quote);

  if (!hasAsset) {
    return {
      ok: false,
      message:
        `Pool mints are not this asset. Pool legs: ${mintA.toBase58().slice(0, 8)}… / ${mintB.toBase58().slice(0, 8)}… — ` +
        `expected the asset mint (${assetMint.toBase58().slice(0, 8)}…) as one leg and ` +
        `${route === 'ViaSol' ? 'wSOL' : 'USDC'} as the other.`,
    };
  }
  if (!hasQuote) {
    return {
      ok: false,
      message:
        route === 'ViaSol'
          ? 'ViaSol needs an asset/wSOL pool (not asset/USDC only).'
          : 'DirectUsdc needs an asset/USDC pool for this network.',
    };
  }
  const other = mintA.equals(assetMint) ? mintB : mintA;
  if (!other.equals(quote)) {
    return {
      ok: false,
      message:
        `Pool other leg is ${other.toBase58().slice(0, 8)}… — for ${route} it must be ` +
        `${route === 'ViaSol' ? 'wSOL' : 'this network’s USDC'}.`,
    };
  }
  return {
    ok: true,
    venue: 'whirlpool',
    mintA: mintA.toBase58(),
    mintB: mintB.toBase58(),
    source: 'orca-whirlpools-sdk',
  };
}

/**
 * Confirms a pool account exists and decodes via:
 *   - Whirlpool → `@orca-so/whirlpools-sdk` (`ParsableWhirlpool`)
 *   - DAMM v2   → `@meteora-ag/cp-amm-sdk` (`CpAmm.isPoolExist` + `fetchPoolState`)
 *
 * When `route` is set, checks the quote leg. When `assetMint` is set (Create
 * asset), also requires the pool to be exactly asset + quote.
 */
export async function checkPoolExists(
  connection: Connection,
  pool: PublicKey,
  kind: DexKindLabel,
  route?: AssetRoute,
  network: Network = 'mainnet',
  assetMint?: PublicKey,
): Promise<PoolCheckResult> {
  const accountInfo = await connection.getAccountInfo(pool);
  if (!accountInfo) {
    return { ok: false, message: 'No account found at this address.' };
  }

  let mintA: PublicKey;
  let mintB: PublicKey;
  let source: 'orca-whirlpools-sdk' | 'meteora-cp-amm-sdk';

  if (kind === 'whirlpool') {
    if (!accountInfo.owner.equals(WHIRLPOOL_PROGRAM_ID)) {
      return {
        ok: false,
        message:
          'Not an Orca Whirlpool — owner is not whirLbMi…. Pick DEX Type = Whirlpool only for Whirlpool pools.',
      };
    }
    // Owner-checked first: ParsableWhirlpool.parse only console.errors on mismatch.
    const parsed = ParsableWhirlpool.parse(pool, accountInfo);
    if (!parsed) {
      return { ok: false, message: 'Not a valid Whirlpool pool account (Orca SDK parse failed).' };
    }
    mintA = parsed.tokenMintA;
    mintB = parsed.tokenMintB;
    source = 'orca-whirlpools-sdk';
  } else {
    if (!accountInfo.owner.equals(DAMM_V2_PROGRAM_ID)) {
      return {
        ok: false,
        message:
          'Not a Meteora DAMM v2 pool — owner is not cpamdp…. Pick DEX Type = DammV2 only for DAMM v2 pools.',
      };
    }
    const cpAmm = new CpAmm(connection);
    const exists = await cpAmm.isPoolExist(pool);
    if (!exists) {
      return { ok: false, message: 'DAMM v2 pool does not exist (Meteora CpAmm.isPoolExist).' };
    }
    try {
      const poolState = await cpAmm.fetchPoolState(pool);
      mintA = poolState.tokenAMint;
      mintB = poolState.tokenBMint;
    } catch (err) {
      return {
        ok: false,
        message: `Not a valid DAMM v2 pool (Meteora fetchPoolState): ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    source = 'meteora-cp-amm-sdk';
  }

  const success = (): PoolCheckResult => ({
    ok: true,
    venue: kind,
    mintA: mintA.toBase58(),
    mintB: mintB.toBase58(),
    source,
  });

  if (!route) return success();

  const usdcMint = NETWORK_CONSTANTS[network].usdcMint;
  const routeCheck = checkRouteMatch(mintA, mintB, route, usdcMint);
  if (!routeCheck.ok) return routeCheck;

  if (assetMint) {
    const leg = checkAssetIsPoolLeg(mintA, mintB, assetMint, route, usdcMint);
    if (!leg.ok) return leg;
  }

  return success();
}

export async function assertPoolExists(
  connection: Connection,
  pool: PublicKey,
  kind: DexKindLabel,
  route?: AssetRoute,
  network: Network = 'mainnet',
  assetMint?: PublicKey,
): Promise<void> {
  const result = await checkPoolExists(connection, pool, kind, route, network, assetMint);
  if (!result.ok) throw new Error(result.message);
}
