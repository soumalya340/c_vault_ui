'use client';

/**
 * Translates the raw `onProgress` operator log (SDK strings like "Checking
 * DEX TWAP freshness for 2/4 vault asset(s)…" or "Estimating ViaSol asset
 * 1/4 → wSOL (simulation)…") into the small, fixed set of phases a holder
 * actually cares about. The SDK narrates its internals; this renders what's
 * *happening to the user's money* — one phase active at a time, not a
 * scrolling console.
 *
 * Phase order is fixed per flow (confirmed against cvault.tsx call order —
 * preflight always precedes building/sending, claim always comes last), so
 * this never needs to reorder — only to advance a pointer as messages match.
 */

import { Spinner } from '@/components/ui/spinner';

export type PhaseId = 'preflight' | 'swap' | 'claim';

type Phase = { id: PhaseId; label: string };

const DEPOSIT_PHASES: Phase[] = [
  { id: 'preflight', label: 'Preparing route' },
  { id: 'swap', label: 'Depositing & swapping' },
];

const REDEEM_PHASES: Phase[] = [
  { id: 'preflight', label: 'Preparing route' },
  { id: 'swap', label: 'Swapping to USDC' },
  { id: 'claim', label: 'Claiming payout' },
];

const CLAIM_ONLY_PHASES: Phase[] = [{ id: 'claim', label: 'Claiming payout' }];

/**
 * Keyword → phase. Order matters: first match wins, and claim-ish language
 * is checked before swap-ish language since a redeem's final step can say
 * both ("Redeem: burn + swap + claim → …").
 */
function classify(message: string): PhaseId {
  const m = message.toLowerCase();
  if (/claim/.test(m)) return 'claim';
  if (/twap|alt|lookup table|preflight|activation/.test(m)) return 'preflight';
  return 'swap';
}

/** Highest phase index reached by any message seen so far (monotonic — never regresses). */
function furthestPhaseIndex(steps: string[], phases: Phase[]): number {
  let idx = 0;
  for (const step of steps) {
    const phaseId = classify(step);
    const i = phases.findIndex((p) => p.id === phaseId);
    if (i > idx) idx = i;
  }
  return idx;
}

export function TransactionPhases({
  flow,
  steps,
  active,
}: {
  flow: 'deposit' | 'redeem' | 'claim';
  steps: string[];
  /** False once the flow has settled (success or error) — freezes the strip. */
  active: boolean;
}) {
  if (steps.length === 0) return null;

  const phases =
    flow === 'deposit' ? DEPOSIT_PHASES : flow === 'claim' ? CLAIM_ONLY_PHASES : REDEEM_PHASES;
  const currentIdx = furthestPhaseIndex(steps, phases);

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-[2px] border border-border bg-foreground/[0.02] px-4 py-3"
    >
      <ol className="space-y-2.5">
        {phases.map((phase, i) => {
          const isDone = active ? i < currentIdx : true;
          const isCurrent = active && i === currentIdx;
          return (
            <li key={phase.id} className="flex items-center gap-2.5">
              <span className="flex size-4 shrink-0 items-center justify-center">
                {isCurrent ? (
                  <Spinner className="size-3.5 text-accent" />
                ) : isDone ? (
                  <span aria-hidden className="text-[13px] leading-none text-accent">
                    ✓
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-muted-foreground/30"
                  />
                )}
              </span>
              <span
                className={`font-mono text-[11px] uppercase tracking-[0.12em] ${
                  isCurrent
                    ? 'font-bold text-foreground'
                    : isDone
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/50'
                }`}
              >
                {phase.label}
                {isCurrent && '…'}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
