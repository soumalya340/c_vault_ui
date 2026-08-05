'use client';

/**
 * Countersigned settlement stub shown after a deposit or redeem lands.
 *
 * The console's OUTPUT panel answers "did it work?" but never "what did I
 * actually get?". This component answers the second question in the register
 * the rest of the app speaks: an engraved certificate counterfoil that states
 * what was surrendered, what was issued in return, and the rate between them.
 *
 * Amounts are measured client-side as balance deltas (after − before) because
 * `depositAndDeploy` / `redeemSwap` return signatures only. A delta can be
 * unavailable (RPC lag, an ATA that did not exist at read time) — every value
 * here is therefore optional, and the stub degrades to the exact leg it can
 * still prove rather than printing a fabricated number.
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
  // Normalise both sides to a common scale, then scale up for the quotient's
  // fractional digits: (num / 10^nd) / (den / 10^dd) = num * 10^dd / (den * 10^nd)
  const scaled =
    (num * 10n ** BigInt(denominatorDecimals) * 10n ** BigInt(resultDecimals)) /
    (den * 10n ** BigInt(numeratorDecimals));
  const s = scaled.toString().padStart(resultDecimals + 1, '0');
  const whole = s.slice(0, s.length - resultDecimals);
  const frac = s.slice(s.length - resultDecimals).replace(/0+$/, '');
  return frac ? `${groupDecimal(whole)}.${frac}` : groupDecimal(whole);
}

/**
 * Counts an amount up to its final value on mount — the engraving being
 * struck rather than a number that simply appears. Skipped entirely under
 * reduced motion, and for values that aren't finite positive numbers.
 *
 * `override` holds the in-flight frame value and is null whenever the count
 * isn't running, so the committed `target` renders unchanged on the first
 * paint and on the final frame. State is only written from inside rAF —
 * never synchronously in the effect body.
 */
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

    // Preserve the exact fractional width of the final string so digits don't
    // reflow mid-count; the last frame clears the override so the committed
    // target string (not a float round-trip) is what remains on screen.
    const frac = target.split('.')[1]?.length ?? 0;
    const start = performance.now();
    const DURATION = 520;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      if (t === 1) {
        setOverride(null);
        return;
      }
      // easeOutExpo — fast strike, settling finish.
      const eased = 1 - Math.pow(2, -10 * t);
      setOverride(groupDecimal((numeric * eased).toFixed(frac)));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    // Safety net: rAF is throttled or suspended in a background tab, which
    // would strand a partial figure on screen. This is a financial receipt —
    // a stale intermediate number is worse than no animation, so settle on the
    // true value once the animation's wall-clock window has elapsed no matter
    // how many frames were actually delivered.
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
      <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {leg.label}
      </dt>
      <dd
        className={`min-w-0 truncate text-right font-mono tabular-nums ${
          emphasis
            ? 'text-[19px] font-bold leading-tight text-accent'
            : 'text-[13px] font-semibold text-foreground'
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
                emphasis ? 'text-[12px] text-accent/70' : 'text-[11px] text-muted-foreground'
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
  /** Drives the stamp wording and the seal colour. */
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
  const stampText = kind === 'deposit' ? 'Deposited' : kind === 'redeem' ? 'Redeemed' : 'Created';

  return (
    <section
      aria-label={`${stampText} — settlement receipt`}
      className="cert-frame relative overflow-hidden bg-foreground/[0.03] px-5 py-5"
    >
      {/* Counterfoil header: the stamp is the one loud element on the stub. */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
            Settlement · № {String(vaultId).padStart(2, '0')}
          </p>
          <p className="mt-2 font-display text-[26px] font-semibold leading-none tracking-[0.01em] text-foreground">
            {stampText}
          </p>
        </div>
        <span
          aria-hidden
          className="stamp shrink-0 text-[10px]"
          style={{ animation: 'cert-fadeup var(--duration-fast) var(--ease-smooth-out) both' }}
        >
          Settled
        </span>
      </div>

      <div
        className="mt-5 space-y-3.5 border-t border-border-strong pt-4"
        style={{ animation: 'cert-fadeup var(--duration-medium) var(--ease-smooth-out) both' }}
      >
        <LegRow leg={surrendered} emphasis={false} />
        <LegRow leg={issued} emphasis />
        {rate && (
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3.5">
            <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              {rate.label}
            </dt>
            <dd className="font-mono text-[13px] font-semibold tabular-nums text-foreground">
              {rate.value}
            </dd>
          </div>
        )}
      </div>

      {note && (
        <p className="mt-4 whitespace-pre-wrap break-words border-t border-border pt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {note}
        </p>
      )}

      <div className="mt-5 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onDone}
          className="rounded-[2px] border border-accent bg-accent px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-background transition-[filter] duration-150 hover:brightness-[1.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {doneLabel}
        </button>
        {solscan && (
          <a
            href={solscan}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent underline transition-colors hover:text-foreground"
          >
            View on Solscan
          </a>
        )}
      </div>
    </section>
  );
}
