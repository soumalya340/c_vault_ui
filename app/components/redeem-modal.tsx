'use client';

import { useEffect, useState } from 'react';
import { BN } from '@coral-xyz/anchor';
import { useConnection, useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { claim, getUserPosition, previewRedeem, requestRedeem, type Network } from '@/lib/cvault';
import type { VaultRecord } from '@/lib/registryClient';
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
} from './ui-classes';

export function RedeemModal({
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
  const { publicKey } = useWallet();

  const [shares, setShares] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);

  const [pending, setPending] = useState<{
    redeemableShares: string;
    unlockTime: string;
    pendingUsdc: string;
  } | null>(null);
  const [checkingPosition, setCheckingPosition] = useState(false);

  const refreshPosition = async () => {
    if (!publicKey) return;
    setCheckingPosition(true);
    try {
      const pos = await getUserPosition(connection, vault.vault_id, publicKey);
      setPending(
        pos.redeemState && Number(pos.redeemState.redeemableShares) > 0
          ? {
              redeemableShares: pos.redeemState.redeemableShares,
              unlockTime: pos.redeemState.unlockTime,
              pendingUsdc: pos.redeemState.pendingUsdc,
            }
          : null,
      );
    } catch {
      setPending(null);
    } finally {
      setCheckingPosition(false);
    }
  };

  useEffect(() => {
    refreshPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  const unlockDate = pending ? new Date(Number(pending.unlockTime) * 1000) : null;
  const unlocked = unlockDate ? unlockDate.getTime() <= Date.now() : false;

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const r = await previewRedeem(connection, vault.vault_id, new BN(shares || '0'));
      setPreview(`≈ ${r.estimatedUsdcValue} base units · ${r.numAssets} assets to swap`);
    } catch (err) {
      setPreview(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const handleRequestRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!anchorWallet) return;
    setLoading(true);
    setResult(null);
    try {
      if (!shares.trim()) throw new Error('Enter shares to redeem.');
      const r = await requestRedeem(connection, anchorWallet, vault.vault_id, new BN(shares.trim()), network);
      setResult({
        type: 'success',
        text: `Redeem requested for vault №${vault.vault_id}. Wait for the cooldown to lapse, then claim.`,
        solscan: r.link,
      });
      setShares('');
      await refreshPosition();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRejection =
        msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('rejected the request');
      setResult({ type: isRejection ? 'info' : 'error', text: isRejection ? 'Transaction cancelled.' : msg });
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!anchorWallet) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await claim(connection, anchorWallet, vault.vault_id, network);
      setResult({ type: 'success', text: `Claimed redeem payout from vault №${vault.vault_id}.`, solscan: r.link });
      await refreshPosition();
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
        aria-label={`Redeem from ${vault.symbol}`}
        className="cert-frame relative z-10 w-full max-w-[480px] overflow-hidden bg-background shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-strong px-6 py-4">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-seal">
              № {String(vault.vault_id).padStart(2, '0')} · redeem
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-[0.02em]">
              {vault.symbol} · {vault.name}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={btnGhostClass}>
            Close
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {checkingPosition && (
            <p className="font-mono text-xs text-muted-foreground">Checking pending redeem…</p>
          )}

          {pending && (
            <div className="rounded-[2px] border border-border bg-foreground/[0.03] px-3.5 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-seal">
                Pending redeem
              </p>
              <p className="mt-1.5 font-mono text-xs leading-relaxed text-foreground">
                {pending.redeemableShares} shares · unlocks{' '}
                {unlockDate?.toLocaleString() ?? '—'}
                {unlocked ? ' — ready to claim' : ' — cooldown active'}
              </p>
              <button
                type="button"
                onClick={handleClaim}
                disabled={loading || !unlocked || !anchorWallet}
                className={`${btnPrimaryClass} mt-3`}
              >
                {loading ? 'Processing…' : 'Claim payout'}
              </button>
            </div>
          )}

          <form onSubmit={handleRequestRedeem} className="space-y-4">
            <div>
              <label className={fieldLabelClass}>Shares to burn</label>
              <input
                className={inputClass}
                type="number"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                placeholder="1000"
                required
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePreview}
                disabled={previewing || !shares.trim()}
                className={btnSecondaryClass}
              >
                {previewing ? 'Previewing…' : 'Preview'}
              </button>
              {preview && (
                <span className="font-mono text-[11px] text-muted-foreground">{preview}</span>
              )}
            </div>

            <button type="submit" disabled={loading || !anchorWallet} className={btnPrimaryClass}>
              {loading ? 'Processing…' : anchorWallet ? 'Request redeem' : 'Connect wallet'}
            </button>
          </form>

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
        </div>
      </div>
    </div>
  );
}
