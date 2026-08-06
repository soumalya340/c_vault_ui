'use client';

import { useEffect, useRef, useState } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import {
  getVaultState,
  NETWORK_CONSTANTS,
  parseUnits,
  PRICE_SCALE_DECIMALS,
  type Network,
} from '@/lib/onchain/cvault';
import {
  updateVaultGenesisStatus,
  updateVaultPoolCreated,
  type VaultRecord,
} from '@/lib/registryClient';
import { resolveVaultShareUsdcPool } from '@/lib/meteora';
import { parseTxError, type UserFacingError } from '@/lib/onchain/txError';
import { executeVaultFunction, formatResult } from './execute-vault-function';
import { ErrorModal } from './error-modal';
import { LedgerOutput } from './ledger-output';
import { showVaultOpsToast } from './vault-ops-toast';
import { CreatePoolAccordion } from './vault-ops-meteora';
import { Badge } from '@/components/ui/badge';

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <input
      className="h-11 w-full border border-border-strong bg-background px-3.5 font-mono text-sm text-foreground transition-[color,background-color,border-color,box-shadow] duration-[250ms] placeholder:text-muted-foreground/60 hover:border-foreground/40 focus:border-foreground focus:bg-background focus:outline-none focus:shadow-[3px_3px_0_rgba(23,37,28,0.1)]"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
    />
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex h-11 border border-border-strong bg-foreground/[0.03]">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] transition-colors ${
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface OpsResult {
  type: 'success' | 'error' | 'info';
  text: string;
  solscan?: string;
}

interface OperationDef {
  id: string;
  number: string;
  name: string;
  tag: string;
  description: string;
}

const OPERATIONS: OperationDef[] = [
  {
    id: 'genesis_deposit',
    number: '01',
    name: 'Genesis deposit',
    tag: 'Seed the vault',
    description:
      'The first deposit mints the genesis shares and sets the initial share price. Deposit USDC; the program swaps into the basket at registry routes.',
  },
  {
    id: 'set_paused',
    number: '02',
    name: 'Set vault paused',
    tag: 'Circuit breaker',
    description:
      'Pausing halts deposits and redemptions instantly; swaps and fee claims are unaffected. Current state is shown on the right.',
  },
  {
    id: 'set_fee_recipient',
    number: '03',
    name: 'Set fee recipient',
    tag: 'Treasury',
    description:
      'Redirects future deposit and redeem fees. Takes effect on the next instruction; already-accrued fees stay with the previous recipient.',
  },
];

