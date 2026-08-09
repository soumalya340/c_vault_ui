'use client';

import { use } from 'react';
import { VaultOpsConsole } from '@/app/components/vault-ops-console';
import { useConsoleNetwork } from '@/app/components/console-shell';

/**
 * Vault operations / management console — /manage/{vault_address}.
 * Layout matches new_ui/component2/cVault-5A-Vault-Operations.html.
 */
export default function ManageVaultPage({
  params,
}: {
  params: Promise<{ vaultAddress: string }>;
}) {
  const { vaultAddress } = use(params);
  const { network } = useConsoleNetwork();

  return <VaultOpsConsole vaultKeyParam={vaultAddress} network={network} />;
}
