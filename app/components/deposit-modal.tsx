'use client';

import { useEffect, useRef, useState } from 'react';
import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import {
  depositAndDeploy,
  previewDeposit,
  parseUnits,
  formatUnits,
  fetchMintDecimals,
  getUserUsdcBalance,
  getUserPosition,
  deriveVaultPdas,
  describePreviewError,
  NETWORK_CONSTANTS,
  type Network,
} from '@/lib/onchain/cvault';
import { PRICE_SCALE_DECIMALS, USDC_DECIMALS } from '@/lib/constants';
import { parseTxError, type UserFacingError } from '@/lib/onchain/txError';
import { useConnection, useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { fetchTokens, updateVaultAlts, type VaultRecord } from '@/lib/registryClient';
import { ErrorModal } from './error-modal';
import { useModalTransition } from './use-modal-transition';
import { displayVaultName } from './view-display';
import { SettlementReceipt, groupDecimal, settlementRate } from './settlement-receipt';
import { TransactionPhases } from './transaction-phases';
import { Spinner } from '@/components/ui/spinner';

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
  sharesUi: string;
  navUi: string;
  priceUi: string;
  sharesRaw: string;
};

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
  const { publicKey } = useWallet();
  const { requestClose, modalClassName, backdropClassName, isClosing } =
    useModalTransition(onClose);

  const [amount, setAmount] = useState('');
  const [slippageOn, setSlippageOn] = useState(false);
  const [minSharesOut, setMinSharesOut] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [quote, setQuote] = useState<PreviewQuote | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [lastError, setLastError] = useState<UserFacingError | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  /**
   * Settled deposit — what the user paid and the shares actually minted to
   * them. `sharesRaw` is a measured balance delta and stays null when the
   * post-deposit read fails, so the receipt never invents a share count.
   */
  const [settlement, setSettlement] = useState<{
    usdcRaw: string;
    sharesRaw: string | null;
    note: string | null;
    metaLeft: string;
    solscan?: string;
  } | null>(null);

  // Quote mint is always network USDC (program constant) — not stored on the
  // vaults row. Label as USDC immediately; registry/on-chain only refine
  // decimals (and a custom symbol if the catalog ever renames it).
  const [baseDecimals, setBaseDecimals] = useState<number | null>(USDC_DECIMALS);
  const [baseSymbol, setBaseSymbol] = useState('USDC');

  const baseMint = NETWORK_CONSTANTS[network].usdcMint.toBase58();

  // Wallet's USDC balance — what the user can actually deposit.
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);

  // Vault share-token decimals — needed to show the deposit preview
  // ("≈ 0.98 BC shares") and the min-shares-out field in human units.
  const [sharesDecimals, setSharesDecimals] = useState<number | null>(null);

  const previewSeq = useRef(0);

  const refreshUsdcBalance = async () => {
    if (!publicKey) {
      setUsdcBalance(null);
      return;
    }
    setCheckingBalance(true);
    try {
      const bal = await getUserUsdcBalance(connection, publicKey, network);
      setUsdcBalance(bal);
    } catch {
      setUsdcBalance(null);
    } finally {
      setCheckingBalance(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!publicKey) {
        // Defer so we don't setState synchronously in the effect body.
        await Promise.resolve();
        if (!cancelled) setUsdcBalance(null);
        return;
      }
      setCheckingBalance(true);
      try {
        const bal = await getUserUsdcBalance(connection, publicKey, network);
        if (!cancelled) setUsdcBalance(bal);
      } catch {
        if (!cancelled) setUsdcBalance(null);
      } finally {
        if (!cancelled) setCheckingBalance(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey, network, connection]);

  /**
   * Raw share-token balance for the connected wallet, or null if it can't be
   * read. Sampled either side of the deposit to measure shares minted —
   * `depositAndDeploy` reports signatures only.
   */
  const readShareBalance = async (): Promise<string | null> => {
    if (!publicKey) return null;
    try {
      const pos = await getUserPosition(connection, vault.vault_id, publicKey, network);
      return pos.shareBalance;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { sharesMint } = deriveVaultPdas(vault.vault_id, network);
        const mintInfo = await getMint(connection, sharesMint, undefined, TOKEN_2022_PROGRAM_ID);
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
      try {
        const tokens = await fetchTokens();
        const match = tokens.find((t) => t.mint === baseMint);
        if (match) {
          if (!cancelled) {
            setBaseDecimals(match.decimals);
            // Keep a readable ticker even if the catalog uses a long name.
            setBaseSymbol(match.symbol?.trim() || 'USDC');
          }
          return;
        }
      } catch {
        // Registry unavailable — fall through to the on-chain mint read.
      }
      try {
        const decimals = await fetchMintDecimals(connection, new PublicKey(baseMint));
        if (!cancelled) {
          setBaseDecimals(decimals);
          setBaseSymbol('USDC');
        }
      } catch {
        // Keep USDC_DECIMALS + "USDC" defaults — quote mint is always USDC.
        if (!cancelled) {
          setBaseDecimals(USDC_DECIMALS);
          setBaseSymbol('USDC');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, baseMint]);

  // Live raw-unit echo shown under the amount field — demoted to a small
  // muted aside; the primary display is always the human-readable amount.
  let rawUnits: string | null = null;
  if (baseDecimals !== null && amount.trim()) {
    try {
      rawUnits = parseUnits(amount, baseDecimals).toString();
    } catch {
      rawUnits = null;
    }
  }

  const usdcBalanceUi =
    usdcBalance !== null ? formatTokenUi(usdcBalance, baseDecimals ?? 6) : null;
  const insufficientBalance =
    usdcBalance !== null && rawUnits !== null && BigInt(rawUnits) > BigInt(usdcBalance);

  // Debounced live preview — matches 6A YOU RECEIVE card (no manual Preview button).
  useEffect(() => {
    const seq = ++previewSeq.current;
    let cancelled = false;

    const clearQuote = () => {
      if (cancelled || previewSeq.current !== seq) return;
      setQuote(null);
      setPreviewError(null);
      setPreviewing(false);
    };

    if (baseDecimals === null || !amount.trim() || insufficientBalance) {
      const t = window.setTimeout(clearQuote, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }

    let raw: BN;
    try {
      raw = parseUnits(amount, baseDecimals);
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
        const r = await previewDeposit(
          connection,
          vault.vault_id,
          raw,
          network,
          anchorWallet,
        );
        if (cancelled || previewSeq.current !== seq) return;
        const decimals = sharesDecimals ?? 6;
        setQuote({
          sharesUi: formatTokenUi(r.sharesToMint, decimals),
          navUi: formatTokenUi(r.totalNav, baseDecimals),
          priceUi: formatTokenUi(r.sharePrice, PRICE_SCALE_DECIMALS),
          sharesRaw: r.sharesToMint,
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
  }, [
    amount,
    baseDecimals,
    sharesDecimals,
    connection,
    vault.vault_id,
    network,
    anchorWallet,
    insufficientBalance,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!anchorWallet) return;
    if (baseDecimals === null) {
      setLastError({
        kind: 'error',
        title: 'USDC decimals not loaded yet',
        summary: 'Try again in a moment.',
        raw: 'USDC decimals not loaded yet — try again in a moment.',
      });
      setErrorOpen(true);
      return;
    }
    setLoading(true);
    setSteps([]);
    setSettlement(null);
    try {
      if (!amount.trim()) throw new Error('Enter an amount.');
      const rawAmount = parseUnits(amount, baseDecimals);
      // Sample shares before signing so the post-deposit delta is attributable
      // to this deposit alone.
      const sharesBefore = await readShareBalance();
      const rawMinShares =
        slippageOn && minSharesOut.trim()
          ? parseUnits(minSharesOut.trim(), sharesDecimals ?? 6)
          : new BN(0);
      const r = await depositAndDeploy(
        connection,
        anchorWallet,
        vault.vault_id,
        rawAmount,
        rawMinShares,
        vault.alt_address,
        network,
        (message) => setSteps((prev) => [...prev, message]),
      );
      // If create_etf never saved an ALT (or it died), deposit just rebuilt it —
      // persist so future deposits/redeems reuse the same table.
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
      const multiTx = r.signatures.length > 1;
      // Shares minted = post-deposit balance − pre-deposit balance. Null when
      // either sample failed, so the receipt shows "not recorded" rather than
      // a wrong number.
      const sharesAfter = await readShareBalance();
      let sharesMintedRaw: string | null = null;
      if (sharesBefore !== null && sharesAfter !== null) {
        try {
          const delta = BigInt(sharesAfter) - BigInt(sharesBefore);
          if (delta > 0n) sharesMintedRaw = delta.toString();
        } catch {
          sharesMintedRaw = null;
        }
      }
      setSettlement({
        usdcRaw: rawAmount.toString(),
        sharesRaw: sharesMintedRaw,
        note: altNote || null,
        metaLeft: multiTx
          ? `${r.signatures.length} transactions · setup + swaps`
          : '1 transaction · swaps included',
        solscan: r.link,
      });
      setAmount('');
      setMinSharesOut('');
      setSlippageOn(false);
      setQuote(null);
      await refreshUsdcBalance();
    } catch (err) {
      const parsed = parseTxError(err);
      setLastError(parsed);
      setErrorOpen(true);
      await refreshUsdcBalance();
    } finally {
      setLoading(false);
    }
  };

  const setAmountPct = (pct: number) => {
    if (baseDecimals === null || usdcBalance === null) return;
    try {
      const raw = (BigInt(usdcBalance) * BigInt(pct)) / 100n;
      setAmount(formatUnits(raw.toString(), baseDecimals));
    } catch {
      // ignore bad balance strings
    }
  };

  const showInFlight = loading && !settlement;
  const vaultName = displayVaultName(vault.name);
  const addrShort = shortAddr(vault.vault_address);
  const shareSymbol = (vault.symbol || 'SHARES').toUpperCase();
  // Amount stays set while signing; only cleared after settlement.
  const depositAmountLabel = amount.trim() || '—';

  const resetToEntry = () => {
    setSettlement(null);
    setSteps([]);
    setQuote(null);
    setPreviewError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {errorOpen && lastError && (
        <ErrorModal
          error={lastError}
          onClose={() => setErrorOpen(false)}
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
        aria-label={`Deposit into ${vaultName}`}
        className={`relative z-10 flex w-full max-w-[396px] max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-background shadow-[0_24px_60px_rgba(0,0,0,0.55)] ${modalClassName}`}
      >
        {/* ── Header ───────────────────────────────────────────── */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.07] px-5 pb-4 pt-[18px]">
          <div>
            <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-accent">
              Deposit
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
              kind="deposit"
              vaultId={vault.vault_id}
              surrendered={{
                label: 'Deposited',
                amount: groupDecimal(
                  formatUnits(settlement.usdcRaw, baseDecimals ?? USDC_DECIMALS),
                ),
                unit: baseSymbol,
              }}
              issued={{
                label: 'Shares received',
                amount:
                  settlement.sharesRaw !== null
                    ? groupDecimal(
                        formatUnits(settlement.sharesRaw, sharesDecimals ?? 6),
                      )
                    : null,
                unit: shareSymbol,
              }}
              rate={(() => {
                const value = settlementRate(
                  settlement.usdcRaw,
                  baseDecimals ?? USDC_DECIMALS,
                  settlement.sharesRaw,
                  sharesDecimals ?? 6,
                );
                return value
                  ? {
                      label: 'Cost per share',
                      value,
                      unit: baseSymbol,
                    }
                  : null;
              })()}
              metaLeft={settlement.metaLeft}
              note={settlement.note}
              solscan={settlement.solscan}
              doneLabel="Done"
              onDone={requestClose}
              againLabel="Deposit again"
              onAgain={resetToEntry}
            />
          </div>
        ) : showInFlight ? (
          <>
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-5 py-[18px]">
              <div className="flex items-center justify-between rounded-xl border border-white/[0.09] bg-bg-elevated px-4 py-3.5">
                <div>
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-ghost">
                    Depositing
                  </div>
                  <div className="mt-1.5 text-2xl font-medium tracking-[-0.03em] text-foreground">
                    {depositAmountLabel}{' '}
                    <span className="font-mono text-xs text-text-faint">{baseSymbol}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-ghost">
                    For
                  </div>
                  <div className="mt-2 font-mono text-[15px] text-accent">
                    {quote ? (
                      <>
                        ≈ {quote.sharesUi}{' '}
                        <span className="text-[10.5px] text-text-faint">{shareSymbol}</span>
                      </>
                    ) : (
                      <span className="text-text-ghost">…</span>
                    )}
                  </div>
                </div>
              </div>

              <TransactionPhases flow="deposit" steps={steps} active />
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
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-5 py-[18px]">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em]">
                <span className="text-text-dim">Amount</span>
                {publicKey && (
                  <span className="text-text-ghost">
                    Wallet{' '}
                    <span className="text-[#DADADE]">
                      {checkingBalance
                        ? '…'
                        : usdcBalanceUi !== null
                          ? `${usdcBalanceUi} ${baseSymbol}`
                          : '—'}
                    </span>
                  </span>
                )}
              </div>

              <div
                className={`rounded-xl border bg-bg-elevated ${
                  insufficientBalance
                    ? 'border-destructive/50'
                    : 'border-white/16 focus-within:border-accent/50'
                }`}
              >
                <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-4">
                  <input
                    className="min-w-0 flex-1 border-0 bg-transparent text-[32px] font-medium tracking-[-0.035em] text-foreground tabular-nums placeholder:text-text-placeholder focus:outline-none disabled:opacity-50"
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v !== '' && !/^\d*\.?\d*$/.test(v)) return;
                      setAmount(v);
                    }}
                    placeholder={baseDecimals === null ? '…' : '0.0'}
                    disabled={baseDecimals === null}
                    required
                    aria-label={`${baseSymbol} amount`}
                  />
                  <span className="flex shrink-0 items-center gap-2 rounded-full border border-white/12 px-3 py-1.5">
                    <span
                      className="inline-block size-[13px] rounded-full bg-[#5AC8E8]"
                      aria-hidden
                    />
                    <span className="font-mono text-[11.5px] text-[#DADADE]">
                      {baseSymbol}
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 px-4 pb-3.5">
                  <span
                    className={`font-mono text-[9.5px] tabular-nums ${
                      insufficientBalance ? 'text-destructive' : 'text-[#5E5E64]'
                    }`}
                  >
                    {baseDecimals === null
                      ? 'Resolving decimals…'
                      : insufficientBalance
                        ? `Exceeds wallet (${usdcBalanceUi} ${baseSymbol})`
                        : rawUnits
                          ? `= ${rawUnits} raw · ${baseDecimals} dec`
                          : `Enter a ${baseSymbol} amount`}
                  </span>
                  {publicKey &&
                    usdcBalanceUi !== null &&
                    usdcBalance !== '0' &&
                    baseDecimals !== null && (
                      <span className="flex shrink-0 gap-1.5">
                        {[25, 50, 75].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setAmountPct(pct)}
                            className="rounded-md border border-white/12 px-2 py-[5px] font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-dim transition-colors hover:border-white/25 hover:text-foreground"
                          >
                            {pct}%
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setAmount(formatUnits(usdcBalance!, baseDecimals))
                          }
                          className="rounded-md border border-accent/30 bg-accent/10 px-2 py-[5px] font-mono text-[9.5px] uppercase tracking-[0.08em] text-accent transition-colors hover:bg-accent/15"
                        >
                          Max
                        </button>
                      </span>
                    )}
                </div>
              </div>

              {/* Slippage guard toggle */}
              <div className="rounded-[10px] border border-white/[0.09] bg-bg-elevated px-3.5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dim">
                    Slippage guard{' '}
                    <span className="text-[#5E5E64]">· min shares out</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={slippageOn}
                    onClick={() => {
                      setSlippageOn((v) => {
                        if (v) setMinSharesOut('');
                        return !v;
                      });
                    }}
                    className="flex items-center gap-2"
                  >
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-text-ghost">
                      {slippageOn ? 'On' : 'Off'}
                    </span>
                    <span
                      className={`flex h-[17px] w-[30px] items-center rounded-full p-[3px] transition-colors ${
                        slippageOn ? 'bg-accent/30' : 'bg-white/10'
                      }`}
                    >
                      <span
                        className={`size-[11px] rounded-full transition-transform ${
                          slippageOn
                            ? 'translate-x-[13px] bg-accent'
                            : 'translate-x-0 bg-text-ghost'
                        }`}
                      />
                    </span>
                  </button>
                </div>
                {slippageOn && (
                  <input
                    className="mt-2.5 w-full rounded-lg border border-white/[0.09] bg-background px-3 py-2.5 font-mono text-sm tabular-nums text-foreground placeholder:text-text-placeholder focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    type="text"
                    inputMode="decimal"
                    value={minSharesOut}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v !== '' && !/^\d*\.?\d*$/.test(v)) return;
                      setMinSharesOut(v);
                    }}
                    placeholder={`0.0 ${shareSymbol}`}
                    aria-label="Minimum shares out"
                  />
                )}
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
                          {quote.sharesUi}
                        </span>{' '}
                        <span className="font-mono text-[10.5px] text-text-dim">
                          {shareSymbol}
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
                    <span>Price / share</span>
                    <span className="tabular-nums text-[#DADADE]">
                      {quote ? `$${quote.priceUi}` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Vault NAV</span>
                    <span className="tabular-nums text-[#DADADE]">
                      {quote ? `$${quote.navUi}` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Deposit fee</span>
                    <span className="tabular-nums text-[#DADADE]">
                      {feePctLabel(vault.deposit_fee_bps ?? 0)}
                    </span>
                  </div>
                </div>
                {previewError && (
                  <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-destructive">
                    {previewError}
                  </p>
                )}
              </div>
            </div>

            <div className="shrink-0 space-y-2.5 border-t border-white/[0.07] bg-bg-elevated px-5 py-4">
              <button
                type="submit"
                disabled={
                  loading ||
                  !anchorWallet ||
                  insufficientBalance ||
                  !amount.trim() ||
                  baseDecimals === null
                }
                className="flex h-12 w-full items-center justify-center rounded-[10px] bg-accent text-[15px] font-semibold tracking-[-0.01em] text-background transition-[transform,background] duration-150 hover:-translate-y-px hover:bg-[#d4ff5c] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {!anchorWallet
                  ? 'Connect wallet'
                  : amount.trim()
                    ? `Deposit ${amount} ${baseSymbol}`
                    : 'Deposit'}
              </button>
              <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-ghost">
                2 transactions · one approval
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
