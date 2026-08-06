import { PublicKey } from '@solana/web3.js';
import {
  C_VAULT_PROGRAM_ID,
  NETWORK_CONSTANTS,
  GLOBAL_STATE_SEED,
  ASSET_SEED,
  VAULT_SEED,
  VAULT_AUTHORITY_SEED,
  SHARES_MINT_SEED,
  USDC_VAULT_SEED,
  REDEEM_SEED,
  REDEEM_USDC_SEED,
  type Network,
} from '../constants';

export function vaultIdBuf(vaultId: number): Buffer {
  const arr = new Uint8Array(8);
  new DataView(arr.buffer).setBigUint64(0, BigInt(vaultId), true);
  return Buffer.from(arr);
}

export function deriveGlobalStatePda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [GLOBAL_STATE_SEED],
    C_VAULT_PROGRAM_ID,
  );
  return pda;
}

/** AssetInfo PDA `["asset", asset_id u64 LE]` — one per admin-listed asset. */
export function deriveAssetInfoPda(assetId: number | bigint): PublicKey {
  const arr = new Uint8Array(8);
  new DataView(arr.buffer).setBigUint64(0, BigInt(assetId), true);
  const [pda] = PublicKey.findProgramAddressSync(
    [ASSET_SEED, Buffer.from(arr)],
    C_VAULT_PROGRAM_ID,
  );
  return pda;
}

export interface VaultPdas {
  vaultPda: PublicKey;
  vaultAuthority: PublicKey;
  sharesMint: PublicKey;
  usdcVault: PublicKey;
}

/**
 * PDAs use C_VAULT_PROGRAM_ID (matches IDL / on-chain declare_id).
 * usdc_vault is also seeded with the network USDC mint — pass `network` (or
 * an explicit `usdcMint`) so PDAs match the cluster's quote mint.
 */
export function deriveVaultPdas(
  vaultId: number,
  network: Network = 'mainnet',
  usdcMint: PublicKey = NETWORK_CONSTANTS[network].usdcMint,
): VaultPdas {
  const idBuf = vaultIdBuf(vaultId);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, idBuf],
    C_VAULT_PROGRAM_ID,
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [VAULT_AUTHORITY_SEED, idBuf],
    C_VAULT_PROGRAM_ID,
  );
  const [sharesMint] = PublicKey.findProgramAddressSync(
    [SHARES_MINT_SEED, idBuf],
    C_VAULT_PROGRAM_ID,
  );
  const [usdcVault] = PublicKey.findProgramAddressSync(
    [USDC_VAULT_SEED, usdcMint.toBuffer(), idBuf],
    C_VAULT_PROGRAM_ID,
  );
  return { vaultPda, vaultAuthority, sharesMint, usdcVault };
}

export function deriveRedeemStatePda(user: PublicKey, vaultId: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [REDEEM_SEED, user.toBuffer(), vaultIdBuf(vaultId)],
    C_VAULT_PROGRAM_ID,
  );
  return pda;
}

/**
 * Per-redeem USDC escrow token account PDA
 * `seeds = ["redeem_usdc", user, vault_id]` — authority = RedeemState PDA.
 * Not an ATA; created `init_if_needed` in `request_redeem`.
 */
export function deriveRedeemUsdcPda(user: PublicKey, vaultId: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [REDEEM_USDC_SEED, user.toBuffer(), vaultIdBuf(vaultId)],
    C_VAULT_PROGRAM_ID,
  );
  return pda;
}
