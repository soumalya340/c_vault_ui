'use client';

import { useEffect, useRef, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { useReducedMotion } from 'motion/react';
import { getVaultState, type Network } from '@/lib/cvault';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/animate-ui/components/radix/popover';
import { formatResult } from './execute-vault-function';
import { humanizeViewResult } from './view-display';
import { LedgerOutput } from './ledger-output';
import { OutputPanelSkeleton } from './loading-skeletons';
import { sectionLabelClass } from './ui-classes';

/**
 * Discover-style circular "i" control that reads on-chain vault state
 * (`getVaultState` / View · Vault State) and shows certificate ledger rows.
 * Used on Portfolio · My Vaults list rows.
 */
export function VaultInfoPopover({
  vaultId,
  symbol,
  name,
  network,
}: {
  vaultId: number;
  symbol: string;
  name: string;
  network: Network;
}) {
  const { connection } = useConnection();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  // Cache last successful fetch key so re-open does not thrash RPC.
  const loadedKeyRef = useRef<string | null>(null);
  const fetchKey = `${network}:${vaultId}`;

  useEffect(() => {
    if (!open) return;
    if (loadedKeyRef.current === fetchKey) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setOutput(null);

    getVaultState(connection, vaultId, network)
      .then((raw) => {
        if (cancelled) return;
        const display = humanizeViewResult('view_vault_state', raw);
        setOutput(formatResult(display));
        loadedKeyRef.current = fetchKey;
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        loadedKeyRef.current = null;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, connection, vaultId, network, fetchKey]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          aria-label={
            open
              ? `Hide vault info for ${symbol}`
              : `View vault info for ${symbol}`
          }
          className="group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:text-accent"
        >
          <span className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-border-strong leading-none transition-colors duration-150 group-hover:border-accent group-data-[state=open]:border-accent">
            {open ? '×' : 'i'}
          </span>
          <span className="underline-offset-4 group-hover:underline">
            {open ? 'Hide vault info' : 'View vault info'}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={10}
        className="w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-[2px] border-border-strong bg-background p-0 text-foreground shadow-[0_18px_48px_-18px_rgba(23,37,28,0.35),inset_0_0_0_1px_rgba(23,37,28,0.06)] outline-hidden"
        transition={
          reduceMotion
            ? { duration: 0.01 }
            : { type: 'spring', stiffness: 320, damping: 28 }
        }
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-strong bg-foreground/[0.03] px-4 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-accent">
              Vault state
            </span>
            <span className="truncate font-mono text-[11px] font-bold tabular-nums tracking-[0.08em] text-seal">
              &#8470;&nbsp;CVLT-{vaultId} · {symbol}
            </span>
            <span className="truncate text-xs text-muted-foreground">{name}</span>
          </div>
          <span className={`${sectionLabelClass} shrink-0 uppercase`}>
            {loading ? 'reading…' : 'on-chain'}
          </span>
        </div>

        <div className="max-h-[min(22rem,55vh)] overflow-y-auto px-4 py-3">
          {loading && <OutputPanelSkeleton />}

          {!loading && error && (
            <p className="font-mono text-xs text-destructive">
              <span className="mr-2 text-muted-foreground/50">&gt;</span>
              vault state unavailable — {error}
            </p>
          )}

          {!loading && !error && output && (
            <LedgerOutput text={output} tone="success" />
          )}
        </div>

        <div className="border-t border-border px-4 py-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/70">
            View · Vault State · shares · TVL · fees
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
