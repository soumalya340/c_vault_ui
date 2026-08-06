export type Network = 'localhost' | 'mainnet';

export function solscanLink(sig: string, network: Network): string {
  if (network === 'mainnet') {
    return `https://solscan.io/tx/${sig}`;
  }
  // Local validator — Solana Explorer custom cluster pointing at default RPC.
  const customUrl = encodeURIComponent(
    process.env.NEXT_PUBLIC_LOCALHOST_RPC ?? 'http://127.0.0.1:8899',
  );
  return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${customUrl}`;
}

export function solscanAccountLink(address: string, network: Network): string {
  if (network === 'mainnet') {
    return `https://solscan.io/account/${address}`;
  }
  const customUrl = encodeURIComponent(
    process.env.NEXT_PUBLIC_LOCALHOST_RPC ?? 'http://127.0.0.1:8899',
  );
  return `https://explorer.solana.com/address/${address}?cluster=custom&customUrl=${customUrl}`;
}
