/**
 * Partial-sign a VersionedTransaction with the TWAP keeper key.
 * Client should already have signed as fee payer (depositor); this only
 * fills the keeper signature slot and returns the bytes (does not broadcast).
 */

import { NextResponse } from 'next/server';
import { VersionedTransaction } from '@solana/web3.js';
import { loadTwapKeeperKeypair } from '@/lib/twap/keeper.server';
import { TWAP_KEEPER_PUBKEY } from '@/lib/constants';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { transaction?: string };
    if (!body.transaction || typeof body.transaction !== 'string') {
      return NextResponse.json(
        { error: 'Body must include base64 `transaction`' },
        { status: 400 },
      );
    }

    let keeper;
    try {
      keeper = loadTwapKeeperKeypair();
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 503 },
      );
    }

    if (!keeper.publicKey.equals(TWAP_KEEPER_PUBKEY)) {
      return NextResponse.json(
        { error: 'Keeper key mismatch with TWAP_KEEPER_PUBKEY' },
        { status: 500 },
      );
    }

    const tx = VersionedTransaction.deserialize(Buffer.from(body.transaction, 'base64'));
    // Only signs the keeper's required signature slot(s).
    tx.sign([keeper]);

    const transaction = Buffer.from(
      (tx as unknown as { serialize: (o?: object) => Uint8Array }).serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
    ).toString('base64');

    return NextResponse.json({
      transaction,
      keeper: keeper.publicKey.toBase58(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
