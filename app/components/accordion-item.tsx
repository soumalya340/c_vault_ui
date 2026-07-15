'use client';

import { useEffect, useRef, useState } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import { parseUnits, PRICE_SCALE_DECIMALS, type AssetRoute, type Network } from '@/lib/cvault';
import { parseTxError, type UserFacingError } from '@/lib/txError';
import {
  fetchAssetRegistry,
  fetchAssetPresets,
  fetchVaults,
  FieldError,
  type AssetPresetRecord,
} from '@/lib/registryClient';
import { assetNameForMint } from '@/lib/presets/canonical-data';
import { checkPoolExists } from '@/lib/poolExists';
import { executeVaultFunction, formatResult } from './execute-vault-function';
import {
  REQUIRES_WALLET,
  SECTION_STYLE,
  resolveFixedValue,
  type FunctionDef,
  type SectionId,
} from './function-defs';
import { ErrorModal } from './error-modal';
import { LedgerOutput } from './ledger-output';
import {
  btnPrimaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
  selectClass,
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
 *  this is purely so a duplicate listing is obvious before submit.
 *  `registryVersion` re-runs the check after a successful create_asset. */
function useMintRegistryCheck(
  mint: string | undefined,
  network: Network,
  registryVersion: number,
): MintCheckState {
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
  }, [mint, network, registryVersion]);

  return state;
}

type IdOptionsState =
  | { status: 'loading' }
  | { status: 'ready'; options: { value: string; label: string }[] }
  | { status: 'error'; message: string };

/** Vault ids from the DB `vaults` table — vault_id fields render as a
 *  registry-backed dropdown, never a hand-typed input. Refetches when the
 *  accordion opens or the network changes. */
