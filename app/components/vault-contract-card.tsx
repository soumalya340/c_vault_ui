'use client';

import { useState } from 'react';
import type { Network } from '@/lib/onchain/solscanLink';
import { solscanAccountLink } from '@/lib/onchain/solscanLink';
import { VaultPanel } from './vault-panel';

function Addr({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${value.slice(0, 4)}…${value.slice(-4)}`;
  return (
    <div className="flex items-center justify-between gap-2.5 border-b border-border py-2.5 last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        className="font-mono text-xs text-foreground underline decoration-dotted decoration-muted-foreground underline-offset-2 transition-colors hover:text-seal"
        title={value}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? 'copied' : short}
      </button>
    </div>
  );
}

export function VaultContractCard({
  vaultAddress,
  baseMint,
  sharesMint,
  network,
}: {
  vaultAddress: string;
  baseMint: string;
  sharesMint: string;
  network: Network;
}) {
  const explorer = solscanAccountLink(vaultAddress, network);

  return (
    <VaultPanel label="Accounts">
      <Addr label="Vault" value={vaultAddress} />
      <Addr label="Base mint" value={baseMint} />
      <Addr label="Shares mint" value={sharesMint} />
      <a
        href={explorer}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.1em] text-accent transition-opacity hover:opacity-80"
      >
        Open on Solscan ↗
      </a>
    </VaultPanel>
  );
}
