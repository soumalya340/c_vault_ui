'use client';

import { use } from 'react';
import { VaultDetailView } from '@/app/components/vault-detail-view';
import { useConsoleNetwork } from '@/app/components/console-shell';

/**
 * Per-vault detail page — /discover/{vault_address} (vault PDA).
 * Legacy numeric /discover/{vault_id} still resolves and rewrites to the PDA.
 *
 * `params` is a Promise in Next 16; unwrapped with React's `use` since this
 * page must be a Client Component (wallet adapter hooks drive the actions).
 */
export default function VaultDetailPage({
  params,
}: {
  params: Promise<{ vaultAddress: string }>;
}) {
  const { vaultAddress } = use(params);
  const { network } = useConsoleNetwork();

  return <VaultDetailView vaultKeyParam={vaultAddress} network={network} />;
}
