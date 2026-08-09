'use client';

/**
 * Deposit progress modal — in-flight + settled only.
 * Amount entry lives on the vault action panel (or is passed via `amount`).
 * Layout matches `cVault-6A-Transaction-Modals.html` states 02 / 03.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import {
  depositAndDeploy,
  previewDeposit,
  parseUnits,
  formatUnits,
  fetchMintDecimals,
  getUserPosition,
  deriveVaultPdas,
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

function shortAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

type PreviewQuote = {
  sharesUi: string;
  navUi: string;
  priceUi: string;
};

export function DepositModal({
  vault,
  network,
  onClose,
  amount: amountProp,
}: {
  vault: VaultRecord;
  network: Network;
  onClose: () => void;
  /** Human-unit USDC amount. Required to start the deposit. */
  amount: string;
}) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey } = useWallet();
  const { requestClose, modalClassName, backdropClassName, isClosing } =
    useModalTransition(onClose);

  const amount = amountProp.trim();
  const [quote, setQuote] = useState<PreviewQuote | null>(null);
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

  const [baseDecimals, setBaseDecimals] = useState<number | null>(USDC_DECIMALS);
  const [baseSymbol, setBaseSymbol] = useState('USDC');
  const baseMint = NETWORK_CONSTANTS[network].usdcMint.toBase58();
  const [sharesDecimals, setSharesDecimals] = useState<number | null>(null);

  const startedRef = useRef(false);

  const readShareBalance = useCallback(async (): Promise<string | null> => {
    if (!publicKey) return null;
    try {
      const pos = await getUserPosition(connection, vault.vault_id, publicKey, network);
      return pos.shareBalance;
    } catch {
      return null;
    }
  }, [publicKey, connection, vault.vault_id, network]);

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
            setBaseSymbol(match.symbol?.trim() || 'USDC');
          }
          return;
        }
      } catch {
        // fall through
      }
      try {
        const decimals = await fetchMintDecimals(connection, new PublicKey(baseMint));
        if (!cancelled) {
          setBaseDecimals(decimals);
          setBaseSymbol('USDC');
        }
      } catch {
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

  // Live preview for the in-flight "FOR ≈" line.
  useEffect(() => {
    if (baseDecimals === null || !amount) return;
    let cancelled = false;
    let raw: BN;
    try {
      raw = parseUnits(amount, baseDecimals);
      if (raw.isZero()) return;
    } catch {
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const r = await previewDeposit(
          connection,
          vault.vault_id,
          raw,
          network,
          anchorWallet,
        );
        if (cancelled) return;
        const decimals = sharesDecimals ?? 6;
        setQuote({
          sharesUi: formatTokenUi(r.sharesToMint, decimals),
          navUi: formatTokenUi(r.totalNav, baseDecimals),
          priceUi: formatTokenUi(r.sharePrice, PRICE_SCALE_DECIMALS),
        });
      } catch {
        // preview is best-effort during in-flight
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [amount, baseDecimals, sharesDecimals, connection, vault.vault_id, network, anchorWallet]);

  const runDeposit = useCallback(async () => {
    if (!anchorWallet || baseDecimals === null || !amount) return;
    setLoading(true);
    setSteps([]);
    setSettlement(null);
    try {
      const rawAmount = parseUnits(amount, baseDecimals);
      const sharesBefore = await readShareBalance();
      const r = await depositAndDeploy(
        connection,
        anchorWallet,
        vault.vault_id,
        rawAmount,
        new BN(0),
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
            ? `ALT created + saved: ${r.altAddress}`
            : `ALT saved: ${r.altAddress}`;
        } catch (err) {
          altNote =
            `ALT live (${r.altAddress}) but DB save failed: ` +
            `${err instanceof Error ? err.message : String(err)}`;
        }
      }
      const multiTx = r.signatures.length > 1;
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
    } catch (err) {
      const parsed = parseTxError(err);
      setLastError(parsed);
      setErrorOpen(true);
    } finally {
      setLoading(false);
    }
  }, [
    anchorWallet,
    baseDecimals,
    amount,
    readShareBalance,
    connection,
    vault.vault_id,
    vault.alt_address,
    network,
  ]);

  // Auto-start once wallet + decimals are ready.
  useEffect(() => {
    if (startedRef.current) return;
    if (!anchorWallet || baseDecimals === null || !amount || settlement) return;
    startedRef.current = true;
    const t = window.setTimeout(() => {
      void runDeposit();
    }, 0);
    return () => window.clearTimeout(t);
  }, [anchorWallet, baseDecimals, amount, settlement, runDeposit]);

  const showInFlight = !settlement;
  const vaultName = displayVaultName(vault.name);
  const addrShort = shortAddr(vault.vault_address);
  const shareSymbol = (vault.symbol || 'SHARES').toUpperCase();
  const depositAmountLabel = amount || '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {errorOpen && lastError && (
        <ErrorModal
          error={lastError}
          onClose={() => {
            setErrorOpen(false);
            if (!settlement) requestClose();
          }}
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
          {showInFlight && loading ? (
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
            />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-5 py-[18px]">
              {!anchorWallet ? (
                <p className="font-mono text-[12px] leading-relaxed text-text-ghost">
                  Connect a wallet to deposit.
                </p>
              ) : !amount ? (
                <p className="font-mono text-[12px] leading-relaxed text-text-ghost">
                  Enter an amount on the vault page, then deposit.
                </p>
              ) : (
                <>
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

                  <TransactionPhases
                    flow="deposit"
                    steps={steps.length > 0 ? steps : ['Preparing route…']}
                    active={loading}
                  />
                </>
              )}
            </div>

            <div className="shrink-0 space-y-2.5 border-t border-white/[0.07] bg-bg-elevated px-5 py-4">
              {loading ? (
                <>
                  <div className="flex h-12 items-center justify-center gap-2.5 rounded-[10px] border border-accent/30 bg-accent/15 text-[15px] font-semibold text-accent">
                    <Spinner className="size-[15px]" />
                    Processing…
                  </div>
                  <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.12em] text-text-ghost">
                    {steps.length > 0
                      ? `Step · ${steps[steps.length - 1]?.slice(0, 42) ?? '…'}`
                      : 'Preparing…'}
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
