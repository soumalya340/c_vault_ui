'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { parseUnits, PRICE_SCALE_DECIMALS, type Network } from '@/lib/cvault';
import { fetchVaults, type VaultRecord } from '@/lib/registryClient';
import { parseTxError, type UserFacingError } from '@/lib/txError';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { executeVaultFunction, formatResult } from './execute-vault-function';
import { ErrorModal } from './error-modal';
import { LedgerOutput } from './ledger-output';
import { showVaultOpsToast } from './vault-ops-toast';

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

function useVaultOptions(active: boolean, network: Network) {
  const [vaults, setVaults] = useState<VaultRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchVaults(network)
      .then((rows) => {
        if (cancelled) return;
        setVaults(rows.sort((a, b) => a.vault_id - b.vault_id));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [active, network]);

  return { vaults, error };
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
  open,
  onToggle,
}: {
  op: OperationDef;
  network: Network;
  open: boolean;
  onToggle: () => void;
}) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { vaults, error: vaultsError } = useVaultOptions(open, network);

  const [vaultId, setVaultId] = useState('');
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
  }, [open, vaults, result, loading]);

  const selectedVault = vaults?.find((v) => String(v.vault_id) === vaultId);
  const currentPaused = appliedPause ?? (selectedVault?.paused ? 'PAUSED' : 'ACTIVE');

  const vaultSelectItems = useMemo(() => {
    const placeholder = { label: '— select vault —', value: null as string | null };
    if (!vaults?.length) return [placeholder];
    return [
      placeholder,
      ...vaults.map((v) => ({
        value: String(v.vault_id),
        label: `№ ${String(v.vault_id).padStart(2, '0')} · ${v.name}${
          v.symbol ? ` (${v.symbol})` : ''
        }`,
      })),
    ];
  }, [vaults]);

  const execute = async () => {
    if (!connected || !anchorWallet || !publicKey) {
      setVisible(true);
      return;
    }
    if (!vaultId) {
      showVaultOpsToast('SELECT A VAULT');
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
          onRefreshSuccess={() => {
            setErrorOpen(false);
            setResult({
              type: 'info',
              text: 'DEX TWAP refreshed — run the action again if needed.',
            });
          }}
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
        <span className="hidden font-mono text-[8.5px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
          {op.tag}
        </span>
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
            {op.description}
          </p>

          <div className="space-y-4">
            <div>
              <FieldLabel>Vault</FieldLabel>
              {vaultsError ? (
                <>
                  <TextInput
                    value={vaultId}
                    onChange={setVaultId}
                    placeholder="0"
                  />
                  <p className="mt-1.5 font-mono text-xs text-destructive">
                    Couldn&rsquo;t load vaults — enter the id manually.
                  </p>
                </>
              ) : vaults === null ? (
                <Select disabled items={[{ label: 'Loading vaults…', value: null }]}>
                  <SelectTrigger className="text-muted-foreground" aria-busy="true">
                    <SelectValue placeholder="Loading vaults…" />
                  </SelectTrigger>
                </Select>
              ) : vaults.length === 0 ? (
                <p className="flex h-11 items-center border border-border-strong bg-foreground/[0.03] px-3.5 font-mono text-xs text-muted-foreground">
                  No vaults recorded on {network} yet.
                </p>
              ) : (
                <Select
                  items={vaultSelectItems}
                  value={vaultId || null}
                  onValueChange={(v) => setVaultId(v ?? '')}
                >
                  <SelectTrigger aria-label="Select vault">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Vaults · {network}</SelectLabel>
                      {vaultSelectItems
                        .filter((item): item is { label: string; value: string } => item.value != null)
                        .map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            <span className="tabular-nums text-seal transition-colors duration-150 group-hover/item:text-primary-foreground group-focus/item:text-primary-foreground group-data-highlighted/item:text-primary-foreground">
                              № {item.value.padStart(2, '0')}
                            </span>
                            <span className="truncate">
                              {item.label.replace(/^№\s+\d+\s+·\s+/, '')}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            </div>

            {op.id === 'genesis_deposit' && (
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
              disabled={loading}
              className={`h-11 w-full font-mono text-[9.5px] font-semibold uppercase tracking-[0.22em] transition-colors ${
                op.id === 'set_paused'
                  ? 'border border-border-strong bg-transparent text-foreground hover:border-foreground hover:bg-foreground/[0.03]'
                  : 'bg-foreground text-background hover:bg-seal'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {loading ? 'Processing…' : connected ? `Execute ${op.name.toLowerCase()}` : 'Connect wallet'}
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

export function VaultOpsPanel({ network }: { network: Network }) {
  const [openId, setOpenId] = useState<string>('genesis_deposit');

  return (
    <section className="border border-border-strong bg-background p-1.5 opacity-0 translate-y-6 transition-all duration-700 ease-[cubic-bezier(.22,1,.36,1)] data-[in=true]:opacity-100 data-[in=true]:translate-y-0"
      data-in="true"
    >
      <div className="border border-border">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-6 py-4">
          <div className="flex min-w-0 items-baseline gap-3 font-display text-lg font-semibold uppercase tracking-[0.1em] text-seal">
            Vault Operations
          </div>
          <span className="min-w-0 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            3 instruments · series 2026
          </span>
        </div>

        <div>
          {OPERATIONS.map((op) => (
            <OperationAccordion
              key={op.id}
              op={op}
              network={network}
              open={openId === op.id}
              onToggle={() => setOpenId((cur) => (cur === op.id ? '' : op.id))}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
