'use client';

import { useState } from 'react';

type TabId = 'deposit' | 'redeem';

/**
 * Right-column trade card from the 2A vault-detail mock.
 * CTAs open the existing production deposit / redeem modals.
 */
export function VaultActionPanel({
  sharePriceLabel,
  entryFeeBps,
  exitFeeBps,
  stakeable,
  shareSymbol,
  walletConnected,
  shareBalanceLabel,
  onDeposit,
  onRedeem,
  onStake,
}: {
  sharePriceLabel: string;
  entryFeeBps: number;
  exitFeeBps: number;
  stakeable: boolean;
  shareSymbol: string;
  walletConnected: boolean;
  shareBalanceLabel?: string | null;
  onDeposit: () => void;
  onRedeem: () => void;
  onStake: () => void;
}) {
  const [tab, setTab] = useState<TabId>('deposit');
  const entryPct = (entryFeeBps / 100).toFixed(2);
  const exitPct = (exitFeeBps / 100).toFixed(2);
  const feeLabel = tab === 'deposit' ? `Mint fee ${entryPct}%` : `Redeem fee ${exitPct}%`;
  const symbol = (shareSymbol || 'SHARES').toUpperCase();

  return (
    <div className="flex flex-col gap-4">
      {/* Deposit / Redeem card */}
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

        <div className="mt-5 flex justify-between font-mono text-[10px] tracking-[0.12em] text-text-ghost">
          <span>{tab === 'deposit' ? 'YOU PAY' : 'YOU BURN'}</span>
          <span>
            {tab === 'deposit'
              ? 'BALANCE — USDC'
              : `BALANCE ${shareBalanceLabel ?? '0.00'} ${symbol}`}
          </span>
        </div>

        <div className="mt-[9px] flex items-center justify-between rounded-[11px] border border-white/[0.11] px-[15px] py-[15px]">
          <span className="text-[27px] font-medium tracking-[-0.02em] text-text-placeholder">
            0.00
          </span>
          <span className="flex items-center gap-2 font-mono text-xs">
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

        <div className="mt-2.5 flex gap-[7px] font-mono text-[10.5px]">
          {['25%', '50%', '75%', 'MAX'].map((q) => (
            <span
              key={q}
              className="flex-1 rounded-full border border-white/10 py-[7px] text-center text-text-dim"
            >
              {q}
            </span>
          ))}
        </div>

        <div className="mt-5 font-mono text-[10px] tracking-[0.12em] text-text-ghost">
          YOU RECEIVE
        </div>
        <div className="mt-[9px] flex items-center justify-between rounded-[11px] border border-white/[0.06] bg-white/[0.02] px-[15px] py-[15px]">
          <span className="text-[27px] font-medium tracking-[-0.02em] text-text-placeholder">
            0.00
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
            <span className="font-mono text-text-faint">—</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">Est. price impact</span>
            <span className="font-mono text-text-faint">—</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-dim">Route</span>
            <span className="font-mono">ORCA · DAMM v2</span>
          </div>
        </div>

        <button
          type="button"
          onClick={tab === 'deposit' ? onDeposit : onRedeem}
          disabled={!walletConnected}
          className="mt-5 w-full rounded-full border border-accent/30 bg-accent/15 px-4 py-[15px] text-center text-sm font-semibold text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {walletConnected
            ? tab === 'deposit'
              ? 'Deposit USDC'
              : 'Redeem shares'
            : 'Connect wallet'}
        </button>
        <p className="mt-3 text-center text-[12.5px] leading-[1.55] text-text-ghost">
          Shares mint at live NAV. Redemption returns the underlying tokens pro
          rata.
        </p>
      </div>

      {/* Stake card */}
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
