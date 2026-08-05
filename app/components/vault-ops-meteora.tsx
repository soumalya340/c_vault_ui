'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey, type Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import {
  createPool,
  parseUiAmount,
  resolveMintDecimals,
  resolveTokenProgram,
  sendMeteoraTx,
} from '@/lib/meteora';
import {
  formatUnits,
  getUserUsdcBalance,
  getVaultSharePriceQuote,
  parseUnits,
  PRICE_SCALE_DECIMALS,
  type SharePriceQuote,
} from '@/lib/cvault';
import { NETWORK_CONSTANTS, USDC_DECIMALS, type Network } from '@/lib/constants';
import {
  updateVaultPoolCreated,
  type VaultRecord,
} from '@/lib/registryClient';
import { solscanLink } from '@/lib/solscanLink';
import { parseTxError, type UserFacingError } from '@/lib/txError';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatResult } from './execute-vault-function';
import { ErrorModal } from './error-modal';
import { LedgerOutput } from './ledger-output';
import { showVaultOpsToast } from './vault-ops-toast';

/** Human-readable token amount with thousands separators. */
function formatTokenUi(raw: string, decimals: number): string {
  const ui = formatUnits(raw, decimals);
  const [whole, frac] = ui.split('.');
  const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${wholeFmt}.${frac}` : wholeFmt;
}

/**
 * USDC base units required to seed `shareUi` shares at `sharePrice` (PRICE_SCALE).
 * Same formula as create-pool execute: amountB = A · price · 10^decB / 10^(decA+9).
 * Shares and USDC both use 6 decimals in this product.
 */
function usdcNeededRaw(
  shareUi: string,
  sharePriceRaw: string,
  sharesDecimals: number = USDC_DECIMALS,
  usdcDecimals: number = USDC_DECIMALS,
): string | null {
  const trimmed = shareUi.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  try {
    const amountA = parseUnits(trimmed, sharesDecimals);
    if (amountA.isZero()) return null;
    const amountB = amountA
      .mul(new BN(sharePriceRaw))
      .mul(new BN(10).pow(new BN(usdcDecimals)))
      .div(new BN(10).pow(new BN(sharesDecimals + PRICE_SCALE_DECIMALS)));
    if (amountB.isZero()) return null;
    return amountB.toString();
  } catch {
    return null;
  }
}

/**
 * DAMM v2 trading fee as a UI percentage → integer bps for the SDK.
 * 1 bps = 0.01%. On-chain range is roughly 0.01%–99% (1–9900 bps).
 */
function tradingFeePercentToBps(percentUi: string): number {
  const trimmed = percentUi.trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a trading fee percentage (e.g. 0.25 for 0.25%).');
  }
  const pct = Number(trimmed);
  if (!Number.isFinite(pct)) {
    throw new Error('Enter a trading fee percentage (e.g. 0.25 for 0.25%).');
  }
  // bps = percent × 100 (0.25% → 25 bps). Round to nearest integer bps.
  const bps = Math.round(pct * 100);
  if (bps < 1 || bps > 9900) {
    throw new Error(
      'Trading fee must be between 0.01% and 99% (DAMM v2 limits).',
    );
  }
  return bps;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <input
      className="h-11 w-full border border-border-strong bg-background px-3.5 font-mono text-sm text-foreground transition-[color,background-color,border-color,box-shadow] duration-[250ms] placeholder:text-muted-foreground/60 hover:border-foreground/40 focus:border-foreground focus:bg-background focus:outline-none focus:shadow-[3px_3px_0_rgba(23,37,28,0.1)]"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      spellCheck={false}
      autoComplete="off"
    />
  );
}

function StaticValue({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-11 w-full items-center overflow-hidden border border-border bg-foreground/[0.03] px-3.5 font-mono text-sm text-foreground/80">
      <span className="truncate">{children}</span>
    </div>
  );
}

function shortenAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

interface OpsResult {
  type: 'success' | 'error' | 'info';
  text: string;
  solscan?: string;
}

function parsePubkey(raw: string, label: string): PublicKey {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`Enter ${label}.`);
  try {
    return new PublicKey(trimmed);
  } catch {
    throw new Error(`Invalid ${label} address.`);
  }
}

function AccordionShell({
  number,
  name,
  tag,
  open,
  onToggle,
  description,
  children,
  result,
  lastError,
  loading,
  network,
  vaultId,
}: {
  number: string;
  name: string;
  tag: string;
  open: boolean;
  onToggle: () => void;
  description: string;
  children: React.ReactNode;
  result: OpsResult | null;
  lastError: UserFacingError | null;
  loading: boolean;
  network: Network;
  vaultId: number;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [errorOpen, setErrorOpen] = useState(false);

  useEffect(() => {
    if (lastError && result?.type === 'error') {
      setErrorOpen(true);
    }
  }, [lastError, result]);

  // Remeasure when open state or payload changes so multi-field forms don't clip.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (open) {
      // Double rAF: wait for form paint after state updates.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.maxHeight = el.scrollHeight + 'px';
        });
      });
    } else {
      el.style.maxHeight = '0px';
    }
  }, [open, result, loading]);

  return (
    <div className="border-b border-border last:border-b-0">
      {errorOpen && lastError && (
        <ErrorModal
          error={lastError}
          onClose={() => setErrorOpen(false)}
          network={network}
          vaultId={vaultId}
        />
      )}

      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-5 px-6 py-5 text-left transition-colors hover:bg-foreground/[0.03]"
      >
        <span className="font-mono text-[11px] font-semibold text-seal">
          № {number}
        </span>
        <span className="font-display text-lg font-semibold text-foreground">
          {name}
        </span>
        <span className="mx-1 flex-1 self-center border-b border-dotted border-border-strong" />
        <span className="hidden font-mono text-[8.5px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
          {tag}
        </span>
        <span
          className={`text-[11px] text-muted-foreground transition-transform duration-[400ms] ${
            open ? 'rotate-180 text-seal' : ''
          }`}
        >
          ▾
        </span>
      </button>

      <div
        ref={bodyRef}
        className="overflow-hidden transition-[max-height] duration-500 ease-[cubic-bezier(.22,1,.36,1)]"
        style={{ maxHeight: open ? undefined : 0 }}
      >
        <div className="space-y-4 px-6 pb-7 pt-2">
          <p className="text-sm leading-relaxed text-foreground/80">
            {description}
          </p>
          {children}
        </div>

        {result && (
          <div className="mx-6 mb-6 max-h-64 overflow-y-auto rounded-[2px] border border-border-strong bg-foreground/[0.04]">
            <div className="border-b border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
              OUTPUT
            </div>
            <div className="px-4 py-3">
              <LedgerOutput text={result.text} tone={result.type} />
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
                    View on explorer
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ExecuteButton({
  loading,
  connected,
  label,
  detail,
  onClick,
}: {
  loading: boolean;
  connected: boolean;
  label: string;
  /** Optional second line (e.g. USDC needed) — keeps the primary label readable. */
  detail?: string | null;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      onClick={onClick}
      disabled={loading}
      className="h-11 w-full min-w-[12rem] gap-2 rounded-[2px] border-border-strong bg-background px-5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground shadow-none transition-colors duration-[var(--duration-fast)] hover:border-foreground hover:bg-foreground hover:text-background focus-visible:ring-accent disabled:opacity-40 md:w-auto md:min-w-[14rem]"
    >
      {loading ? (
        'Processing…'
      ) : !connected ? (
        'Connect wallet'
      ) : detail ? (
        <span className="flex flex-col items-center leading-tight normal-case tracking-normal">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em]">
            {label}
          </span>
          <span className="mt-0.5 font-mono text-[11px] font-medium tabular-nums tracking-normal opacity-80">
            {detail}
          </span>
        </span>
      ) : (
        label
      )}
    </Button>
  );
}

export function CreatePoolAccordion({
  network,
  vault,
  open,
  onToggle,
  poolCreated = false,
  onPoolCreated,
}: {
  network: Network;
  vault: VaultRecord;
  open: boolean;
  onToggle: () => void;
  /** When true, create is disabled (pool already on-chain / DB). */
  poolCreated?: boolean;
  onPoolCreated?: (next: VaultRecord) => void;
}) {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { setVisible } = useWalletModal();

  const [shareAmount, setShareAmount] = useState('');
  /** Trading fee as percent UI (0.25 = 0.25% = 25 bps). Converted at execute. */
  const [tradingFeePercent, setTradingFeePercent] = useState('0.25');

  const [priceQuote, setPriceQuote] = useState<SharePriceQuote | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [walletUsdcRaw, setWalletUsdcRaw] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OpsResult | null>(null);
  const [lastError, setLastError] = useState<UserFacingError | null>(null);

  const vaultId = vault.vault_id;
  const usdcMint = NETWORK_CONSTANTS[network].usdcMint;
  const walletKey = publicKey?.toBase58() ?? '';

  // Load share price when the panel opens. Prefer live oracle NAV; fall back
  // to genesis baseline so the field is
  // never stuck on "—" for a funded vault.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setPriceLoading(true);
      setPriceError(null);
      try {
        const quote = await getVaultSharePriceQuote(
          connection,
          vaultId,
          network,
          anchorWallet ?? null,
        );
        if (!cancelled) {
          setPriceQuote(quote);
          setPriceError(null);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setPriceQuote(null);
        setPriceError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setPriceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, connection, vaultId, network, walletKey, anchorWallet]);

  // Wallet USDC — needed to seed the quote side of the pool.
  useEffect(() => {
    if (!open || !publicKey) {
      setWalletUsdcRaw(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const bal = await getUserUsdcBalance(connection, publicKey, network);
        if (!cancelled) setWalletUsdcRaw(bal);
      } catch {
        if (!cancelled) setWalletUsdcRaw(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, connection, publicKey, network, walletKey]);

  // Exact USDC required (same base-unit math as the create tx).
  const usdcNeededRawStr =
    priceQuote && BigInt(priceQuote.sharePrice) > 0n
      ? usdcNeededRaw(shareAmount, priceQuote.sharePrice)
      : null;
  const usdcNeededUi =
    usdcNeededRawStr != null
      ? formatTokenUi(usdcNeededRawStr, USDC_DECIMALS)
      : null;
  const walletUsdcUi =
    walletUsdcRaw != null ? formatTokenUi(walletUsdcRaw, USDC_DECIMALS) : null;
  const insufficientUsdc =
    usdcNeededRawStr != null &&
    walletUsdcRaw != null &&
    BigInt(usdcNeededRawStr) > BigInt(walletUsdcRaw);

  const execute = async () => {
    if (poolCreated) {
      setResult({
        type: 'info',
        text: 'Pool already created for this vault — use Stake & Earn on the vault page.',
      });
      return;
    }
    if (!connected || !publicKey || !signTransaction) {
      setVisible(true);
      return;
    }

    setLoading(true);
    setResult(null);
    setLastError(null);

    try {
      if (!shareAmount.trim()) {
        throw new Error('Enter the share amount to seed.');
      }

      const feeBps = tradingFeePercentToBps(tradingFeePercent);

      // Token A is always this vault's share mint, token B always USDC.
      const mintA = parsePubkey(vault.shares_mint, 'vault share mint');
      const mintB = usdcMint;
      if (mintA.equals(mintB)) {
        throw new Error('Vault share mint cannot be the USDC mint.');
      }

      // Fresh quote at click — live NAV → book → baseline.
      const quote = await getVaultSharePriceQuote(
        connection,
        vaultId,
        network,
        anchorWallet ?? null,
      );
      setPriceQuote(quote);
      if (quote.sharePrice === '0' || BigInt(quote.sharePrice) <= 0n) {
        throw new Error(
          'Vault has no usable share price yet — run Genesis deposit (№01) before creating a pool.',
        );
      }
      const initPrice = formatUnits(quote.sharePrice, PRICE_SCALE_DECIMALS);

      const [tokenAProgram, tokenBProgram] = await Promise.all([
        resolveTokenProgram(connection, mintA),
        resolveTokenProgram(connection, mintB),
      ]);
      const [decimalsA, decimalsB] = await Promise.all([
        resolveMintDecimals(connection, mintA, tokenAProgram),
        resolveMintDecimals(connection, mintB, tokenBProgram),
      ]);

      const amountA = parseUiAmount(shareAmount, decimalsA);
      // USDC side derived from the share price, exact base-unit math:
      // amountB = amountA · sharePrice(1e9) · 10^decimalsB / 10^(decimalsA+9)
      const amountB = amountA
        .mul(new BN(quote.sharePrice))
        .mul(new BN(10).pow(new BN(decimalsB)))
        .div(new BN(10).pow(new BN(decimalsA + PRICE_SCALE_DECIMALS)));
      if (amountB.isZero()) {
        throw new Error(
          'Seed amount too small — derived USDC side rounds to zero.',
        );
      }

      const built = await createPool({
        connection,
        payer: publicKey,
        tokenA: {
          mint: mintA,
          amount: amountA,
          decimals: decimalsA,
          tokenProgram: tokenAProgram,
        },
        tokenB: {
          mint: mintB,
          amount: amountB,
          decimals: decimalsB,
          tokenProgram: tokenBProgram,
        },
        initPrice,
        fee: {
          startingFeeBps: feeBps,
          endingFeeBps: feeBps,
        },
      });

      const signature = await sendMeteoraTx(
        connection,
        {
          publicKey,
          signTransaction: signTransaction as (
            tx: Transaction,
          ) => Promise<Transaction>,
        },
        built.tx,
        [built.positionNft],
      );

      const payload = {
        pool: built.pool.toBase58(),
        position: built.position.toBase58(),
        positionNft: built.positionNft.publicKey.toBase58(),
        tokenAMint: mintA.toBase58(),
        tokenBMint: mintB.toBase58(),
        initPrice,
        priceSource: quote.source,
        tokenAAmount: built.tokenAAmount.toString(),
        tokenBAmount: built.tokenBAmount.toString(),
        liquidityDelta: built.liquidityDelta.toString(),
        signature,
      };

      setResult({
        type: 'success',
        text: formatResult(payload),
        solscan: solscanLink(signature, network),
      });
      showVaultOpsToast('DAMM V2 · POOL CREATED');
      try {
        const updated = await updateVaultPoolCreated(network, vaultId, true);
        onPoolCreated?.(updated);
      } catch {
        onPoolCreated?.({ ...vault, is_pool_created: true });
      }
    } catch (err: unknown) {
      const parsed = parseTxError(err);
      setLastError(parsed);
      setResult({
        type: parsed.kind === 'info' ? 'info' : 'error',
        text: parsed.title,
      });
    } finally {
      setLoading(false);
    }
  };

  const priceDisplay = priceLoading
    ? 'Fetching…'
    : priceQuote
      ? `${priceQuote.sharePriceUsd} / share · ${priceQuote.sourceLabel}`
      : priceError
        ? 'Unavailable'
        : '—';

  return (
    <AccordionShell
      number="04"
      name="Create DAMM v2 pool"
      tag="Meteora"
      open={open}
      onToggle={onToggle}
      description="Create a Meteora DAMM v2 pool for this vault's share token against USDC and seed the initial position in one transaction. Token A is the vault share mint, token B is always USDC. Init price prefers live oracle NAV, then falls back to the genesis baseline. Set seed size and trading fee percentage (0.01%–99%)."
      result={result}
      lastError={lastError}
      loading={loading || priceLoading}
      network={network}
      vaultId={vaultId}
    >
      {poolCreated ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge
            variant="secondary"
            className="font-mono text-[9px] font-bold uppercase tracking-[0.1em]"
          >
            Pool-Created
          </Badge>
          <p className="font-mono text-[11px] text-muted-foreground">
            Shares×USDC DAMM pool is live. Create is disabled — use Stake &amp; Earn
            on the vault page to add liquidity.
          </p>
        </div>
      ) : null}
      <div
        className={`grid gap-4 md:grid-cols-2 ${poolCreated ? 'pointer-events-none opacity-40' : ''}`}
      >
        <div>
          <FieldLabel>Token A · vault share mint</FieldLabel>
          <StaticValue>
            {vault.symbol} · {shortenAddress(vault.shares_mint)}
          </StaticValue>
        </div>
        <div>
          <FieldLabel>Token B · quote</FieldLabel>
          <StaticValue>USDC · {shortenAddress(usdcMint.toBase58())}</StaticValue>
        </div>
        <div>
          <FieldLabel>Init price · share / USDC</FieldLabel>
          <StaticValue>{priceDisplay}</StaticValue>
          {priceQuote?.note && (
            <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {priceQuote.note}
            </p>
          )}
          {priceError && !priceQuote && (
            <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-destructive">
              {priceError}
            </p>
          )}
        </div>
        <div>
          <FieldLabel>Trading fee percentage</FieldLabel>
          <TextInput
            value={tradingFeePercent}
            onChange={setTradingFeePercent}
            placeholder="0.25"
            inputMode="decimal"
          />
          <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
            Pool swap fee in percent (e.g. 0.25 = 0.25%). Range 0.01%–99%.
          </p>
        </div>
        <div>
          <FieldLabel>Share amount to seed ({vault.symbol})</FieldLabel>
          <TextInput
            value={shareAmount}
            onChange={setShareAmount}
            placeholder="1000"
            inputMode="decimal"
          />
          <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
            Your vault share tokens deposited as token A liquidity.
          </p>
        </div>
        <div>
          <FieldLabel>USDC needed to seed</FieldLabel>
          <StaticValue>
            {priceLoading
              ? 'Fetching price…'
              : usdcNeededUi != null
                ? `${usdcNeededUi} USDC`
                : shareAmount.trim()
                  ? priceQuote
                    ? 'Amount too small (rounds to 0)'
                    : 'Waiting for share price…'
                  : 'Enter share amount'}
          </StaticValue>
          <p
            className={`mt-1.5 font-mono text-[10px] leading-relaxed ${
              insufficientUsdc ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {priceQuote && usdcNeededUi != null ? (
              <>
                = {shareAmount.trim() || '0'} × {priceQuote.sharePriceUsd}/share
                <span className="text-muted-foreground/70">
                  {' '}
                  ({priceQuote.sourceLabel})
                </span>
                {walletUsdcUi != null && (
                  <>
                    <br />
                    wallet: {walletUsdcUi} USDC
                    {insufficientUsdc ? ' — not enough to seed' : ' available'}
                  </>
                )}
              </>
            ) : priceError && !priceQuote ? (
              'Share price unavailable — cannot size the USDC leg yet.'
            ) : (
              'Matched USDC (token B) required at the init price for this seed.'
            )}
          </p>
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <ExecuteButton
          loading={loading || poolCreated}
          connected={connected}
          label={poolCreated ? 'Pool already created' : 'Create pool + seed'}
          detail={
            poolCreated
              ? null
              : usdcNeededUi != null
                ? `${usdcNeededUi} USDC`
                : null
          }
          onClick={execute}
        />
      </div>
    </AccordionShell>
  );
}