function useVaultIdOptions(active: boolean, network: Network): IdOptionsState | null {
  const [state, setState] = useState<IdOptionsState | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchVaults(network)
      .then((rows) => {
        if (cancelled) return;
        const sorted = [...rows].sort((a, b) => a.vault_id - b.vault_id);
        setState({
          status: 'ready',
          options: sorted.map((r) => ({
            value: String(r.vault_id),
            label: `№ ${String(r.vault_id).padStart(2, '0')} · ${r.name}${
              r.symbol ? ` (${r.symbol})` : ''
            }`,
          })),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [active, network]);

  return state;
}

/** Asset ids from `pre_approved_token_registry` — same contract as
 *  {@link useVaultIdOptions} but for asset_id fields. */
function useAssetIdOptions(active: boolean, network: Network): IdOptionsState | null {
  const [state, setState] = useState<IdOptionsState | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchAssetRegistry(network)
      .then((rows) => {
        if (cancelled) return;
        const sorted = [...rows].sort((a, b) => Number(a.asset_id) - Number(b.asset_id));
        setState({
          status: 'ready',
          options: sorted.map((r) => ({
            value: r.asset_id,
            label: `#${r.asset_id} · ${r.asset_name}${r.active ? '' : ' (inactive)'}`,
          })),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [active, network]);

  return state;
}

const ID_FIELD_PLACEHOLDER: Record<'vault_id' | 'asset_id', string> = {
  vault_id: 'Select a Vault',
  asset_id: 'Choose an Asset',
};

type PresetPickerState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; options: AssetPresetRecord[] }
  | { status: 'error'; message: string };

/** Presets from Pools.md, minus whatever is already listed on this network's
 *  registry — so the dropdown only ever offers assets worth creating.
 *  `registryVersion` refetches after a successful create_asset, so a mint
 *  listed moments ago drops out of the options without collapsing the form. */
function useUnlistedPresets(
  open: boolean,
  network: Network,
  registryVersion: number,
): PresetPickerState {
  const [state, setState] = useState<PresetPickerState>({ status: 'idle' });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([fetchAssetPresets(network), fetchAssetRegistry(network)])
      .then(([presets, registry]) => {
        if (cancelled) return;
        const listedMints = new Set(registry.map((r) => r.mint));
        setState({ status: 'ready', options: presets.filter((p) => !listedMints.has(p.mint)) });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [open, network, registryVersion]);

  // Not an effect-body setState: derives "loading" for render only when the
  // fetch has actually kicked off (open) and hasn't resolved yet, without a
  // synchronous transition inside the effect itself.
  if (open && state.status === 'idle') return { status: 'loading' };

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
  /** Last structured failure — kept after dismiss so OUTPUT can re-open the modal. */
  const [lastError, setLastError] = useState<UserFacingError | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
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
  const isCreateAsset = fn.id === 'create_asset';

  // Bumped after a successful create_asset so the preset dropdown and the
  // duplicate-mint check refetch the registry instead of serving stale data.
  const [registryVersion, setRegistryVersion] = useState(0);

  const hasVaultIdField = fn.fields.some((f) => f.name === 'vault_id');
  const hasAssetIdField = fn.fields.some((f) => f.name === 'asset_id');
  const vaultIdOptions = useVaultIdOptions(open && hasVaultIdField, network);
  const assetIdOptions = useAssetIdOptions(open && hasAssetIdField, network);

  // Ids are per-network — drop any picked id when the cluster changes so a
  // localhost vault id can never be submitted against mainnet (and vice versa).
  useEffect(() => {
    setValues((prev) => {
      if (prev.vault_id === undefined && prev.asset_id === undefined) return prev;
      const rest = { ...prev };
      delete rest.vault_id;
      delete rest.asset_id;
      return rest;
    });
  }, [network]);

  const presetPicker = useUnlistedPresets(open && isCreateAsset, network, registryVersion);
  const fillFromPreset = (presetKey: string) => {
    const preset =
      presetPicker.status === 'ready' ? presetPicker.options.find((p) => p.preset_key === presetKey) : undefined;
    if (!preset) return;
    setFieldErrors({});
    // Preset catalog (asset_presets / Pools.md) is the source of truth for the
    // display name when the admin picks a known mint.
    setValues((prev) => ({
      ...prev,
      asset_name: preset.asset_name,
      mint: preset.mint,
      pool_address: preset.pool_address,
      pyth_feed_id: preset.pyth_feed_id,
      route: preset.route === 'DirectUsdc' ? 'directUsdc' : 'viaSol',
      price_source_tag: String(preset.price_source_tag),
      price_dex_kind: preset.swap_kind === 'DammV2' ? '1' : '0',
      token_program_tag: String(preset.token_program_tag),
    }));
  };

  /** When mint matches a cataloged preset, prefer its asset_name unless the
   *  admin already typed a custom name that is not the previous preset name. */
  const applyPresetNameForMint = (
    prev: Record<string, string>,
    nextMint: string,
  ): Record<string, string> => {
    const trimmed = nextMint.trim();
    const fromDb =
      (presetPicker.status === 'ready'
        ? presetPicker.options.find((p) => p.mint === trimmed)?.asset_name
        : undefined) || assetNameForMint(trimmed);
    if (!fromDb) return { ...prev, mint: nextMint };

    const curName = prev.asset_name?.trim() ?? '';
    const prevMintPreset =
      (presetPicker.status === 'ready'
        ? presetPicker.options.find((p) => p.mint === (prev.mint ?? '').trim())?.asset_name
        : undefined) || assetNameForMint((prev.mint ?? '').trim());
    // Fill when empty, or when the field still holds the last auto-filled preset name.
    if (!curName || curName === prevMintPreset) {
      return { ...prev, mint: nextMint, asset_name: fromDb };
    }
    return { ...prev, mint: nextMint };
  };

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

  const mintCheck = useMintRegistryCheck(
    hasMintField ? values.mint : undefined,
    network,
    registryVersion,
  );

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

    // Create asset: require a display name. Prefer the typed value; if empty
    // but mint is a known preset, take the catalog name so the registry row
    // is never blank for Pools.md assets.
    let submitValues = values;
    if (isCreateAsset) {
      const mintTrim = values.mint?.trim() ?? '';
      const typedName = values.asset_name?.trim() ?? '';
      const fromPreset =
        (presetPicker.status === 'ready'
          ? presetPicker.options.find((p) => p.mint === mintTrim)?.asset_name
          : undefined) || assetNameForMint(mintTrim);
      const assetName = typedName || fromPreset || '';
      if (!assetName) {
        setFieldErrors({
          asset_name: 'Enter an asset name (or pick a preset / paste a known mint).',
        });
        setLoading(false);
        return;
      }
      submitValues = { ...values, asset_name: assetName };
      if (!typedName && fromPreset) {
        setValues((prev) => ({ ...prev, asset_name: fromPreset }));
      }
    }

    // DB-backed id fields: submit exactly what the dropdown shows. Block when
    // the registry has no rows (nothing valid to target) or is still loading;
    // when the fetch failed the manual fallback input is active, so pass
    // whatever was typed straight through.
    const idFields: [string, IdOptionsState | null][] = [];
    if (hasVaultIdField) idFields.push(['vault_id', vaultIdOptions]);
    if (hasAssetIdField) idFields.push(['asset_id', assetIdOptions]);
    for (const [name, opts] of idFields) {
      if (opts?.status === 'error') continue;
      if (!opts || opts.status === 'loading') {
        setFieldErrors({ [name]: 'Still loading ids from the registry — wait a moment.' });
        setLoading(false);
        return;
      }
      if (opts.options.length === 0) {
        setFieldErrors({
          [name]:
            name === 'vault_id'
              ? `No vaults recorded on ${network} yet — create one under 02 VAULTS.`
              : `No assets recorded on ${network} yet — list one via Admin № 05 Create asset.`,
        });
        setLoading(false);
        return;
      }
      const current = submitValues[name];
      const valid = current && opts.options.some((o) => o.value === current);
      if (!valid) {
        if (section === 'view') {
          const idName = name as 'vault_id' | 'asset_id';
          setFieldErrors({ [name]: `${ID_FIELD_PLACEHOLDER[idName]}.` });
          setLoading(false);
          return;
        }
        submitValues = { ...submitValues, [name]: opts.options[0].value };
      }
    }

    // Untouched selects display options[0] — make sure the submit sends the
    // same value instead of undefined.
    for (const f of fn.fields) {
      if (f.type === 'select' && !submitValues[f.name] && f.options?.length) {
        submitValues = { ...submitValues, [f.name]: f.options[0].value };
      }
    }

    try {
      const data = await executeVaultFunction(fn.id, submitValues, {
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
      if (isCreateAsset) setRegistryVersion((v) => v + 1);
    } catch (err: unknown) {
      if (err instanceof FieldError) {
        setFieldErrors({ [err.field]: err.message });
        return;
      }
      const parsed = parseTxError(err);
      setLastError(parsed);
      setErrorOpen(true);
      setResult({
        type: parsed.kind === 'info' ? 'info' : 'error',
        text: parsed.title,
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
      {errorOpen && lastError && (
        <ErrorModal
          error={lastError}
          onClose={() => setErrorOpen(false)}
          network={network}
          vaultId={
            values.vault_id != null && values.vault_id !== ''
              ? Number(values.vault_id)
              : null
          }
          onRefreshSuccess={() => {
            setErrorOpen(false);
            setResult({
              type: 'info',
              text: 'DEX TWAP refreshed — run the action again (e.g. Get Total NAV View).',
            });
          }}
        />
      )}
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

            {isCreateAsset && (
              <div>
                <label className={`${fieldLabelClass} !mb-1.5`} htmlFor="create-asset-preset">
                  Fill from preset (Pools.md)
                </label>
                {presetPicker.status === 'error' ? (
                  <p className="font-mono text-xs text-destructive">
                    Couldn&rsquo;t load presets — {presetPicker.message}
                  </p>
                ) : presetPicker.status === 'ready' && presetPicker.options.length === 0 ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    Every cataloged preset is already listed on {network}.
                  </p>
                ) : (
                  <select
                    id="create-asset-preset"
                    className={selectClass}
                    disabled={presetPicker.status !== 'ready'}
                    value=""
                    onChange={(e) => e.target.value && fillFromPreset(e.target.value)}
                  >
                    <option value="">
                      {presetPicker.status === 'loading' ? 'Loading presets…' : 'Choose a preset to autofill…'}
                    </option>
                    {presetPicker.status === 'ready' &&
                      presetPicker.options.map((p) => (
                        <option key={p.preset_key} value={p.preset_key}>
                          {p.asset_name} · {p.route} · {p.swap_kind}
                        </option>
                      ))}
                  </select>
                )}
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground/80">
                  Fills asset name, mint, pool, Pyth feed, and DEX settings below — review before submitting.
                </p>
              </div>
            )}

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
                const fieldSelectClass = fieldError
                  ? `${selectClass} border-destructive focus-visible:border-destructive focus-visible:ring-destructive`
                  : selectClass;
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
                    ) : field.name === 'vault_id' || field.name === 'asset_id' ? (
                      (() => {
                        const opts = field.name === 'vault_id' ? vaultIdOptions : assetIdOptions;
                        const noun = field.name === 'vault_id' ? 'vaults' : 'assets';
                        if (opts?.status === 'error') {
                          // Registry unreachable — manual entry is the only way
                          // left to target an id, so fall back to the input.
                          return (
                            <>
                              <input
                                type="number"
                                placeholder={field.placeholder}
                                value={values[field.name] ?? ''}
                                onChange={(e) => {
                                  clearFieldError();
                                  setValues((prev) => ({ ...prev, [field.name]: e.target.value }));
                                }}
                                className={fieldInputClass}
                              />
                              <p className="mt-1.5 font-mono text-xs leading-relaxed text-destructive">
                                Couldn&rsquo;t load {noun} from the registry ({opts.message}) —
                                enter the id manually.
                              </p>
                            </>
                          );
                        }
                        if (opts?.status !== 'ready') {
                          return (
                            <select value="" disabled className={fieldInputClass}>
                              <option value="">Loading {noun}…</option>
                            </select>
                          );
                        }
                        if (opts.options.length === 0) {
                          return (
                            <p className="rounded-[2px] border border-border bg-foreground/[0.03] px-3 py-2.5 font-mono text-xs text-muted-foreground">
                              No {noun} recorded on {network} yet.
                            </p>
                          );
                        }
                        const idFieldName = field.name as 'vault_id' | 'asset_id';
                        const requirePick = section === 'view';
                        const current = values[field.name];
                        const hasSelection =
                          current !== undefined && opts.options.some((o) => o.value === current);
                        const selected = hasSelection
                          ? current
                          : requirePick
                            ? ''
                            : opts.options[0].value;
                        return (
                          <select
                            value={selected}
                            onChange={(e) => {
                              clearFieldError();
                              setValues((prev) => ({ ...prev, [field.name]: e.target.value }));
                            }}
                            className={fieldSelectClass}
                            aria-invalid={fieldError ? true : undefined}
                          >
                            {requirePick && (
                              <option value="">
                                {ID_FIELD_PLACEHOLDER[idFieldName]}
                              </option>
                            )}
                            {opts.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        );
                      })()
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
                          const next = e.target.value;
                          // Pasting a known mint auto-fills Asset name from the
                          // preset catalog (unless the admin already customized it).
                          if (isCreateAsset && field.name === 'mint') {
                            setValues((prev) => applyPresetNameForMint(prev, next));
                            return;
                          }
                          setValues((prev) => ({ ...prev, [field.name]: next }));
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
                <div className="px-4 py-3 md:px-5">
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
          </form>
        </div>
      </div>
    </div>
  );
}
