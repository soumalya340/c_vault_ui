'use client';

import { useState } from 'react';
import { useConnection, useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import {
  getUserPosition,
  claim,
  formatUnits,
  type Network,
} from '@/lib/onchain/cvault';
import { USDC_DECIMALS } from '@/lib/constants';
import { parseTxError, type UserFacingError } from '@/lib/onchain/txError';
import type { VaultRecord } from '@/lib/registryClient';
import { ErrorModal } from './error-modal';
import { btnGhostClass, btnPrimaryClass } from './ui-classes';

/** Human-readable token amount with thousands separators; exact string math. */
export function formatTokenUi(raw: string, decimals: number): string {
  const ui = formatUnits(raw, decimals);
  const [whole, frac] = ui.split('.');
  const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${wholeFmt}.${frac}` : wholeFmt;
}

type PendingClaimState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none'; solscan?: string }
  | { status: 'ready'; usdc: string }
  | { status: 'claiming'; usdc: string }
  | { status: 'error'; message: string };

/**
 * On-click on-chain check for a claimable redeem — reads RedeemState fresh
 * (no polling, no per-row auto-fetch) and, if `pending_usdc > 0`, submits
 * `claim` directly. Independent of the Redeem & Claim modal so a user doesn't
 * have to re-enter the burn flow just to collect USDC from a redeem they
 * already swapped.
 *
 * Shared by the vaults list rows and the per-vault detail page so both run the
 * same claim path.
 */
export function PendingClaimButton({
  vault,
  network,
  onClaimed,
}: {
  vault: VaultRecord;
  network: Network;
  /** Fired after a successful claim so a host page can refresh position data. */
  onClaimed?: () => void;
}) {
  const { publicKey } = useWallet();

  // Remount on wallet switch/disconnect so any stale check result is dropped —
  // a key-based reset instead of a setState-in-effect cascade.
  return (
    <PendingClaimButtonInner
      key={publicKey?.toBase58() ?? 'disconnected'}
      vault={vault}
      network={network}
      onClaimed={onClaimed}
    />
  );
}

function PendingClaimButtonInner({
  vault,
  network,
  onClaimed,
}: {
  vault: VaultRecord;
  network: Network;
  onClaimed?: () => void;
}) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey } = useWallet();
  const [state, setState] = useState<PendingClaimState>({ status: 'idle' });
  const [lastError, setLastError] = useState<UserFacingError | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);

  const check = async () => {
    if (!publicKey) return;
    setState({ status: 'checking' });
    try {
      const pos = await getUserPosition(connection, vault.vault_id, publicKey, network);
      const pendingUsdc = pos.redeemState?.pendingUsdc ?? '0';
      if (!pos.redeemState || BigInt(pendingUsdc) <= 0n) {
        setState({ status: 'none' });
        return;
      }
      setState({ status: 'ready', usdc: pendingUsdc });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleClaim = async () => {
    if (!anchorWallet || state.status !== 'ready') return;
    setState({ status: 'claiming', usdc: state.usdc });
    try {
      const r = await claim(connection, anchorWallet, vault.vault_id, network);
      setState({ status: 'none', solscan: r.link });
      onClaimed?.();
    } catch (err) {
      const parsed = parseTxError(err);
      setLastError(parsed);
      setErrorOpen(true);
      setState({ status: 'error', message: parsed.title });
    }
  };

  if (!publicKey) return null;

  return (
    <>
      {errorOpen && lastError && (
        <ErrorModal
          error={lastError}
          onClose={() => setErrorOpen(false)}
          network={network}
          vaultId={vault.vault_id}
          onRefreshSuccess={() => {
            setErrorOpen(false);
            setState({ status: 'none' });
            onClaimed?.();
          }}
        />
      )}
      {(state.status === 'idle' || state.status === 'checking') && (
        <button
          type="button"
          onClick={check}
          disabled={state.status === 'checking'}
          className={btnGhostClass}
        >
          {state.status === 'checking' ? 'Checking…' : 'Pending claim'}
        </button>
      )}
      {state.status === 'none' && (
        <span className="font-mono text-[11px] text-muted-foreground/60">
          nothing to claim
          {state.solscan && (
            <>
              {' · '}
              <a
                href={state.solscan}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline transition-colors hover:text-foreground"
              >
                claimed — view on Solscan
              </a>
            </>
          )}
        </span>
      )}
      {(state.status === 'ready' || state.status === 'claiming') && (
        <button
          type="button"
          onClick={handleClaim}
          disabled={state.status === 'claiming'}
          className={btnPrimaryClass}
        >
          {state.status === 'claiming'
            ? 'Claiming…'
            : `Claim ${formatTokenUi(state.usdc, USDC_DECIMALS)} USDC`}
        </button>
      )}
      {state.status === 'error' && (
        <span className="font-mono text-[11px] text-destructive">{state.message}</span>
      )}
    </>
  );
}
