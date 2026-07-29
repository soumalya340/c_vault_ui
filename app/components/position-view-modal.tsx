'use client';

import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { getUserPosition, type Network } from '@/lib/cvault';
import type { VaultRecord } from '@/lib/registryClient';
import { formatResult } from './execute-vault-function';
import { displayVaultName, humanizeViewResult } from './view-display';
import { LedgerOutput } from './ledger-output';
import { OutputPanelSkeleton } from './loading-skeletons';
import { btnGhostClass, btnSecondaryClass, outputPanelClass } from './ui-classes';
import { useModalTransition } from './use-modal-transition';

export function PositionViewModal({
  vault,
  network,
  onClose,
}: {
  vault: VaultRecord;
  network: Network;
  onClose: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { requestClose, modalClassName, backdropClassName, isClosing } =
    useModalTransition(onClose);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  const fetchPosition = async () => {
    if (!publicKey) {
      setError('Connect wallet');
      setOutput(null);
      return;
    }
    setLoading(true);
    setError(null);
    setOutput(null);
    try {
      const raw = await getUserPosition(
        connection,
        vault.vault_id,
        publicKey,
        network,
      );
      const display = humanizeViewResult('view_my_position', raw);
      setOutput(formatResult(display));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!publicKey) {
        if (!cancelled) {
          setError('Connect wallet');
          setOutput(null);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setError(null);
        setOutput(null);
      }
      try {
        const raw = await getUserPosition(
          connection,
          vault.vault_id,
          publicKey,
          network,
        );
        if (cancelled) return;
        const display = humanizeViewResult('view_my_position', raw);
        setOutput(formatResult(display));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, vault.vault_id, network]);

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4'>
      <div
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm ${backdropClassName}`}
        onClick={() => {
          if (!isClosing) requestClose();
        }}
      />
      <div
        role='dialog'
        aria-modal='true'
        aria-label={`My position in ${displayVaultName(vault.name)}`}
        className={`cert-frame relative z-10 flex w-full max-w-[480px] max-h-[90vh] flex-col overflow-hidden bg-background shadow-2xl ${modalClassName}`}
      >
        <div className='flex shrink-0 items-start justify-between gap-4 border-b border-border-strong px-6 py-4'>
          <div>
            <div className='font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-position'>
              My position
            </div>
            <h2 className='mt-1 font-display text-lg font-semibold tracking-[0.02em]'>
              {displayVaultName(vault.name)}
            </h2>
            <p className='mt-1.5 max-w-[40ch] text-sm leading-relaxed text-muted-foreground'>
              Share balance, deposit history, and any active redeem state for
              this wallet.
            </p>
          </div>
          <button
            type='button'
            onClick={requestClose}
            disabled={isClosing}
            aria-label='Close'
            className={btnGhostClass}
          >
            Close
          </button>
        </div>

        <div className='space-y-4 overflow-y-auto px-6 py-5'>
          <div className='flex items-center gap-3'>
            <button
              type='button'
              onClick={() => void fetchPosition()}
              disabled={loading || !publicKey}
              className={btnSecondaryClass}
            >
              {loading ? (
                <span className='t-shimmer' data-text='Fetching…'>
                  Fetching…
                </span>
              ) : (
                'Refresh'
              )}
            </button>
            {!publicKey && (
              <span className='font-mono text-[11px] text-muted-foreground'>
                Connect wallet to read position
              </span>
            )}
          </div>

          {loading && !error && <OutputPanelSkeleton />}

          {error && (
            <p className='font-mono text-xs text-destructive'>
              <span className='mr-2 text-muted-foreground/50'>&gt;</span>
              {error}
            </p>
          )}

          {output && !error && !loading && (
            <div className={outputPanelClass}>
              <div className='border-b border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground'>
                OUTPUT
              </div>
              <div className='px-4 py-3'>
                <LedgerOutput text={output} tone='success' />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}