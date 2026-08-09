'use client';

import type { UserFacingError } from '@/lib/onchain/txError';
import { ErrorModal } from './error-modal';
import { LedgerOutput } from './ledger-output';
import { outputPanelClass } from './ui-classes';
import { useModalTransition } from './use-modal-transition';
import { SettlementReceipt } from './settlement-receipt';
import { TransactionPhases } from './transaction-phases';
import { Spinner } from '@/components/ui/spinner';
import type { Network } from '@/lib/onchain/cvault';

/**
 * Progress + result overlay for Create ETF — opened by the /create form on
 * submit. Mirrors DepositModal/RedeemModal's UX (phase checklist while
 * signing, settlement-style receipt on success) but owns no transaction
 * logic itself: the form component still runs create_etf → metadata → ALT →
 * record → genesis_deposit and just feeds this modal its live state.
 */
export function CreateEtfModal({
  network,
  loading,
  steps,
  result,
  lastError,
  errorOpen,
  onErrorOpenChange,
  created,
  onClose,
  onCreateAnother,
}: {
  network: Network;
  loading: boolean;
  steps: string[];
  result: { type: 'success' | 'error' | 'info'; text: string; solscan?: string } | null;
  lastError: UserFacingError | null;
  errorOpen: boolean;
  onErrorOpenChange: (open: boolean) => void;
  created: {
    vaultId: number;
    sharesMint: string;
    altAddress: string | null;
    genesisSeeded: boolean;
    solscan?: string;
  } | null;
  onClose: () => void;
  onCreateAnother: () => void;
}) {
  const { requestClose, modalClassName, backdropClassName, isClosing } =
    useModalTransition(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {errorOpen && lastError && (
        <ErrorModal
          error={lastError}
          onClose={() => onErrorOpenChange(false)}
          network={network}
          vaultId={created?.vaultId}
        />
      )}
      <div
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm ${backdropClassName}`}
        onClick={() => {
          if (!isClosing && !loading) requestClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create ETF vault"
        className={`relative z-10 flex w-full max-w-[420px] max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-background shadow-2xl ${modalClassName}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-accent">
              {created ? `№ ${String(created.vaultId).padStart(2, '0')} · ` : ''}Create etf
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">
              {created ? 'Vault created' : 'Creating vault…'}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={isClosing || loading}
            aria-label="Close"
            className="rounded-full px-3 py-1.5 font-mono text-xs text-text-dim transition-colors duration-150 hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {created ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
            <SettlementReceipt
              kind="create"
              vaultId={created.vaultId}
              surrendered={{
                label: 'Vault ID',
                amount: String(created.vaultId),
                unit: '',
              }}
              issued={{
                label: 'Shares mint',
                amount: `${created.sharesMint.slice(0, 4)}…${created.sharesMint.slice(-4)}`,
                unit: '',
              }}
              rate={null}
              note={
                `Lookup table: ${created.altAddress ?? '— (creation failed)'}\n` +
                `Genesis deposit: ${created.genesisSeeded ? 'seeded' : 'not seeded — run it from the vault\'s admin panel'}`
              }
              solscan={created.solscan}
              doneLabel="Done"
              onDone={requestClose}
            />
            <button
              type="button"
              onClick={onCreateAnother}
              className="mt-4 w-full rounded-[2px] border border-border-strong bg-background px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-foreground transition-colors duration-150 hover:border-accent hover:bg-accent hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Create another
            </button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-5">
            <p className="font-mono text-xs leading-relaxed text-muted-foreground">
              {loading
                ? 'Signing and confirming the vault-creation sequence — keep this window open.'
                : 'Waiting to start…'}
            </p>

            {loading && (
              <div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground">
                <Spinner className="size-3.5 text-accent" />
                Processing…
              </div>
            )}

            <TransactionPhases flow="create" steps={steps} active={loading} />

            {result && result.type !== 'success' && (
              <div className={outputPanelClass}>
                <div className="border-b border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
                  OUTPUT
                </div>
                <div className="px-4 py-3">
                  <LedgerOutput text={result.text} tone={result.type} />
                  {result.type === 'error' && lastError && (
                    <div className="mt-2 border-t border-border pt-2">
                      <button
                        type="button"
                        onClick={() => onErrorOpenChange(true)}
                        className="font-mono text-[11px] text-accent underline transition-colors hover:text-foreground"
                      >
                        View error details
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
