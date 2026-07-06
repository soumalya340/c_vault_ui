import { PublicKey } from '@solana/web3.js';
import {
  C_VAULT_PROGRAM_ID,
  GLOBAL_STATE_SEED,
  VAULT_SEED,
  VAULT_AUTHORITY_SEED,
  SHARES_MINT_SEED,
  USDC_VAULT_SEED,
  USER_INFO_SEED,
  REDEEM_SEED,
  USDC_MINT,
} from './constants';

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

export interface VaultPdas {
  vaultPda: PublicKey;
  vaultAuthority: PublicKey;
  sharesMint: PublicKey;
  usdcVault: PublicKey;
}

/**
 * The usdc_vault PDA is seeded with the vault's base mint — pass the actual
 * base mint for vaults not denominated in mainnet USDC (e.g. forge mock USDC
 * on devnet).
 */
export function deriveVaultPdas(vaultId: number, baseMint: PublicKey = USDC_MINT): VaultPdas {
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
    [USDC_VAULT_SEED, baseMint.toBuffer(), idBuf],
    C_VAULT_PROGRAM_ID,
  );
  return { vaultPda, vaultAuthority, sharesMint, usdcVault };
}

export function deriveUserInfoPda(vaultPda: PublicKey, user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [USER_INFO_SEED, vaultPda.toBuffer(), user.toBuffer()],
    C_VAULT_PROGRAM_ID,
  );
  return pda;
}

export function deriveRedeemStatePda(user: PublicKey, vaultId: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [REDEEM_SEED, user.toBuffer(), vaultIdBuf(vaultId)],
    C_VAULT_PROGRAM_ID,
  );
  return pda;
}
