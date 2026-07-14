/**
 * Server-only TWAP keeper key material.
 * Never import this from client components.
 */

import 'server-only';
import fs from 'fs';
import path from 'path';
import { Keypair } from '@solana/web3.js';
import { TWAP_KEEPER_PUBKEY } from '../constants';

/**
 * Load the keeper keypair.
 * 1. `TWAP_KEEPER_SECRET` — JSON array of 64 secret bytes (preferred)
 * 2. Monorepo fallback: `../c_vault_script/DExJYX….json` (localhost dev)
 */
export function loadTwapKeeperKeypair(): Keypair {
  const fromEnv = process.env.TWAP_KEEPER_SECRET?.trim();
  if (fromEnv) {
    let arr: number[];
    try {
      arr = JSON.parse(fromEnv) as number[];
    } catch {
      throw new Error('TWAP_KEEPER_SECRET must be a JSON array of 64 secret-key bytes');
    }
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error('TWAP_KEEPER_SECRET must be a 64-byte secret key array');
    }
    const kp = Keypair.fromSecretKey(Uint8Array.from(arr));
    assertMatchesConstant(kp);
    return kp;
  }

  const monorepoPath = path.resolve(
    process.cwd(),
    '../c_vault_script/DExJYXEqEGCzbsN93FeeoQu6cQZkuEB8PBEn64GJKt7W.json',
  );
  if (fs.existsSync(monorepoPath)) {
    const arr = JSON.parse(fs.readFileSync(monorepoPath, 'utf8')) as number[];
    const kp = Keypair.fromSecretKey(Uint8Array.from(arr));
    assertMatchesConstant(kp);
    return kp;
  }

  throw new Error(
    'TWAP keeper not configured. Set TWAP_KEEPER_SECRET (JSON byte array) or place ' +
      'c_vault_script/DExJYXEqEGCzbsN93FeeoQu6cQZkuEB8PBEn64GJKt7W.json next to c_vault_ui.',
  );
}

function assertMatchesConstant(kp: Keypair): void {
  if (!kp.publicKey.equals(TWAP_KEEPER_PUBKEY)) {
    throw new Error(
      `TWAP keeper secret pubkey ${kp.publicKey.toBase58()} != TWAP_KEEPER_PUBKEY ${TWAP_KEEPER_PUBKEY.toBase58()}`,
    );
  }
}
