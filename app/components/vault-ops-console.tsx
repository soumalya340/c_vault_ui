'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from '@solana/wallet-adapter-react';
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
  fetchVaults,
  updateVaultGenesisStatus,
  updateVaultPoolCreated,
  type VaultRecord,
} from '@/lib/registryClient';
import { parseTxError, type UserFacingError } from '@/lib/onchain/txError';
import { executeVaultFunction, formatResult } from './execute-vault-function';
import { ErrorModal } from './error-modal';
import { LedgerOutput } from './ledger-output';
import { showVaultOpsToast, VaultOpsToast } from './vault-ops-toast';
import { CreatePoolAccordion } from './vault-ops-meteora';
import { displayVaultName } from './view-display';
import { PORTFOLIO_ROUTE, manageVaultPath } from './console-routes';

type OpId = 'genesis_deposit' | 'set_paused' | 'set_fee_recipient' | 'create_pool';

interface OperationDef {
  id: OpId;
  number: string;
  name: string;
  sig: string;
  tag: string;
  tagTone: 'default' | 'meteora' | 'breaker';
  description: string;
  writes: string;
}

const OPERATIONS: OperationDef[] = [
  {
    id: 'genesis_deposit',
    number: '01',
    name: 'Genesis deposit',
    sig: 'genesis_deposit',
    tag: 'Seed the vault',
    tagTone: 'default',
    description:
      'The first deposit mints the genesis shares and sets the initial share price. Deposit USDC; the program swaps into the basket at registry routes.',
    writes: 'WRITES SEED + SHARES',
  },
  {
    id: 'set_paused',
    number: '02',
    name: 'Set vault paused',
    sig: 'set_vault_paused',
    tag: 'Circuit breaker',
    tagTone: 'breaker',
    description:
      'Pausing halts deposits and redemptions instantly; swaps and fee claims are unaffected.',
    writes: 'WRITES 1 ACCOUNT',
  },
  {
    id: 'set_fee_recipient',
    number: '03',
    name: 'Set fee recipient',
    sig: 'set_fee_recipient',
    tag: 'Treasury',
    tagTone: 'default',
    description:
      'Redirects future deposit and redeem fees. Takes effect on the next instruction; already-accrued fees stay with the previous recipient.',
    writes: 'WRITES 1 ACCOUNT',
  },
  {
    id: 'create_pool',
    number: '04',
    name: 'Create DAMM v2 pool',
    sig: 'create_damm_v2_pool',
    tag: 'Meteora',
    tagTone: 'meteora',
    description:
      "Create a Meteora DAMM v2 pool for this vault's share token against USDC and seed the initial position in one transaction. Token A is the vault share mint, token B is always USDC.",
    writes: 'WRITES 4 ACCOUNTS',
  },
];

