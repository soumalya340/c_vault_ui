import { PublicKey } from '@solana/web3.js';
import {
  NETWORK_CONSTANTS,
  GLOBAL_STATE_SEED,
  ASSET_SEED,
  VAULT_SEED,
  VAULT_AUTHORITY_SEED,
  SHARES_MINT_SEED,
  USDC_VAULT_SEED,
  USER_INFO_SEED,
  REDEEM_SEED,
  type Network,
} from './constants';

export function vaultIdBuf(vaultId: number): Buffer {
  const arr = new Uint8Array(8);
  new DataView(arr.buffer).setBigUint64(0, BigInt(vaultId), true);
  return Buffer.from(arr);
}

export function deriveGlobalStatePda(network: Network = 'mainnet'): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [GLOBAL_STATE_SEED],
    NETWORK_CONSTANTS[network].programId,
  );
  return pda;
}

/** AssetInfo PDA `["asset", asset_id u64 LE]` — one per admin-listed asset. */
export function deriveAssetInfoPda(assetId: number | bigint, network: Network = 'mainnet'): PublicKey {
  const arr = new Uint8Array(8);
  new DataView(arr.buffer).setBigUint64(0, BigInt(assetId), true);
  const [pda] = PublicKey.findProgramAddressSync(
    [ASSET_SEED, Buffer.from(arr)],
    NETWORK_CONSTANTS[network].programId,
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
 * The usdc_vault PDA is seeded with the USDC mint, which differs per network
 * deployment; pass `usdcMint` explicitly to override the network default.
 */
export function deriveVaultPdas(
  vaultId: number,
  network: Network = 'mainnet',
  usdcMint: PublicKey = NETWORK_CONSTANTS[network].usdcMint,
): VaultPdas {
  const programId = NETWORK_CONSTANTS[network].programId;
  const idBuf = vaultIdBuf(vaultId);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, idBuf],
    programId,
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [VAULT_AUTHORITY_SEED, idBuf],
    programId,
  );
  const [sharesMint] = PublicKey.findProgramAddressSync(
    [SHARES_MINT_SEED, idBuf],
    programId,
  );
  const [usdcVault] = PublicKey.findProgramAddressSync(
    [USDC_VAULT_SEED, usdcMint.toBuffer(), idBuf],
    programId,
  );
  return { vaultPda, vaultAuthority, sharesMint, usdcVault };
}

export function deriveUserInfoPda(vaultPda: PublicKey, user: PublicKey, network: Network = 'mainnet'): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [USER_INFO_SEED, vaultPda.toBuffer(), user.toBuffer()],
    NETWORK_CONSTANTS[network].programId,
  );
  return pda;
}

export function deriveRedeemStatePda(user: PublicKey, vaultId: number, network: Network = 'mainnet'): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [REDEEM_SEED, user.toBuffer(), vaultIdBuf(vaultId)],
    NETWORK_CONSTANTS[network].programId,
  );
  return pda;
}
