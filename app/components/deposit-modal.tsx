'use client';

import { useState } from 'react';
import { BN } from '@coral-xyz/anchor';
import { useConnection, useAnchorWallet } from '@solana/wallet-adapter-react';
import { deposit, previewDeposit, type Network } from '@/lib/cvault';
import type { VaultRecord } from '@/lib/registryClient';
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
} from './ui-classes';

export function DepositModal({
  vault,
  network,
  onClose,
}: {
  vault: VaultRecord;
  network: Network;
  onClose: () => void;
}) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();

  const [amount, setAmount] = useState('');
  const [minSharesOut, setMinSharesOut] = useState('0');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const r = await previewDeposit(connection, vault.vault_id, new BN(amount || '0'));
      setPreview(
        `≈ ${r.sharesToMint} shares · NAV ${r.totalNav} · price ${r.sharePrice}`,
      );
    } catch (err) {
      setPreview(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!anchorWallet) return;
    setLoading(true);
    setResult(null);
    try {
      if (!amount.trim()) throw new Error('Enter an amount.');
      const r = await deposit(
        connection,
        anchorWallet,
        vault.vault_id,
        new BN(amount.trim()),
        new BN(minSharesOut.trim() || '0'),
        network,
      );
      setResult({ type: 'success', text: `Deposited into vault №${vault.vault_id}.`, solscan: r.link });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRejection =
        msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('rejected the request');
      setResult({ type: isRejection ? 'info' : 'error', text: isRejection ? 'Transaction cancelled.' : msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Deposit into ${vault.symbol}`}
        className="cert-frame relative z-10 w-full max-w-[480px] overflow-hidden bg-background shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-strong px-6 py-4">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-accent">
              № {String(vault.vault_id).padStart(2, '0')} · deposit
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-[0.02em]">
              {vault.symbol} · {vault.name}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={btnGhostClass}>
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div>
            <label className={fieldLabelClass}>Amount (raw base units)</label>
            <input
              className={inputClass}
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000000000"
              required
            />
          </div>
          <div>
            <label className={fieldLabelClass}>Min shares out (0 = no slippage check)</label>
            <input
              className={inputClass}
              type="number"
              value={minSharesOut}
              onChange={(e) => setMinSharesOut(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewing || !amount.trim()}
              className={btnSecondaryClass}
            >
              {previewing ? 'Previewing…' : 'Preview'}
            </button>
            {preview && (
              <span className="font-mono text-[11px] text-muted-foreground">{preview}</span>
            )}
          </div>

          <button type="submit" disabled={loading || !anchorWallet} className={btnPrimaryClass}>
            {loading ? 'Processing…' : anchorWallet ? 'Deposit' : 'Connect wallet'}
          </button>

          {result && (
            <div className={outputPanelClass}>
              <div className="border-b border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                OUTPUT
              </div>
              <div
                className={`whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs leading-relaxed ${
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
      </div>
    </div>
  );
}
