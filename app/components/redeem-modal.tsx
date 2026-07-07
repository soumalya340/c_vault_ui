'use client';

import { useEffect, useState } from 'react';
import { BN } from '@coral-xyz/anchor';
import { useConnection, useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { getUserPosition, previewRedeem, redeemAndClaim, type Network } from '@/lib/cvault';
import type { VaultRecord } from '@/lib/registryClient';
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
} from './ui-classes';

// One "Redeem & Claim" action (Plan.md §8-9). Nothing is stored off-chain per
// user — the flow checks on-chain state and either burns shares
// (request_redeem) or, when a claimable RedeemState exists, runs the outflow
// swap legs and claims the payout. The vault's ALT compresses every swap
// transaction.

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
  const [steps, setSteps] = useState<string[]>([]);
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
  const [shareBalance, setShareBalance] = useState<string>('0');
  const [checkingPosition, setCheckingPosition] = useState(false);

  const refreshPosition = async () => {
    if (!publicKey) return;
    setCheckingPosition(true);
    try {
      const pos = await getUserPosition(connection, vault.vault_id, publicKey);
      setShareBalance(pos.shareBalance);
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

  const handleRedeemAndClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!anchorWallet) return;
    setLoading(true);
    setResult(null);
    setSteps([]);
    try {
      const r = await redeemAndClaim(
        connection,
        anchorWallet,
        vault.vault_id,
        shares.trim() ? new BN(shares.trim()) : null,
        vault.alt_address,
        network,
        (message) => setSteps((prev) => [...prev, message]),
      );
      if (r.phase === 'requested') {
        const unlock = r.unlockTime ? new Date(r.unlockTime * 1000).toLocaleString() : '—';
        setResult({
          type: 'success',
          text:
            `Shares burned for vault №${vault.vault_id}. Cooldown active — ` +
            `press Redeem & Claim again after ${unlock} to swap and claim.`,
          solscan: r.link || undefined,
        });
      } else {
        setResult({
          type: 'success',
          text: `Redeemed and claimed payout from vault №${vault.vault_id} (${r.signatures.length} transaction${r.signatures.length === 1 ? '' : 's'}).`,
          solscan: r.link,
        });
      }
      setShares('');
      await refreshPosition();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRejection =
        msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('rejected the request');
      setResult({ type: isRejection ? 'info' : 'error', text: isRejection ? 'Transaction cancelled.' : msg });
      await refreshPosition();
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
              № {String(vault.vault_id).padStart(2, '0')} · redeem &amp; claim
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
            <p className="font-mono text-xs text-muted-foreground">Checking on-chain position…</p>
          )}

          {!checkingPosition && (
            <p className="font-mono text-[11px] text-muted-foreground">
              share balance: <span className="text-foreground">{shareBalance}</span>
            </p>
          )}

          {pending && (
            <div className="rounded-[2px] border border-border bg-foreground/[0.03] px-3.5 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-seal">
                Pending redeem
              </p>
              <p className="mt-1.5 font-mono text-xs leading-relaxed text-foreground">
                {pending.redeemableShares} shares burned · unlocks{' '}
                {unlockDate?.toLocaleString() ?? '—'}
                {unlocked
                  ? ' — ready: Redeem & Claim will swap and pay out'
                  : ' — cooldown active'}
              </p>
            </div>
          )}

          <form onSubmit={handleRedeemAndClaim} className="space-y-4">
            {!pending && (
              <>
                <div>
                  <label className={fieldLabelClass}>Shares to burn</label>
                  <input
                    className={inputClass}
                    type="number"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                    placeholder="1000"
                    required={!pending}
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
              </>
            )}

            <button type="submit" disabled={loading || !anchorWallet} className={btnPrimaryClass}>
              {loading ? 'Processing…' : anchorWallet ? 'Redeem & Claim' : 'Connect wallet'}
            </button>
          </form>

          {steps.length > 0 && (
            <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
              {steps.map((step, i) => (
                <p key={i}>
                  <span className="mr-2 text-muted-foreground/50">&gt;</span>
                  {step}
                </p>
              ))}
            </div>
          )}

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
