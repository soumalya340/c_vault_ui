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
  deriveVaultPdas,
  describePreviewError,
  NETWORK_CONSTANTS,
  type Network,
} from '@/lib/cvault';
import { PRICE_SCALE_DECIMALS } from '@/lib/constants';
import { parseTxError, type UserFacingError } from '@/lib/txError';
import { useConnection, useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { fetchTokens, type VaultRecord } from '@/lib/registryClient';
import { ErrorModal } from './error-modal';
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
} from './ui-classes';

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

  const [amount, setAmount] = useState('');
  const [minSharesOut, setMinSharesOut] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);
  const [lastError, setLastError] = useState<UserFacingError | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);

  // Base-mint metadata for human-readable amounts. Symbol/decimals come from
  // the token registry; decimals fall back to the on-chain mint account.
  const [baseDecimals, setBaseDecimals] = useState<number | null>(null);
  const [baseSymbol, setBaseSymbol] = useState('base');

  // Quote mint is always network USDC (program constant) — not stored on the
  // vaults row.
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
            setBaseSymbol(match.symbol);
          }
          return;
        }
      } catch {
        // Registry unavailable — fall through to the on-chain mint read.
      }
      try {
        const decimals = await fetchMintDecimals(connection, new PublicKey(baseMint));
        if (!cancelled) setBaseDecimals(decimals);
      } catch {
        // Leave decimals null — the amount field stays disabled until known.
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
      setResult({ type: 'error', text: 'Base token decimals not loaded yet — try again in a moment.' });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      if (!amount.trim()) throw new Error('Enter an amount.');
      const rawAmount = parseUnits(amount, baseDecimals);
      const rawMinShares = minSharesOut.trim()
        ? parseUnits(minSharesOut.trim(), sharesDecimals ?? 6)
        : new BN(0);
      // One v0 transaction via the vault's ALT: deposit + all inflow swap
      // legs. No pre-checks — the program enforces everything (Plan.md §9).
      const r = await depositAndDeploy(
        connection,
        anchorWallet,
        vault.vault_id,
        rawAmount,
        rawMinShares,
        vault.alt_address,
        network,
      );
      setResult({
        type: 'success',
        text: `Deposited into vault №${vault.vault_id} — swaps executed in the same transaction.`,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {errorOpen && lastError && (
        <ErrorModal error={lastError} onClose={() => setErrorOpen(false)} />
      )}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Deposit into ${vault.symbol}`}
        className="cert-frame relative z-10 w-full max-w-[480px] overflow-hidden bg-background shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-strong px-6 py-4">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-accent">
              № {String(vault.vault_id).padStart(2, '0')} · deposit
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-[0.02em]">
              {vault.symbol} · {vault.name}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={btnGhostClass}>
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {publicKey && (
            <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
              wallet balance:{' '}
              <span className="text-foreground">
                {checkingBalance ? '…' : usdcBalanceUi !== null ? `${usdcBalanceUi} ${baseSymbol}` : '—'}
              </span>
            </p>
          )}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className={fieldLabelClass}>
                Amount ({baseSymbol})
              </label>
              {publicKey && usdcBalanceUi !== null && usdcBalance !== '0' && (
                <button
                  type="button"
                  onClick={() => baseDecimals !== null && setAmount(formatUnits(usdcBalance!, baseDecimals))}
                  className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-accent transition-colors hover:text-foreground"
                >
                  Max {usdcBalanceUi}
                </button>
              )}
            </div>
            <input
              className={`${inputClass} tabular-nums`}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={baseDecimals === null ? 'loading…' : '100'}
              disabled={baseDecimals === null}
              required
            />
            <p
              className={`mt-1.5 font-mono text-[11px] tabular-nums ${
                insufficientBalance ? 'text-destructive' : 'text-muted-foreground/70'
              }`}
            >
              {baseDecimals === null
                ? 'Resolving base token decimals…'
                : insufficientBalance
                  ? `Exceeds wallet balance (${usdcBalanceUi} ${baseSymbol} available)`
                  : rawUnits
                    ? `${rawUnits} raw units (${baseDecimals} decimals)`
                    : `Enter a ${baseSymbol} amount (e.g. 100)`}
            </p>
          </div>
          <div>
            <label className={fieldLabelClass}>
              Min shares out ({vault.symbol}) — leave blank to skip the slippage check
            </label>
            <input
              className={`${inputClass} tabular-nums`}
              type="text"
              inputMode="decimal"
              value={minSharesOut}
              onChange={(e) => setMinSharesOut(e.target.value)}
              placeholder="0.0"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePreview}
              disabled={previewing || !amount.trim() || baseDecimals === null}
              className={btnSecondaryClass}
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
            className={btnPrimaryClass}
          >
            {loading ? 'Processing…' : anchorWallet ? 'Deposit' : 'Connect wallet'}
          </button>

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
                {result.type === 'error' && lastError && (
                  <div className="mt-2 border-t border-border pt-2">
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
        </form>
      </div>
    </div>
  );
}
