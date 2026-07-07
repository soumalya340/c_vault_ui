'use client';

import { useEffect, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

import {
  createEtf,
  deriveGlobalStatePda,
  getGlobalState,
  pythFeedAccount,
  vaultAssetAta,
  WSOL_MINT,
  type AssetParam,
  type Network,
} from '@/lib/cvault';
import { buildVaultAltAddresses, createVaultAlt } from '@/lib/alt';
import { fetchPoolCtx } from '@/lib/whirlpool';
import {
  fetchAllPoolsForMint,
  fetchPool,
  fetchPythInfo,
  fetchTokens,
  savePythInfo,
  saveVault,
  type PoolRecord,
  type TokenOption,
} from '@/lib/registryClient';
import { SECTION_STYLE } from './function-defs';
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  fieldLabelClass,
  inputClass,
  outputPanelClass,
  panelClass,
  sectionLabelClass,
  selectClass,
} from './ui-classes';

// Create ETF vault — create_etf.rs initialises the vault AND its Token-2022
// share metadata inside one instruction. Pool addresses come exclusively from
// the Supabase `orca_pools` table (no manual entry — Plan.md §4); pyth feed
// ids come from `PythInfo` with a manual fallback that is written back on
// success (Plan.md §5). After the vault lands, an Address Lookup Table with
// every swap-leg account is created and stored with the vault row (§6).

interface AssetDraft {
  mint: string;
  allocationBps: string;
  /** Derived from which pool is picked — base-mint pair ⇒ DirectUsdc, wSOL pair ⇒ ViaSol. */
  route: 'DirectUsdc' | 'ViaSol';
  /** Every orca_pools row that includes this token mint (either side). */
  tokenPools: PoolRecord[];
  poolAddress: string;
  poolLabel: string;
  poolMissing: boolean;
  /** From PythInfo when available; editable only when the registry misses. */
  pythFeedId: string;
  pythFromRegistry: boolean;
  looking: boolean;
}

const EMPTY_ASSET: AssetDraft = {
  mint: '',
  allocationBps: '',
  route: 'DirectUsdc',
  tokenPools: [],
  poolAddress: '',
  poolLabel: '',
  poolMissing: false,
  pythFeedId: '',
  pythFromRegistry: false,
  looking: false,
};

const ZERO_FEED_ID = '0'.repeat(64);
const WSOL = WSOL_MINT.toBase58();

// SOL isn't a row in the Supabase token registry — it's wrapped to wSOL by
// the vault's own swap legs once deposited, so it's offered here directly
// from constants.ts rather than requiring a registry entry.
const SOL_TOKEN_OPTION: TokenOption = {
  token_index: 'native-sol',
  mint: WSOL,
  symbol: 'SOL',
  name: 'Solana (wrapped to wSOL in-vault)',
  decimals: 9,
  uri: '',
};

function parseFeedId(hex: string): number[] {
  const clean = hex.trim().replace(/^0x/, '') || ZERO_FEED_ID;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('Price feed id must be 64 hex characters (or blank).');
  }
  return Array.from(Buffer.from(clean, 'hex'));
}

/**
 * DirectUsdc for a base-mint pair, ViaSol for a wSOL pair. A wSOL-native
 * slot is always ViaSol — it's filled by the base→wSOL leg itself, so it
 * needs `hasViaSol` to trigger that swap regardless of pool orientation.
 */
function routeForPool(pool: PoolRecord, baseMint: string, assetMint?: string): AssetDraft['route'] {
  if (assetMint === WSOL) return 'ViaSol';
  const isBasePair = pool.mint_a === baseMint || pool.mint_b === baseMint;
  return isBasePair ? 'DirectUsdc' : 'ViaSol';
}

/**
 * Pools valid for vault creation: token paired with the base mint or wSOL.
 * A wSOL-native slot (asset.mint === WSOL) always trades on the base/wSOL
 * pool itself — it has no separate "wSOL vs wSOL" pair to pick.
 */
function validPoolsForAsset(asset: AssetDraft, baseMint: string): PoolRecord[] {
  if (!asset.mint || !baseMint) return [];
  if (asset.mint === WSOL) {
    return asset.tokenPools.filter(
      (p) => p.mint_a === baseMint || p.mint_b === baseMint,
    );
  }
  return asset.tokenPools.filter(
    (p) =>
      p.mint_a === baseMint ||
      p.mint_b === baseMint ||
      p.mint_a === WSOL ||
      p.mint_b === WSOL,
  );
}

