'use client';

import { useEffect, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

import {
  assertCreateEtfMetadata,
  createEtf,
  setShareMetadataFields,
  deriveGlobalStatePda,
  pythFeedAccount,
  vaultAssetAta,
  WSOL_MINT,
  SOL_USD_PYTH_FEED_ID,
  PRICE_SOURCE_PYTH,
  PRICE_SOURCE_DEX,
  NETWORK_CONSTANTS,
  type Network,
} from '@/lib/cvault';
import { MAX_METADATA_VALUE_LEN, VAULT_METADATA_DESCRIPTION_KEY } from '@/lib/constants';
import { buildVaultAltAddresses, createVaultAlt } from '@/lib/alt';
import { fetchPoolCtx } from '@/lib/whirlpool';
import { fetchDammPoolCtx } from '@/lib/damm';
import {
  fetchAssetRegistry,
  saveVault,
  generateVaultDescription,
  type AssetRegistryEntry,
} from '@/lib/registryClient';
import { parseTxError, type UserFacingError } from '@/lib/txError';
import { SECTION_STYLE } from './function-defs';
import { ErrorModal } from './error-modal';
import { ImageDropzone } from './image-dropzone';
import { LedgerOutput } from './ledger-output';
import {
  btnGhostClass,
  btnPrimaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
  panelClass,
  sectionLabelClass,
  selectClass,
} from './ui-classes';

// Create ETF vault — create_etf initialises the vault AND its Token-2022 share
// metadata in one instruction. Assets are picked by asset_id from the global
// registry (admin-listed via create_asset); every other attribute (mint,
// pool, route, price source, swap venue, token program) already lives on
// that shared AssetInfo PDA and is not re-entered here. Quote mint is always
// mainnet USDC.

interface AssetRow {
  /** Empty string = unpicked. */
  assetId: string;
  /** User-facing percentage, e.g. "1.01" for 1.01% — up to 2 decimals. */
  allocationPct: string;
}

const EMPTY_ROW: AssetRow = { assetId: '', allocationPct: '' };

/** "1.01" (percent, ≤2 decimals) → 101 (raw on-chain allocation_bps). */
function pctToBps(pct: string): number {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function CreateEtfPanel({ network }: { network: Network }) {
  const style = SECTION_STYLE['vault-ops'];
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const usdcMint = NETWORK_CONSTANTS[network].usdcMint;
  const usdcBase58 = usdcMint.toBase58();

  const [registry, setRegistry] = useState<AssetRegistryEntry[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [uri, setUri] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [generatingInfo, setGeneratingInfo] = useState(false);
  const [generateInfoError, setGenerateInfoError] = useState<string | null>(null);
  const [feeRecipient, setFeeRecipient] = useState('');
  const [depositFeeBps, setDepositFeeBps] = useState('0');
  const [redeemFeeBps, setRedeemFeeBps] = useState('100');
  const [fundType, setFundType] = useState<'dynamic' | 'fixed'>('dynamic');
  const [maxShares, setMaxShares] = useState('');
  const [rows, setRows] = useState<AssetRow[]>([{ ...EMPTY_ROW }]);
  const [activeRowIndex, setActiveRowIndex] = useState(0);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);
  const [lastError, setLastError] = useState<UserFacingError | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Network switch → reload this cluster's registry and clear the basket so
    // asset ids from the previous network can't be submitted by mistake.
    setRows([{ ...EMPTY_ROW }]);
    setActiveRowIndex(0);
    fetchAssetRegistry(network)
      .then((rows) => {
        if (cancelled) return;
        setRegistry(rows);
        setRegistryError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setRegistryError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [network]);

  const activeAssets = useMemo(
    () => registry.filter((a) => a.active),
    [registry],
  );

  const assetById = useMemo(
    () => new Map(registry.map((a) => [a.asset_id, a])),
    [registry],
  );

  const allocationTotalBps = rows.reduce((sum, r) => sum + pctToBps(r.allocationPct), 0);
  const allocationTotalPct = (allocationTotalBps / 100).toFixed(2);

  const updateRow = (index: number, patch: Partial<AssetRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const hasViaSol = rows.some((r) => assetById.get(r.assetId)?.route === 'ViaSol');

  const handleGenerateInfo = async () => {
    if (!name.trim()) {
      setGenerateInfoError('Enter a share name first.');
      return;
    }
    setGeneratingInfo(true);
    setGenerateInfoError(null);
    try {
      const text = await generateVaultDescription(name.trim());
      setAdditionalInfo(text);
    } catch (err) {
      setGenerateInfoError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingInfo(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !anchorWallet || !publicKey) {
      setVisible(true);
      return;
    }
    if (imageUploading) return;
    if (!uri.trim()) {
      setResult({ type: 'error', text: 'Upload a vault image before creating the vault.' });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      if (rows.length === 0) throw new Error('Add at least one asset.');
      if (allocationTotalBps !== 10_000) {
        throw new Error(`Allocations must sum to 100% (currently ${allocationTotalPct}%).`);
      }

      const picked = rows.map((row, i) => {
        if (!row.assetId) throw new Error(`Asset ${i + 1}: pick a token.`);
        const entry = assetById.get(row.assetId);
        if (!entry) throw new Error(`Asset ${i + 1}: unknown asset id ${row.assetId}.`);
        return { entry, allocationBps: pctToBps(row.allocationPct) };
      });

      assertCreateEtfMetadata(name, symbol, uri);

      setStatus('Creating vault (create_etf)…');
      const created = await createEtf(
        connection,
        anchorWallet,
        {
          feeRecipient: feeRecipient.trim() ? new PublicKey(feeRecipient.trim()) : null,
          depositFeeBps: Number(depositFeeBps) || 0,
          redeemFeeBps: Number(redeemFeeBps) || 0,
          assets: picked.map((p) => ({
            assetId: Number(p.entry.asset_id),
            allocationBps: p.allocationBps,
          })),
          fundType: fundType === 'fixed' ? { fixed: {} } : { dynamic: {} },
          maxShares: maxShares.trim() ? new BN(maxShares.trim()) : null,
        },
        name,
        symbol,
        uri,
        network,
      );

      const trimmedInfo = additionalInfo.trim();
      let metadataNote = '';
      if (trimmedInfo) {
        try {
          setStatus('Setting additional information (set_share_metadata_fields)…');
          await setShareMetadataFields(
            connection,
            anchorWallet,
            created.vaultId,
            [{ key: VAULT_METADATA_DESCRIPTION_KEY, value: trimmedInfo }],
            network,
          );
        } catch (err) {
          metadataNote =
            `\n\nVault created, but setting additional information failed: ${
              err instanceof Error ? err.message : String(err)
            }. Retry from the vault's admin panel.`;
        }
      }

      let altAddress: string | null = null;
      let altNote = '';
      try {
        setStatus('Creating address lookup table…');
        const whirlpoolAddrs: PublicKey[] = [];
        const dammAddrs: PublicKey[] = [];

        for (const { entry } of picked) {
          const poolAddr = new PublicKey(entry.pool_address);
          if (entry.swap_kind === 'DammV2') dammAddrs.push(poolAddr);
          else whirlpoolAddrs.push(poolAddr);
          if (entry.price_source_tag === PRICE_SOURCE_DEX) {
            const pricePool = new PublicKey(entry.price_pool_address);
            if (entry.price_dex_kind === 1) dammAddrs.push(pricePool);
            else whirlpoolAddrs.push(pricePool);
          }
        }
        // ViaSol legs use the cluster's canonical USDC↔wSOL Whirlpool (not vault-stored).
        if (hasViaSol) {
          whirlpoolAddrs.push(NETWORK_CONSTANTS[network].wsolUsdcPool);
        }

        const uniqueWp = Array.from(new Set(whirlpoolAddrs.map((p) => p.toBase58()))).map(
          (s) => new PublicKey(s),
        );
        const uniqueDamm = Array.from(new Set(dammAddrs.map((p) => p.toBase58()))).map(
          (s) => new PublicKey(s),
        );

        const poolCtxs = await Promise.all(
          uniqueWp.map((p) => fetchPoolCtx(connection, p).catch(() => null)),
        );
        const dammCtxs = await Promise.all(
          uniqueDamm.map((p) => fetchDammPoolCtx(connection, p).catch(() => null)),
        );

        const assetMints = picked.map((p) => new PublicKey(p.entry.mint));
        const ataMints =
          hasViaSol && !assetMints.some((m) => m.equals(WSOL_MINT))
            ? [...assetMints, WSOL_MINT]
            : assetMints;
        const priceFeeds = picked
          .filter((p) => p.entry.price_source_tag === PRICE_SOURCE_PYTH)
          .map((p) => Array.from(Buffer.from(p.entry.pyth_feed_id, 'hex')))
          .filter((bytes) => bytes.some((b) => b !== 0))
          .map((bytes) => pythFeedAccount(bytes));
        // DEX ViaSol NAV needs SOL/USD Pyth after the price pool (sum_nav stride).
        if (
          picked.some(
            (p) =>
              p.entry.price_source_tag === PRICE_SOURCE_DEX && p.entry.route === 'ViaSol',
          )
        ) {
          priceFeeds.push(pythFeedAccount(SOL_USD_PYTH_FEED_ID));
        }

        const lut = await createVaultAlt(
          connection,
          anchorWallet,
          buildVaultAltAddresses({
            globalState: deriveGlobalStatePda(),
            vaultPda: created.vaultPda,
            vaultAuthority: created.vaultAuthority,
            sharesMint: created.sharesMint,
            usdcVault: created.usdcVault,
            baseMint: usdcMint,
            assetMints,
            vaultAssetAtas: ataMints.map((m, i) => {
              const tag = picked[i]?.entry.token_program_tag ?? 0;
              return vaultAssetAta(created.vaultAuthority, m, tag);
            }),
            priceFeeds,
            pools: poolCtxs.filter((p): p is NonNullable<typeof p> => p != null),
            dammPools: dammCtxs.filter((p): p is NonNullable<typeof p> => p != null),
          }),
        );
        altAddress = lut.toBase58();
      } catch (err) {
        altNote =
          `\n\nALT creation failed at create_etf: ${
            err instanceof Error ? err.message : String(err)
          }. ` +
          `Vault is still on-chain — run Genesis deposit next; it will create the ALT, wait for activation, and save it to the DB before seeding.`;
      }

      setStatus('Recording vault…');
      let registryNote = '';
      try {
        const manager = publicKey.toBase58();
        const feeRcpt = feeRecipient.trim() || manager;
        await saveVault({
          vault_address: created.vaultPda.toBase58(),
          vault_id: created.vaultId,
          network,
          vault_authority: created.vaultAuthority.toBase58(),
          shares_mint: created.sharesMint.toBase58(),
          usdc_vault: created.usdcVault.toBase58(),
          name,
          symbol,
          uri,
          fee_recipient: feeRcpt,
          fund_type: fundType,
          max_shares: maxShares.trim() || null,
          creator: manager,
          tx_signature: created.tx,
          alt_address: altAddress,
          paused: 0,
          admin_locked: 0,
          vault_manager: manager,
          deposit_fee_bps: Number(depositFeeBps) || 0,
          redeem_fee_bps: Number(redeemFeeBps) || 0,
          total_usdc_value: '0',
          asset_ids: picked.map((p) => Number(p.entry.asset_id)),
          asset_allocation_bps: picked.map((p) => p.allocationBps),
          num_assets: picked.length,
          genesis_deposit_status: false,
          is_pool_created: false,
          additional_metadata: trimmedInfo || null,
        });
      } catch (err) {
        registryNote = `\n\nVault created on-chain but recording it failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }

      setResult({
        type: 'success',
        text:
          `ETF vault №${created.vaultId} created — share metadata set in the same transaction.\n` +
          `vault: ${created.vaultPda.toBase58()}\n` +
          `shares mint: ${created.sharesMint.toBase58()}\n` +
          `lookup table: ${altAddress ?? '— (creation failed)'}${metadataNote}${altNote}${registryNote}`,
        solscan: created.tx ? created.link : undefined,
      });
    } catch (err) {
      const parsed = parseTxError(err);
      setLastError(parsed);
      setErrorOpen(true);
      setResult({
        type: parsed.kind === 'info' ? 'info' : 'error',
        text: parsed.title,
      });
    } finally {
      setStatus(null);
      setLoading(false);
    }
  };

  return (
    <section aria-label="Create ETF vault" className={`${panelClass} overflow-hidden`}>
      {errorOpen && lastError && (
        <ErrorModal
          error={lastError}
          onClose={() => setErrorOpen(false)}
          network={network}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-5 py-3.5 md:px-6">
        <span
          className="font-display text-base font-semibold uppercase tracking-[0.18em]"
          style={{ color: style.accent }}
        >
          <span className="mr-3 font-mono text-xs font-bold tracking-[0.08em] text-seal">№ 01</span>
          Create ETF vault
        </span>
        <span className={`${sectionLabelClass} uppercase`}>
          vault + vault metadata + lookup table
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 px-5 py-5 md:px-6">
        <p
          className="border-l-2 py-0.5 pl-3 text-sm leading-[1.55] text-muted-foreground"
          style={{ borderColor: `${style.accent}44` }}
        >
          Quote mint is mainnet USDC. Assets are picked from the admin-approved
          registry — pool, route, price source, and swap venue are already set
          per asset; only the weighting is chosen here.
        </p>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
          <div className="shrink-0">
            <label className={fieldLabelClass}>Vault image</label>
            <ImageDropzone value={uri} onChange={setUri} onUploadingChange={setImageUploading} />
            {uri ? (
              <p className="mt-1.5 max-w-[10rem] truncate font-mono text-[10px] text-muted-foreground">
                {uri}
              </p>
            ) : (
              <p className="mt-1.5 max-w-[10rem] font-mono text-[10px] text-muted-foreground/70">
                Required before you can create the vault.
              </p>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={fieldLabelClass}>Share name</label>
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="cVault Shares"
                  maxLength={32}
                  required
                />
              </div>
              <div>
                <label className={fieldLabelClass}>Share symbol</label>
                <input
                  className={inputClass}
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="CVS"
                  maxLength={10}
                  required
                />
              </div>
            </div>

            <div className="flex flex-1 flex-col">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label className={fieldLabelClass}>Description (Optional)</label>
                <button
                  type="button"
                  onClick={handleGenerateInfo}
                  disabled={generatingInfo || !name.trim()}
                  className={btnGhostClass}
                >
                  {generatingInfo ? 'Generating…' : 'Auto-generate'}
                </button>
              </div>
              <textarea
                className={`${inputClass} flex-1 resize-none`}
                value={additionalInfo}
                onChange={(e) => setAdditionalInfo(e.target.value)}
                placeholder="Optional — strategy notes, mandate, or other context shown alongside this vault."
                maxLength={MAX_METADATA_VALUE_LEN}
              />
            </div>
          </div>
        </div>
        {generateInfoError && (
          <p className="-mt-3 font-mono text-[10px] text-destructive">{generateInfoError}</p>
        )}
        <p className="-mt-3 font-mono text-[10px] text-muted-foreground">
          Optional. Draft from the share name via Auto-generate, then edit freely. Written
          on-chain as share-mint metadata (key {VAULT_METADATA_DESCRIPTION_KEY}) in a follow-up
          transaction after the vault is created. Max {MAX_METADATA_VALUE_LEN} bytes.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={fieldLabelClass}>Base / quote mint</label>
            <input className={inputClass} value={`USDC · ${usdcBase58}`} readOnly />
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              Program constant — Circle USDC (EPjF…) on every network
            </p>
          </div>
          <div>
            <label className={fieldLabelClass}>Fee recipient (blank = you)</label>
            <input
              className={inputClass}
              value={feeRecipient}
              onChange={(e) => setFeeRecipient(e.target.value)}
              placeholder="Connected wallet"
            />
          </div>
          <div>
            <label className={fieldLabelClass}>Deposit fee (BPS)</label>
            <input
              className={inputClass}
              type="number"
              value={depositFeeBps}
              onChange={(e) => setDepositFeeBps(e.target.value)}
              placeholder="0"
            />
          </div>
          <div>
            <label className={fieldLabelClass}>Redeem fee (BPS)</label>
            <input
              className={inputClass}
              type="number"
              value={redeemFeeBps}
              onChange={(e) => setRedeemFeeBps(e.target.value)}
              placeholder="100"
            />
          </div>
          <div>
            <label className={fieldLabelClass}>Fund type</label>
            <select
              className={selectClass}
              value={fundType}
              onChange={(e) => setFundType(e.target.value as 'dynamic' | 'fixed')}
            >
              <option value="dynamic">Dynamic</option>
              <option value="fixed">Fixed</option>
            </select>
          </div>
          {fundType === 'fixed' && (
            <div>
              <label className={fieldLabelClass}>Max shares (raw)</label>
              <input
                className={inputClass}
                type="number"
                value={maxShares}
                onChange={(e) => setMaxShares(e.target.value)}
                placeholder="1000000000"
              />
            </div>
          )}
        </div>

        <div className="border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <span className={`${sectionLabelClass} font-bold uppercase`}>Asset basket</span>
            <span
              className="font-mono text-[11px] tabular-nums"
              style={{ color: allocationTotalBps === 10_000 ? style.accent : '#A63A2B' }}
            >
              {allocationTotalPct}% / 100%
            </span>
          </div>

          {registryError && (
            <p className="px-4 py-3 font-mono text-xs text-destructive">
              <span className="mr-1 text-muted-foreground/50">&gt;</span>
              asset registry unavailable — {registryError}
            </p>
          )}
          {!registryError && activeAssets.length === 0 && (
            <p className="px-4 py-3 font-mono text-xs text-muted-foreground">
              <span className="mr-1 text-muted-foreground/50">&gt;</span>
              no active assets on {network} — list some under Admin → Create asset (same network)
            </p>
          )}

          <div
            role="tablist"
            aria-label="Asset basket slots"
            className="flex flex-wrap divide-x divide-border border-b border-border bg-foreground/[0.015]"
          >
            {rows.map((row, i) => {
              const entry = assetById.get(row.assetId);
              const active = i === activeRowIndex;
              const complete = row.assetId && Number(row.allocationPct) > 0;
              const tabColorClass = active
                ? 'text-background'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground';
              const label = entry ? assetLabel(entry) : row.assetId ? '…' : '—';

              return (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveRowIndex(i)}
                  className={`flex items-center gap-1.5 px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.06em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${tabColorClass}`}
                  style={active ? { background: style.accent } : undefined}
                >
                  <span
                    className={active ? '' : 'text-seal'}
                    style={!active && !complete ? { opacity: 0.5 } : undefined}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span>{label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setRows((prev) => [...prev, { ...EMPTY_ROW }]);
                setActiveRowIndex(rows.length);
              }}
              className="flex items-center px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.04] hover:text-foreground"
            >
              + Add
            </button>
          </div>

          <div className="divide-y divide-border">
            {rows.map((row, i) => {
              if (i !== activeRowIndex) return null;
              const entry = assetById.get(row.assetId);
              return (
                <div key={i} className="space-y-3 px-4 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs font-bold tracking-[0.08em] text-seal">
                      ASSET {String(i + 1).padStart(2, '0')}
                      {entry ? ` · ${assetLabel(entry)}` : ''}
                    </span>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setRows((prev) => {
                            const next = prev.filter((_, j) => j !== i);
                            setActiveRowIndex((cur) => Math.min(cur, next.length - 1));
                            return next;
                          })
                        }
                        className={btnGhostClass}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className={fieldLabelClass}>Token</label>
                      <select
                        className={selectClass}
                        value={row.assetId}
                        onChange={(e) => updateRow(i, { assetId: e.target.value })}
                        required
                        disabled={!!registryError || activeAssets.length === 0}
                      >
                        <option value="">— pick token —</option>
                        {activeAssets.map((a) => (
                          <option key={a.asset_id} value={a.asset_id}>
                            {formatAssetOption(a)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={fieldLabelClass}>Allocation (%)</label>
                      <input
                        className={inputClass}
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={row.allocationPct}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (/^\d*\.?\d{0,2}$/.test(v)) {
                            updateRow(i, { allocationPct: v });
                          }
                        }}
                        placeholder="100.00"
                        required
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {!connected && (
          <p className="rounded-[2px] border border-border bg-foreground/[0.03] px-3 py-2.5 font-mono text-xs text-muted-foreground">
            Connect your wallet to create a vault.
          </p>
        )}
        {connected && !uri.trim() && !imageUploading && (
          <p className="rounded-[2px] border border-border bg-foreground/[0.03] px-3 py-2.5 font-mono text-xs text-muted-foreground">
            Upload a vault image above before creating the vault.
          </p>
        )}

        <button
          type="submit"
          disabled={loading || imageUploading || (connected && !uri.trim())}
          className={btnPrimaryClass}
        >
          {loading
            ? (status ?? 'Processing…')
            : imageUploading
              ? 'Uploading image…'
              : connected
                ? 'Create ETF'
                : 'Connect wallet'}
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
    </section>
  );
}

function shortMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

/** Human-readable name from the asset registry, with mint fallback when unset. */
function assetLabel(entry: Pick<AssetRegistryEntry, 'asset_name' | 'mint'>): string {
  const name = entry.asset_name?.trim();
  return name || shortMint(entry.mint);
}

function formatAssetOption(a: AssetRegistryEntry): string {
  const name = a.asset_name?.trim();
  const mint = shortMint(a.mint);
  const title = name ? `${name} · ${mint}` : mint;
  return `#${a.asset_id} · ${title} (${a.decimals} dec, ${a.route})`;
}
