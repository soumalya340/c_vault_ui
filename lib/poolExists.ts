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

export type PoolCheckResult = { ok: true } | { ok: false; message: string };

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
    return { ok: false, message: 'DirectUsdc route needs USDC as one leg of this pool.' };
  }
  if (route === 'ViaSol' && !hasSol) {
    return { ok: false, message: 'ViaSol route needs wSOL as one leg of this pool.' };
  }
  return { ok: true };
}

/**
 * Confirms a pool account exists, decodes as the selected venue, and (when a
 * route is passed) includes the mint that route requires. Mirrors the checks
 * `create_asset_handler` (asset_ops.rs) runs on-chain for DEX-priced assets,
 * but runs them client-side so a typo'd, wrong-venue, or wrong-route address
 * is caught before it costs a signature or a failed tx.
 *
 * Owner is checked before handing the account to the SDK parser — the SDK's
 * ParsableWhirlpool.parse only `console.error`s and returns null on a
 * mismatch, which Next.js's dev overlay surfaces as a scary "Console Error"
 * for what's actually just an expected "wrong venue selected" case.
 */
export async function checkPoolExists(
  connection: Connection,
  pool: PublicKey,
  kind: DexKindLabel,
  route?: AssetRoute,
  network: Network = 'mainnet',
): Promise<PoolCheckResult> {
  const accountInfo = await connection.getAccountInfo(pool);
  if (!accountInfo) {
    return { ok: false, message: 'No account found at this address.' };
  }

  let mintA: PublicKey;
  let mintB: PublicKey;

  if (kind === 'whirlpool') {
    if (!accountInfo.owner.equals(WHIRLPOOL_PROGRAM_ID)) {
      return { ok: false, message: 'Not a Whirlpool pool — check the address and DEX Type.' };
    }
    const parsed = ParsableWhirlpool.parse(pool, accountInfo);
    if (!parsed) {
      return { ok: false, message: 'Not a valid Whirlpool pool account.' };
    }
    mintA = parsed.tokenMintA;
    mintB = parsed.tokenMintB;
  } else {
    if (!accountInfo.owner.equals(DAMM_V2_PROGRAM_ID)) {
      return { ok: false, message: 'Not a DAMM v2 pool — check the address and DEX Type.' };
    }
    const cpAmm = new CpAmm(connection);
    try {
      const poolState = await cpAmm.fetchPoolState(pool);
      mintA = poolState.tokenAMint;
      mintB = poolState.tokenBMint;
    } catch {
      return { ok: false, message: 'Not a valid DAMM v2 pool account.' };
    }
  }

  if (!route) return { ok: true };
  return checkRouteMatch(mintA, mintB, route, NETWORK_CONSTANTS[network].usdcMint);
}

export async function assertPoolExists(
  connection: Connection,
  pool: PublicKey,
  kind: DexKindLabel,
  route?: AssetRoute,
  network: Network = 'mainnet',
): Promise<void> {
  const result = await checkPoolExists(connection, pool, kind, route, network);
  if (!result.ok) throw new Error(result.message);
}