export function CreateEtfPanel({ network }: { network: Network }) {
  const style = SECTION_STYLE['vault-ops'];
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  const [tokens, setTokens] = useState<TokenOption[]>([]);
  const [tokensError, setTokensError] = useState<string | null>(null);

  const [eligibleBaseMints, setEligibleBaseMints] = useState<string[]>([]);
  const [baseMintsError, setBaseMintsError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [uri, setUri] = useState('');
  const [baseMint, setBaseMint] = useState('');
  const [feeRecipient, setFeeRecipient] = useState('');
  const [performanceFeeBps, setPerformanceFeeBps] = useState('1000');
  const [fundType, setFundType] = useState<'dynamic' | 'fixed'>('dynamic');
  const [maxShares, setMaxShares] = useState('');
  const [assets, setAssets] = useState<AssetDraft[]>([{ ...EMPTY_ASSET }]);

  // base/wSOL pool — auto-resolved, required when any asset routes ViaSol.
  const [solPool, setSolPool] = useState<{
    address: string;
    missing: boolean;
    looking: boolean;
  }>({ address: '', missing: false, looking: false });

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);

  useEffect(() => {
    fetchTokens()
      .then((rows) => {
        setTokens(rows);
        setTokensError(null);
      })
      .catch((err) =>
        setTokensError(err instanceof Error ? err.message : String(err)),
      );
  }, []);

  // Base mint options come from GlobalState.eligible_base_mints on-chain —
  // the company-approved list — not the full token registry.
  useEffect(() => {
    let cancelled = false;
    getGlobalState(connection)
      .then((gs) => {
        if (cancelled) return;
        setEligibleBaseMints(gs.eligibleBaseMints);
        setBaseMintsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setBaseMintsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  // Asset-basket token choices: registry tokens plus native SOL (wSOL).
  const assetTokenOptions = useMemo(
    () => [SOL_TOKEN_OPTION, ...tokens.filter((t) => t.mint !== WSOL)],
    [tokens],
  );

  const tokenByMint = useMemo(
    () => new Map(assetTokenOptions.map((t) => [t.mint, t])),
    [assetTokenOptions],
  );

  const baseMintOptions = useMemo(
    () =>
      eligibleBaseMints.map((mint) => {
        const token = tokenByMint.get(mint);
        return { mint, label: token ? `${token.symbol} · ${token.name}` : mint };
      }),
    [eligibleBaseMints, tokenByMint],
  );

  const symbolForMint = (mint: string) => tokenByMint.get(mint)?.symbol ?? mint;
  const baseMintSymbol = baseMint ? symbolForMint(baseMint) : '';

  const allocationTotal = assets.reduce(
    (sum, a) => sum + (Number(a.allocationBps) || 0),
    0,
  );

  const updateAsset = (index: number, patch: Partial<AssetDraft>) => {
    setAssets((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const hasViaSol = assets.some(
    (a) => a.route === 'ViaSol' || (a.mint && a.mint === WSOL),
  );

  // ── Supabase: all orca_pools rows for each token mint (Plan.md §3-4) ──
  const assetLookupKey = assets.map((a) => a.mint).join(',');
  useEffect(() => {
    let cancelled = false;
    assets.forEach((asset, i) => {
      if (!asset.mint) return;
      updateAsset(i, { looking: true, poolMissing: false });
      fetchAllPoolsForMint(asset.mint, network)
        .then((pools) => {
          if (cancelled) return;
          updateAsset(i, {
            looking: false,
            tokenPools: pools,
            poolMissing: pools.length === 0,
            poolAddress: '',
            poolLabel: '',
            route: 'DirectUsdc',
          });
        })
        .catch(() => {
          if (!cancelled) {
            updateAsset(i, {
              looking: false,
              tokenPools: [],
              poolAddress: '',
              poolLabel: '',
              poolMissing: true,
            });
          }
        });
      // Pyth id — keyed by mint only; manual entries are preserved.
      fetchPythInfo(asset.mint)
        .then((pyth) => {
          if (cancelled || !pyth) return;
          updateAsset(i, { pythFeedId: pyth.pyth_id, pythFromRegistry: true });
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetLookupKey, network]);

  // Auto-select when exactly one valid pool; clear stale picks when base mint changes.
  const poolSelectionKey = assets
    .map((a) => `${a.mint}:${a.tokenPools.map((p) => p.pool_address).join('|')}:${a.poolAddress}`)
    .join(';');
  useEffect(() => {
    if (!baseMint) return;
    assets.forEach((asset, i) => {
      const valid = validPoolsForAsset(asset, baseMint);
      if (valid.length === 1) {
        const picked = valid[0];
        if (asset.poolAddress === picked.pool_address) return;
        updateAsset(i, {
          poolAddress: picked.pool_address,
          poolLabel: `${picked.symbol_a}/${picked.symbol_b}`,
          route: routeForPool(picked, baseMint, asset.mint),
        });
        return;
      }
      if (
        asset.poolAddress &&
        !valid.some((p) => p.pool_address === asset.poolAddress)
      ) {
        updateAsset(i, {
          poolAddress: '',
          poolLabel: '',
          route: 'DirectUsdc',
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMint, poolSelectionKey]);

  // ── base/wSOL pool lookup (needed for any ViaSol routing) ──
  useEffect(() => {
    if (!baseMint || !hasViaSol) {
      setSolPool({ address: '', missing: false, looking: false });
      return;
    }
    let cancelled = false;
    setSolPool((s) => ({ ...s, looking: true, missing: false }));
    fetchPool(baseMint, WSOL, network)
      .then((pool) => {
        if (cancelled) return;
        setSolPool({ address: pool?.pool_address ?? '', missing: !pool, looking: false });
      })
      .catch(() => {
        if (!cancelled) setSolPool({ address: '', missing: true, looking: false });
      });
    return () => {
      cancelled = true;
    };
  }, [baseMint, hasViaSol, network]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !anchorWallet || !publicKey) {
      setVisible(true);
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      if (!baseMint) throw new Error('Pick a base mint.');
      if (assets.length === 0) throw new Error('Add at least one asset.');
      if (allocationTotal !== 10_000) {
        throw new Error(`Allocations must sum to 10000 BPS (currently ${allocationTotal}).`);
      }

      const assetParams: AssetParam[] = assets.map((draft, i) => {
        const token = tokenByMint.get(draft.mint);
        if (!token) throw new Error(`Asset ${i + 1}: pick a token from the registry.`);
        if (!draft.poolAddress) {
          throw new Error(
            `Asset ${i + 1} (${token.symbol}): no pool in orca_pools for this pair — ` +
              'pools cannot be entered manually. Create the pool first.',
          );
        }
        return {
          mint: new PublicKey(token.mint),
          poolAddress: new PublicKey(draft.poolAddress),
          pythFeedId: parseFeedId(draft.pythFeedId),
          allocationBps: Number(draft.allocationBps) || 0,
          decimals: token.decimals,
          route: draft.route === 'ViaSol' ? { viaSol: {} } : { directUsdc: {} },
        };
      });

      if (hasViaSol && !solPool.address) {
        throw new Error(
          'No base/wSOL pool in orca_pools — required when any asset routes ViaSol. ' +
            'Pools cannot be entered manually.',
        );
      }

      setStatus('Creating vault (create_etf)…');
      const created = await createEtf(
        connection,
        anchorWallet,
        new PublicKey(baseMint),
        {
          feeRecipient: feeRecipient.trim() ? new PublicKey(feeRecipient.trim()) : null,
          performanceFeeBps: Number(performanceFeeBps) || 0,
          usdcSolPool: solPool.address ? new PublicKey(solPool.address) : null,
          assets: assetParams,
          fundType: fundType === 'fixed' ? { fixed: {} } : { dynamic: {} },
          maxShares: maxShares.trim() ? new BN(maxShares.trim()) : null,
        },
        name,
        symbol,
        uri,
        network,
      );

      // Record manually supplied pyth ids so the next lookup finds them (§5).
      for (const draft of assets) {
        const feedId = draft.pythFeedId.trim().replace(/^0x/, '');
        if (!draft.pythFromRegistry && feedId && feedId !== ZERO_FEED_ID) {
          const token = tokenByMint.get(draft.mint);
          try {
            await savePythInfo({
              token_name: token?.symbol ?? draft.mint,
              pyth_id: feedId,
              mint_address: draft.mint,
            });
          } catch {
            // non-fatal — the vault row still records the feed id
          }
        }
      }

      // Build the vault's ALT: every account the swap legs touch (§6).
      let altAddress: string | null = null;
      let altNote = '';
      try {
        setStatus('Creating address lookup table…');
        const poolAddrs = Array.from(
          new Set(
            [...assetParams.map((a) => a.poolAddress.toBase58()), solPool.address].filter(Boolean),
          ),
        );
        const poolCtxs = await Promise.all(
          poolAddrs.map((p) => fetchPoolCtx(connection, new PublicKey(p))),
        );
        const assetMints = assetParams.map((a) => a.mint);
        const ataMints = hasViaSol && !assetMints.some((m) => m.equals(WSOL_MINT))
          ? [...assetMints, WSOL_MINT]
          : assetMints;
        const priceFeeds = assetParams
          .filter((a) => a.pythFeedId.some((b) => b !== 0))
          .map((a) => pythFeedAccount(a.pythFeedId));

        const lut = await createVaultAlt(
          connection,
          anchorWallet,
          buildVaultAltAddresses({
            globalState: deriveGlobalStatePda(),
            vaultPda: created.vaultPda,
            vaultAuthority: created.vaultAuthority,
            sharesMint: created.sharesMint,
            usdcVault: created.usdcVault,
            baseMint: new PublicKey(baseMint),
            assetMints,
            vaultAssetAtas: ataMints.map((m) => vaultAssetAta(created.vaultAuthority, m)),
            priceFeeds,
            pools: poolCtxs,
          }),
        );
        altAddress = lut.toBase58();
      } catch (err) {
        altNote = `\n\nALT creation failed (deposits fall back to static keys): ${
          err instanceof Error ? err.message : String(err)
        }`;
      }

      // Record the vault in Supabase — the Vaults tab reads only from there.
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
          base_mint: baseMint,
          name,
          symbol,
          uri,
          fee_recipient: feeRecipient.trim() || publicKey.toBase58(),
          performance_fee_bps: Number(performanceFeeBps) || 0,
          fund_type: fundType,
          max_shares: maxShares.trim() || null,
          usdc_sol_pool: solPool.address || null,
          assets: assets.map((draft, i) => ({
            mint: assetParams[i].mint.toBase58(),
            pool_address: assetParams[i].poolAddress.toBase58(),
            allocation_bps: assetParams[i].allocationBps,
            decimals: assetParams[i].decimals,
            route: draft.route,
            pyth_feed_id: draft.pythFeedId.trim().replace(/^0x/, '') || ZERO_FEED_ID,
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
        solscan: created.link,
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
          Pool choices list every base-mint or SOL pair from orca_pools for
          each token — a token with no pool blocks creation; pyth feed ids
          resolve from PythInfo with manual fallback. The vault&apos;s swap
          lookup table is created right after create_etf.
        </p>

        {/* ── Share metadata ── */}
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

        {/* ── Vault config ── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={fieldLabelClass}>Base mint (from GlobalState)</label>
            <select
              className={selectClass}
              value={baseMint}
              onChange={(e) => setBaseMint(e.target.value)}
              required
            >
              <option value="">— pick base token —</option>
              {baseMintOptions.map((o) => (
                <option key={o.mint} value={o.mint}>
                  {o.label}
                </option>
              ))}
            </select>
            {baseMintsError && (
              <p className="mt-1 font-mono text-[11px] text-destructive">
                eligible base mints unavailable — {baseMintsError}
              </p>
            )}
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
            <label className={fieldLabelClass}>Performance fee (BPS)</label>
            <input
              className={inputClass}
              type="number"
              value={performanceFeeBps}
              onChange={(e) => setPerformanceFeeBps(e.target.value)}
              placeholder="1000"
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
            <div>
              <label className={fieldLabelClass}>Base/wSOL pool (auto)</label>
              <p className="mt-1 break-all font-mono text-[11px] leading-relaxed">
                {solPool.looking && <span className="text-muted-foreground">looking up…</span>}
                {!solPool.looking && solPool.address && (
                  <span className="text-foreground">{solPool.address}</span>
                )}
                {!solPool.looking && solPool.missing && (
                  <span className="text-destructive">
                    {baseMintSymbol}/SOL pool does not exist — required for ViaSol routing
                  </span>
                )}
                {!solPool.looking && !solPool.address && !solPool.missing && (
                  <span className="text-muted-foreground">pick a base mint first</span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* ── Asset basket ── */}
        <div className="border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <span className={`${sectionLabelClass} font-bold uppercase`}>Asset basket</span>
            <span
              className="font-mono text-[11px] tabular-nums"
              style={{ color: allocationTotal === 10_000 ? style.accent : '#A63A2B' }}
            >
              {allocationTotal} / 10000 BPS
            </span>
          </div>

          {tokensError && (
            <p className="px-4 py-3 font-mono text-xs text-destructive">
              <span className="mr-1 text-muted-foreground/50">&gt;</span>
              token registry unavailable — {tokensError}
            </p>
          )}

          <div className="divide-y divide-border">
            {assets.map((asset, i) => {
              const token = tokenByMint.get(asset.mint);
              return (
                <div key={i} className="space-y-3 px-4 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs font-bold tracking-[0.08em] text-seal">
                      ASSET {String(i + 1).padStart(2, '0')}
                      {token ? ` · ${token.symbol}` : ''}
                    </span>
                    {assets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setAssets((prev) => prev.filter((_, j) => j !== i))}
                        className={btnGhostClass}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className={fieldLabelClass}>Token</label>
                      <select
                        className={selectClass}
                        value={asset.mint}
                        onChange={(e) =>
                          updateAsset(i, {
                            mint: e.target.value,
                            tokenPools: [],
                            poolAddress: '',
                            poolLabel: '',
                            poolMissing: false,
                            pythFeedId: '',
                            pythFromRegistry: false,
                            route: 'DirectUsdc',
                          })
                        }
                        required
                      >
                        <option value="">— pick token —</option>
                        {assetTokenOptions.map((t) => (
                          <option key={t.mint} value={t.mint}>
                            {t.symbol} · {t.name} ({t.decimals} dec)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={fieldLabelClass}>Allocation (BPS)</label>
                      <input
                        className={inputClass}
                        type="number"
                        value={asset.allocationBps}
                        onChange={(e) => updateAsset(i, { allocationBps: e.target.value })}
                        placeholder="10000"
                        required
                      />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className={fieldLabelClass}>
                        Pool (from orca_pools — base mint or SOL pair)
                      </label>
                      {asset.looking && (
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">looking up…</p>
                      )}
                      {!asset.looking && !asset.mint && (
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          pick a token first
                        </p>
                      )}
                      {!asset.looking && asset.mint && !baseMint && asset.tokenPools.length > 0 && (
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {asset.tokenPools.length} pool
                          {asset.tokenPools.length === 1 ? '' : 's'} in orca_pools — pick a base
                          mint above to choose route
                        </p>
                      )}
                      {!asset.looking && asset.mint && !baseMint && asset.tokenPools.length === 0 && (
                        <p className="mt-1 font-mono text-[11px] text-destructive">
                          {token?.symbol ?? 'token'}/SOL pool does not exist — no pool for{' '}
                          {token?.symbol ?? 'this token'} in orca_pools
                        </p>
                      )}
                      {!asset.looking && asset.mint && baseMint && (() => {
                        const validPools = validPoolsForAsset(asset, baseMint);
                        if (validPools.length === 0) {
                          const sym = token?.symbol ?? 'token';
                          return (
                            <p className="mt-1 font-mono text-[11px] text-destructive">
                              {baseMintSymbol}/{sym} pool does not exist, and {sym}/SOL pool
                              does not exist — create one in orca_pools before this vault can exist
                            </p>
                          );
                        }
                        return (
                          <>
                            <select
                              className={selectClass}
                              value={asset.poolAddress}
                              onChange={(e) => {
                                const pool = validPools.find(
                                  (p) => p.pool_address === e.target.value,
                                );
                                updateAsset(i, {
                                  poolAddress: pool?.pool_address ?? '',
                                  poolLabel: pool ? `${pool.symbol_a}/${pool.symbol_b}` : '',
                                  route: pool ? routeForPool(pool, baseMint, asset.mint) : asset.route,
                                });
                              }}
                              required
                            >
                              <option value="">— pick pool —</option>
                              {validPools.map((p) => (
                                <option key={p.pool_address} value={p.pool_address}>
                                  {p.symbol_a}/{p.symbol_b} · {routeForPool(p, baseMint, asset.mint)} ·{' '}
                                  {p.pool_address.slice(0, 4)}…{p.pool_address.slice(-4)}
                                </option>
                              ))}
                            </select>
                            {asset.poolAddress && (
                              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                Route: {asset.route}
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className={fieldLabelClass}>
                        Price feed id{' '}
                        {asset.pythFromRegistry
                          ? '(from PythInfo — read-only)'
                          : '(not in PythInfo — enter manually, it will be saved)'}
                      </label>
                      <input
                        className={inputClass}
                        value={asset.pythFeedId}
                        onChange={(e) =>
                          updateAsset(i, { pythFeedId: e.target.value, pythFromRegistry: false })
                        }
                        placeholder="64 hex chars — blank = zeroed feed id"
                        readOnly={asset.pythFromRegistry}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => setAssets((prev) => [...prev, { ...EMPTY_ASSET }])}
              className={btnSecondaryClass}
            >
              + Add asset
            </button>
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
