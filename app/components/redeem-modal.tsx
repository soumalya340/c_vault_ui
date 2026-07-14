'use client';

import { useEffect, useState } from 'react';
import { BN } from '@coral-xyz/anchor';
import { getMint, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { useConnection, useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import {
  getUserPosition,
  previewRedeem,
  redeemSwap,
  claim,
  describePreviewError,
  deriveVaultPdas,
  parseUnits,
  formatUnits,
  type Network,
} from '@/lib/cvault';
import { USDC_DECIMALS } from '@/lib/constants';
import { parseTxError, type UserFacingError } from '@/lib/txError';
import { updateVaultAlts, type VaultRecord } from '@/lib/registryClient';
import { ErrorModal } from './error-modal';
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
} from './ui-classes';

// Two separate actions so a failure in one phase (e.g. an outflow swap leg)
// doesn't get hidden behind a single "Redeem & Claim" button:
//  - "Redeem (swap)" — burns shares (request_redeem) if no RedeemState yet,
//    otherwise (once unlocked) runs the outflow swap legs.
//  - "Claim" — only enabled once the outflow legs are done (pendingUsdc > 0);
//    sends the final `claim` instruction.
// Nothing is stored off-chain per user — both actions check on-chain state.
// The vault's ALT compresses every swap
// transaction.

/** Human-readable token amount with thousands separators; exact string math. */
function formatTokenUi(raw: string, decimals: number): string {
  const ui = formatUnits(raw, decimals);
  const [whole, frac] = ui.split('.');
  const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${wholeFmt}.${frac}` : wholeFmt;
}

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
  const [errorModal, setErrorModal] = useState<UserFacingError | null>(null);

  const [pending, setPending] = useState<{
    redeemableShares: string;
    unlockTime: string;
    pendingUsdc: string;
  } | null>(null);
  /** Raw share-token base units (Token-2022 amount). */
  const [shareBalance, setShareBalance] = useState<string>('0');
  const [sharesDecimals, setSharesDecimals] = useState<number | null>(null);
  const [checkingPosition, setCheckingPosition] = useState(false);

  // Shares mint decimals (authoritative from Token-2022 mint). Needed to show
  // balance / burn amounts in human units instead of raw base units.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { sharesMint } = deriveVaultPdas(vault.vault_id, network);
        const mintInfo = await getMint(
          connection,
          sharesMint,
          undefined,
          TOKEN_2022_PROGRAM_ID,
        );
        if (!cancelled) setSharesDecimals(mintInfo.decimals);
      } catch {
        // Fall back to the vault default (6) so the form still works offline.
        if (!cancelled) setSharesDecimals(6);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, vault.vault_id, network]);

  const refreshPosition = async () => {
    if (!publicKey) return;
    setCheckingPosition(true);
    try {
      const pos = await getUserPosition(connection, vault.vault_id, publicKey, network);
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

  const shareBalanceUi =
    sharesDecimals !== null ? formatTokenUi(shareBalance, sharesDecimals) : null;

  // Live raw-unit echo under the burn field (mirrors deposit modal).
  let rawShares: string | null = null;
  if (sharesDecimals !== null && shares.trim()) {
    try {
      rawShares = parseUnits(shares, sharesDecimals).toString();
    } catch {
      rawShares = null;
    }
  }

  const parseSharesInput = (): BN => {
    if (sharesDecimals === null) {
      throw new Error('Share token decimals not loaded yet — try again in a moment.');
    }
    if (!shares.trim()) throw new Error('Enter a share amount to burn.');
    return parseUnits(shares.trim(), sharesDecimals);
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const raw = parseSharesInput();
      const r = await previewRedeem(
        connection,
        vault.vault_id,
        raw,
        network,
        anchorWallet,
      );
      const usdcUi = formatTokenUi(r.estimatedUsdcValue, USDC_DECIMALS);
      setPreview(`≈ ${usdcUi} USDC · ${r.numAssets} assets to swap`);
    } catch (err) {
      setPreview(describePreviewError(err));
    } finally {
      setPreviewing(false);
    }
  };

  const pendingUsdc = pending ? BigInt(pending.pendingUsdc) : 0n;
  const readyToClaim = unlocked && pendingUsdc > 0n;

  const handleRedeemSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!anchorWallet) return;
    setLoading(true);
    setResult(null);
    setSteps([]);
    try {
      let sharesBn: BN | null = null;
      if (shares.trim()) {
        sharesBn = parseSharesInput();
      }
      const r = await redeemSwap(
        connection,
        anchorWallet,
        vault.vault_id,
        sharesBn,
        vault.alt_address,
        network,
        (message) => setSteps((prev) => [...prev, message]),
      );
      let altNote = '';
      if (
        r.altAddress &&
        (r.altCreated || !vault.alt_address || vault.alt_address !== r.altAddress)
      ) {
        try {
          await updateVaultAlts(network, vault.vault_id, {
            deposit_alt_address: r.altAddress,
            redeem_alt_address: r.altAddress,
          });
          altNote = r.altCreated
            ? `\nALT created + saved: ${r.altAddress}`
            : `\nALT saved: ${r.altAddress}`;
        } catch (err) {
          altNote =
            `\nALT live (${r.altAddress}) but DB save failed: ` +
            `${err instanceof Error ? err.message : String(err)}`;
        }
      }
      if (r.phase === 'requested') {
        const unlock = r.unlockTime ? new Date(r.unlockTime * 1000).toLocaleString() : '—';
        setResult({
          type: 'success',
          text:
            `Shares burned for vault №${vault.vault_id}. Cooldown active — ` +
            `press Redeem (swap) again after ${unlock} to run the outflow swap.` +
            altNote,
          solscan: r.link || undefined,
        });
      } else {
        setResult({
          type: 'success',
          text:
            `Outflow swap complete for vault №${vault.vault_id} (${r.signatures.length} transaction${r.signatures.length === 1 ? '' : 's'}). Press Claim to receive the payout.` +
            altNote,
          solscan: r.link,
        });
      }
      setShares('');
      await refreshPosition();
    } catch (err) {
      const parsed = parseTxError(err);
      setErrorModal(parsed);
      setResult({
        type: parsed.kind === 'info' ? 'info' : 'error',
        text: parsed.title,
      });
      await refreshPosition();
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!anchorWallet) return;
    setLoading(true);
    setResult(null);
    setSteps([]);
    try {
      const r = await claim(connection, anchorWallet, vault.vault_id, network);
      setResult({
        type: 'success',
        text: `Claimed payout from vault №${vault.vault_id}.`,
        solscan: r.link,
      });
      await refreshPosition();
    } catch (err) {
      const parsed = parseTxError(err);
      setErrorModal(parsed);
      setResult({
        type: parsed.kind === 'info' ? 'info' : 'error',
        text: parsed.title,
      });
      await refreshPosition();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {errorModal && (
        <ErrorModal error={errorModal} onClose={() => setErrorModal(null)} />
      )}
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
            <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
              share balance:{' '}
              <span className="text-foreground">
                {shareBalanceUi !== null ? (
                  <>
                    {shareBalanceUi} {vault.symbol}
                    <span className="text-muted-foreground/70">
                      {' '}
                      ({shareBalance} raw)
                    </span>
                  </>
                ) : (
                  '…'
                )}
              </span>
            </p>
          )}

          {pending && (
            <div className="rounded-[2px] border border-border bg-foreground/[0.03] px-3.5 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-seal">
                Pending redeem
              </p>
              <p className="mt-1.5 font-mono text-xs tabular-nums leading-relaxed text-foreground">
                {sharesDecimals !== null
                  ? formatTokenUi(pending.redeemableShares, sharesDecimals)
                  : pending.redeemableShares}{' '}
                {vault.symbol} burned
                {pendingUsdc > 0n
                  ? ` · ${formatTokenUi(pending.pendingUsdc, USDC_DECIMALS)} USDC pending`
                  : ''}{' '}
                · unlocks {unlockDate?.toLocaleString() ?? '—'}
                {readyToClaim
                  ? ' — swapped: ready to Claim'
                  : unlocked
                    ? ' — ready: press Redeem (swap) to run the outflow swap'
                    : ' — cooldown active'}
              </p>
            </div>
          )}

          <form onSubmit={handleRedeemSwap} className="space-y-4">
            {!pending && (
              <>
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className={fieldLabelClass}>Shares to burn</label>
                    {shareBalanceUi !== null && shareBalance !== '0' && (
                      <button
                        type="button"
                        onClick={() =>
                          sharesDecimals !== null &&
                          setShares(formatUnits(shareBalance, sharesDecimals))
                        }
                        className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-accent transition-colors hover:text-foreground"
                      >
                        Max {shareBalanceUi}
                      </button>
                    )}
                  </div>
                  <input
                    className={`${inputClass} tabular-nums`}
                    type="text"
                    inputMode="decimal"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                    placeholder={
                      sharesDecimals === null
                        ? 'loading…'
                        : shareBalanceUi && shareBalance !== '0'
                          ? shareBalanceUi
                          : '1.0'
                    }
                    disabled={sharesDecimals === null}
                    required={!pending}
                  />
                  <p className="mt-1.5 font-mono text-[11px] tabular-nums text-muted-foreground/70">
                    {sharesDecimals === null
                      ? 'Resolving share token decimals…'
                      : rawShares
                        ? `= ${rawShares} raw units (${sharesDecimals} decimals)`
                        : `Enter a ${vault.symbol} amount (e.g. 1.5)`}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handlePreview}
                    disabled={previewing || !shares.trim() || sharesDecimals === null}
                    className={btnSecondaryClass}
                  >
                    {previewing ? 'Previewing…' : 'Preview'}
                  </button>
                  {preview && (
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {preview}
                    </span>
                  )}
                </div>
              </>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={loading || !anchorWallet || readyToClaim || sharesDecimals === null}
                className={btnPrimaryClass}
              >
                {loading ? 'Processing…' : anchorWallet ? 'Redeem (swap)' : 'Connect wallet'}
              </button>
              <button
                type="button"
                onClick={handleClaim}
                disabled={loading || !anchorWallet || !readyToClaim}
                className={btnPrimaryClass}
              >
                {loading ? 'Processing…' : 'Claim'}
              </button>
            </div>
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
