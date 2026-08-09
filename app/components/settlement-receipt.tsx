'use client';

/**
 * Countersigned settlement stub shown after a deposit or redeem lands.
 *
 * Amounts are measured client-side as balance deltas (after − before) because
 * `depositAndDeploy` / `redeemSwap` return signatures only. A delta can be
 * unavailable — every value here is therefore optional.
 *
 * Visual layout matches `ui/new_ui/component2/cVault-6A-Transaction-Modals.html`
 * settled state (check + stamp, row list, dual CTA footer).
 */

import { useEffect, useRef, useState } from 'react';

export type SettlementLeg = {
  /** Row label — what left, or what arrived. */
  label: string;
  /** Human-readable amount, already comma-grouped. Null when unmeasurable. */
  amount: string | null;
  /** Ticker printed after the amount. */
  unit: string;
};

/** Comma-group an already-formatted decimal string. */
export function groupDecimal(ui: string): string {
  const [whole, frac] = ui.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/**
 * Exact decimal division for the settlement rate, done in integer space so a
 * float never rounds a price the user is reading off a receipt.
 * Returns null when the divisor is zero or either side is unmeasurable.
 */
export function settlementRate(
  numeratorRaw: string | null,
  numeratorDecimals: number,
  denominatorRaw: string | null,
  denominatorDecimals: number,
  resultDecimals = 6,
): string | null {
  if (numeratorRaw === null || denominatorRaw === null) return null;
  let num: bigint;
  let den: bigint;
  try {
    num = BigInt(numeratorRaw);
    den = BigInt(denominatorRaw);
  } catch {
    return null;
  }
  if (den <= 0n || num <= 0n) return null;
  const scaled =
    (num * 10n ** BigInt(denominatorDecimals) * 10n ** BigInt(resultDecimals)) /
    (den * 10n ** BigInt(numeratorDecimals));
  const s = scaled.toString().padStart(resultDecimals + 1, '0');
  const whole = s.slice(0, s.length - resultDecimals);
  const frac = s.slice(s.length - resultDecimals).replace(/0+$/, '');
  return frac ? `${groupDecimal(whole)}.${frac}` : groupDecimal(whole);
}

function useStruckAmount(target: string | null): string | null {
  const [override, setOverride] = useState<string | null>(null);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (target === null) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const numeric = Number(target.replace(/,/g, ''));
    if (reduced || !Number.isFinite(numeric) || numeric <= 0) return;

    const frac = target.split('.')[1]?.length ?? 0;
    const start = performance.now();
    const DURATION = 520;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      if (t === 1) {
        setOverride(null);
        return;
      }
      const eased = 1 - Math.pow(2, -10 * t);
      setOverride(groupDecimal((numeric * eased).toFixed(frac)));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    const settle = setTimeout(() => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      setOverride(null);
    }, DURATION + 80);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      clearTimeout(settle);
    };
  }, [target]);

  return override ?? target;
}

function LegRow({
  leg,
  emphasis,
  borderedBottom,
}: {
  leg: SettlementLeg;
  emphasis: boolean;
  borderedBottom?: boolean;
}) {
  const struck = useStruckAmount(emphasis ? leg.amount : null);
  const shown = emphasis ? struck : leg.amount;
  return (
    <div
      className={`flex items-center justify-between gap-4 border-t border-white/[0.07] py-3 ${
        borderedBottom ? 'border-b border-white/[0.07]' : ''
      }`}
    >
      <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-dim">
        {leg.label}
      </dt>
      <dd
        className={`min-w-0 truncate text-right font-mono tabular-nums ${
          emphasis
            ? 'text-[19px] font-medium leading-tight text-accent'
            : 'text-[14px] font-medium text-foreground'
        }`}
        title={leg.amount ?? undefined}
      >
        {shown === null ? (
          <span className="text-[13px] font-medium text-muted-foreground">
            not recorded
          </span>
        ) : (
          <>
            {shown}
            {leg.unit ? (
              <span className="ml-1.5 text-[10.5px] font-medium text-text-faint">
                {leg.unit}
              </span>
            ) : null}
          </>
        )}
      </dd>
    </div>
  );
}

