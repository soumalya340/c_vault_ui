'use client';

/**
 * Translates the raw `onProgress` operator log into the small, fixed set of
 * phases a holder actually cares about. Phase order is fixed per flow
 * (confirmed against cvault.tsx call order), so this only advances a pointer
 * as messages match.
 *
 * Visual layout matches `ui/new_ui/component2/cVault-6A-Transaction-Modals.html`
 * in-flight checklist.
 */

import { Spinner } from '@/components/ui/spinner';

export type PhaseId =
  | 'preflight'
  | 'swap'
  | 'confirm'
  | 'claim'
  | 'vault'
  | 'metadata'
  | 'genesis'
  | 'record';

type Phase = { id: PhaseId; label: string };

const DEPOSIT_PHASES: Phase[] = [
  { id: 'preflight', label: 'Preparing route' },
  { id: 'swap', label: 'Depositing & swapping' },
  { id: 'confirm', label: 'Confirming shares' },
];

const REDEEM_PHASES: Phase[] = [
  { id: 'preflight', label: 'Preparing route' },
  { id: 'swap', label: 'Swapping assets to USDC' },
  { id: 'claim', label: 'Claiming payout' },
];

const CLAIM_ONLY_PHASES: Phase[] = [{ id: 'claim', label: 'Claiming payout' }];

const CREATE_PHASES: Phase[] = [
  { id: 'vault', label: 'Creating vault' },
  { id: 'metadata', label: 'Setting metadata' },
  { id: 'preflight', label: 'Creating lookup table' },
  { id: 'record', label: 'Recording vault' },
  { id: 'genesis', label: 'Seeding genesis deposit' },
];

function classify(
  message: string,
  flow: 'deposit' | 'redeem' | 'claim' | 'create',
): PhaseId {
  const m = message.toLowerCase();
  if (flow === 'create') {
    if (/genesis/.test(m)) return 'genesis';
    if (/record/.test(m)) return 'record';
    if (/lookup table|alt/.test(m)) return 'preflight';
    if (/metadata/.test(m)) return 'metadata';
    return 'vault';
  }
  if (/claim/.test(m)) return 'claim';
  if (/confirm|mint|share balance|reading share/.test(m)) return 'confirm';
  if (/twap|alt|lookup table|preflight|activation|preparing/.test(m)) {
    return 'preflight';
  }
  return 'swap';
}

function furthestPhaseIndex(
  steps: string[],
  phases: Phase[],
  flow: 'deposit' | 'redeem' | 'claim' | 'create',
): number {
  let idx = 0;
  for (const step of steps) {
    const phaseId = classify(step, flow);
    const i = phases.findIndex((p) => p.id === phaseId);
    if (i > idx) idx = i;
  }
  return idx;
}

export function TransactionPhases({
  flow,
  steps,
  active,
  swapLabel,
  hint,
}: {
  flow: 'deposit' | 'redeem' | 'claim' | 'create';
  steps: string[];
  /** False once the flow has settled (success or error) — freezes the strip. */
  active: boolean;
  /** Override the mid-phase label (e.g. "Swapping 5 assets to USDC"). */
  swapLabel?: string;
  /** Optional note under the checklist (defaults to deposit/redeem copy). */
  hint?: string | null;
}) {
  if (steps.length === 0) return null;

  const phases =
    flow === 'deposit'
      ? DEPOSIT_PHASES
      : flow === 'claim'
        ? CLAIM_ONLY_PHASES
        : flow === 'create'
          ? CREATE_PHASES
          : REDEEM_PHASES.map((p) =>
              p.id === 'swap' && swapLabel ? { ...p, label: swapLabel } : p,
            );
  const currentIdx = furthestPhaseIndex(steps, phases, flow);

  const defaultHint =
    flow === 'redeem' || flow === 'claim'
      ? 'If the claim fails, your proceeds stay escrowed — reopen this modal and claim without burning again.'
      : 'Keep this window open — the second transaction needs the same wallet session.';

  return (
    <div className="space-y-3.5">
      <div
        role="status"
        aria-live="polite"
        className="overflow-hidden rounded-xl border border-white/[0.09] bg-bg-elevated"
      >
        <ol>
          {phases.map((phase, i) => {
            const isDone = active ? i < currentIdx : true;
            const isCurrent = active && i === currentIdx;
            return (
              <li
                key={phase.id}
                className={`flex items-center gap-3 px-4 py-[13px] ${
                  isCurrent ? 'bg-background' : ''
                } ${i > 0 ? 'border-t border-white/[0.06]' : ''}`}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {isCurrent ? (
                    <Spinner className="size-3.5 text-accent" />
                  ) : isDone ? (
                    <span
                      aria-hidden
                      className="flex size-4 items-center justify-center rounded-full bg-accent/15 text-[9px] leading-none text-accent"
                    >
                      ✓
                    </span>
                  ) : (
                    <span
                      aria-hidden
                      className="size-4 rounded-full border border-white/14"
                    />
                  )}
                </span>
                <span
                  className={`flex-1 font-mono text-[10.5px] uppercase tracking-[0.12em] ${
                    isCurrent
                      ? 'font-medium text-foreground'
                      : isDone
                        ? 'text-text-faint'
                        : 'text-[#4A4A50]'
                  }`}
                >
                  {phase.label}
                </span>
                {isCurrent && (
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-accent">
                    Signing
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {active && hint !== null && (
        <p className="font-mono text-[10px] leading-[1.7] text-text-ghost">
          {hint ?? defaultHint}
        </p>
      )}
    </div>
  );
}
