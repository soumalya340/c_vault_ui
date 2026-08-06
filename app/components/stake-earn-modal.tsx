'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PublicKey, type Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import BN from 'bn.js';
import {
  addLiquidity,
  getCpAmm,
  parseUiAmount,
  resolveVaultShareUsdcPool,
  sendMeteoraTx,
  type VaultShareUsdcPoolInfo,
  type WalletSigner,
} from '@/lib/meteora';
import {
  formatUnits,
  getUserUsdcBalance,
  NETWORK_CONSTANTS,
  type Network,
} from '@/lib/onchain/cvault';
import { USDC_DECIMALS } from '@/lib/constants';
import type { VaultRecord } from '@/lib/registryClient';
import { solscanLink } from '@/lib/onchain/solscanLink';
import { parseTxError, type UserFacingError } from '@/lib/onchain/txError';
import { ErrorModal } from './error-modal';
import { LedgerOutput } from './ledger-output';
import { useModalTransition } from './use-modal-transition';
import { displayVaultName } from './view-display';
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
} from './ui-classes';

function formatTokenUi(raw: string, decimals: number): string {
  const ui = formatUnits(raw, decimals);
  const [whole, frac] = ui.split('.');
  const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${wholeFmt}.${frac}` : wholeFmt;
}

/**
 * Stake vault shares + matching USDC into the DAMM v2 customizable pool.
 * USDC needed is quoted from the pool (getDepositQuote) when the user types shares.
 */
export function StakeEarnModal({
  vault,
  network,
  onClose,
}: {
  vault: VaultRecord;
  network: Network;
  onClose: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const { requestClose, modalClassName, backdropClassName, isClosing } =
    useModalTransition(onClose);

  const usdcMint = NETWORK_CONSTANTS[network].usdcMint;
  const sharesMint = useMemo(
    () => new PublicKey(vault.shares_mint),
    [vault.shares_mint],
  );

  const [poolInfo, setPoolInfo] = useState<VaultShareUsdcPoolInfo | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);

  const [shareAmount, setShareAmount] = useState('');
  /** Raw USDC base units quoted for the current share amount (null if none). */
  const [usdcNeededRaw, setUsdcNeededRaw] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [shareBal, setShareBal] = useState<string | null>(null);
  const [usdcBal, setUsdcBal] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  /** Shown under the button while the tx is building / waiting on Phantom. */
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);
  const [lastError, setLastError] = useState<UserFacingError | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);

  const loadPoolAndBalances = useCallback(async () => {
    setPoolLoading(true);
    setPoolError(null);
    try {
      const info = await resolveVaultShareUsdcPool(
        connection,
        sharesMint,
        usdcMint,
      );
      setPoolInfo(info);
      if (!info.exists) {
        setPoolError(
          'No DAMM v2 shares/USDC pool yet. Create it first (Portfolio → Vault Ops → Create DAMM v2 pool).',
        );
      }
    } catch (err) {
      setPoolInfo(null);
      setPoolError(err instanceof Error ? err.message : String(err));
    } finally {
      setPoolLoading(false);
    }

    if (!publicKey) {
      setShareBal(null);
      setUsdcBal(null);
      return;
    }
    try {
      const ata = getAssociatedTokenAddressSync(
        sharesMint,
        publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );
      try {
        const bal = await connection.getTokenAccountBalance(ata);
        setShareBal(bal.value.amount);
      } catch {
        setShareBal('0');
      }
      const usdc = await getUserUsdcBalance(connection, publicKey, network);
      setUsdcBal(usdc);
    } catch {
      setShareBal(null);
      setUsdcBal(null);
    }
  }, [connection, sharesMint, usdcMint, publicKey, network]);

  useEffect(() => {
    void loadPoolAndBalances();
  }, [loadPoolAndBalances]);

  // Quote USDC needed whenever share amount or pool changes.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setQuoteError(null);
      const trimmed = shareAmount.trim();
      if (!poolInfo?.exists || !trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
        setUsdcNeededRaw(null);
        setQuoteLoading(false);
        return;
      }

      let inAmount: BN;
      try {
        inAmount = parseUiAmount(trimmed, USDC_DECIMALS);
      } catch {
        setUsdcNeededRaw(null);
        return;
      }
      if (inAmount.isZero()) {
        setUsdcNeededRaw(null);
        return;
      }

      setQuoteLoading(true);
      try {
        const cpAmm = getCpAmm(connection);
        const poolState = await cpAmm.fetchPoolState(poolInfo.pool);
        const sharesB58 = sharesMint.toBase58();
        const isSharesTokenA = poolState.tokenAMint.toBase58() === sharesB58;
        const isSharesTokenB = poolState.tokenBMint.toBase58() === sharesB58;
        if (!isSharesTokenA && !isSharesTokenB) {
          throw new Error('Pool mints do not match this vault’s share mint.');
        }

        const depositQuote = cpAmm.getDepositQuote({
          inAmount,
          isTokenA: isSharesTokenA,
          sqrtPrice: poolState.sqrtPrice,
          minSqrtPrice: poolState.sqrtMinPrice,
          maxSqrtPrice: poolState.sqrtMaxPrice,
          collectFeeMode: poolState.collectFeeMode,
          tokenAAmount: poolState.tokenAAmount,
          tokenBAmount: poolState.tokenBAmount,
          liquidity: poolState.liquidity,
        });

        // Input = shares → outputAmount is the counterpart (USDC) on either side.
        const counterpart = depositQuote.outputAmount;

        if (cancelled) return;
        if (counterpart.isZero()) {
          setUsdcNeededRaw(null);
          setQuoteError('Quote returned zero USDC — try a larger share amount.');
        } else {
          setUsdcNeededRaw(counterpart.toString());
        }
      } catch (err) {
        if (cancelled) return;
        setUsdcNeededRaw(null);
        setQuoteError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    };

    const t = window.setTimeout(() => {
      void run();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [shareAmount, poolInfo, connection, sharesMint]);

  const shareBalUi =
    shareBal != null ? formatTokenUi(shareBal, USDC_DECIMALS) : null;
  const usdcBalUi =
    usdcBal != null ? formatTokenUi(usdcBal, USDC_DECIMALS) : null;
  const usdcNeededUi =
    usdcNeededRaw != null ? formatTokenUi(usdcNeededRaw, USDC_DECIMALS) : null;

  const insufficientShares =
    shareBal != null &&
    shareAmount.trim() &&
    /^\d+(\.\d+)?$/.test(shareAmount.trim()) &&
    (() => {
      try {
        return parseUiAmount(shareAmount, USDC_DECIMALS).gt(new BN(shareBal));
      } catch {
        return false;
      }
    })();

  const insufficientUsdc =
    usdcBal != null &&
    usdcNeededRaw != null &&
    BigInt(usdcNeededRaw) > BigInt(usdcBal);

  const execute = async () => {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }
    if (!signTransaction && !sendTransaction) {
      setVisible(true);
      setResult({
        type: 'error',
        text: 'Wallet cannot sign — reconnect Phantom and try again.',
      });
      return;
    }
    if (!poolInfo?.exists) {
      setResult({
        type: 'error',
        text: 'Pool does not exist yet — create the DAMM v2 pool first.',
      });
      return;
    }

    setLoading(true);
    setStatus('Building stake transaction…');
    setResult(null);
    setLastError(null);

    try {
      if (!shareAmount.trim()) {
        throw new Error('Enter the share amount to stake.');
      }
      if (!usdcNeededRaw || usdcNeededRaw === '0') {
        throw new Error(
          'USDC amount not ready — wait for the quote or check the share amount.',
        );
      }
      const amountShares = parseUiAmount(shareAmount, USDC_DECIMALS);
      const amountUsdc = new BN(usdcNeededRaw);
      if (amountShares.isZero() || amountUsdc.isZero()) {
        throw new Error('Both share and USDC amounts must be greater than zero.');
      }
      if (shareBal != null && amountShares.gt(new BN(shareBal))) {
        throw new Error(
          `Not enough shares — wallet has ${shareBalUi ?? '0'} ${vault.symbol}.`,
        );
      }
      if (usdcBal != null && amountUsdc.gt(new BN(usdcBal))) {
        throw new Error(
          `Not enough USDC — need ${usdcNeededUi} USDC, wallet has ${usdcBalUi ?? '0'}.`,
        );
      }

      // Map max amounts to pool token A/B order.
      setStatus('Reading pool…');
      const cpAmm = getCpAmm(connection);
      const poolState = await cpAmm.fetchPoolState(poolInfo.pool);
      const sharesB58 = sharesMint.toBase58();
      const isSharesTokenA = poolState.tokenAMint.toBase58() === sharesB58;
      if (
        !isSharesTokenA &&
        poolState.tokenBMint.toBase58() !== sharesB58
      ) {
        throw new Error('Pool mints do not match this vault’s share mint.');
      }
      const maxAmountTokenA = isSharesTokenA ? amountShares : amountUsdc;
      const maxAmountTokenB = isSharesTokenA ? amountUsdc : amountShares;

      setStatus('Preparing position + liquidity…');
      const built = await addLiquidity({
        connection,
        owner: publicKey,
        pool: poolInfo.pool,
        maxAmountTokenA,
        maxAmountTokenB,
        mode: { kind: 'new_position' },
        slippagePercent: 1,
      });

      setStatus('Approve in Phantom…');
      const signer: WalletSigner = {
        publicKey,
        signTransaction: signTransaction
          ? (signTransaction as (tx: Transaction) => Promise<Transaction>)
          : undefined,
        sendTransaction: sendTransaction
          ? (sendTransaction as NonNullable<WalletSigner['sendTransaction']>)
          : undefined,
      };
      const signature = await sendMeteoraTx(
        connection,
        signer,
        built.tx,
        built.positionNftKeypair ? [built.positionNftKeypair] : [],
      );

      setStatus('Confirming…');
      setResult({
        type: 'success',
        text:
          `Staked into ${displayVaultName(vault.name)} pool.\n` +
          `shares: ${shareAmount} ${vault.symbol}\n` +
          `usdc: ${usdcNeededUi} USDC\n` +
          `position: ${built.position.toBase58()}`,
        solscan: solscanLink(signature, network),
      });
      setShareAmount('');
      setUsdcNeededRaw(null);
      await loadPoolAndBalances();
    } catch (err) {
      const parsed = parseTxError(err);
      setLastError(parsed);
      setErrorOpen(true);
      setResult({
        type: parsed.kind === 'info' ? 'info' : 'error',
        text: parsed.title,
      });
    } finally {
      setLoading(false);
      setStatus(null);
    }
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
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm ${backdropClassName}`}
        onClick={() => {
          if (!isClosing) requestClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Stake & Earn — ${displayVaultName(vault.name)}`}
        className={`cert-frame relative z-10 flex w-full max-w-[480px] max-h-[90vh] flex-col overflow-hidden bg-background shadow-2xl ${modalClassName}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-strong px-6 py-4">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-accent">
              № {String(vault.vault_id).padStart(2, '0')} · stake &amp; earn
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-[0.02em]">
              {displayVaultName(vault.name)}
            </h2>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              Provide {vault.symbol} + matching USDC liquidity on DAMM v2
            </p>
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

        <div className="space-y-4 overflow-y-auto px-6 py-5">
          {poolLoading && (
            <p className="font-mono text-[11px] text-muted-foreground">
              Loading pool…
            </p>
          )}

          {poolError && (
            <p className="font-mono text-[11px] leading-relaxed text-destructive">
              {poolError}
            </p>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className={fieldLabelClass}>
                {vault.symbol} amount (shares)
              </label>
              {shareBalUi != null && (
                <button
                  type="button"
                  className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-accent hover:text-foreground"
                  onClick={() =>
                    shareBal != null &&
                    setShareAmount(formatUnits(shareBal, USDC_DECIMALS))
                  }
                >
                  Max {shareBalUi}
                </button>
              )}
            </div>
            <input
              className={`${inputClass} tabular-nums`}
              type="text"
              inputMode="decimal"
              value={shareAmount}
              onChange={(e) => setShareAmount(e.target.value)}
              placeholder="0.1"
              disabled={!poolInfo?.exists || poolLoading}
            />
            {insufficientShares && (
              <p className="mt-1.5 font-mono text-[10px] text-destructive">
                Exceeds wallet balance ({shareBalUi} {vault.symbol})
              </p>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className={fieldLabelClass}>USDC needed (matched)</label>
              {usdcBalUi != null && (
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Wallet {usdcBalUi}
                </span>
              )}
            </div>
            <div
              className={`${inputClass} flex items-center tabular-nums ${
                insufficientUsdc ? 'border-destructive text-destructive' : ''
              }`}
            >
              {quoteLoading
                ? 'Quoting…'
                : usdcNeededUi != null
                  ? `${usdcNeededUi} USDC`
                  : shareAmount.trim()
                    ? '—'
                    : 'Enter shares above'}
            </div>
            <p
              className={`mt-1.5 font-mono text-[10px] leading-relaxed ${
                insufficientUsdc ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {quoteError
                ? quoteError
                : usdcNeededUi != null && shareAmount.trim()
                  ? `= ${shareAmount.trim()} ${vault.symbol} at current pool ratio` +
                    (insufficientUsdc
                      ? ' — not enough USDC in wallet'
                      : usdcBalUi
                        ? ` · ${usdcBalUi} USDC available`
                        : '')
                  : 'USDC side is calculated from the live pool so the deposit stays balanced.'}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={execute}
                disabled={
                  loading ||
                  poolLoading ||
                  quoteLoading ||
                  !poolInfo?.exists ||
                  !shareAmount.trim() ||
                  !usdcNeededRaw ||
                  insufficientShares ||
                  insufficientUsdc
                }
                className={btnPrimaryClass}
              >
                {loading
                  ? status?.startsWith('Approve')
                    ? 'Waiting for Phantom…'
                    : 'Staking…'
                  : !connected
                    ? 'Connect wallet'
                    : usdcNeededUi != null
                      ? `Stake & Earn (${usdcNeededUi} USDC)`
                      : 'Stake & Earn'}
              </button>
              <button
                type="button"
                onClick={() => void loadPoolAndBalances()}
                disabled={poolLoading || loading}
                className={btnSecondaryClass}
              >
                Refresh
              </button>
            </div>
            {status && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {status}
              </p>
            )}
          </div>

          {result && (
            <div className={outputPanelClass}>
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
                      className="text-accent underline hover:text-foreground"
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