export function SettlementReceipt({
  kind,
  vaultId: _vaultId,
  surrendered,
  issued,
  rate,
  note,
  solscan,
  onDone,
  doneLabel,
  againLabel,
  onAgain,
  metaLeft,
}: {
  /** Drives the stamp wording. */
  kind: 'deposit' | 'redeem' | 'create';
  vaultId: number;
  /** What the user gave up — USDC on deposit, shares on redeem. */
  surrendered: SettlementLeg;
  /** What the user received — shares on deposit, USDC on redeem. */
  issued: SettlementLeg;
  /** Settlement rate line, e.g. "1.0243 USDC / BC". Omitted when unmeasurable. */
  rate?: { label: string; value: string; unit?: string } | null;
  /** Secondary operational detail (ALT persistence, tx count). */
  note?: string | null;
  solscan?: string;
  onDone: () => void;
  doneLabel: string;
  /** Optional secondary CTA (Deposit again / Redeem more). */
  againLabel?: string;
  onAgain?: () => void;
  /** Left-side meta under the rows (e.g. "2 TRANSACTIONS · SETUP + SWAPS"). */
  metaLeft?: string | null;
}) {
  void _vaultId;
  const stampText =
    kind === 'deposit' ? 'Deposited' : kind === 'redeem' ? 'Redeemed' : 'Created';

  const hasDualCta = Boolean(againLabel && onAgain);

  return (
    <section
      aria-label={`${stampText} — settlement receipt`}
      className="flex flex-col"
    >
      <div className="px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex size-7 items-center justify-center rounded-full bg-accent/15 text-xs text-accent"
            >
              ✓
            </span>
            <p className="text-[22px] font-semibold tracking-[-0.03em] text-foreground">
              {stampText}
            </p>
          </div>
          <span className="rounded-full border border-accent/35 px-2.5 py-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-accent">
            Settled
          </span>
        </div>

        <dl className="mt-4">
          <LegRow leg={surrendered} emphasis={false} />
          <LegRow leg={issued} emphasis />
          {rate && (
            <div className="flex items-center justify-between gap-4 border-t border-b border-white/[0.07] py-3">
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-dim">
                {rate.label}
              </dt>
              <dd className="font-mono text-[14px] font-medium tabular-nums text-foreground">
                {rate.value}
                {rate.unit ? (
                  <span className="ml-1.5 text-[10.5px] font-medium text-text-faint">
                    {rate.unit}
                  </span>
                ) : null}
              </dd>
            </div>
          )}
        </dl>

        {(metaLeft || note || solscan) && (
          <div className="mt-4 flex items-start justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-ghost">
            <p className="min-w-0 whitespace-pre-wrap break-words leading-relaxed">
              {metaLeft ?? note ?? null}
            </p>
            {solscan && (
              <a
                href={solscan}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-accent underline transition-colors hover:text-foreground"
              >
                Solscan ↗
              </a>
            )}
          </div>
        )}

        {/* When note is separate from metaLeft (ALT details etc.), show under meta. */}
        {metaLeft && note && (
          <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-text-ghost">
            {note}
          </p>
        )}
      </div>

      <div
        className={`border-t border-white/[0.07] bg-bg-elevated px-5 py-4 ${
          hasDualCta ? 'grid grid-cols-2 gap-2.5' : ''
        }`}
      >
        {hasDualCta && (
          <button
            type="button"
            onClick={onAgain}
            className="flex h-12 items-center justify-center rounded-[10px] border border-white/14 text-[14.5px] font-medium text-[#DADADE] transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {againLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className={`flex h-12 items-center justify-center rounded-[10px] bg-accent text-[14.5px] font-semibold text-background transition-[transform,background] duration-150 hover:-translate-y-px hover:bg-[#d4ff5c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            hasDualCta ? '' : 'w-full'
          }`}
        >
          {doneLabel}
        </button>
      </div>
    </section>
  );
}
