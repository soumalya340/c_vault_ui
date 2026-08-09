'use client';

/**
 * Redeem progress modal — in-flight + settled only.
 * Share amount entry lives on the vault action panel (or is passed via `shares`).
 * Claim-only resumes when on-chain pending USDC is ready.
 * Layout matches `cVault-6A-Transaction-Modals.html` states 02 / 03.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BN } from '@coral-xyz/anchor';
import { getMint, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { useConnection, useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import {
  getUserPosition,
  getUserUsdcBalance,
  previewRedeem,
  redeemSwap,
  claim,
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

/** Human-readable token amount with thousands separators; exact string math. */
function formatTokenUi(raw: string, decimals: number): string {
  const ui = formatUnits(raw, decimals);
  const [whole, frac] = ui.split('.');
  const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${wholeFmt}.${frac}` : wholeFmt;
}

function shortAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

type PreviewQuote = {
  usdcUi: string;
  numAssets: number;
};

export function RedeemModal({
  vault,
  network,
  onClose,
  shares: sharesProp,
}: {
  vault: VaultRecord;
  network: Network;
  onClose: () => void;
  /**
   * Human-unit share amount to burn. Optional when resuming a claim-only
   * redeem (pending USDC already escrowed).
   */
  shares?: string;
}) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey } = useWallet();
  const { requestClose, modalClassName, backdropClassName, isClosing } =
    useModalTransition(onClose);

  const shares = (sharesProp ?? '').trim();
  const [quote, setQuote] = useState<PreviewQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [activeFlow, setActiveFlow] = useState<'redeem' | 'claim'>('redeem');
  const [errorModal, setErrorModal] = useState<UserFacingError | null>(null);
  /** Sticky across error-modal dismissal, so the checklist stays truthful. */
  const [failed, setFailed] = useState(false);
  /**
   * Settled redeem — shares burned and the USDC that actually landed in the
   * wallet. `usdcRaw` is a measured wallet delta; `sharesRaw` is null when the
   * user resumed a pending redeem without re-entering an amount.
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
  const [shareBalance, setShareBalance] = useState<string>('0');
  const [sharesDecimals, setSharesDecimals] = useState<number | null>(null);
  const [positionReady, setPositionReady] = useState(false);

  const startedRef = useRef(false);

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
        if (!cancelled) setSharesDecimals(6);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, vault.vault_id, network]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!publicKey) {
        await Promise.resolve();
        if (!cancelled) {
          setShareBalance('0');
          setPending(null);
          setPositionReady(true);
        }
        return;
      }
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
        if (!cancelled) setPositionReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey, connection, vault.vault_id, network]);

  const readUsdcBalance = useCallback(async (): Promise<string | null> => {
    if (!publicKey) return null;
    try {
      return await getUserUsdcBalance(connection, publicKey, network);
    } catch {
      return null;
    }
  }, [publicKey, connection, network]);

  const measureUsdcDelta = (before: string | null, after: string | null): string | null => {
    if (before === null || after === null) return null;
    try {
      const delta = BigInt(after) - BigInt(before);
      return delta > 0n ? delta.toString() : null;
    } catch {
      return null;
    }
  };

  const pendingUsdc = pending ? BigInt(pending.pendingUsdc) : 0n;
  const readyToClaim = pendingUsdc > 0n;

  // Preview for in-flight "FOR ≈" when burning shares.
  useEffect(() => {
    if (sharesDecimals === null || !shares || readyToClaim) return;
    let cancelled = false;
    let raw: BN;
    try {
      raw = parseUnits(shares, sharesDecimals);
      if (raw.isZero()) return;
    } catch {
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const r = await previewRedeem(
          connection,
          vault.vault_id,
          raw,
          network,
          anchorWallet,
        );
        if (cancelled) return;
        setQuote({
          usdcUi: formatTokenUi(r.estimatedUsdcValue, USDC_DECIMALS),
          numAssets: r.numAssets,
        });
      } catch {
        // best-effort
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shares, sharesDecimals, readyToClaim, connection, vault.vault_id, network, anchorWallet]);

  const runRedeem = useCallback(async () => {
    if (!anchorWallet) return;
    setActiveFlow('redeem');
    setLoading(true);
    setSteps([]);
    setSettlement(null);
    setFailed(false);
    try {
      let sharesBn: BN | null = null;
      if (shares && sharesDecimals !== null) {
        sharesBn = parseUnits(shares, sharesDecimals);
      }
      const usdcBefore = await readUsdcBalance();
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
      const remainingUi =
        sharesDecimals !== null
          ? formatTokenUi(
              sharesBn && BigInt(shareBalance) >= BigInt(sharesBn.toString())
                ? (BigInt(shareBalance) - BigInt(sharesBn.toString())).toString()
                : shareBalance,
              sharesDecimals,
            )
          : null;
      const shareSymbol = (vault.symbol || 'SHARES').toUpperCase();
      setSettlement({
        sharesRaw: sharesBn ? sharesBn.toString() : null,
        usdcRaw: measureUsdcDelta(usdcBefore, usdcAfter),
        note: altNote || null,
        metaLeft:
          remainingUi !== null
            ? `Remaining ${remainingUi} ${shareSymbol}`
            : `${r.signatures.length} transaction${r.signatures.length === 1 ? '' : 's'} · one approval`,
        solscan: r.link,
      });
    } catch (err) {
      setErrorModal(parseTxError(err));
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [
    anchorWallet,
    shares,
    sharesDecimals,
    readUsdcBalance,
    connection,
    vault.vault_id,
    vault.alt_address,
    vault.symbol,
    network,
    shareBalance,
  ]);

  const runClaim = useCallback(async () => {
    if (!anchorWallet) return;
    setActiveFlow('claim');
    setLoading(true);
    setSteps([]);
    setSettlement(null);
    setFailed(false);
    try {
      setSteps(['Claiming USDC payout…']);
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
    } catch (err) {
      setErrorModal(parseTxError(err));
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [
    anchorWallet,
    pendingUsdc,
    readUsdcBalance,
    connection,
    vault.vault_id,
    network,
  ]);

  // Auto-start once position + wallet are ready.
  //
  // Deferred to a microtask (not setTimeout) so the first state update lands
  // outside the effect body, and deliberately left uncancelled: React
  // StrictMode double-mounts in dev, so a cleanup that aborted the start would
  // drop the call while `startedRef` stayed true — the remount would then bail
  // out and no wallet prompt would ever appear. `startedRef` alone guarantees
  // this runs exactly once.
  useEffect(() => {
    if (startedRef.current || !positionReady || !anchorWallet || settlement) return;
    if (readyToClaim) {
      startedRef.current = true;
      void Promise.resolve().then(runClaim);
      return;
    }
    if (shares && sharesDecimals !== null) {
      startedRef.current = true;
      void Promise.resolve().then(runRedeem);
    }
  }, [
    positionReady,
    anchorWallet,
    settlement,
    readyToClaim,
    shares,
    sharesDecimals,
    runClaim,
    runRedeem,
  ]);

  const showInFlight = !settlement;
  const vaultName = displayVaultName(vault.name);
  const addrShort = shortAddr(vault.vault_address);
  const shareSymbol = (vault.symbol || 'SHARES').toUpperCase();
  const burnLabel = shares || '…';
  const canStart = Boolean(anchorWallet && (readyToClaim || (shares && sharesDecimals !== null)));
  /**
   * The redeem auto-starts, so from the moment the modal opens until it either
   * errors or settles the user is mid-flow — even during the brief async setup
   * before `loading` flips. Treat that whole window as busy so the footer never
   * offers a misleading "Close" a beat before the wallet prompt appears.
   */
  const busy = loading || (!failed && !settlement && canStart);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {errorModal && (
        <ErrorModal
          error={errorModal}
          onClose={() => {
            setErrorModal(null);
            if (!settlement) requestClose();
          }}
          network={network}
          vaultId={vault.vault_id}
        />
      )}
      <div
        className={`absolute inset-0 bg-black/75 backdrop-blur-sm ${backdropClassName}`}
        onClick={() => {
          if (!isClosing && !busy) requestClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Redeem from ${vaultName}`}
        className={`relative z-10 flex w-full max-w-[396px] max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-background shadow-[0_24px_60px_rgba(0,0,0,0.55)] ${modalClassName}`}
      >
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
          {showInFlight && busy ? (
            <span className="rounded-full bg-accent/10 px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-accent">
              In flight
            </span>
          ) : (
            <button
              type="button"
              onClick={requestClose}
              disabled={isClosing || busy}
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
              metaLeft={settlement.metaLeft}
              note={settlement.note}
              solscan={settlement.solscan}
              doneLabel="Done"
              onDone={requestClose}
            />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-5 py-[18px]">
              {!anchorWallet ? (
                <p className="font-mono text-[12px] leading-relaxed text-text-ghost">
                  Connect a wallet to redeem.
                </p>
              ) : !canStart && positionReady ? (
                <p className="font-mono text-[12px] leading-relaxed text-text-ghost">
                  Enter a share amount on the vault page, then redeem.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-xl border border-white/[0.09] bg-bg-elevated px-4 py-3.5">
                    <div>
                      <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-ghost">
                        {activeFlow === 'claim' || readyToClaim ? 'Claiming' : 'Burning'}
                      </div>
                      <div className="mt-1.5 text-2xl font-medium tracking-[-0.03em] text-foreground">
                        {activeFlow === 'claim' || readyToClaim ? (
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
                        {activeFlow === 'claim' || readyToClaim ? (
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
                    flow={activeFlow === 'claim' || readyToClaim ? 'claim' : 'redeem'}
                    steps={steps}
                    status={loading ? 'running' : failed ? 'failed' : 'pending'}
                    swapLabel={
                      quote && quote.numAssets > 0
                        ? `Swapping ${quote.numAssets} assets to USDC`
                        : undefined
                    }
                  />
                </>
              )}
            </div>

            <div className="shrink-0 space-y-2.5 border-t border-white/[0.07] bg-bg-elevated px-5 py-4">
              {busy ? (
                <>
                  <div className="flex h-12 items-center justify-center gap-2.5 rounded-[10px] border border-accent/30 bg-accent/15 text-[15px] font-semibold text-accent">
                    <Spinner className="size-[15px]" />
                    {loading ? 'Processing…' : 'Preparing…'}
                  </div>
                  <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-ghost">
                    {steps.length > 0
                      ? `Step · ${steps[steps.length - 1]?.slice(0, 42) ?? '…'}`
                      : 'Approve in your wallet'}
                  </p>
                </>
              ) : (
                <button
                  type="button"
                  onClick={requestClose}
                  className="flex h-12 w-full items-center justify-center rounded-[10px] border border-white/14 text-[14.5px] font-medium text-[#DADADE] transition-colors hover:bg-white/[0.04]"
                >
                  Close
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
