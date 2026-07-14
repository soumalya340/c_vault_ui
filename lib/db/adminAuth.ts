import "server-only";
import nacl from "tweetnacl";
import { ADMIN_PUBKEY } from "@/lib/constants";

const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/**
 * Verifies a `wallet.signMessage` signature over
 * `cvault-admin:clear:<network>:<unix-ms>` was produced by ADMIN_PUBKEY and
 * is fresh. Throws on any failure — callers should map to a 401.
 */
export function verifyAdminSignature({
  network,
  message,
  signature,
}: {
  network: string;
  message: string;
  signature: string; // base64
}): void {
  const match = message.match(/^cvault-admin:clear:(localhost|mainnet):(\d+)$/);
  if (!match) {
    throw new Error("Malformed admin signature message.");
  }
  const [, msgNetwork, tsRaw] = match;
  if (msgNetwork !== network) {
    throw new Error("Signed message network does not match request network.");
  }
  const timestamp = Number(tsRaw);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > FRESHNESS_WINDOW_MS) {
    throw new Error("Admin signature has expired — try again.");
  }

  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = Buffer.from(signature, "base64");
  const verified = nacl.sign.detached.verify(
    messageBytes,
    signatureBytes,
    ADMIN_PUBKEY.toBytes(),
  );
  if (!verified) {
    throw new Error("Invalid admin signature.");
  }
}
