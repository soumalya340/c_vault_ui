import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from "@solana/spl-token";

export async function wrapSol(
  connection: Connection,
  payer: Keypair,
  amountInSol: number,
) {
  const lamports = amountInSol * LAMPORTS_PER_SOL;

  // 1. Get the Associated Token Account (ATA) address for WSOL
  const wsolAddress = await getAssociatedTokenAddress(
    NATIVE_MINT,
    payer.publicKey,
  );

  const transaction = new Transaction();

  // 2. Check if the WSOL account already exists.
  // If it doesn't, add the instruction to create it.
  const accountInfo = await connection.getAccountInfo(wsolAddress);
  if (!accountInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey, // Payer of the initialization fees
        wsolAddress, // The ATA address being created
        payer.publicKey, // Owner of the new token account
        NATIVE_MINT, // WSOL Mint address
      ),
    );
  }

  // 3. Transfer native SOL to the WSOL account
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wsolAddress,
      lamports: lamports,
    }),
  );

  // 4. Sync the native balance to reflect the newly deposited SOL as WSOL
  transaction.add(createSyncNativeInstruction(wsolAddress));

  // 5. Send and confirm the transaction
  try {
    const signature = await sendAndConfirmTransaction(connection, transaction, [
      payer,
    ]);
    console.log(`Successfully wrapped ${amountInSol} SOL into WSOL!`);
    console.log(`Tx Signature: https://explorer.solana.com/tx/${signature}`);
  } catch (error) {
    console.error("Failed to wrap SOL:", error);
  }
}

// Example Usage:
// (async () => {
//   const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
//   const payer = Keypair.fromSecretKey(new Uint8Array([...]));
//   await wrapSol(connection, payer, 0.1); // Wraps 0.1 SOL
// })();
