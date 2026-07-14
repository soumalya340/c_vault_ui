'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PublicKey } from '@solana/web3.js';
import { useConnection, useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import {
  isTwapRefreshableError,
  parseTxError,
  type UserFacingError,
} from '@/lib/txError';
import { fetchVaultCtx, setTwapKeeper, type Network } from '@/lib/cvault';
import { createProgram } from '@/lib/program';
import { ADMIN_PUBKEY, TWAP_KEEPER_PUBKEY } from '@/lib/constants';
import { deriveGlobalStatePda } from '@/lib/pda';
import { ensureVaultDexTwapFresh, refreshAllStaleDexTwaps } from '@/lib/twap';
import { btnGhostClass, btnPrimaryClass, btnSecondaryClass } from './ui-classes';

function useIsClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function isDefaultPubkey(pk: PublicKey): boolean {
  return pk.equals(PublicKey.default);
}

/**
 * Error dialog. On any TWAP keeper/staleness failure shows **Refresh Asset**:
 * ensure on-chain twap_keeper is set (admin), then multi-ix spot refresh (user pays).
 */
export function ErrorModal({
  error,
  onClose,
  vaultId,
  network = 'localhost',
  onRefreshSuccess,
}: {
  error: UserFacingError;
  onClose: () => void;
  vaultId?: number | null;
  network?: Network;
  onRefreshSuccess?: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const mounted = useIsClient();
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [refreshErr, setRefreshErr] = useState<string | null>(null);

  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();

  // Always recompute from current error object (6050 / 6052 / message match).
  const showRefreshAsset = isTwapRefreshableError(error);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !refreshing) onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLElement>('button[data-dismiss]')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, refreshing]);

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

  const handleRefreshAsset = async () => {
    if (!connected || !anchorWallet || !publicKey) {
      setVisible(true);
      setRefreshErr('Connect a wallet first — admin assigns keeper if needed; you pay refresh fees.');
      return;
    }

    setRefreshing(true);
    setRefreshErr(null);
    setRefreshNote(null);

    try {
      const program = createProgram(anchorWallet, connection);

      // 1) Ensure global_state.twap_keeper is set (fixes 6050).
      const gs = await (program.account as any).globalState.fetch(deriveGlobalStatePda());
      const currentKeeper = gs.twapKeeper as PublicKey;
      if (isDefaultPubkey(currentKeeper)) {
        if (!publicKey.equals(ADMIN_PUBKEY)) {
          throw new Error(
            `TWAP keeper is unset. Connect the admin wallet (${ADMIN_PUBKEY.toBase58().slice(0, 8)}…) ` +
              `and click Refresh Asset again to assign ${TWAP_KEEPER_PUBKEY.toBase58().slice(0, 8)}….`,
          );
        }
        setRefreshNote('Assigning TWAP keeper (admin)…');
        await setTwapKeeper(connection, anchorWallet, TWAP_KEEPER_PUBKEY, network);
        setRefreshNote(`Keeper set → ${TWAP_KEEPER_PUBKEY.toBase58().slice(0, 8)}…`);
      }

      // 2) Push Orca/DAMM spots for stale DEX assets (fixes 6052).
      const progress = (msg: string) => setRefreshNote(msg);
      let result;
      if (vaultId != null && Number.isFinite(Number(vaultId))) {
        const ctx = await fetchVaultCtx(connection, Number(vaultId), network);
        result = await ensureVaultDexTwapFresh(
          connection,
          anchorWallet,
          program,
          ctx,
          progress,
        );
      } else {
        result = await refreshAllStaleDexTwaps(
          connection,
          anchorWallet,
          program,
          progress,
        );
      }

      if (result.refreshed === 0) {
        setRefreshNote(
          'Keeper OK; no stale DEX TWAPs left. Retry the original action (e.g. Get Total NAV View).',
        );
      } else {
        setRefreshNote(
          `Refreshed ${result.refreshed} asset(s) in 1 tx` +
            (result.signature ? ` · ${result.signature.slice(0, 8)}…` : '') +
            '. Continue with the original action.',
        );
      }
      onRefreshSuccess?.();
    } catch (err) {
      const parsed = parseTxError(err);
      setRefreshErr(parsed.summary || parsed.raw || String(err));
    } finally {
      setRefreshing(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => {
          if (!refreshing) onClose();
        }}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-summary`}
        className="cert-frame relative z-10 w-full max-w-[520px] overflow-hidden bg-background shadow-2xl"
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
              onClick={onClose}
              disabled={refreshing}
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

          {showRefreshAsset && (
            <div className="rounded-[2px] border border-accent/40 bg-accent/[0.06] px-3.5 py-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
                Testing · DEX TWAP
              </p>
              <p className="mt-1.5 text-sm leading-[1.55] text-foreground">
                <strong className="font-medium">Refresh Price</strong> will (1) assign the
                canonical TWAP keeper if unset — admin wallet required — then (2) push Orca/DAMM
                spots in one multi-ix tx. You pay fees; keeper only cosigns.
                {vaultId != null ? ` Vault ${vaultId}.` : ''}
              </p>
              {refreshNote && (
                <p className="mt-2 font-mono text-[11px] leading-relaxed text-accent">{refreshNote}</p>
              )}
              {refreshErr && (
                <p className="mt-2 font-mono text-[11px] leading-relaxed text-destructive">
                  {refreshErr}
                </p>
              )}
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
            {showRefreshAsset && (
              <button
                type="button"
                onClick={handleRefreshAsset}
                disabled={refreshing}
                className={btnSecondaryClass}
              >
                {refreshing ? 'Refreshing…' : 'Refresh Price'}
              </button>
            )}
            <button
              type="button"
              data-dismiss
              onClick={onClose}
              disabled={refreshing}
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
