'use client';

import { useState } from 'react';
import type { Network } from '@/lib/cvault';
import type { VaultRecord } from '@/lib/registryClient';
import { DepositModal } from './deposit-modal';
import { RedeemModal } from './redeem-modal';
import { btnPrimaryClass, panelClass, sectionLabelClass } from './ui-classes';

type Tab = 'buy' | 'sell';

export function VaultTradePanel({
  vault,
  network,
  sharePriceUsd,
  onDeposited,
  onRedeemed,
}: {
  vault: VaultRecord;
  network: Network;
  sharePriceUsd: string | null;
  onDeposited: () => void;
  onRedeemed: () => void;
}) {
  const [tab, setTab] = useState<Tab>('buy');
  const [depositOpen, setDepositOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);

  const feeBps = tab === 'buy' ? vault.deposit_fee_bps : vault.redeem_fee_bps;
  const feePct = (feeBps / 100).toFixed(2);

  return (
    <div className={`${panelClass} flex flex-col gap-4 px-5 py-4 md:px-6`}>
      <div className="t-tabs w-full border border-border" role="group" aria-label="Buy or sell">
        {(['buy', 'sell'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className="t-tab flex-1 px-2.5 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em]"
          >
            {t === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      <dl className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <dt className={sectionLabelClass}>NAV / share</dt>
          <dd className="font-mono text-xs tabular-nums text-foreground">
            {sharePriceUsd ?? '—'}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className={sectionLabelClass}>{tab === 'buy' ? 'Entry fee' : 'Exit fee'}</dt>
          <dd className="font-mono text-xs tabular-nums text-foreground">{feePct}%</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={() => (tab === 'buy' ? setDepositOpen(true) : setRedeemOpen(true))}
        className={btnPrimaryClass}
      >
        {tab === 'buy' ? 'Deposit' : 'Redeem & Claim'}
      </button>

      {depositOpen && (
        <DepositModal
          vault={vault}
          network={network}
          onClose={() => {
            setDepositOpen(false);
            onDeposited();
          }}
        />
      )}
      {redeemOpen && (
        <RedeemModal
          vault={vault}
          network={network}
          onClose={() => {
            setRedeemOpen(false);
            onRedeemed();
          }}
        />
      )}
    </div>
  );
}
