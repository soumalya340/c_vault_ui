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
} from '@/lib/onchain/cvault';
import { USDC_DECIMALS } from '@/lib/constants';
import { parseTxError, type UserFacingError } from '@/lib/onchain/txError';
import { updateVaultAlts, type VaultRecord } from '@/lib/registryClient';
import { ErrorModal } from './error-modal';
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

function feePctLabel(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function shortAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

type PreviewQuote = {
  usdcUi: string;
  usdcRaw: string;
  numAssets: number;
  proceedsPerShareUi: string | null;
};

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
  const [quote, setQuote] = useState<PreviewQuote | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  /** Which button triggered the in-flight transaction — picks the phase list. */
  const [activeFlow, setActiveFlow] = useState<'redeem' | 'claim'>('redeem');
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
    metaLeft: string;
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

  const previewSeq = useRef(0);

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
    let cancelled = false;
    (async () => {
      if (!publicKey) {
        await Promise.resolve();
        if (!cancelled) {
          setShareBalance('0');
          setPending(null);
        }
        return;
      }
      setCheckingPosition(true);
      try {
        const pos = await getUserPosition(
          connection,
          vault.vault_id,
          publicKey,
          network,
        );
        if (cancelled) return;
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
        if (!cancelled) setPending(null);
      } finally {
        if (!cancelled) setCheckingPosition(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey, connection, vault.vault_id, network]);

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

  // Debounced live preview — matches 6A YOU RECEIVE card.
  useEffect(() => {
    const seq = ++previewSeq.current;
    let cancelled = false;

    const clearQuote = () => {
      if (cancelled || previewSeq.current !== seq) return;
      setQuote(null);
      setPreviewError(null);
      setPreviewing(false);
    };

    if (pending || sharesDecimals === null || !shares.trim()) {
      const t = window.setTimeout(clearQuote, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }

    let raw: BN;
    try {
      raw = parseUnits(shares.trim(), sharesDecimals);
      if (raw.isZero()) {
        const t = window.setTimeout(clearQuote, 0);
        return () => {
          cancelled = true;
          window.clearTimeout(t);
        };
      }
    } catch {
      const t = window.setTimeout(clearQuote, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }

    const timer = window.setTimeout(async () => {
      if (cancelled || previewSeq.current !== seq) return;
      setPreviewing(true);
      try {
        const r = await previewRedeem(
          connection,
          vault.vault_id,
          raw,
          network,
          anchorWallet,
        );
        if (cancelled || previewSeq.current !== seq) return;
        const usdcUi = formatTokenUi(r.estimatedUsdcValue, USDC_DECIMALS);
        const proceeds = settlementRate(
          r.estimatedUsdcValue,
          USDC_DECIMALS,
          raw.toString(),
          sharesDecimals,
        );
        setQuote({
          usdcUi,
          usdcRaw: r.estimatedUsdcValue,
          numAssets: r.numAssets,
          proceedsPerShareUi: proceeds,
        });
        setPreviewError(null);
      } catch (err) {
        if (cancelled || previewSeq.current !== seq) return;
        setQuote(null);
        setPreviewError(describePreviewError(err));
      } finally {
        if (!cancelled && previewSeq.current === seq) setPreviewing(false);
      }
    }, 380);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shares, sharesDecimals, pending, connection, vault.vault_id, network, anchorWallet]);

  const pendingUsdc = pending ? BigInt(pending.pendingUsdc) : 0n;
  const readyToClaim = pendingUsdc > 0n;

  const handleRedeemSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!anchorWallet) return;
    setActiveFlow('redeem');
    setLoading(true);
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
            ? `ALT created + saved: ${r.altAddress}`
            : `ALT saved: ${r.altAddress}`;
        } catch (err) {
          altNote =
            `ALT live (${r.altAddress}) but DB save failed: ` +
            `${err instanceof Error ? err.message : String(err)}`;
        }
      }
      const usdcAfter = await readUsdcBalance();
      const remainingRaw =
        sharesBn && BigInt(shareBalance) >= BigInt(sharesBn.toString())
          ? (BigInt(shareBalance) - BigInt(sharesBn.toString())).toString()
          : null;
      const remainingUi =
        remainingRaw !== null && sharesDecimals !== null
          ? formatTokenUi(remainingRaw, sharesDecimals)
          : null;
      setSettlement({
        sharesRaw: sharesBn ? sharesBn.toString() : null,
        usdcRaw: measureUsdcDelta(usdcBefore, usdcAfter),
        note: altNote || null,
        metaLeft:
          remainingUi !== null
            ? `Remaining ${remainingUi} ${(vault.symbol || 'SHARES').toUpperCase()}`
            : `${r.signatures.length} transaction${r.signatures.length === 1 ? '' : 's'} · one approval`,
        solscan: r.link,
      });
      setShares('');
      setQuote(null);
      await refreshPosition();
    } catch (err) {
      const parsed = parseTxError(err);
      setErrorModal(parsed);
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
        note: null,
        metaLeft: 'Pending payout claimed to your wallet',
        solscan: r.link,
      });
      await refreshPosition();
    } catch (err) {
      const parsed = parseTxError(err);
      setErrorModal(parsed);
      await refreshPosition();
    } finally {
      setLoading(false);
    }
  };

  const setSharesPct = (pct: number) => {
    if (sharesDecimals === null) return;
    try {
      const raw = (BigInt(shareBalance) * BigInt(pct)) / 100n;
      setShares(formatUnits(raw.toString(), sharesDecimals));
    } catch {
      // ignore
    }
  };

  const showInFlight = loading && !settlement;
  const vaultName = displayVaultName(vault.name);
  const addrShort = shortAddr(vault.vault_address);
  const shareSymbol = (vault.symbol || 'SHARES').toUpperCase();
  // Shares stay set while signing; only cleared after settlement.
  const burnLabel = shares.trim() || '…';

  const resetToEntry = () => {
    setSettlement(null);
    setSteps([]);
    setQuote(null);
    setPreviewError(null);
  };

  const remainingAfterBurnUi =
    settlement?.sharesRaw && sharesDecimals !== null
      ? (() => {
          try {
            // shareBalance was refreshed after settlement; show current held.
            return formatTokenUi(shareBalance, sharesDecimals);
          } catch {
            return null;
          }
        })()
      : null;

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
        className={`absolute inset-0 bg-black/75 backdrop-blur-sm ${backdropClassName}`}
        onClick={() => {
          if (!isClosing && !loading) requestClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Redeem from ${vaultName}`}
        className={`relative z-10 flex w-full max-w-[396px] max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-background shadow-[0_24px_60px_rgba(0,0,0,0.55)] ${modalClassName}`}
      >
        {/* ── Header ───────────────────────────────────────────── */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.07] px-5 pb-4 pt-[18px]">
          <div>
            <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-accent">
              Redeem &amp; claim
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <h2 className="text-[21px] font-semibold tracking-[-0.03em] text-foreground">
                {vaultName}
              </h2>
              <span className="font-mono text-[10.5px] text-text-ghost">{addrShort}</span>
            </div>
          </div>
          {showInFlight ? (
            <span className="rounded-full bg-accent/10 px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-accent">
              In flight
            </span>
          ) : (
            <button
              type="button"
              onClick={requestClose}
              disabled={isClosing || loading}
              aria-label="Close"
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/12 font-mono text-[11px] text-text-dim transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-40"
            >
              ✕
            </button>
          )}
        </div>

        {settlement ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <SettlementReceipt
              kind="redeem"
              vaultId={vault.vault_id}
              surrendered={{
                label: 'Shares burned',
                amount:
                  settlement.sharesRaw !== null && sharesDecimals !== null
                    ? groupDecimal(formatUnits(settlement.sharesRaw, sharesDecimals))
                    : null,
                unit: shareSymbol,
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
                  ? {
                      label: 'Proceeds per share',
                      value,
                      unit: 'USDC',
                    }
                  : null;
              })()}
              metaLeft={
                remainingAfterBurnUi !== null
                  ? `Remaining ${remainingAfterBurnUi} ${shareSymbol}`
                  : settlement.metaLeft
              }
              note={settlement.note}
              solscan={settlement.solscan}
              doneLabel="Done"
              onDone={requestClose}
              againLabel="Redeem more"
              onAgain={resetToEntry}
            />
          </div>
        ) : showInFlight ? (
          <>
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-5 py-[18px]">
              <div className="flex items-center justify-between rounded-xl border border-white/[0.09] bg-bg-elevated px-4 py-3.5">
                <div>
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-ghost">
                    {activeFlow === 'claim' ? 'Claiming' : 'Burning'}
                  </div>
                  <div className="mt-1.5 text-2xl font-medium tracking-[-0.03em] text-foreground">
                    {activeFlow === 'claim' ? (
                      <>
                        {pending
                          ? formatTokenUi(pending.pendingUsdc, USDC_DECIMALS)
                          : '…'}{' '}
                        <span className="font-mono text-xs text-text-faint">USDC</span>
                      </>
                    ) : (
                      <>
                        {burnLabel}{' '}
                        <span className="font-mono text-xs text-text-faint">
                          {shareSymbol}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-ghost">
                    For
                  </div>
                  <div className="mt-2 font-mono text-[15px] text-accent">
                    {activeFlow === 'claim' ? (
                      <span className="text-text-ghost">Wallet</span>
                    ) : quote ? (
                      <>
                        ≈ {quote.usdcUi}{' '}
                        <span className="text-[10.5px] text-text-faint">USDC</span>
                      </>
                    ) : (
                      <span className="text-text-ghost">…</span>
                    )}
                  </div>
                </div>
              </div>

              <TransactionPhases
                flow={activeFlow}
                steps={steps}
                active
                swapLabel={
                  quote && quote.numAssets > 0
                    ? `Swapping ${quote.numAssets} assets to USDC`
                    : undefined
                }
              />
            </div>

            <div className="shrink-0 space-y-2.5 border-t border-white/[0.07] bg-bg-elevated px-5 py-4">
              <div className="flex h-12 items-center justify-center gap-2.5 rounded-[10px] border border-accent/30 bg-accent/15 text-[15px] font-semibold text-accent">
                <Spinner className="size-[15px]" />
                Processing…
              </div>
              <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-ghost">
                {steps.length > 0
                  ? `Step · ${steps[steps.length - 1]?.slice(0, 42) ?? '…'}`
                  : 'Preparing…'}
              </p>
            </div>
          </>
        ) : (
          <form
            onSubmit={handleRedeemSwap}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-5 py-[18px]">
              {checkingPosition && (
                <p className="font-mono text-[10px] text-text-ghost">
                  Checking on-chain position…
                </p>
              )}

              {pending && (
                <div className="rounded-xl border border-accent/25 bg-accent/[0.05] px-4 py-3.5">
                  <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-accent">
                    Pending redeem
                  </p>
                  <p className="mt-1.5 font-mono text-[11px] leading-relaxed tabular-nums text-foreground">
                    {pendingUsdc > 0n
                      ? `${formatTokenUi(pending.pendingUsdc, USDC_DECIMALS)} USDC ready to claim`
                      : 'Assets still converting — press Redeem to resume swaps'}
                  </p>
                </div>
              )}

              {!pending && (
                <>
                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em]">
                    <span className="text-text-dim">Shares to burn</span>
                    <span className="text-text-ghost">
                      Held{' '}
                      <span className="text-[#DADADE]">
                        {shareBalanceUi !== null
                          ? `${shareBalanceUi} ${shareSymbol}`
                          : '…'}
                      </span>
                    </span>
                  </div>

                  <div className="rounded-xl border border-white/16 bg-bg-elevated focus-within:border-accent/50">
                    <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-4">
                      <input
                        className="min-w-0 flex-1 border-0 bg-transparent text-[32px] font-medium tracking-[-0.035em] text-foreground tabular-nums placeholder:text-text-placeholder focus:outline-none disabled:opacity-50"
                        type="text"
                        inputMode="decimal"
                        value={shares}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== '' && !/^\d*\.?\d*$/.test(v)) return;
                          setShares(v);
                        }}
                        placeholder={
                          sharesDecimals === null
                            ? '…'
                            : shareBalanceUi && shareBalance !== '0'
                              ? shareBalanceUi
                              : '0.0'
                        }
                        disabled={sharesDecimals === null}
                        required={!pending}
                        aria-label={`${shareSymbol} shares to burn`}
                      />
                      <span className="flex shrink-0 items-center gap-2 rounded-full border border-white/12 px-3 py-1.5">
                        <span
                          className="inline-block size-[13px] rounded-full bg-accent"
                          aria-hidden
                        />
                        <span className="font-mono text-[11.5px] text-[#DADADE]">
                          {shareSymbol}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 px-4 pb-3.5">
                      <span className="font-mono text-[9.5px] tabular-nums text-[#5E5E64]">
                        {sharesDecimals === null
                          ? 'Resolving decimals…'
                          : rawShares
                            ? `= ${rawShares} raw · ${sharesDecimals} dec`
                            : `Enter a ${shareSymbol} amount`}
                      </span>
                      {shareBalanceUi !== null &&
                        shareBalance !== '0' &&
                        sharesDecimals !== null && (
                          <span className="flex shrink-0 gap-1.5">
                            {[25, 50, 75].map((pct) => (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => setSharesPct(pct)}
                                className="rounded-md border border-white/12 px-2 py-[5px] font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-dim transition-colors hover:border-white/25 hover:text-foreground"
                              >
                                {pct}%
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() =>
                                setShares(formatUnits(shareBalance, sharesDecimals))
                              }
                              className="rounded-md border border-accent/30 bg-accent/10 px-2 py-[5px] font-mono text-[9.5px] uppercase tracking-[0.08em] text-accent transition-colors hover:bg-accent/15"
                            >
                              Max
                            </button>
                          </span>
                        )}
                    </div>
                  </div>

                  {/* YOU RECEIVE quote card */}
                  <div className="rounded-xl border border-accent/25 bg-accent/[0.05] px-4 py-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-dim">
                        You receive
                      </span>
                      <span className="text-right">
                        {previewing && !quote ? (
                          <span className="font-mono text-sm text-text-ghost">…</span>
                        ) : quote ? (
                          <>
                            <span className="font-mono text-xl tabular-nums text-accent">
                              {quote.usdcUi}
                            </span>{' '}
                            <span className="font-mono text-[10.5px] text-text-dim">
                              USDC
                            </span>
                          </>
                        ) : (
                          <span className="font-mono text-xl tabular-nums text-text-placeholder">
                            0.00
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="my-3 h-px bg-accent/15" />
                    <div className="space-y-2 font-mono text-[10.5px] text-text-ghost">
                      <div className="flex items-center justify-between gap-3">
                        <span>Assets to swap</span>
                        <span className="tabular-nums text-[#DADADE]">
                          {quote ? quote.numAssets : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Proceeds / share</span>
                        <span className="tabular-nums text-[#DADADE]">
                          {quote?.proceedsPerShareUi
                            ? `${quote.proceedsPerShareUi} USDC`
                            : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Redeem fee</span>
                        <span className="tabular-nums text-[#DADADE]">
                          {feePctLabel(vault.redeem_fee_bps ?? 0)}
                        </span>
                      </div>
                    </div>
                    {previewError && (
                      <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-destructive">
                        {previewError}
                      </p>
                    )}
                  </div>

                  <div className="flex items-start gap-2.5 font-mono text-[10px] leading-[1.7] text-text-ghost">
                    <span className="shrink-0 text-[#FF9E4D]">!</span>
                    <span>
                      Shares burn and assets swap in one approval; the USDC payout
                      is claimed in the same flow.
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="shrink-0 space-y-2.5 border-t border-white/[0.07] bg-bg-elevated px-5 py-4">
              {readyToClaim ? (
                <button
                  type="button"
                  onClick={handleClaim}
                  disabled={loading || !anchorWallet}
                  className="flex h-12 w-full items-center justify-center rounded-[10px] bg-accent text-[15px] font-semibold tracking-[-0.01em] text-background transition-[transform,background] duration-150 hover:-translate-y-px hover:bg-[#d4ff5c] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {!anchorWallet ? 'Connect wallet' : 'Claim payout'}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    loading ||
                    !anchorWallet ||
                    sharesDecimals === null ||
                    (!pending && !shares.trim())
                  }
                  className="flex h-12 w-full items-center justify-center rounded-[10px] bg-accent text-[15px] font-semibold tracking-[-0.01em] text-background transition-[transform,background] duration-150 hover:-translate-y-px hover:bg-[#d4ff5c] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {!anchorWallet
                    ? 'Connect wallet'
                    : pending
                      ? 'Resume redeem'
                      : 'Redeem & claim'}
                </button>
              )}
              <div className="flex items-center justify-between gap-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-ghost">
                <span>2 transactions · one approval</span>
                {pending && !readyToClaim && (
                  <button
                    type="button"
                    onClick={handleClaim}
                    disabled
                    className="text-text-dim underline disabled:cursor-not-allowed"
                    title="Available once all swap legs complete"
                  >
                    Claim pending payout
                  </button>
                )}
                {readyToClaim && (
                  <span className="text-accent">Claim ready</span>
                )}
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
