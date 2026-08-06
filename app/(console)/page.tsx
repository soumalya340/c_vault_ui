'use client';

import { HeroSection } from '@/app/components/hero-section';
import { useConsoleNetwork } from '@/app/components/console-shell';
import {
  C_VAULT_PROGRAM_ID,
  DEFAULT_VAULT_ID,
  deriveVaultPdas,
} from '@/lib/onchain/cvault';

export default function HomePage() {
  const { network } = useConsoleNetwork();

  const { vaultPda } = deriveVaultPdas(DEFAULT_VAULT_ID, network);
  const vaultShort = `${vaultPda.toBase58().slice(0, 8)}…${vaultPda.toBase58().slice(-8)}`;
  const programShort = `${C_VAULT_PROGRAM_ID.toBase58().slice(0, 8)}…${C_VAULT_PROGRAM_ID.toBase58().slice(-8)}`;

  return (
    <HeroSection
      network={network}
      vaultId={DEFAULT_VAULT_ID}
      vaultShort={vaultShort}
      programShort={programShort}
    />
  );
}