export type Network = 'devnet' | 'mainnet';

export function solscanLink(sig: string, network: Network): string {
  if (network === 'mainnet') {
    return `https://solscan.io/tx/${sig}`;
  }
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}
