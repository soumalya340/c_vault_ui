'use client';

import { useEffect, useRef, useState } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type { AssetRoute, Network } from '@/lib/cvault';
import { fetchAssetRegistry, FieldError } from '@/lib/registryClient';
import { checkPoolExists } from '@/lib/poolExists';
import { executeVaultFunction, formatResult } from './execute-vault-function';
import {
  REQUIRES_WALLET,
  SECTION_STYLE,
  resolveFixedValue,
  type FunctionDef,
  type SectionId,
} from './function-defs';
import {
  btnPrimaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
} from './ui-classes';

type PoolCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'found' }
  | { status: 'not-found'; message: string };

/** Debounced live existence check for the pool address field on Create asset.
 *  Not the source of truth — execute-vault-function.ts re-checks before
 *  signing — this is purely so a bad address is obvious before submit. */
function usePoolCheck(
  connection: Connection,
  poolAddress: string | undefined,
  dexKind: 'whirlpool' | 'dammV2',
  route: AssetRoute,
  network: Network,
): PoolCheckState {
  const [state, setState] = useState<PoolCheckState>({ status: 'idle' });
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = poolAddress?.trim() ?? '';
    if (!trimmed) {
      setState({ status: 'idle' });
      return;
    }

    let pool: PublicKey;
    try {
      pool = new PublicKey(trimmed);
    } catch {
      setState({ status: 'not-found', message: 'Not a valid Solana address.' });
      return;
    }

    const id = ++requestId.current;
    setState({ status: 'checking' });
    const timer = setTimeout(() => {
      checkPoolExists(connection, pool, dexKind, route, network)
        .then((result) => {
          if (requestId.current !== id) return;
          setState(result.ok ? { status: 'found' } : { status: 'not-found', message: result.message });
        })
        .catch((err) => {
          if (requestId.current !== id) return;
          setState({
            status: 'not-found',
            message: err instanceof Error ? err.message : 'Could not reach the pool account.',
          });
        });
    }, 450);

    return () => clearTimeout(timer);
  }, [connection, poolAddress, dexKind, route, network]);

  return state;
}

type MintCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'unlisted' }
  | { status: 'listed'; assetId: string };

/** Debounced check for whether the mint field on Create asset is already
 *  registered (`pre_approved_token_registry`, scoped to `network`). Not the
 *  source of truth — execute-vault-function.ts re-checks before signing —
 *  this is purely so a duplicate listing is obvious before submit. */
function useMintRegistryCheck(mint: string | undefined, network: Network): MintCheckState {
  const [state, setState] = useState<MintCheckState>({ status: 'idle' });
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = mint?.trim() ?? '';
    if (!trimmed) {
      setState({ status: 'idle' });
      return;
    }

    try {
      new PublicKey(trimmed);
    } catch {
      setState({ status: 'idle' });
      return;
    }

    const id = ++requestId.current;
    setState({ status: 'checking' });
    const timer = setTimeout(() => {
      fetchAssetRegistry(network)
        .then((rows) => {
          if (requestId.current !== id) return;
          const dupe = rows.find((r) => r.mint === trimmed);
          setState(dupe ? { status: 'listed', assetId: dupe.asset_id } : { status: 'unlisted' });
        })
        .catch(() => {
          if (requestId.current !== id) return;
          setState({ status: 'idle' });
        });
    }, 450);

    return () => clearTimeout(timer);
  }, [mint, network]);

  return state;
}