function OperationAccordion({
  op,
  network,
  vault,
  open,
  onToggle,
  genesisDone,
  onGenesisDone,
}: {
  op: OperationDef;
  network: Network;
  vault: VaultRecord;
  open: boolean;
  onToggle: () => void;
  genesisDone: boolean;
  onGenesisDone: () => void;
}) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  const vaultId = String(vault.vault_id);
  const genesisLocked = op.id === 'genesis_deposit' && genesisDone;
  const [amount, setAmount] = useState('');
  const [pausedTarget, setPausedTarget] = useState<'ACTIVE' | 'PAUSED'>('ACTIVE');
  const [appliedPause, setAppliedPause] = useState<'ACTIVE' | 'PAUSED' | null>(null);
  const [feeRecipient, setFeeRecipient] = useState('');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OpsResult | null>(null);
  const [lastError, setLastError] = useState<UserFacingError | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.style.maxHeight = bodyRef.current.scrollHeight + 'px';
    } else if (bodyRef.current) {
      bodyRef.current.style.maxHeight = '0px';
    }
  }, [open, result, loading, genesisLocked]);

  const currentPaused = appliedPause ?? (vault.paused ? 'PAUSED' : 'ACTIVE');

  const execute = async () => {
    if (genesisLocked) return;
    if (!connected || !anchorWallet || !publicKey) {
      setVisible(true);
      return;
    }

    setLoading(true);
    setResult(null);
    setLastError(null);

    try {
      const values: Record<string, string> = { vault_id: vaultId };

      if (op.id === 'genesis_deposit') {
        if (!amount) throw new Error('Enter an opening share price.');
        parseUnits(amount, PRICE_SCALE_DECIMALS);
        values.baseline_share_price = amount;
      } else if (op.id === 'set_paused') {
        values.paused = pausedTarget === 'PAUSED' ? 'true' : 'false';
      } else if (op.id === 'set_fee_recipient') {
        if (!feeRecipient.trim()) throw new Error('Enter a recipient address.');
        values.fee_recipient = feeRecipient.trim();
      }

      const data = await executeVaultFunction(op.id, values, {
        connection,
        anchorWallet,
        publicKey,
        network,
      });

      const solscanUrl =
        data && typeof data === 'object' && 'solscan' in data
          ? (data as { solscan?: string }).solscan
          : undefined;
      const display = data && typeof data === 'object' ? { ...(data as object), solscan: undefined } : data;

      setResult({ type: 'success', text: formatResult(display), solscan: solscanUrl });
      showVaultOpsToast(`INSTRUCTION QUEUED · ${op.name.toUpperCase()}`);

      if (op.id === 'set_paused') {
        setAppliedPause(pausedTarget);
      }
      if (op.id === 'genesis_deposit') {
        onGenesisDone();
      }
    } catch (err: unknown) {
      const parsed = parseTxError(err);
      setLastError(parsed);
      setErrorOpen(true);
      setResult({ type: parsed.kind === 'info' ? 'info' : 'error', text: parsed.title });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-b border-border last:border-b-0">
      {errorOpen && lastError && (
        <ErrorModal
          error={lastError}
          onClose={() => setErrorOpen(false)}
          network={network}
          vaultId={vaultId ? Number(vaultId) : null}
        />
      )}

      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-5 px-6 py-5 text-left transition-colors hover:bg-foreground/[0.03]"
      >
        <span className="font-mono text-[11px] font-semibold text-seal">№ {op.number}</span>
        <span className="font-display text-lg font-semibold text-foreground">{op.name}</span>
        <span className="mx-1 flex-1 self-center border-b border-dotted border-border-strong" />
        {genesisLocked ? (
          <Badge
            variant="secondary"
            className="font-mono text-[8.5px] font-bold uppercase tracking-[0.14em]"
          >
            Genesis-Deposit-Done
          </Badge>
        ) : (
          <span className="hidden font-mono text-[8.5px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
            {op.tag}
          </span>
        )}
        <span
          className={`text-[11px] text-muted-foreground transition-transform duration-[400ms] ${
            open ? 'rotate-180 text-seal' : ''
          }`}
        >
          ▾
        </span>
      </button>

      <div
        ref={bodyRef}
        className="overflow-hidden transition-[max-height] duration-500 ease-[cubic-bezier(.22,1,.36,1)]"
        style={{ maxHeight: open ? undefined : 0 }}
      >
        <div className="grid items-end gap-6 px-6 pb-7 pt-2 md:grid-cols-[1fr_220px]">
          <p className="text-sm leading-relaxed text-foreground/80 md:col-span-2">
            {genesisLocked
              ? 'Genesis deposit is already complete for this vault — opening share price is locked and this instruction cannot run again.'
              : op.description}
          </p>

          <div className="space-y-4">
            {op.id === 'genesis_deposit' && !genesisLocked && (
              <div>
                <FieldLabel>Opening share price ($)</FieldLabel>
                <TextInput value={amount} onChange={setAmount} placeholder="1.00" inputMode="decimal" />
              </div>
            )}

            {op.id === 'set_paused' && (
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <FieldLabel>Target state</FieldLabel>
                  <span
                    className={`inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] ${
                      currentPaused === 'PAUSED'
                        ? 'border-seal text-seal'
                        : 'border-moss text-moss'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    Current · {currentPaused}
                  </span>
                </div>
                <Segmented
                  options={[
                    { label: 'Active', value: 'ACTIVE' },
                    { label: 'Paused', value: 'PAUSED' },
                  ]}
                  value={pausedTarget}
                  onChange={(v) => setPausedTarget(v as 'ACTIVE' | 'PAUSED')}
                />
              </div>
            )}

            {op.id === 'set_fee_recipient' && (
              <div>
                <FieldLabel>New recipient address</FieldLabel>
                <TextInput
                  value={feeRecipient}
                  onChange={setFeeRecipient}
                  placeholder="Base58 address…"
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={execute}
              disabled={loading || genesisLocked}
              className="h-11 w-full bg-foreground font-mono text-[9.5px] font-semibold uppercase tracking-[0.22em] text-background transition-colors hover:bg-seal disabled:cursor-not-allowed disabled:opacity-40"
            >
              {genesisLocked
                ? 'Genesis complete'
                : loading
                  ? 'Processing…'
                  : connected
                    ? `Execute ${op.name.toLowerCase()}`
                    : 'Connect wallet'}
            </button>
          </div>
        </div>

        {result && (
          <div className="mx-6 mb-6 max-h-64 overflow-y-auto rounded-[2px] border border-border-strong bg-foreground/[0.04]">
            <div className="border-b border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
              OUTPUT
            </div>
            <div className="px-4 py-3">
              <LedgerOutput text={result.text} tone={result.type} />
              {result.type === 'error' && lastError && (
                <div className="mt-2 border-t border-border pt-2">
                  <button
                    type="button"
                    onClick={() => setErrorOpen(true)}
                    className="font-mono text-[11px] text-accent underline transition-colors hover:text-foreground"
                  >
                    View error details
                  </button>
                </div>
              )}
              {result.solscan && (
                <div className="mt-2 border-t border-border pt-2">
                  <a
                    href={result.solscan}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline transition-colors hover:text-foreground"
                  >
                    View on Solscan
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function VaultOpsPanel({
  network,
  vault,
  onVaultUpdated,
}: {
  network: Network;
  vault: VaultRecord;
  /** Fired when local genesis status becomes true (UI success or on-chain reconcile). */
  onVaultUpdated?: (next: VaultRecord) => void;
}) {
  const { connection } = useConnection();
  const [genesisDone, setGenesisDone] = useState(Boolean(vault.genesis_deposit_status));
  const [poolCreated, setPoolCreated] = useState(Boolean(vault.is_pool_created));
  const [openId, setOpenId] = useState<string>(
    vault.genesis_deposit_status ? 'set_paused' : 'genesis_deposit',
  );

  // Keep local flags in sync when parent reloads the vault row.
  useEffect(() => {
    setGenesisDone(Boolean(vault.genesis_deposit_status));
    setPoolCreated(Boolean(vault.is_pool_created));
  }, [vault.vault_id, vault.genesis_deposit_status, vault.is_pool_created]);

  // DB false → read on-chain once; if genesis_done, write true and keep it.
  useEffect(() => {
    if (vault.genesis_deposit_status) return;

    let cancelled = false;
    (async () => {
      try {
        const state = await getVaultState(connection, vault.vault_id, network);
        if (cancelled || !state.genesisDone) return;
        const updated = await updateVaultGenesisStatus(network, vault.vault_id, true);
        if (cancelled) return;
        setGenesisDone(true);
        onVaultUpdated?.(updated);
      } catch {
        // Non-fatal — user can still attempt genesis; on-chain rejects duplicates.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    connection,
    network,
    vault.vault_id,
    vault.genesis_deposit_status,
    onVaultUpdated,
  ]);

  // DB false → derive shares×USDC pool; if live, pin is_pool_created.
  useEffect(() => {
    if (vault.is_pool_created) return;

    let cancelled = false;
    (async () => {
      try {
        const info = await resolveVaultShareUsdcPool(
          connection,
          new PublicKey(vault.shares_mint),
          NETWORK_CONSTANTS[network].usdcMint,
        );
        if (cancelled || !info.exists) return;
        const updated = await updateVaultPoolCreated(network, vault.vault_id, true);
        if (cancelled) return;
        setPoolCreated(true);
        onVaultUpdated?.(updated);
      } catch {
        // Non-fatal — create pool remains available.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    connection,
    network,
    vault.vault_id,
    vault.shares_mint,
    vault.is_pool_created,
    onVaultUpdated,
  ]);

  const markGenesisDone = () => {
    setGenesisDone(true);
    onVaultUpdated?.({ ...vault, genesis_deposit_status: true });
  };

  const markPoolCreated = (next: VaultRecord) => {
    setPoolCreated(true);
    onVaultUpdated?.(next);
  };

  return (
    <section
      className="border border-border bg-foreground/[0.015] motion-safe:animate-[cert-fadeup_0.4s_ease_both]"
      aria-label={`Vault operations · CVLT-${vault.vault_id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex min-w-0 items-baseline gap-3 font-display text-base font-semibold uppercase tracking-[0.1em] text-seal">
          Vault Operations
        </div>
        <span className="min-w-0 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          4 instruments · series 2026
        </span>
      </div>

      <div>
        {OPERATIONS.map((op) => (
          <OperationAccordion
            key={op.id}
            op={op}
            network={network}
            vault={vault}
            open={openId === op.id}
            onToggle={() => setOpenId((cur) => (cur === op.id ? '' : op.id))}
            genesisDone={genesisDone}
            onGenesisDone={markGenesisDone}
          />
        ))}
        <CreatePoolAccordion
          network={network}
          vault={vault}
          open={openId === 'create_pool'}
          onToggle={() =>
            setOpenId((cur) => (cur === 'create_pool' ? '' : 'create_pool'))
          }
          poolCreated={poolCreated}
          onPoolCreated={markPoolCreated}
        />
      </div>
    </section>
  );
}
