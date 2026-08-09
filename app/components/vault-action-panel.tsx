'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  formatUnits,
  getUserUsdcBalance,
  type Network,
} from '@/lib/onchain/cvault';
import { USDC_DECIMALS } from '@/lib/constants';

type TabId = 'deposit' | 'redeem';
type QuickPick = '25' | '50' | '75' | 'max' | 'custom' | null;

function formatUiAmount(raw: string | null | undefined, decimals: number): string {
  if (raw == null) return '—';
  try {
    const ui = formatUnits(raw, decimals);
    const [whole, frac] = ui.split('.');
    const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (!frac) return wholeFmt;
    // Keep up to 4 meaningful fraction digits for balance display.
    const trimmed = frac.slice(0, 4).replace(/0+$/, '');
    return trimmed ? `${wholeFmt}.${trimmed}` : wholeFmt;
  } catch {
    return '—';
  }
}

function parseUsdPrice(label: string | null | undefined): number | null {
  if (!label || label === '—') return null;
  const n = Number(String(label).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function applyPct(rawBalance: string, pct: number, decimals: number): string {
  try {
    const bal = BigInt(rawBalance);
    const scaled = (bal * BigInt(Math.round(pct * 10000))) / 10000n;
    return formatUnits(scaled.toString(), decimals);
  } catch {
    return '0';
  }
}

/**
 * Right-column trade card — live USDC / share balances, amount field,
 * 25/50/75/MAX/CUSTOM chips. CTA still opens production deposit/redeem modals.
 */
export function VaultActionPanel({
  network,
  sharePriceLabel,
  entryFeeBps,
  exitFeeBps,
  stakeable,
  shareSymbol,
  walletConnected,
  shareBalanceRaw,
  shareBalanceLabel,
  onDeposit,
  onRedeem,
  onStake,
}: {
  network: Network;
  sharePriceLabel: string;
  entryFeeBps: number;
  exitFeeBps: number;
  stakeable: boolean;
  shareSymbol: string;
  walletConnected: boolean;
  /** Raw base-unit share balance for % chips on redeem. */
  shareBalanceRaw?: string | null;
  shareBalanceLabel?: string | null;
  /** Opens the deposit progress modal with the entered USDC amount. */
  onDeposit: (amount: string) => void;
  /** Opens the redeem progress modal with the entered share amount. */
  onRedeem: (shares: string) => void;
  onStake: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  const [tab, setTab] = useState<TabId>('deposit');
  const [amount, setAmount] = useState('');
  const [quick, setQuick] = useState<QuickPick>(null);
  const [usdcRaw, setUsdcRaw] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const entryPct = (entryFeeBps / 100).toFixed(2);
  const exitPct = (exitFeeBps / 100).toFixed(2);
  const feeLabel = tab === 'deposit' ? `Mint fee ${entryPct}%` : `Redeem fee ${exitPct}%`;
  const symbol = (shareSymbol || 'SHARES').toUpperCase();

  // USDC balance when wallet/network is available. No interval polling.
  // Click the BALANCE label to refresh manually. Dep array length must stay fixed.
  const loadUsdc = useCallback(async () => {
    if (!publicKey) {
      setUsdcRaw(null);
      return;
    }
    setBalanceLoading(true);
    try {
      const bal = await getUserUsdcBalance(connection, publicKey, network);
      setUsdcRaw(bal);
    } catch {
      setUsdcRaw(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [connection, publicKey, network]);

  useEffect(() => {
    void loadUsdc();
  }, [loadUsdc]);

  // Reset amount when switching tabs.
  useEffect(() => {
    setAmount('');
    setQuick(null);
  }, [tab]);

  const usdcUi = formatUiAmount(usdcRaw, USDC_DECIMALS);
  const balanceLabel =
    tab === 'deposit'
      ? !walletConnected
        ? 'BALANCE — USDC'
        : balanceLoading
          ? 'BALANCE … USDC'
          : `BALANCE ${usdcUi} USDC`
      : `BALANCE ${shareBalanceLabel ?? (walletConnected ? '0.00' : '—')} ${symbol}`;

  const payBalanceRaw = tab === 'deposit' ? usdcRaw : (shareBalanceRaw ?? null);
  const payDecimals = tab === 'deposit' ? USDC_DECIMALS : USDC_DECIMALS; // shares also 6 in product

  const setFromPct = (pct: number, pick: QuickPick) => {
    if (!payBalanceRaw || payBalanceRaw === '0') {
      setAmount('0');
      setQuick(pick);
      return;
    }
    setAmount(applyPct(payBalanceRaw, pct, payDecimals));
    setQuick(pick);
  };

  const onCustom = () => {
    setQuick('custom');
    // Keep current amount; focus for free typing.
    requestAnimationFrame(() => amountRef.current?.focus());
  };

  const onAmountChange = (value: string) => {
    // Allow empty, digits, one decimal point.
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return;
    setAmount(value);
    setQuick('custom');
  };

  const nav = parseUsdPrice(sharePriceLabel);
  const amountNum = amount.trim() === '' ? null : Number(amount);
  const receiveEstimate = useMemo(() => {
    if (amountNum == null || !Number.isFinite(amountNum) || amountNum <= 0) {
      return null;
    }
    if (tab === 'deposit') {
      if (nav == null) return null;
      const feeMult = 1 - entryFeeBps / 10_000;
      const shares = (amountNum * feeMult) / nav;
      return shares > 0 ? shares : null;
    }
    // Redeem: shares → USDC estimate at NAV after exit fee.
    if (nav == null) return null;
    const feeMult = 1 - exitFeeBps / 10_000;
    const usdc = amountNum * nav * feeMult;
    return usdc > 0 ? usdc : null;
  }, [amountNum, tab, nav, entryFeeBps, exitFeeBps]);

  const receiveDisplay =
    receiveEstimate == null
      ? '0.00'
      : receiveEstimate.toLocaleString(undefined, {
          maximumFractionDigits: 4,
          minimumFractionDigits: 0,
        });

  const feeAmountDisplay = useMemo(() => {
    if (amountNum == null || !Number.isFinite(amountNum) || amountNum <= 0) {
      return '—';
    }
    const bps = tab === 'deposit' ? entryFeeBps : exitFeeBps;
    const fee = (amountNum * bps) / 10_000;
    if (fee <= 0) return '0';
    return fee.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }, [amountNum, tab, entryFeeBps, exitFeeBps]);

  const hasAmount = amountNum != null && Number.isFinite(amountNum) && amountNum > 0;
  const ctaLabel = !walletConnected
    ? 'Connect wallet'
    : !hasAmount
      ? 'Enter an amount'
      : tab === 'deposit'
        ? 'Deposit USDC'
        : 'Redeem shares';

  const chips: { id: QuickPick; label: string; onClick: () => void }[] = [
    { id: '25', label: '25%', onClick: () => setFromPct(0.25, '25') },
    { id: '50', label: '50%', onClick: () => setFromPct(0.5, '50') },
    { id: '75', label: '75%', onClick: () => setFromPct(0.75, '75') },
    { id: 'max', label: 'MAX', onClick: () => setFromPct(1, 'max') },
    { id: 'custom', label: 'CUSTOM', onClick: onCustom },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[13px] border border-white/[0.09] bg-background p-[18px]">
        <div className="flex gap-1.5 rounded-full bg-white/[0.04] p-1">
          {(['deposit', 'redeem'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 rounded-full py-[9px] text-center text-[13px] font-semibold transition-colors ${
                tab === id
                  ? 'bg-accent text-background'
                  : 'font-medium text-text-dim hover:text-foreground'
              }`}
            >
              {id === 'deposit' ? 'Deposit' : 'Redeem'}
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 font-mono text-[10px] tracking-[0.12em] text-text-ghost">
          <span>{tab === 'deposit' ? 'YOU PAY' : 'YOU BURN'}</span>
          <button
            type="button"
            onClick={() => {
              if (tab === 'deposit') void loadUsdc();
            }}
            className="text-right transition-colors hover:text-muted-foreground"
            title={tab === 'deposit' ? 'Refresh USDC balance' : undefined}
          >
            {balanceLabel}
          </button>
        </div>

        <div className="mt-[9px] flex items-center justify-between gap-3 rounded-[11px] border border-white/[0.11] px-[15px] py-[11px] focus-within:border-accent/40">
          <input
            ref={amountRef}
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            aria-label={tab === 'deposit' ? 'USDC amount' : 'Share amount'}
            className="min-w-0 flex-1 bg-transparent text-[27px] font-medium tracking-[-0.02em] text-foreground outline-none placeholder:text-text-placeholder"
          />
          <span className="flex shrink-0 items-center gap-2 font-mono text-xs">
            {tab === 'deposit' ? (
              <>
                <span
                  className="inline-block h-[18px] w-[18px] rounded-full bg-[#5AC8E8]"
                  aria-hidden
                />
                USDC
              </>
            ) : (
              symbol
            )}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-[7px] font-mono text-[10.5px]">
          {chips.map((c) => {
            const active = quick === c.id;
            const disabled =
              !walletConnected ||
              (c.id !== 'custom' &&
                (payBalanceRaw == null || payBalanceRaw === '0'));
            return (
              <button
                key={c.id}
                type="button"
                disabled={disabled && c.id !== 'custom'}
                onClick={c.onClick}
                className={`min-w-[3.25rem] flex-1 rounded-full border px-2 py-[7px] text-center transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                  active
                    ? 'border-accent/45 bg-accent/12 text-accent'
                    : 'border-white/10 text-text-dim hover:border-white/20 hover:text-foreground'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="mt-5 font-mono text-[10px] tracking-[0.12em] text-text-ghost">
          YOU RECEIVE
        </div>
        <div className="mt-[9px] flex items-center justify-between rounded-[11px] border border-white/[0.06] bg-white/[0.02] px-[15px] py-[15px]">
          <span
            className={`text-[27px] font-medium tracking-[-0.02em] ${
              receiveEstimate != null ? 'text-foreground' : 'text-text-placeholder'
            }`}
          >
            {receiveDisplay}
          </span>
          <span className="font-mono text-xs">
            {tab === 'deposit' ? symbol : 'USDC'}
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-[11px] text-[13px]">
          <div className="flex justify-between">
            <span className="text-text-dim">NAV per share</span>
            <span className="font-mono">{sharePriceLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">{feeLabel}</span>
            <span className="font-mono text-text-faint">{feeAmountDisplay}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">Est. price impact</span>
            <span className="font-mono text-text-faint">—</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!hasAmount) return;
            if (tab === 'deposit') onDeposit(amount.trim());
            else onRedeem(amount.trim());
          }}
          disabled={!walletConnected || !hasAmount}
          className="mt-5 w-full rounded-full border border-accent/30 bg-accent/15 px-4 py-[15px] text-center text-sm font-semibold text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {ctaLabel}
        </button>
        <p className="mt-3 text-center text-[12.5px] leading-[1.55] text-text-ghost">
          Shares mint at live NAV. Redemption returns the underlying tokens pro
          rata. Your wallet will ask you to approve the transaction.
        </p>
      </div>

      {stakeable && (
        <div className="rounded-[13px] border border-accent/25 bg-background p-[18px]">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] tracking-[0.14em] text-accent">
              STAKE SHARES
            </div>
            <span className="rounded-full border border-border-strong px-[7px] py-[3px] font-mono text-[9.5px] text-text-dim">
              DAMM v2
            </span>
          </div>
          <p className="mt-3 text-sm leading-[1.5] text-muted-foreground">
            Put your {symbol} shares to work in the {symbol} / USDC pool. Shares
            stay redeemable; LP fees accrue to your position.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
            <div>
              <div className="font-mono text-[9.5px] tracking-[0.12em] text-text-ghost">
                ENTRY FEE
              </div>
              <div className="mt-1.5 text-xl font-semibold tracking-[-0.02em] text-accent">
                {entryPct}%
              </div>
            </div>
            <div>
              <div className="font-mono text-[9.5px] tracking-[0.12em] text-text-ghost">
                EXIT FEE
              </div>
              <div className="mt-1.5 text-xl font-semibold tracking-[-0.02em]">
                {exitPct}%
              </div>
            </div>
            <div>
              <div className="font-mono text-[9.5px] tracking-[0.12em] text-text-ghost">
                STAKED
              </div>
              <div className="mt-1.5 text-xl font-semibold tracking-[-0.02em] text-text-placeholder">
                0.00
              </div>
            </div>
          </div>
          <div className="mt-[18px] flex gap-[9px]">
            <button
              type="button"
              onClick={onStake}
              disabled={!walletConnected}
              className="flex-1 rounded-full bg-accent py-3.5 text-center text-sm font-semibold text-background transition-colors hover:bg-[#d4ff5c] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Stake {symbol}
            </button>
            <button
              type="button"
              disabled
              className="rounded-full border border-border-strong px-5 py-3.5 text-sm font-medium text-text-dim opacity-60"
            >
              Unstake
            </button>
          </div>
          <p className="mt-3 text-center text-xs leading-[1.5] text-text-ghost">
            Staking routes through DAMM v2. Impermanent loss applies while the
            position is open.
          </p>
        </div>
      )}
    </div>
  );
}
