'use client';

import { useEffect, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

import { createEtf, type AssetParam, type Network } from '@/lib/cvault';
import { fetchTokens, saveVault, type TokenOption } from '@/lib/registryClient';
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
// share metadata inside one instruction, so this panel is a single combined
// flow: one form, one signature, one transaction. Assets are picked from the
// forge token_registry (nothing hardcoded); after the transaction lands, the
// vault row is recorded in the Supabase `vaults` table.

interface AssetDraft {
  mint: string; // token_registry mint (select)
  poolAddress: string;
  allocationBps: string;
  route: 'DirectUsdc' | 'ViaSol';
  pythFeedId: string; // optional 64-char hex
}

const EMPTY_ASSET: AssetDraft = {
  mint: '',
  poolAddress: '',
  allocationBps: '',
  route: 'DirectUsdc',
  pythFeedId: '',
};

const ZERO_FEED_ID = '0'.repeat(64);

function parseFeedId(hex: string): number[] {
  const clean = hex.trim().replace(/^0x/, '') || ZERO_FEED_ID;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('Price feed id must be 64 hex characters (or blank).');
  }
  return Array.from(Buffer.from(clean, 'hex'));
}

export function CreateEtfPanel({ network }: { network: Network }) {
  const style = SECTION_STYLE['vault-ops'];
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  const [tokens, setTokens] = useState<TokenOption[]>([]);
  const [tokensError, setTokensError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [uri, setUri] = useState('');
  const [baseMint, setBaseMint] = useState('');
  const [feeRecipient, setFeeRecipient] = useState('');
  const [performanceFeeBps, setPerformanceFeeBps] = useState('1000');
  const [fundType, setFundType] = useState<'dynamic' | 'fixed'>('dynamic');
  const [maxShares, setMaxShares] = useState('');
  const [usdcSolPool, setUsdcSolPool] = useState('');
  const [assets, setAssets] = useState<AssetDraft[]>([{ ...EMPTY_ASSET }]);

  const [loading, setLoading] = useState(false);
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

  const tokenByMint = useMemo(
    () => new Map(tokens.map((t) => [t.mint, t])),
    [tokens],
  );

  const allocationTotal = assets.reduce(
    (sum, a) => sum + (Number(a.allocationBps) || 0),
    0,
  );

  const updateAsset = (index: number, patch: Partial<AssetDraft>) => {
    setAssets((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

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
        if (!draft.poolAddress.trim()) {
          throw new Error(`Asset ${i + 1} (${token.symbol}): pool address is required.`);
        }
        return {
          mint: new PublicKey(token.mint),
          poolAddress: new PublicKey(draft.poolAddress.trim()),
          pythFeedId: parseFeedId(draft.pythFeedId),
          allocationBps: Number(draft.allocationBps) || 0,
          decimals: token.decimals,
          route: draft.route === 'ViaSol' ? { viaSol: {} } : { directUsdc: {} },
        };
      });

      const needsSolPool = assets.some((a) => a.route === 'ViaSol');
      if (needsSolPool && !usdcSolPool.trim()) {
        throw new Error('A base/wSOL pool is required when any asset routes ViaSol.');
      }

      const created = await createEtf(
        connection,
        anchorWallet,
        new PublicKey(baseMint),
        {
          feeRecipient: feeRecipient.trim() ? new PublicKey(feeRecipient.trim()) : null,
          performanceFeeBps: Number(performanceFeeBps) || 0,
          usdcSolPool: usdcSolPool.trim() ? new PublicKey(usdcSolPool.trim()) : null,
          assets: assetParams,
          fundType: fundType === 'fixed' ? { fixed: {} } : { dynamic: {} },
          maxShares: maxShares.trim() ? new BN(maxShares.trim()) : null,
        },
        name,
        symbol,
        uri,
        network,
      );

      // Record the vault in Supabase — the Vaults tab reads only from there.
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
          usdc_sol_pool: usdcSolPool.trim() || null,
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
          `shares mint: ${created.sharesMint.toBase58()}${registryNote}`,
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
          vault + share metadata · one transaction
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 px-5 py-5 md:px-6">
        <p
          className="border-l-2 py-0.5 pl-3 text-sm leading-[1.55] text-muted-foreground"
          style={{ borderColor: `${style.accent}44` }}
        >
          create_etf initialises the vault and its Token-2022 share metadata in a
          single instruction. Assets are sourced from the forge token registry.
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
            <label className={fieldLabelClass}>Base mint (from registry)</label>
            <select
              className={selectClass}
              value={baseMint}
              onChange={(e) => setBaseMint(e.target.value)}
              required
            >
              <option value="">— pick base token —</option>
              {tokens.map((t) => (
                <option key={t.mint} value={t.mint}>
                  {t.symbol} · {t.name}
                </option>
              ))}
            </select>
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
          <div>
            <label className={fieldLabelClass}>Base/wSOL pool (ViaSol only)</label>
            <input
              className={inputClass}
              value={usdcSolPool}
              onChange={(e) => setUsdcSolPool(e.target.value)}
              placeholder="Whirlpool address"
            />
          </div>
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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className={fieldLabelClass}>Token</label>
                      <select
                        className={selectClass}
                        value={asset.mint}
                        onChange={(e) => updateAsset(i, { mint: e.target.value })}
                        required
                      >
                        <option value="">— pick token —</option>
                        {tokens.map((t) => (
                          <option key={t.mint} value={t.mint}>
                            {t.symbol} · {t.name} ({t.decimals} dec)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={fieldLabelClass}>Pool address</label>
                      <input
                        className={inputClass}
                        value={asset.poolAddress}
                        onChange={(e) => updateAsset(i, { poolAddress: e.target.value })}
                        placeholder="Whirlpool address"
                        required
                      />
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
                    <div>
                      <label className={fieldLabelClass}>Route</label>
                      <select
                        className={selectClass}
                        value={asset.route}
                        onChange={(e) =>
                          updateAsset(i, { route: e.target.value as 'DirectUsdc' | 'ViaSol' })
                        }
                      >
                        <option value="DirectUsdc">DirectUsdc</option>
                        <option value="ViaSol">ViaSol</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4">
                      <label className={fieldLabelClass}>Price feed id (hex, optional)</label>
                      <input
                        className={inputClass}
                        value={asset.pythFeedId}
                        onChange={(e) => updateAsset(i, { pythFeedId: e.target.value })}
                        placeholder="64 hex chars — blank = zeroed feed id"
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
          {loading ? 'Processing…' : connected ? 'Create ETF' : 'Connect wallet'}
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
