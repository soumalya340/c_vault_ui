'use client';

import { useEffect, useRef, useState } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import { parseUnits, PRICE_SCALE_DECIMALS, type AssetRoute, type Network } from '@/lib/cvault';
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
  | {
      status: 'found';
      venue: 'whirlpool' | 'dammV2';
      mintA: string;
      mintB: string;
      source: string;
    }
  | { status: 'not-found'; message: string };

/** Debounced live existence check for the pool address field on Create asset.
 *  Uses Orca Whirlpools SDK or Meteora CpAmm SDK based on DEX Type.
 *  Not the source of truth — execute-vault-function.ts re-checks before
 *  signing — this is purely so a bad address is obvious before submit.
 *
 *  Dependency list length is fixed (React forbids changing it between
 *  renders). Pass `assetMint: ''` when mint-leg validation is not needed.
 */
function usePoolCheck(
  connection: Connection,
  poolAddress: string,
  dexKind: 'whirlpool' | 'dammV2',
  route: AssetRoute,
  network: Network,
  /** Asset mint base58, or `''` to skip mint-leg validation. */
  assetMint: string,
): PoolCheckState {
  const [state, setState] = useState<PoolCheckState>({ status: 'idle' });
  const requestId = useRef(0);

  // Normalize once so the effect deps are always the same 6 primitives.
  const poolAddressKey = poolAddress.trim();
  const assetMintKey = assetMint.trim();

  useEffect(() => {
    if (!poolAddressKey) {
      setState({ status: 'idle' });
      return;
    }

    let pool: PublicKey;
    try {
      pool = new PublicKey(poolAddressKey);
    } catch {
      setState({ status: 'not-found', message: 'Not a valid Solana address.' });
      return;
    }

    let mintPk: PublicKey | undefined;
    if (assetMintKey) {
      try {
        mintPk = new PublicKey(assetMintKey);
      } catch {
        mintPk = undefined;
      }
    }

    const id = ++requestId.current;
    setState({ status: 'checking' });
    const timer = setTimeout(() => {
      checkPoolExists(connection, pool, dexKind, route, network, mintPk)
        .then((result) => {
          if (requestId.current !== id) return;
          if (result.ok) {
            setState({
              status: 'found',
              venue: result.venue,
              mintA: result.mintA,
              mintB: result.mintB,
              source: result.source,
            });
          } else {
            setState({ status: 'not-found', message: result.message });
          }
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
  }, [connection, poolAddressKey, dexKind, route, network, assetMintKey]);

  return state;
}

/** "1.50" → "1,500,000,000" (PRICE_SCALE units), or null while unparseable/empty. */
function usdToPriceScale(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return parseUnits(trimmed, PRICE_SCALE_DECIMALS).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  } catch {
    return null;
  }
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
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  const style = SECTION_STYLE[section];
  const needsWallet = REQUIRES_WALLET.has(fn.id);
  const poolAddressField = fn.fields.find((field) => field.name === 'pool_address');
  const hasMintField = fn.fields.some((field) => field.name === 'mint');

  // Always pass mint when present — swap pools must include the asset mint
  // even for Pyth-priced assets (DEX Type still selects Whirlpool vs DAMM).
  const poolCheck = usePoolCheck(
    connection,
    open && poolAddressField
      ? (resolveFixedValue(poolAddressField, network) ?? values.pool_address ?? '')
      : '',
    values.price_dex_kind === '1' ? 'dammV2' : 'whirlpool',
    values.route === 'directUsdc' ? 'DirectUsdc' : 'ViaSol',
    network,
    values.mint ?? '',
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

    if (poolAddressField && poolCheck.status === 'not-found') {
      setFieldErrors({ pool_address: poolCheck.message });
      setLoading(false);
      return;
    }
    if (poolAddressField && poolCheck.status === 'checking') {
      setFieldErrors({ pool_address: 'Still checking pool — wait a moment.' });
      setLoading(false);
      return;
    }
    if (hasMintField && mintCheck.status === 'listed') {
      setFieldErrors({
        mint: `Mint already listed as asset #${mintCheck.assetId}.`,
      });
      setLoading(false);
      return;
    }

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
                const infoOpen = openInfo === field.name;
                return (
                  <div key={field.name} className={field.wide ? 'sm:col-span-2' : undefined}>
                    <div className="mb-1.5 flex items-baseline gap-1.5">
                      <label className={`${fieldLabelClass} !mb-0`}>{field.label}</label>
                      {field.info && (
                        <button
                          type="button"
                          onClick={() => setOpenInfo(infoOpen ? null : field.name)}
                          aria-expanded={infoOpen}
                          aria-label={`${infoOpen ? 'Hide' : 'Show'} details for ${field.label}`}
                          className={`inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full border font-mono text-[9px] leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            infoOpen
                              ? 'border-accent text-accent'
                              : 'border-border-strong text-muted-foreground hover:border-accent hover:text-accent'
                          }`}
                        >
                          i
                        </button>
                      )}
                    </div>
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
                    ) : field.type === 'usd' ? (
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                          $
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder={field.placeholder}
                          value={values[field.name] ?? ''}
                          onChange={(e) => {
                            clearFieldError();
                            setValues((prev) => ({ ...prev, [field.name]: e.target.value }));
                          }}
                          className={`${fieldInputClass} pl-6`}
                        />
                      </div>
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
                    {infoOpen && field.info && (
                      <div className="mt-1.5 rounded-[2px] border border-border-strong bg-foreground/[0.03] px-3 py-2.5">
                        <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                          {field.info}
                        </p>
                        {field.type === 'usd' && (() => {
                          const scaled = usdToPriceScale(values[field.name] ?? '');
                          return (
                            <p className="mt-2 border-t border-border pt-2 font-mono text-[11px] text-foreground">
                              {scaled !== null
                                ? `→ ${scaled} on-chain`
                                : 'Enter a value above to see the on-chain integer.'}
                            </p>
                          );
                        })()}
                      </div>
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
                        {poolCheck.status === 'checking' &&
                          (values.price_dex_kind === '1'
                            ? 'Checking DAMM v2 pool (Meteora SDK)…'
                            : 'Checking Whirlpool (Orca SDK)…')}
                        {poolCheck.status === 'found' &&
                          `✓ ${
                            poolCheck.venue === 'dammV2' ? 'DAMM v2 (Meteora)' : 'Whirlpool (Orca)'
                          } — ${poolCheck.mintA.slice(0, 4)}… / ${poolCheck.mintB.slice(0, 4)}…`}
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
