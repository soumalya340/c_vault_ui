'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { UserFacingError } from '@/lib/onchain/txError';
import { btnGhostClass, btnPrimaryClass } from './ui-classes';
import { useModalTransition } from './use-modal-transition';

function useIsClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Error dialog for transaction failures.
 * (TWAP keeper refresh removed — deposit/NAV price live pool spot as of 2.0.2.)
 */
export function ErrorModal({
  error,
  onClose,
}: {
  error: UserFacingError;
  onClose: () => void;
  /** @deprecated unused — kept for call-site compatibility */
  vaultId?: number | null;
  /** @deprecated unused — kept for call-site compatibility */
  network?: string;
  /** @deprecated unused — kept for call-site compatibility */
  onRefreshSuccess?: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const mounted = useIsClient();
  const { requestClose, modalClassName, backdropClassName, isClosing } =
    useModalTransition(onClose);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isClosing) requestClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLElement>('button[data-dismiss]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [requestClose, isClosing]);

  if (!mounted) return null;

  const kindLabel =
    error.kind === 'info' ? 'notice' : error.kind === 'warning' ? 'warning' : 'refused';
  const accentClass =
    error.kind === 'info'
      ? 'text-accent'
      : error.kind === 'warning'
        ? 'text-seal'
        : 'text-destructive';
  const borderAccent =
    error.kind === 'info'
      ? 'border-accent/50'
      : error.kind === 'warning'
        ? 'border-seal/50'
        : 'border-destructive/45';

  const copyDetails = async () => {
    const text = [
      error.title,
      error.summary,
      error.fix ? `What to do: ${error.fix}` : '',
      error.code ? `Code: ${error.code}` : '',
      error.instruction ? `Instruction: ${error.instruction}` : '',
      '',
      error.details || error.raw,
    ]
      .filter((l) => l !== undefined)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm ${backdropClassName}`}
        onClick={() => {
          if (!isClosing) requestClose();
        }}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-summary`}
        className={`cert-frame relative z-10 w-full max-w-[520px] overflow-hidden bg-background shadow-2xl ${modalClassName}`}
      >
        <div className={`border-b border-border-strong px-6 py-4 ${borderAccent}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div
                className={`font-mono text-[10px] font-bold uppercase tracking-[0.24em] ${accentClass}`}
              >
                transaction · {kindLabel}
              </div>
              <h2
                id={titleId}
                className="mt-1.5 font-display text-xl font-semibold leading-snug tracking-[0.02em] text-foreground"
              >
                {error.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={isClosing}
              aria-label="Close"
              className={btnGhostClass}
            >
              Close
            </button>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p id={`${titleId}-summary`} className="text-sm leading-[1.55] text-foreground">
            {error.summary}
          </p>

          {error.fix && (
            <div className="rounded-[2px] border border-border bg-foreground/[0.03] px-3.5 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
                What to do
              </p>
              <p className="mt-1.5 text-sm leading-[1.55] text-foreground">{error.fix}</p>
            </div>
          )}

          {(error.instruction || error.code) && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-[11px]">
              {error.instruction && (
                <>
                  <dt className="text-muted-foreground">Instruction</dt>
                  <dd className="text-foreground">{error.instruction}</dd>
                </>
              )}
              {error.code && (
                <>
                  <dt className="text-muted-foreground">Code</dt>
                  <dd className="break-all text-foreground">{error.code}</dd>
                </>
              )}
            </dl>
          )}

          {(error.details || error.raw) && (
            <div className="rounded-[2px] border border-border">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                aria-expanded={showDetails}
              >
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Technical log
                </span>
                <span className="font-mono text-xs text-muted-foreground" aria-hidden>
                  {showDetails ? '▴' : '▾'}
                </span>
              </button>
              {showDetails && (
                <div className="border-t border-border">
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all px-3.5 py-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {error.details || error.raw}
                  </pre>
                  <div className="flex justify-end border-t border-border px-3 py-2">
                    <button type="button" onClick={copyDetails} className={btnGhostClass}>
                      {copied ? 'Copied' : 'Copy log'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              data-dismiss
              onClick={requestClose}
              disabled={isClosing}
              className={btnPrimaryClass}
            >
              Understood
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