export function AccordionItem({
  fn,
  section,
  network,
}: {
  fn: FunctionDef;
  section: SectionId;
  network: Network;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
    solscan?: string;
  } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  const style = SECTION_STYLE[section];
  const needsWallet = REQUIRES_WALLET.has(fn.id);
  const poolAddressField = fn.fields.find((field) => field.name === 'pool_address');
  const hasMintField = fn.fields.some((field) => field.name === 'mint');

  const poolCheck = usePoolCheck(
    connection,
    open && poolAddressField
      ? (resolveFixedValue(poolAddressField, network) ?? values.pool_address)
      : undefined,
    values.price_dex_kind === '1' ? 'dammV2' : 'whirlpool',
    values.route === 'directUsdc' ? 'DirectUsdc' : 'ViaSol',
    network,
  );

  const mintCheck = useMintRegistryCheck(hasMintField ? values.mint : undefined, network);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsWallet && !connected) {
      setVisible(true);
      return;
    }

    setLoading(true);
    setResult(null);
    setFieldErrors({});

    try {
      const data = await executeVaultFunction(fn.id, values, {
        connection,
        anchorWallet: anchorWallet ?? null,
        publicKey: publicKey ?? null,
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
    } catch (err: unknown) {
      if (err instanceof FieldError) {
        setFieldErrors({ [err.field]: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isRejection =
        msg.toLowerCase().includes('user rejected') ||
        msg.toLowerCase().includes('rejected the request') ||
        msg.toLowerCase().includes('transaction cancelled');
      setResult({
        type: isRejection ? 'info' : 'error',
        text: isRejection ? 'Transaction cancelled.' : msg,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`overflow-hidden transition-colors duration-150 ${
        open ? 'bg-foreground/[0.03]' : 'bg-transparent'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full items-baseline gap-4 px-2 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset md:px-3"
      >
        <span
          className="flex-shrink-0 font-mono text-xs font-bold tabular-nums tracking-[0.08em] text-seal"
          aria-hidden
        >
          &#8470;&nbsp;{fn.number}
        </span>
        <span className="flex-shrink-0 text-sm font-medium tracking-[-0.01em] text-foreground transition-colors group-hover:text-accent">
          {fn.title}
        </span>
        <span
          className="mx-1 flex-1 self-center border-b border-dotted border-border"
          aria-hidden
        />
        <span
          className="flex-shrink-0 select-none font-mono text-sm text-muted-foreground transition-colors"
          style={open ? { color: style.accent } : undefined}
          aria-hidden
        >
          {open ? '▴' : '▾'}
        </span>
      </button>

      <div className={`accordion-content ${open ? 'open' : ''}`}>
        <div className="accordion-inner">
          <form
            onSubmit={handleSubmit}
            className="space-y-4 border-t border-border px-2 pb-5 pt-4 md:px-3"
          >
            <p
              className="border-l-2 py-0.5 pl-3 text-sm leading-[1.55] text-muted-foreground"
              style={{ borderColor: `${style.accent}44` }}
            >
              {fn.description}
            </p>

            {fn.fields.length === 0 && (
              <p className="font-mono text-xs text-muted-foreground/70">No parameters required.</p>
            )}

            {needsWallet && !connected && (
              <p className="rounded-[2px] border border-border bg-foreground/[0.03] px-3 py-2.5 font-mono text-xs text-muted-foreground">
                Connect your wallet to run this instruction.
              </p>
            )}

            {needsWallet && connected && publicKey && (
              <p className="truncate rounded-[2px] border border-border bg-foreground/[0.03] px-3 py-2.5 font-mono text-[11px] text-accent">
                <span className="mr-2 font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  bearer
                </span>
                {publicKey.toBase58()}
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fn.fields.map((field) => {
                const fieldError = fieldErrors[field.name];
                const fieldInputClass = fieldError
                  ? `${inputClass} border-destructive focus-visible:border-destructive focus-visible:ring-destructive`
                  : inputClass;
                const clearFieldError = () => {
                  if (!fieldError) return;
                  setFieldErrors((prev) => {
                    const rest = { ...prev };
                    delete rest[field.name];
                    return rest;
                  });
                };
                return (
                  <div key={field.name} className={field.wide ? 'sm:col-span-2' : undefined}>
                    <label className={fieldLabelClass}>{field.label}</label>
                    {field.fixed !== undefined ? (
                      <p className="break-all rounded-[2px] border border-border bg-foreground/[0.03] px-3 py-2.5 font-mono text-[11px] text-foreground">
                        {resolveFixedValue(field, network)}
                      </p>
                    ) : field.type === 'select' ? (
                      <select
                        value={values[field.name] ?? field.options?.[0]?.value ?? ''}
                        onChange={(e) => {
                          clearFieldError();
                          setValues((prev) => ({ ...prev, [field.name]: e.target.value }));
                        }}
                        className={fieldInputClass}
                      >
                        {field.options?.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : field.name === 'assets_json' ? (
                      <textarea
                        value={values[field.name] ?? ''}
                        onChange={(e) => {
                          clearFieldError();
                          setValues((prev) => ({ ...prev, [field.name]: e.target.value }));
                        }}
                        rows={6}
                        placeholder={field.hint}
                        className={`${fieldInputClass} text-xs`}
                      />
                    ) : (
                      <input
                        type={field.type ?? 'text'}
                        placeholder={field.placeholder}
                        value={values[field.name] ?? ''}
                        onChange={(e) => {
                          clearFieldError();
                          setValues((prev) => ({ ...prev, [field.name]: e.target.value }));
                        }}
                        className={fieldInputClass}
                      />
                    )}
                    {fieldError && (
                      <p className="mt-1.5 font-mono text-xs leading-relaxed text-destructive">
                        {fieldError}
                      </p>
                    )}
                    {!fieldError && field.name === 'pool_address' && poolCheck.status !== 'idle' && (
                      <p
                        className={`mt-1.5 font-mono text-xs leading-relaxed ${
                          poolCheck.status === 'not-found'
                            ? 'text-destructive'
                            : poolCheck.status === 'found'
                              ? 'text-accent'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {poolCheck.status === 'checking' && 'Checking pool…'}
                        {poolCheck.status === 'found' && '✓ Pool found on-chain.'}
                        {poolCheck.status === 'not-found' && poolCheck.message}
                      </p>
                    )}
                    {!fieldError && field.name === 'mint' && mintCheck.status !== 'idle' && (
                      <p
                        className={`mt-1.5 font-mono text-xs leading-relaxed ${
                          mintCheck.status === 'listed'
                            ? 'text-destructive'
                            : mintCheck.status === 'unlisted'
                              ? 'text-accent'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {mintCheck.status === 'checking' && 'Checking registry…'}
                        {mintCheck.status === 'unlisted' && '✓ Not yet listed.'}
                        {mintCheck.status === 'listed' &&
                          `Already listed as asset #${mintCheck.assetId}.`}
                      </p>
                    )}
                    {field.hint && field.name !== 'assets_json' && (
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground/80">
                        {field.hint}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <button type="submit" disabled={loading} className={btnPrimaryClass}>
              {loading
                ? 'Processing…'
                : needsWallet && !connected
                  ? 'Connect wallet'
                  : fn.submitLabel}
            </button>

            {result && (
              <div className={outputPanelClass}>
                <div className="border-b border-border px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-muted-foreground md:px-5">
                  OUTPUT
                </div>
                <div
                  className={`whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs leading-relaxed md:px-5 ${
                    result.type === 'error'
                      ? 'text-destructive'
                      : result.type === 'success'
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                  }`}
                >
                  <span className="mr-2 text-muted-foreground/50">&gt;</span>
                  {result.text}
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
          </form>
        </div>
      </div>
    </div>
  );
}
