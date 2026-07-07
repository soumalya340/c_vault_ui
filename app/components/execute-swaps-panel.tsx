'use client';

import { useState } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

import { deployPendingSwaps, type Network } from '@/lib/cvault';
import { fetchVaults } from '@/lib/registryClient';
import { SECTION_STYLE } from './function-defs';
import {
  btnPrimaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
  panelClass,
  sectionLabelClass,
} from './ui-classes';

// Execute pending inflow swaps for a vault (Plan.md §1-2): the vault account
// is fetched by id, assets[0..num_assets] is walked slot by slot, and every
// pending leg is bundled into one v0 transaction compressed by the vault's
// stored ALT. Permissionless — any connected wallet may deploy.

export function ExecuteSwapsPanel({ network }: { network: Network }) {
  const style = SECTION_STYLE['vault-ops'];
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  const [vaultId, setVaultId] = useState('0');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !anchorWallet) {
      setVisible(true);
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const id = Number(vaultId);
      if (!Number.isInteger(id) || id < 0) throw new Error('Enter a valid vault id.');

      // The ALT lives in the Supabase vaults row; a missing row or ALT just
      // means the transaction is built with static keys instead.
      let altAddress: string | null = null;
      try {
        const rows = await fetchVaults(network);
        altAddress = rows.find((v) => v.vault_id === id)?.alt_address ?? null;
      } catch {
        // registry unavailable — proceed without the ALT
      }

      const r = await deployPendingSwaps(connection, anchorWallet, id, altAddress, network);
      setResult({
        type: 'success',
        text: `Pending swaps executed for vault №${id}${altAddress ? ' (via stored ALT)' : ''}.`,
        solscan: r.link,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRejection =
        msg.toLowerCase().includes('user rejected') ||
        msg.toLowerCase().includes('rejected the request');
      setResult({
        type: isRejection ? 'info' : 'error',
        text: isRejection ? 'Transaction cancelled.' : msg,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section aria-label="Execute pending swaps" className={`${panelClass} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-5 py-3.5 md:px-6">
        <span
          className="font-display text-base font-semibold uppercase tracking-[0.18em]"
          style={{ color: style.accent }}
        >
          <span className="mr-3 font-mono text-xs font-bold tracking-[0.08em] text-seal">№ 1B</span>
          Execute pending swaps
        </span>
        <span className={`${sectionLabelClass} uppercase`}>
          permissionless · one v0 transaction via ALT
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5 md:px-6">
        <p
          className="border-l-2 py-0.5 pl-3 text-sm leading-[1.55] text-muted-foreground"
          style={{ borderColor: `${style.accent}44` }}
        >
          Fetches the vault by id, walks its asset basket (up to num_assets
          slots), and deploys whatever USDC/wSOL is pending into the basket —
          USDC→wSOL, then wSOL→asset and USDC→asset legs per route.
        </p>

        <div className="max-w-[220px]">
          <label className={fieldLabelClass}>Vault ID</label>
          <input
            className={inputClass}
            type="number"
            value={vaultId}
            onChange={(e) => setVaultId(e.target.value)}
            placeholder="0"
            required
          />
        </div>

        <button type="submit" disabled={loading} className={btnPrimaryClass}>
          {loading ? 'Processing…' : connected ? 'Execute swaps' : 'Connect wallet'}
        </button>

        {result && (
          <div className={outputPanelClass}>
            <div className="border-b border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground md:px-5">
              OUTPUT
            </div>
            <div
              className={`whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs leading-relaxed md:px-5 ${
                result.type === 'error'
                  ? 'text-destructive'
                  : result.type === 'success'
                    ? 'text-foreground'
                    : 'text-muted-foreground'
              }`}
            >
              <span className="mr-2 text-muted-foreground/50">&gt;</span>
              {result.text}
              {result.solscan && (
                <div className="mt-2 border-t border-border pt-2">
                  <a
                    href={result.solscan}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline transition-colors hover:text-foreground"
                  >
                    View on Solscan
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
