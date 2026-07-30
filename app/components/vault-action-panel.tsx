'use client';

import { useState } from 'react';
import { panelClass } from './ui-classes';

type TabId = 'deposit' | 'redeem' | 'stake';

/**
 * Sticky action column — Deposit / Redeem / Stake tabs open the existing
 * production modals. Quotes use live share price + vault fee bps only.
 */
export function VaultActionPanel({
  sharePriceLabel,
  entryFeeBps,
  exitFeeBps,
  stakeable,
  onDeposit,
  onRedeem,
  onStake,
  walletConnected,
}: {
  sharePriceLabel: string;
  entryFeeBps: number;
  exitFeeBps: number;
  stakeable: boolean;
  onDeposit: () => void;
  onRedeem: () => void;
  onStake: () => void;
  walletConnected: boolean;
}) {
  const tabs: { id: TabId; label: string; hidden?: boolean }[] = [
    { id: 'deposit', label: 'Deposit' },
    { id: 'redeem', label: 'Redeem' },
    { id: 'stake', label: 'Stake', hidden: !stakeable },
  ];
  const visible = tabs.filter((t) => !t.hidden);
  const [tab, setTab] = useState<TabId>('deposit');
  const active = visible.some((t) => t.id === tab) ? tab : 'deposit';

  const entryPct = (entryFeeBps / 100).toFixed(2);
  const exitPct = (exitFeeBps / 100).toFixed(2);

  const quote =
    active === 'deposit'
      ? [
          ['Entry fee', `${entryPct}%`],
          ['Share price', sharePriceLabel],
          ['Settles', 'mint shares · USDC in'],
        ]
      : active === 'redeem'
        ? [
            ['Exit fee', `${exitPct}%`],
            ['Share price', sharePriceLabel],
            ['Settles', 'burn shares · claim USDC'],
          ]
        : [
            ['Pool', 'DAMM v2 shares × USDC'],
            ['Share price', sharePriceLabel],
            ['Settles', 'add LP liquidity'],
          ];

  const cta =
    active === 'deposit'
      ? 'Deposit USDC'
      : active === 'redeem'
        ? 'Redeem & claim'
        : 'Stake & earn';

  const onCta =
    active === 'deposit'
      ? onDeposit
      : active === 'redeem'
        ? onRedeem
        : onStake;

  return (
    <div className={`${panelClass} overflow-hidden`}>
      <div
        className="grid border-b border-border-strong"
        style={{ gridTemplateColumns: `repeat(${visible.length}, 1fr)` }}
      >
        {visible.map((t, i) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-2 py-3 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
              i > 0 ? 'border-l border-border' : ''
            } ${
              active === t.id
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 py-4">
        <dl className="my-1 border-y border-border">
          {quote.map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between gap-3 border-b border-border py-2 text-xs last:border-b-0"
            >
              <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {k}
              </dt>
              <dd className="m-0 font-mono text-xs tabular-nums text-foreground">
                {v}
              </dd>
            </div>
          ))}
        </dl>

        <button
          type="button"
          onClick={onCta}
          disabled={!walletConnected}
          className={`mt-4 w-full border border-border-strong px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] transition-[filter,opacity] disabled:cursor-not-allowed disabled:opacity-40 ${
            active === 'redeem'
              ? 'bg-seal text-background hover:brightness-110'
              : 'bg-accent text-background hover:brightness-110'
          }`}
        >
          {walletConnected ? cta : 'Connect wallet'}
        </button>

        <p className="mt-3.5 text-xs leading-relaxed text-muted-foreground">
          {active === 'redeem'
            ? 'Redeeming burns shares and settles USDC via the on-chain redeem path. Pending claim is collected in the same flow when ready.'
            : active === 'stake'
              ? 'Stake deposits vault shares plus matching USDC into the DAMM v2 secondary pool for LP yield.'
              : 'Priced off the live NAV view, settled at the slot your transaction lands. Deposit mints vault shares against USDC.'}
        </p>
      </div>

      <div className="border-t border-border-strong bg-foreground/[0.04] px-4 py-3.5">
        <div className="flex items-center justify-between py-1 text-xs text-foreground/80">
          <span>Entry</span>
          <span className="font-mono text-[11px] tabular-nums">{entryPct}%</span>
        </div>
        <div className="flex items-center justify-between py-1 text-xs text-foreground/80">
          <span>Exit</span>
          <span className="font-mono text-[11px] tabular-nums">{exitPct}%</span>
        </div>
      </div>
    </div>
  );
}