function shorten(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function isBase58Pubkey(value: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function tagClass(tone: OperationDef['tagTone']): string {
  if (tone === 'meteora') {
    return 'border-[rgba(90,200,232,0.3)] text-[#5AC8E8]';
  }
  if (tone === 'breaker') {
    return 'border-white/[0.12] text-text-faint';
  }
  return 'border-white/[0.12] text-text-faint';
}

export function VaultOpsConsole({
  vaultKeyParam,
  network,
}: {
  vaultKeyParam: string;
  network: Network;
}) {
  const router = useRouter();
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [loadingVault, setLoadingVault] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [genesisDone, setGenesisDone] = useState(false);
  const [poolCreated, setPoolCreated] = useState(false);
  const [selectedId, setSelectedId] = useState<OpId>('set_paused');

  // Per-op form state
  const [baselinePrice, setBaselinePrice] = useState('1.00');
  const [pausedTarget, setPausedTarget] = useState<'ACTIVE' | 'PAUSED'>('ACTIVE');
  const [appliedPause, setAppliedPause] = useState<'ACTIVE' | 'PAUSED' | null>(null);
  const [feeRecipient, setFeeRecipient] = useState('');

  const [execLoading, setExecLoading] = useState(false);
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);
  const [lastError, setLastError] = useState<UserFacingError | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);

  const loadVault = useCallback(async () => {
    setLoadingVault(true);
    setLoadError(null);
    try {
      const rows = await fetchVaults(network);
      const key = vaultKeyParam.trim();
      let found: VaultRecord | undefined;
      if (isBase58Pubkey(key)) {
        found = rows.find((v) => v.vault_address === key);
      } else if (/^\d+$/.test(key)) {
        const id = Number(key);
        found = rows.find((v) => v.vault_id === id);
        if (found) {
          router.replace(manageVaultPath(found.vault_address));
        }
      }
      if (!found) {
        setVault(null);
        setLoadError('Vault not found in the registry for this network.');
        return;
      }
      setVault(found);
      setGenesisDone(Boolean(found.genesis_deposit_status));
      setPoolCreated(Boolean(found.is_pool_created));
      setPausedTarget(found.paused ? 'PAUSED' : 'ACTIVE');
      setAppliedPause(found.paused ? 'PAUSED' : 'ACTIVE');
      setSelectedId(found.genesis_deposit_status ? 'set_paused' : 'genesis_deposit');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setVault(null);
    } finally {
      setLoadingVault(false);
    }
  }, [network, vaultKeyParam, router]);

  useEffect(() => {
    void loadVault();
  }, [loadVault]);

  // Reconcile genesis / pool flags once when vault loads.
  useEffect(() => {
    if (!vault) return;
    let cancelled = false;

    (async () => {
      if (!vault.genesis_deposit_status) {
        try {
          const state = await getVaultState(connection, vault.vault_id, network);
          if (cancelled || !state.genesisDone) return;
          const updated = await updateVaultGenesisStatus(network, vault.vault_id, true);
          if (cancelled) return;
          setGenesisDone(true);
          setVault(updated);
          setSelectedId((cur) => (cur === 'genesis_deposit' ? 'set_paused' : cur));
        } catch {
          // non-fatal
        }
      }
    })();

    (async () => {
      if (vault.is_pool_created) return;
      try {
        const { resolveVaultShareUsdcPool } = await import('@/lib/meteora/pool');
        const info = await resolveVaultShareUsdcPool(
          connection,
          new PublicKey(vault.shares_mint),
          NETWORK_CONSTANTS[network].usdcMint,
        );
        if (cancelled || !info.exists) return;
        const updated = await updateVaultPoolCreated(network, vault.vault_id, true);
        if (cancelled) return;
        setPoolCreated(true);
        setVault(updated);
      } catch {
        // non-fatal
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, network, vault?.vault_id, vault?.genesis_deposit_status, vault?.is_pool_created, vault?.shares_mint]);

  const selected = useMemo(
    () => OPERATIONS.find((o) => o.id === selectedId) ?? OPERATIONS[1],
    [selectedId],
  );

  const currentPaused = appliedPause ?? (vault?.paused ? 'PAUSED' : 'ACTIVE');
  const pauseUnchanged = selectedId === 'set_paused' && pausedTarget === currentPaused;
  const walletLabel = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : '—';

  const execute = async () => {
    if (!vault) return;
    if (selectedId === 'genesis_deposit' && genesisDone) return;
    if (selectedId === 'create_pool') return; // handled by CreatePoolAccordion
    if (!connected || !anchorWallet || !publicKey) {
      setVisible(true);
      return;
    }
    if (pauseUnchanged) return;

    setExecLoading(true);
    setResult(null);
    setLastError(null);

    try {
      const values: Record<string, string> = { vault_id: String(vault.vault_id) };

      if (selectedId === 'genesis_deposit') {
        if (!baselinePrice.trim()) throw new Error('Enter an opening share price.');
        parseUnits(baselinePrice, PRICE_SCALE_DECIMALS);
        values.baseline_share_price = baselinePrice.trim();
      } else if (selectedId === 'set_paused') {
        values.paused = pausedTarget === 'PAUSED' ? 'true' : 'false';
      } else if (selectedId === 'set_fee_recipient') {
        if (!feeRecipient.trim()) throw new Error('Enter a recipient address.');
        values.fee_recipient = feeRecipient.trim();
      }

      const data = await executeVaultFunction(selectedId, values, {
        connection,
        anchorWallet,
        publicKey,
        network,
      });

      const solscanUrl =
        data && typeof data === 'object' && 'solscan' in data
          ? (data as { solscan?: string }).solscan
          : undefined;
      const display =
        data && typeof data === 'object'
          ? { ...(data as object), solscan: undefined }
          : data;

      setResult({ type: 'success', text: formatResult(display), solscan: solscanUrl });
      showVaultOpsToast(`INSTRUCTION QUEUED · ${selected.name.toUpperCase()}`);

      if (selectedId === 'set_paused') {
        setAppliedPause(pausedTarget);
        setVault((v) =>
          v ? { ...v, paused: pausedTarget === 'PAUSED' ? 1 : 0 } : v,
        );
      }
      if (selectedId === 'genesis_deposit') {
        setGenesisDone(true);
        setVault((v) => (v ? { ...v, genesis_deposit_status: true } : v));
        try {
          await updateVaultGenesisStatus(network, vault.vault_id, true);
        } catch {
          // non-fatal
        }
      }
    } catch (err: unknown) {
      const parsed = parseTxError(err);
      setLastError(parsed);
      setErrorOpen(true);
      setResult({
        type: parsed.kind === 'info' ? 'info' : 'error',
        text: parsed.title,
      });
    } finally {
      setExecLoading(false);
    }
  };

  if (loadingVault) {
    return (
      <div className="flex flex-1 items-center px-[26px] py-16 font-mono text-xs text-text-dim">
        loading vault operations…
      </div>
    );
  }

  if (loadError || !vault) {
    return (
      <div className="flex flex-1 flex-col items-start gap-4 px-[26px] py-16">
        <p className="font-mono text-xs text-destructive">
          {loadError ?? 'Vault not found.'}
        </p>
        <Link
          href={PORTFOLIO_ROUTE}
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent"
        >
          ← Back to portfolio
        </Link>
      </div>
    );
  }

  const name = displayVaultName(vault.name);
  const fundLabel = `${vault.fund_type === 'fixed' ? 'STATIC' : 'DYNAMIC'} · ${vault.num_assets} ASSETS`;
  const canExecute =
    !execLoading &&
    !(selectedId === 'genesis_deposit' && genesisDone) &&
    !pauseUnchanged &&
    selectedId !== 'create_pool';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <VaultOpsToast />
      {errorOpen && lastError && (
        <ErrorModal
          error={lastError}
          onClose={() => setErrorOpen(false)}
          network={network}
          vaultId={vault.vault_id}
        />
      )}

      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-[26px] py-5">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <Link
            href={PORTFOLIO_ROUTE}
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint transition-colors hover:text-foreground"
          >
            ← Portfolio
          </Link>
          <span className="hidden h-4 w-px bg-white/[0.12] sm:block" aria-hidden />
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
            Vault operations
          </span>
          <span className="hidden h-4 w-px bg-white/[0.12] sm:block" aria-hidden />
          <span className="truncate text-[17px] font-semibold tracking-[-0.02em]">
            {name}
          </span>
          <span className="font-mono text-[11px] text-text-ghost">
            CVLT-{vault.vault_id} · {shorten(vault.vault_address)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
              vault.paused
                ? 'bg-destructive/10 text-destructive'
                : 'bg-accent/10 text-accent'
            }`}
          >
            <span
              className={`h-[5px] w-[5px] rounded-full ${
                vault.paused ? 'bg-destructive' : 'bg-accent'
              }`}
            />
            {vault.paused ? 'Paused' : 'Active'}
          </span>
          <span className="rounded-full border border-white/[0.12] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-faint">
            {fundLabel}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
        {/* Instruction rail */}
        <aside className="flex flex-col border-b border-border bg-bg-elevated md:border-b-0 md:border-r">
          <div className="flex items-center justify-between border-b border-border px-[18px] py-[15px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-ghost">
              Instruction set
            </span>
            <span className="font-mono text-[10px] text-[#4A4A50]">
              {OPERATIONS.length}
            </span>
          </div>

          {OPERATIONS.map((op) => {
            const selected = op.id === selectedId;
            const done =
              (op.id === 'genesis_deposit' && genesisDone) ||
              (op.id === 'create_pool' && poolCreated);
            return (
              <button
                key={op.id}
                type="button"
                onClick={() => {
                  setSelectedId(op.id);
                  setResult(null);
                }}
                aria-pressed={selected}
                className={`flex w-full items-center gap-3.5 border-b border-white/[0.06] px-[18px] py-4 text-left transition-colors ${
                  selected
                    ? 'bg-background shadow-[inset_2px_0_0_#C8FF3D]'
                    : 'hover:bg-white/[0.02]'
                }`}
              >
                <span
                  className={`min-w-[18px] font-mono text-[11px] ${
                    selected ? 'text-accent' : 'text-[#4A4A50]'
                  }`}
                >
                  {op.number}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-[14.5px] tracking-[-0.01em] ${
                      selected
                        ? 'font-semibold text-foreground'
                        : 'font-medium text-text-dim'
                    }`}
                  >
                    {op.name}
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-[#4A4A50]">
                    {op.sig}
                  </div>
                </div>
                {done ? (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/[0.14] text-[9px] text-accent">
                    ✓
                  </span>
                ) : (
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      selected ? 'bg-accent' : 'bg-white/[0.14]'
                    }`}
                  />
                )}
              </button>
            );
          })}

          <div className="mt-auto px-[18px] py-4 font-mono text-[9.5px] uppercase leading-relaxed tracking-[0.12em] text-[#4A4A50]">
            <div>Last instruction</div>
            <div className="mt-1.5 normal-case tracking-normal text-text-faint">
              {genesisDone ? 'genesis_deposit · complete' : 'awaiting genesis'}
            </div>
          </div>
        </aside>

        {/* Detail pane */}
        <main className="flex min-h-0 min-w-0 flex-col bg-background">
          {selectedId === 'genesis_deposit' && genesisDone ? (
            <div className="flex flex-1 flex-col justify-center gap-3 px-10 py-12">
              <span className="font-mono text-[11px] tracking-[0.08em] text-accent">
                Nº 01 · Complete
              </span>
              <h3 className="m-0 text-2xl font-semibold tracking-[-0.03em]">
                Genesis deposit
              </h3>
              <p className="max-w-md text-sm leading-relaxed text-text-dim">
                Baseline deposit is settled for this vault. Opening share price is locked
                and this instruction cannot run again.
              </p>
              <div className="mt-2 font-mono text-xs text-text-ghost">
                genesis_deposit() · writes settled
              </div>
            </div>
          ) : selectedId === 'create_pool' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <DetailHeader
                op={selected}
                walletLabel={walletLabel}
              />
              <div className="flex-1 overflow-y-auto [&_.border-b:first-child>button]:hidden">
                {/* Hide accordion chrome — console already shows Nº 04 header */}
                <CreatePoolAccordion
                  network={network}
                  vault={vault}
                  open
                  onToggle={() => undefined}
                  poolCreated={poolCreated}
                  onPoolCreated={(next) => {
                    setPoolCreated(true);
                    setVault(next);
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <DetailHeader op={selected} walletLabel={walletLabel} />

              <div className="flex-1 overflow-y-auto px-[26px] py-[26px]">
                <p className="m-0 max-w-[660px] text-[15px] leading-[1.65] text-muted-foreground">
                  {selected.description}
                </p>

                {selectedId === 'genesis_deposit' && (
                  <>
                    <SectionRule label="Opening share price" />
                    <div className="mt-4 max-w-md">
                      <label className="mb-2.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-text-dim">
                        Price (USD)
                      </label>
                      <input
                        value={baselinePrice}
                        onChange={(e) => setBaselinePrice(e.target.value)}
                        placeholder="1.00"
                        inputMode="decimal"
                        className="h-[52px] w-full rounded-[8px] border border-white/[0.12] bg-bg-elevated px-3.5 font-mono text-[15px] text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <p className="mt-2 text-[12.5px] text-text-ghost">
                        Seeds the vault with 1 USDC at this opening share price.
                      </p>
                    </div>
                  </>
                )}

                {selectedId === 'set_paused' && (
                  <>
                    <SectionRule label="Target state" />
                    <div className="mt-4 grid max-w-[660px] grid-cols-1 gap-3.5 sm:grid-cols-2">
                      {(
                        [
                          {
                            value: 'ACTIVE' as const,
                            title: 'Active',
                            body: 'Deposits and redemptions open to every bearer.',
                          },
                          {
                            value: 'PAUSED' as const,
                            title: 'Paused',
                            body: 'Mint and burn instructions reject until re-enabled.',
                          },
                        ] as const
                      ).map((opt) => {
                        const on = pausedTarget === opt.value;
                        const isCurrent = currentPaused === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setPausedTarget(opt.value)}
                            className={`rounded-[10px] p-5 text-left transition-colors ${
                              on
                                ? 'border border-accent/35 bg-accent/[0.06]'
                                : 'border border-white/10 bg-bg-elevated'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span
                                className={`font-mono text-[12px] font-medium uppercase tracking-[0.12em] ${
                                  on ? 'text-accent' : 'text-muted-foreground'
                                }`}
                              >
                                {opt.title}
                              </span>
                              {isCurrent ? (
                                <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-accent">
                                  Current
                                </span>
                              ) : (
                                <span
                                  className={`h-3.5 w-3.5 rounded-full border ${
                                    on ? 'border-accent bg-accent' : 'border-white/[0.18]'
                                  }`}
                                />
                              )}
                            </div>
                            <p
                              className={`mt-2.5 text-[13px] leading-relaxed ${
                                on ? 'text-text-dim' : 'text-text-ghost'
                              }`}
                            >
                              {opt.body}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                    {pauseUnchanged && (
                      <p className="mt-[22px] flex items-center gap-2.5 font-mono text-[11px] text-text-ghost">
                        <span className="text-[#FF9E4D]">!</span>
                        No state change staged — pick a different target to enable
                        execution.
                      </p>
                    )}
                  </>
                )}

                {selectedId === 'set_fee_recipient' && (
                  <>
                    <SectionRule label="New recipient" />
                    <div className="mt-4 max-w-xl">
                      <label className="mb-2.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-text-dim">
                        Recipient address
                      </label>
                      <input
                        value={feeRecipient}
                        onChange={(e) => setFeeRecipient(e.target.value)}
                        placeholder="Base58 address…"
                        className="h-[52px] w-full rounded-[8px] border border-white/[0.12] bg-bg-elevated px-3.5 font-mono text-[14px] text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <p className="mt-2 text-[12.5px] text-text-ghost">
                        Leave blank is not allowed — must be a valid Solana address.
                      </p>
                    </div>
                  </>
                )}

                {result && (
                  <div className="mt-8 max-h-64 overflow-y-auto rounded-[8px] border border-white/[0.1] bg-bg-elevated">
                    <div className="border-b border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-text-ghost">
                      Output
                    </div>
                    <div className="px-4 py-3">
                      <LedgerOutput text={result.text} tone={result.type} />
                      {result.solscan && (
                        <a
                          href={result.solscan}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-sm text-accent underline"
                        >
                          View on Solscan
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-5 border-t border-border bg-bg-elevated px-[26px] py-[18px]">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-ghost">
                  ≈ network fee · 1 transaction
                </span>
                <button
                  type="button"
                  onClick={() => void execute()}
                  disabled={!canExecute && connected}
                  className={`flex h-[46px] items-center justify-center rounded-[8px] px-7 text-sm font-semibold transition-colors ${
                    canExecute || !connected
                      ? 'bg-accent text-background hover:bg-[#d4ff5c]'
                      : 'cursor-not-allowed border border-white/10 bg-white/[0.05] text-[#5E5E64]'
                  }`}
                >
                  {execLoading
                    ? 'Processing…'
                    : !connected
                      ? 'Connect wallet'
                      : 'Execute'}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function DetailHeader({
  op,
  walletLabel,
}: {
  op: OperationDef;
  walletLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-6 border-b border-border px-[26px] pb-[22px] pt-[26px]">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[11px] tracking-[0.08em] text-accent">
            Nº {op.number}
          </span>
          <span
            className={`rounded-full border px-[11px] py-[5px] font-mono text-[10px] uppercase tracking-[0.1em] ${tagClass(op.tagTone)}`}
          >
            {op.tag}
          </span>
        </div>
        <h3 className="m-0 mt-3 text-[30px] font-semibold tracking-[-0.035em]">
          {op.name}
        </h3>
        <div className="mt-2 font-mono text-[11.5px] text-text-ghost">
          {op.sig}
          <span className="text-[#3A3A3F]">()</span>
        </div>
      </div>
      <div className="text-right font-mono text-[10px] uppercase leading-[1.9] tracking-[0.12em] text-text-ghost">
        <div>{op.writes}</div>
        <div>
          Signer <span className="text-muted-foreground">{walletLabel}</span>
        </div>
      </div>
    </div>
  );
}

function SectionRule({ label }: { label: string }) {
  return (
    <div className="mt-7 flex items-center gap-3.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-dim">
        {label}
      </span>
      <span className="h-px flex-1 bg-white/[0.08]" />
    </div>
  );
}
