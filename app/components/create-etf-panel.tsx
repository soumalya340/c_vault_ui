'use client';

import { useEffect, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

import {
  createEtf,
  deriveGlobalStatePda,
  pythFeedAccount,
  vaultAssetAta,
  WSOL_MINT,
  USDC_MINT,
  PRICE_SOURCE_PYTH,
  PRICE_SOURCE_DEX,
  type Network,
} from '@/lib/cvault';
import { buildVaultAltAddresses, createVaultAlt } from '@/lib/alt';
import { fetchPoolCtx } from '@/lib/whirlpool';
import { fetchDammPoolCtx } from '@/lib/damm';
import {
  fetchAssetRegistry,
  saveVault,
  type AssetRegistryEntry,
} from '@/lib/registryClient';
import { SECTION_STYLE } from './function-defs';
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

const USDC = USDC_MINT.toBase58();

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

  const [registry, setRegistry] = useState<AssetRegistryEntry[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [uri, setUri] = useState('');
  const [feeRecipient, setFeeRecipient] = useState('');
  const [depositFeeBps, setDepositFeeBps] = useState('0');
  const [redeemFeeBps, setRedeemFeeBps] = useState('100');
  const [fundType, setFundType] = useState<'dynamic' | 'fixed'>('dynamic');
  const [maxShares, setMaxShares] = useState('');
  const [rows, setRows] = useState<AssetRow[]>([{ ...EMPTY_ROW }]);
  const [activeRowIndex, setActiveRowIndex] = useState(0);

  // USDC/wSOL pool — required when any picked asset routes ViaSol. Free-form address.
  const [solPool, setSolPool] = useState('');

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);

  useEffect(() => {
    if (network !== 'devnet') return;
    let cancelled = false;
    fetchAssetRegistry()
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
    () => (network === 'devnet' ? registry.filter((a) => a.active) : []),
    [registry, network],
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !anchorWallet || !publicKey) {
      setVisible(true);
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

      if (hasViaSol && !solPool.trim()) {
        throw new Error('USDC/wSOL pool address is required when any asset routes ViaSol.');
      }

      setStatus('Creating vault (create_etf)…');
      const created = await createEtf(
        connection,
        anchorWallet,
        {
          feeRecipient: feeRecipient.trim() ? new PublicKey(feeRecipient.trim()) : null,
          depositFeeBps: Number(depositFeeBps) || 0,
          redeemFeeBps: Number(redeemFeeBps) || 0,
          usdcSolPool: solPool.trim() ? new PublicKey(solPool.trim()) : null,
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
        if (solPool.trim()) {
          whirlpoolAddrs.push(new PublicKey(solPool.trim()));
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

        const lut = await createVaultAlt(
          connection,
          anchorWallet,
          buildVaultAltAddresses({
            globalState: deriveGlobalStatePda(),
            vaultPda: created.vaultPda,
            vaultAuthority: created.vaultAuthority,
            sharesMint: created.sharesMint,
            usdcVault: created.usdcVault,
            baseMint: USDC_MINT,
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
        altNote = `\n\nALT creation failed (deposits fall back to static keys): ${
          err instanceof Error ? err.message : String(err)
        }`;
      }

      setStatus('Recording vault…');
      let registryNote = '';
      try {
        await saveVault({
          vault_address: created.vaultPda.toBase58(),
          vault_id: created.vaultId,
          network,
          vault_authority: created.vaultAuthority.toBase58(),
          shares_mint: created.sharesMint.toBase58(),
          usdc_vault: created.usdcVault.toBase58(),
          base_mint: USDC,
          name,
          symbol,
          uri,
          fee_recipient: feeRecipient.trim() || publicKey.toBase58(),
          performance_fee_bps: Number(redeemFeeBps) || 0,
          fund_type: fundType,
          max_shares: maxShares.trim() || null,
          usdc_sol_pool: solPool.trim() || null,
          assets: picked.map((p) => ({
            mint: p.entry.mint,
            pool_address: p.entry.pool_address,
            allocation_bps: p.allocationBps,
            decimals: p.entry.decimals,
            route: p.entry.route,
            pyth_feed_id: p.entry.pyth_feed_id,
          })),
          creator: publicKey.toBase58(),
          tx_signature: created.tx,
          alt_address: altAddress,
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
          `lookup table: ${altAddress ?? '— (creation failed)'}${altNote}${registryNote}`,
        solscan: created.tx ? created.link : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRejection =
        msg.toLowerCase().includes('user rejected') ||
        msg.toLowerCase().includes('rejected the request');
      setResult({
        type: isRejection ? 'info' : 'error',
        text: isRejection ? 'Transaction cancelled.' : msg,
      });
    } finally {
      setStatus(null);
      setLoading(false);
    }
  };

  return (
    <section aria-label="Create ETF vault" className={`${panelClass} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-5 py-3.5 md:px-6">
        <span
          className="font-display text-base font-semibold uppercase tracking-[0.18em]"
          style={{ color: style.accent }}
        >
          <span className="mr-3 font-mono text-xs font-bold tracking-[0.08em] text-seal">№ 01</span>
          Create ETF vault
        </span>
        <span className={`${sectionLabelClass} uppercase`}>
          vault + share metadata + lookup table
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={fieldLabelClass}>Share name</label>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="cVault Shares"
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
              required
            />
          </div>
          <div>
            <label className={fieldLabelClass}>Metadata URI</label>
            <input
              className={inputClass}
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="https://…"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={fieldLabelClass}>Base / quote mint</label>
            <input className={inputClass} value={`USDC · ${USDC}`} readOnly />
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              Program constant — mainnet USDC only
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
          {hasViaSol && (
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={fieldLabelClass}>USDC/wSOL pool (any address)</label>
              <input
                className={inputClass}
                value={solPool}
                onChange={(e) => setSolPool(e.target.value)}
                placeholder="Whirlpool USDC↔wSOL pool address"
                required
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

          {network !== 'devnet' && (
            <p className="px-4 py-3 font-mono text-xs text-muted-foreground">
              <span className="mr-1 text-muted-foreground/50">&gt;</span>
              asset picker is devnet-only for now — switch network to pick assets
            </p>
          )}
          {network === 'devnet' && registryError && (
            <p className="px-4 py-3 font-mono text-xs text-destructive">
              <span className="mr-1 text-muted-foreground/50">&gt;</span>
              asset registry unavailable — {registryError}
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
              const label = entry ? shortMint(entry.mint) : row.assetId ? '…' : '—';

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
                      {entry ? ` · ${shortMint(entry.mint)}` : ''}
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
                        disabled={network !== 'devnet'}
                      >
                        <option value="">— pick token —</option>
                        {activeAssets.map((a) => (
                          <option key={a.asset_id} value={a.asset_id}>
                            #{a.asset_id} · {shortMint(a.mint)} ({a.decimals} dec, {a.route})
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

        <button type="submit" disabled={loading} className={btnPrimaryClass}>
          {loading ? (status ?? 'Processing…') : connected ? 'Create ETF' : 'Connect wallet'}
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
    </section>
  );
}

function shortMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}
