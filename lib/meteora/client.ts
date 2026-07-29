import { Connection } from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';

/**
 * Shared DAMM v2 client. Program id is the same on devnet and mainnet
 * (`cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`).
 */
export function getCpAmm(connection: Connection): CpAmm {
  return new CpAmm(connection);
}
