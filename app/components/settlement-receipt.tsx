'use client';

/**
 * Countersigned settlement stub shown after a deposit or redeem lands.
 *
 * Amounts are measured client-side as balance deltas (after − before) because
 * `depositAndDeploy` / `redeemSwap` return signatures only. A delta can be
 * unavailable — every value here is therefore optional.
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

function LegRow({ leg, emphasis }: { leg: SettlementLeg; emphasis: boolean }) {
  const struck = useStruckAmount(emphasis ? leg.amount : null);
  const shown = emphasis ? struck : leg.amount;
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-ghost">
        {leg.label}
      </dt>
      <dd
        className={`min-w-0 truncate text-right font-mono tabular-nums ${
          emphasis
            ? 'text-[22px] font-semibold leading-tight text-accent'
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
            <span
              className={`ml-1.5 font-medium ${
                emphasis
                  ? 'text-[12px] text-accent/70'
                  : 'text-[11px] text-text-ghost'
              }`}
            >
              {leg.unit}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

export function SettlementReceipt({
  kind,
  vaultId,
  surrendered,
  issued,
  rate,
  note,
  solscan,
  onDone,
  doneLabel,
}: {
  /** Drives the stamp wording. */
  kind: 'deposit' | 'redeem' | 'create';
  vaultId: number;
  /** What the user gave up — USDC on deposit, shares on redeem. */
  surrendered: SettlementLeg;
  /** What the user received — shares on deposit, USDC on redeem. */
  issued: SettlementLeg;
  /** Settlement rate line, e.g. "1.0243 USDC / BC". Omitted when unmeasurable. */
  rate?: { label: string; value: string } | null;
  /** Secondary operational detail (ALT persistence, tx count). */
  note?: string | null;
  solscan?: string;
  onDone: () => void;
  doneLabel: string;
}) {
  const stampText =
    kind === 'deposit' ? 'Deposited' : kind === 'redeem' ? 'Redeemed' : 'Created';
  const kindLabel =
    kind === 'deposit' ? 'Deposit' : kind === 'redeem' ? 'Redeem' : 'Create';

  return (
    <section
      aria-label={`${stampText} — settlement receipt`}
      className="relative overflow-hidden rounded-[12px] border border-white/[0.07] bg-bg-elevated px-5 py-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-accent">
            {kindLabel} · № {String(vaultId).padStart(2, '0')}
          </p>
          <p className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] text-foreground">
            {stampText}
          </p>
        </div>
        <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-accent">
          Settled
        </span>
      </div>

      <div className="mt-5 space-y-3.5 border-t border-white/[0.07] pt-4">
        <LegRow leg={surrendered} emphasis={false} />
        <LegRow leg={issued} emphasis />
        {rate && (
          <div className="flex items-baseline justify-between gap-4 border-t border-white/[0.06] pt-3.5">
            <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-ghost">
              {rate.label}
            </dt>
            <dd className="font-mono text-[13px] font-medium tabular-nums text-foreground">
              {rate.value}
            </dd>
          </div>
        )}
      </div>

      {note && (
        <p className="mt-4 whitespace-pre-wrap break-words border-t border-white/[0.06] pt-3 font-mono text-[11px] leading-relaxed text-text-ghost">
          {note}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onDone}
          className="rounded-full bg-accent px-6 py-2.5 text-[13.5px] font-semibold text-background transition-[transform,background] duration-150 hover:-translate-y-px hover:bg-[#d4ff5c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {doneLabel}
        </button>
        {solscan && (
          <a
            href={solscan}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent transition-colors hover:text-foreground"
          >
            Solscan ↗
          </a>
        )}
      </div>
    </section>
  );
}
