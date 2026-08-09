'use client';

import { useEffect, useState } from 'react';
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
import { isTwapRefreshableError, parseTxError, type UserFacingError } from '@/lib/onchain/txError';
import { useConnection, useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { fetchTokens, updateVaultAlts, type VaultRecord } from '@/lib/registryClient';
import { ErrorModal } from './error-modal';
import { LedgerOutput } from './ledger-output';
import {
  btnPrimaryClass,
  fieldLabelClass,
  outputPanelClass,
} from './ui-classes';
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
  const [minSharesOut, setMinSharesOut] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);
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
    refreshUsdcBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, network]);

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

  const handlePreview = async () => {
    if (baseDecimals === null) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const raw = parseUnits(amount || '0', baseDecimals);
      const r = await previewDeposit(connection, vault.vault_id, raw, network, anchorWallet);
      const decimals = sharesDecimals ?? 6;
      const sharesUi = formatTokenUi(r.sharesToMint, decimals);
      const navUi = formatTokenUi(r.totalNav, baseDecimals);
      const priceUi = formatTokenUi(r.sharePrice, PRICE_SCALE_DECIMALS);
      setPreview(
        `≈ ${sharesUi} ${vault.symbol} shares · vault NAV $${navUi} · price $${priceUi}/share`,
      );
    } catch (err) {
      setPreview(describePreviewError(err));
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!anchorWallet) return;
    if (baseDecimals === null) {
      setResult({
        type: 'error',
        text: 'USDC decimals not loaded yet — try again in a moment.',
      });
      return;
    }
    setLoading(true);
    setResult(null);
    setSteps([]);
    setSettlement(null);
    try {
      if (!amount.trim()) throw new Error('Enter an amount.');
      const rawAmount = parseUnits(amount, baseDecimals);
      // Sample shares before signing so the post-deposit delta is attributable
      // to this deposit alone.
      const sharesBefore = await readShareBalance();
      const rawMinShares = minSharesOut.trim()
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
            ? `\nALT created + saved: ${r.altAddress}`
            : `\nALT saved: ${r.altAddress}`;
        } catch (err) {
          altNote =
            `\nALT live (${r.altAddress}) but DB save failed: ` +
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
        note:
          (multiTx
            ? `${r.signatures.length} transactions (setup + swaps).`
            : 'Swaps executed in the same transaction.') + altNote,
        solscan: r.link,
      });
      setResult({
        type: 'success',
        text:
          (multiTx
            ? `Deposited into vault №${vault.vault_id} — ${r.signatures.length} transactions (setup + swaps).`
            : `Deposited into vault №${vault.vault_id} — swaps executed in the same transaction.`) +
          altNote,
        solscan: r.link,
      });
      setAmount('');
      await refreshUsdcBalance();
    } catch (err) {
      const parsed = parseTxError(err);
      setLastError(parsed);
      setErrorOpen(true);
      setResult({
        type: parsed.kind === 'info' ? 'info' : 'error',
        text: parsed.title,
      });
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
        aria-label={`Deposit into ${displayVaultName(vault.name)}`}
        className={`relative z-10 flex w-full max-w-[420px] max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-background shadow-2xl ${modalClassName}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-accent">
              Deposit · № {String(vault.vault_id).padStart(2, '0')}
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">
              {displayVaultName(vault.name)}
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-text-ghost">
              {vault.vault_address.slice(0, 4)}…{vault.vault_address.slice(-4)}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={isClosing || loading}
            aria-label="Close"
            className="rounded-full px-3 py-1.5 font-mono text-xs text-text-dim transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {settlement ? (
          <div className="overflow-y-auto px-5 py-5">
            <SettlementReceipt
              kind="deposit"
              vaultId={vault.vault_id}
              surrendered={{
                label: 'Deposited',
                amount: groupDecimal(formatUnits(settlement.usdcRaw, baseDecimals ?? USDC_DECIMALS)),
                unit: baseSymbol,
              }}
              issued={{
                label: 'Shares received',
                amount:
                  settlement.sharesRaw !== null
                    ? groupDecimal(formatUnits(settlement.sharesRaw, sharesDecimals ?? 6))
                    : null,
                unit: vault.symbol,
              }}
              rate={(() => {
                const value = settlementRate(
                  settlement.usdcRaw,
                  baseDecimals ?? USDC_DECIMALS,
                  settlement.sharesRaw,
                  sharesDecimals ?? 6,
                );
                return value
                  ? { label: 'Cost per share', value: `${value} ${baseSymbol}` }
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
              className="mt-3 w-full rounded-full border border-white/14 px-5 py-2.5 text-[13.5px] font-medium text-foreground transition-colors hover:bg-white/[0.06]"
            >
              Deposit again
            </button>
          </div>
        ) : showInFlight ? (
          <div className="space-y-4 overflow-y-auto px-5 py-5">
            <div className="rounded-[12px] border border-white/[0.07] bg-bg-elevated px-4 py-4">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-ghost">
                In flight
              </div>
              <div className="mt-2 text-[15px] text-foreground">
                Depositing{' '}
                <span className="font-mono font-semibold tabular-nums text-accent">
                  {amount || '—'} {baseSymbol}
                </span>
              </div>
            </div>
            <TransactionPhases flow="deposit" steps={steps} active />
            <div className="flex items-center justify-center gap-2 rounded-[10px] bg-accent/10 px-4 py-3.5 text-[15px] font-semibold text-accent">
              <Spinner className="size-4" />
              Processing…
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto px-5 py-5">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className={fieldLabelClass}>Amount</label>
              {publicKey && (
                <span className="font-mono text-[11px] tabular-nums text-text-faint">
                  Wallet{' '}
                  <span className="text-foreground">
                    {checkingBalance
                      ? '…'
                      : usdcBalanceUi !== null
                        ? `${usdcBalanceUi} ${baseSymbol}`
                        : '—'}
                  </span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 rounded-[10px] border border-white/[0.09] bg-bg-elevated px-3.5 py-1 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
              <input
                className="min-w-0 flex-1 border-0 bg-transparent py-3 font-mono text-[22px] font-medium tabular-nums text-foreground placeholder:text-text-placeholder focus:outline-none disabled:opacity-50"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={baseDecimals === null ? '…' : '0.0'}
                disabled={baseDecimals === null}
                required
              />
              <span className="shrink-0 rounded-full bg-white/[0.06] px-3 py-1.5 font-mono text-[12px] font-medium text-foreground">
                {baseSymbol}
              </span>
            </div>
            <p
              className={`mt-1.5 font-mono text-[11px] tabular-nums ${
                insufficientBalance ? 'text-destructive' : 'text-text-ghost'
              }`}
            >
              {baseDecimals === null
                ? 'Resolving USDC decimals…'
                : insufficientBalance
                  ? `Exceeds wallet balance (${usdcBalanceUi} ${baseSymbol} available)`
                  : rawUnits
                    ? `= ${rawUnits} raw · ${baseDecimals} dec`
                    : `Enter a ${baseSymbol} amount`}
            </p>
            {publicKey && usdcBalanceUi !== null && usdcBalance !== '0' && baseDecimals !== null && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {[25, 50, 75].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setAmountPct(pct)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] text-text-dim transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    {pct}%
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setAmount(formatUnits(usdcBalance!, baseDecimals))}
                  className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 font-mono text-[11px] text-accent transition-colors hover:bg-accent/15"
                >
                  Max
                </button>
              </div>
            )}
          </div>

          <div className="rounded-[10px] border border-white/[0.09] bg-bg-elevated px-3.5 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-dim">
                Slippage guard <span className="text-text-ghost">· min shares out</span>
              </label>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-ghost">
                {minSharesOut.trim() ? 'On' : 'Off'}
              </span>
            </div>
            <input
              className="w-full rounded-[8px] border border-white/[0.09] bg-background px-3 py-2.5 font-mono text-sm tabular-nums text-foreground placeholder:text-text-placeholder focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              type="text"
              inputMode="decimal"
              value={minSharesOut}
              onChange={(e) => setMinSharesOut(e.target.value)}
              placeholder={`0.0 ${vault.symbol}`}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewing || !amount.trim() || baseDecimals === null}
              className="rounded-full border border-white/14 px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.06] disabled:opacity-40"
            >
              {previewing ? 'Previewing…' : 'Preview'}
            </button>
            {preview && (
              <span className="font-mono text-[11px] tabular-nums leading-relaxed text-muted-foreground">
                {preview}
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !anchorWallet || insufficientBalance}
            className={btnPrimaryClass + ' w-full'}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="size-3.5" />
                Processing…
              </span>
            ) : anchorWallet ? (
              amount.trim()
                ? `Deposit ${amount} ${baseSymbol}`
                : 'Deposit'
            ) : (
              'Connect wallet'
            )}
          </button>
          <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-ghost">
            2 transactions · one approval
          </p>

          {result && (
            <div className={outputPanelClass}>
              <div className="border-b border-white/[0.07] px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-text-ghost">
                Output
              </div>
              <div className="px-4 py-3">
                <LedgerOutput text={result.text} tone={result.type} />
                {result.type === 'error' && lastError && (
                  <div className="mt-2 border-t border-white/[0.07] pt-2">
                    <button
                      type="button"
                      onClick={() => setErrorOpen(true)}
                      className="font-mono text-[11px] text-accent underline transition-colors hover:text-foreground"
                    >
                      View error details
                    </button>
                  </div>
                )}
                {result.solscan && (
                  <div className="mt-2 border-t border-white/[0.07] pt-2">
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
        )}
      </div>
    </div>
  );
}
