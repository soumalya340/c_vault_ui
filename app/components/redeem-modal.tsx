'use client';

import { useEffect, useRef, useState } from 'react';
import { BN } from '@coral-xyz/anchor';
import { getMint, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { useConnection, useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import {
  getUserPosition,
  getUserUsdcBalance,
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
import { isTwapRefreshableError, parseTxError, type UserFacingError } from '@/lib/txError';
import { updateVaultAlts, type VaultRecord } from '@/lib/registryClient';
import { ErrorModal } from './error-modal';
import { LedgerOutput } from './ledger-output';
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
} from './ui-classes';
import { useModalTransition } from './use-modal-transition';
import { displayVaultName } from './view-display';
import {
  SettlementReceipt,
  groupDecimal,
  settlementRate,
} from './settlement-receipt';
import { TransactionPhases } from './transaction-phases';
import { Spinner } from '@/components/ui/spinner';

// Two separate actions so a failure in one phase (e.g. an outflow swap leg)
// doesn't get hidden behind a single "Redeem & Claim" button:
//  - "Redeem (swap)" — burns shares (request_redeem) if no active redeem yet,
//    otherwise runs the outflow swap legs.
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
  const { requestClose, modalClassName, backdropClassName, isClosing } =
    useModalTransition(onClose);

  const [shares, setShares] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  /** Which button triggered the in-flight transaction — picks the phase list. */
  const [activeFlow, setActiveFlow] = useState<'redeem' | 'claim'>('redeem');
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);
  const [errorModal, setErrorModal] = useState<UserFacingError | null>(null);
  /**
   * Settled redeem — shares burned and the USDC that actually landed in the
   * wallet. `usdcRaw` is a measured wallet delta; `sharesRaw` is null when the
   * user resumed a pending redeem without re-entering an amount (the burn
   * happened in an earlier session, so this run cannot attribute it).
   */
  const [settlement, setSettlement] = useState<{
    sharesRaw: string | null;
    usdcRaw: string | null;
    note: string | null;
    solscan?: string;
  } | null>(null);

  const [pending, setPending] = useState<{
    isRedeemActive: boolean;
    pendingUsdc: string;
  } | null>(null);
  /** Raw share-token base units (Token-2022 amount). */
  const [shareBalance, setShareBalance] = useState<string>('0');
  const [sharesDecimals, setSharesDecimals] = useState<number | null>(null);
  const [checkingPosition, setCheckingPosition] = useState(false);
  /** Scroll container + anchors so long redeem logs don't hide OUTPUT. */
  const bodyRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const stepsEndRef = useRef<HTMLDivElement>(null);

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
        pos.redeemState && pos.redeemState.isRedeemActive
          ? {
              isRedeemActive: pos.redeemState.isRedeemActive,
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

  // Multi-leg redeem logs fill the viewport; keep the latest step in view while
  // loading, then jump to OUTPUT when redeem/claim finishes.
  useEffect(() => {
    if (result) {
      // Bring OUTPUT to the top of the scroll body so success/error is never
      // buried under dozens of "Sending ALT transaction…" lines.
      bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (loading && steps.length > 0) {
      stepsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [result, steps, loading]);

  /**
   * Raw wallet USDC, or null if unreadable. Sampled either side of
   * redeem/claim to measure the payout — neither `redeemSwap` nor `claim`
   * returns the amount that landed.
   */
  const readUsdcBalance = async (): Promise<string | null> => {
    if (!publicKey) return null;
    try {
      return await getUserUsdcBalance(connection, publicKey, network);
    } catch {
      return null;
    }
  };

  /** Positive wallet delta between two samples, or null if unmeasurable. */
  const measureUsdcDelta = (before: string | null, after: string | null): string | null => {
    if (before === null || after === null) return null;
    try {
      const delta = BigInt(after) - BigInt(before);
      return delta > 0n ? delta.toString() : null;
    } catch {
      return null;
    }
  };

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
  const readyToClaim = pendingUsdc > 0n;

  const handleRedeemSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!anchorWallet) return;
    setActiveFlow('redeem');
    setLoading(true);
    setResult(null);
    setSteps([]);
    setSettlement(null);
    try {
      let sharesBn: BN | null = null;
      if (shares.trim()) {
        sharesBn = parseSharesInput();
      }
      // Sample wallet USDC before signing — the batch includes `claim`, so the
      // payout lands within this call.
      const usdcBefore = await readUsdcBalance();
      // Burn + all outflow legs + claim in one wallet approval (signAllTransactions).
      const r = await redeemSwap(
        connection,
        anchorWallet,
        vault.vault_id,
        sharesBn,
        vault.alt_address,
        network,
        (message) => setSteps((prev) => [...prev, message]),
        { includeClaim: true },
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
      const usdcAfter = await readUsdcBalance();
      setSettlement({
        sharesRaw: sharesBn ? sharesBn.toString() : null,
        usdcRaw: measureUsdcDelta(usdcBefore, usdcAfter),
        note:
          `Shares burned, assets swapped, USDC claimed ` +
          `(${r.signatures.length} transaction${r.signatures.length === 1 ? '' : 's'}, one wallet approval).` +
          altNote,
        solscan: r.link,
      });
      setResult({
        type: 'success',
        text:
          `Redeem complete for vault №${vault.vault_id}: shares burned, assets swapped, USDC claimed ` +
          `(${r.signatures.length} transaction${r.signatures.length === 1 ? '' : 's'}, one wallet approval).` +
          altNote,
        solscan: r.link,
      });
      setShares('');
      await refreshPosition();
    } catch (err) {
      const parsed = parseTxError(err);
      setErrorModal(parsed);
      setResult({
        type: parsed.kind === 'info' ? 'info' : 'error',
        text: parsed.title,
      });
      // Always re-read RedeemState — burn may have succeeded even if a later
      // swap/claim leg failed; user can press Redeem (swap) again to resume.
      await refreshPosition();
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!anchorWallet) return;
    setActiveFlow('claim');
    setLoading(true);
    setResult(null);
    setSteps([]);
    setSettlement(null);
    try {
      setSteps(['Claiming USDC payout…']);
      // On-chain pending amount is the authoritative payout for a bare claim;
      // the wallet delta is the fallback if RedeemState wasn't readable.
      const expectedUsdc = pendingUsdc > 0n ? pendingUsdc.toString() : null;
      const usdcBefore = await readUsdcBalance();
      const r = await claim(connection, anchorWallet, vault.vault_id, network);
      const usdcAfter = await readUsdcBalance();
      setSettlement({
        sharesRaw: null,
        usdcRaw: expectedUsdc ?? measureUsdcDelta(usdcBefore, usdcAfter),
        note: 'Pending payout claimed to your wallet.',
        solscan: r.link,
      });
      setResult({
        type: 'success',
        text: `Claimed USDC payout from vault №${vault.vault_id}.`,
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
        <ErrorModal
          error={errorModal}
          onClose={() => setErrorModal(null)}
          network={network}
          vaultId={vault.vault_id}
        />
      )}
      <div
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm ${backdropClassName}`}
        onClick={() => {
          if (!isClosing) requestClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Redeem from ${displayVaultName(vault.name)}`}
        className={`cert-frame relative z-10 flex w-full max-w-[480px] max-h-[90vh] flex-col overflow-hidden bg-background shadow-2xl ${modalClassName}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-strong px-6 py-4">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-seal">
              № {String(vault.vault_id).padStart(2, '0')} · redeem &amp; claim
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-[0.02em]">
              {displayVaultName(vault.name)}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={isClosing}
            aria-label="Close"
            className={btnGhostClass}
          >
            Close
          </button>
        </div>

        {settlement ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
            <SettlementReceipt
              kind="redeem"
              vaultId={vault.vault_id}
              surrendered={{
                label: 'Shares burned',
                amount:
                  settlement.sharesRaw !== null && sharesDecimals !== null
                    ? groupDecimal(formatUnits(settlement.sharesRaw, sharesDecimals))
                    : null,
                unit: vault.symbol,
              }}
              issued={{
                label: 'USDC claimed',
                amount:
                  settlement.usdcRaw !== null
                    ? groupDecimal(formatUnits(settlement.usdcRaw, USDC_DECIMALS))
                    : null,
                unit: 'USDC',
              }}
              rate={(() => {
                const value = settlementRate(
                  settlement.usdcRaw,
                  USDC_DECIMALS,
                  settlement.sharesRaw,
                  sharesDecimals ?? 6,
                );
                return value
                  ? { label: 'Proceeds per share', value: `${value} USDC` }
                  : null;
              })()}
              note={settlement.note}
              solscan={settlement.solscan}
              doneLabel="Done"
              onDone={requestClose}
            />
            <button
              type="button"
              onClick={() => {
                setSettlement(null);
                setResult(null);
                setSteps([]);
                setPreview(null);
              }}
              className="mt-4 w-full rounded-[2px] border border-border-strong bg-background px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-foreground transition-colors duration-150 hover:border-accent hover:bg-accent hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Redeem more
            </button>
          </div>
        ) : (
        <div ref={bodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-5">
          {checkingPosition && (
            <p className="font-mono text-xs text-muted-foreground">
              <span className="t-shimmer" data-text="Checking on-chain position…">
                Checking on-chain position…
              </span>
            </p>
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
                Redeem in progress for vault №{vault.vault_id}
                {pendingUsdc > 0n
                  ? ` · ${formatTokenUi(pending.pendingUsdc, USDC_DECIMALS)} USDC pending`
                  : ''}{' '}
                {readyToClaim
                  ? '— all legs swapped: press Claim (or Redeem to auto-claim)'
                  : '— press Redeem (swap) to convert assets → USDC (then auto-claim)'}
              </p>
            </div>
          )}

          {/* OUTPUT first when present — multi-leg logs used to bury success below the fold. */}
          {result && (
            <div ref={resultRef} className={outputPanelClass}>
              <div className="border-b border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                OUTPUT
              </div>
              <div className="px-4 py-3">
                <LedgerOutput text={result.text} tone={result.type} />
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
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="size-3.5" />
                    Processing…
                  </span>
                ) : anchorWallet ? (
                  'Redeem (swap)'
                ) : (
                  'Connect wallet'
                )}
              </button>
              <button
                type="button"
                onClick={handleClaim}
                disabled={loading || !anchorWallet || !readyToClaim}
                className={btnPrimaryClass}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="size-3.5" />
                    Processing…
                  </span>
                ) : (
                  'Claim'
                )}
              </button>
            </div>
          </form>

          <TransactionPhases flow={activeFlow} steps={steps} active={loading} />
          <div ref={stepsEndRef} aria-hidden />
        </div>
        )}
      </div>
    </div>
  );
}
