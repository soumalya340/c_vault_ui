'use client';

import { useEffect, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

import {
  assertCreateEtfMetadata,
  createEtf,
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
import { CREATE_ETF_MAX_METADATA_BYTES } from '@/lib/constants';
import { buildVaultAltAddresses, createVaultAlt } from '@/lib/alt';
import { fetchPoolCtx } from '@/lib/whirlpool';
import { fetchDammPoolCtx } from '@/lib/damm';
import {
  fetchAssetRegistry,
  saveVault,
  type AssetRegistryEntry,
} from '@/lib/registryClient';
import { parseTxError, type UserFacingError } from '@/lib/txError';
import { ErrorModal } from './error-modal';
import { LedgerOutput } from './ledger-output';
import { showVaultOpsToast } from './vault-ops-toast';

interface AssetRow {
  assetId: string;
  allocationPct: string;
}

const EMPTY_ROW: AssetRow = { assetId: '', allocationPct: '' };

function pctToBps(pct: string): number {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function shortMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

function assetLabel(entry: Pick<AssetRegistryEntry, 'asset_name' | 'mint'>): string {
  return entry.asset_name?.trim() || shortMint(entry.mint);
}

function formatAssetOption(a: AssetRegistryEntry): string {
  const name = a.asset_name?.trim();
  const mint = shortMint(a.mint);
  const title = name ? `${name} · ${mint}` : mint;
  return `#${a.asset_id} · ${title}`;
}

function SectionDivider({
  title,
  side,
}: {
  title: string;
  side: string;
}) {
  return (
    <div className="mb-5 mt-7 flex min-w-0 items-center gap-3.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.26em] text-foreground">
        {title}
      </span>
      <span className="h-px min-w-4 flex-1 bg-border" />
      <span className="min-w-0 truncate font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        {side}
      </span>
    </div>
  );
}

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
  readOnly,
  maxLength,
  style,
  required,
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  maxLength?: number;
  style?: React.CSSProperties;
  required?: boolean;
}) {
  return (
    <input
      className="h-11 w-full border border-border-strong bg-background px-3.5 font-mono text-sm text-foreground transition-[color,background-color,border-color,box-shadow] duration-[250ms] placeholder:text-muted-foreground/60 hover:border-foreground/40 focus:border-foreground focus:bg-background focus:outline-none focus:shadow-[3px_3px_0_rgba(23,37,28,0.1)] disabled:cursor-default disabled:opacity-70"
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      placeholder={placeholder}
      readOnly={readOnly}
      maxLength={maxLength}
      style={style}
      required={required}
    />
  );
}

function FeeControl({
  value,
  onChange,
  minBps = 0,
  maxBps,
}: {
  value: string;
  onChange: (v: string) => void;
  minBps?: number;
  maxBps: number;
}) {
  const bps = Number(value) || 0;
  const pct = bps / 100;
  const minPct = minBps / 100;
  const maxPct = maxBps / 100;

  const setFromPct = (pctStr: string) => {
    const n = Number(pctStr);
    if (!Number.isFinite(n)) {
      onChange('');
      return;
    }
    const clamped = Math.min(maxBps, Math.max(minBps, Math.round(n * 100)));
    onChange(String(clamped));
  };

  return (
    <div className="flex h-11 items-center gap-3 border border-border-strong bg-foreground/[0.03] px-3 transition-colors focus-within:border-foreground">
      <input
        type="number"
        min={minPct}
        max={maxPct}
        step={0.01}
        value={pct}
        onChange={(e) => setFromPct(e.target.value)}
        className="w-14 border-0 bg-transparent text-right font-mono text-sm text-foreground focus:outline-none"
      />
      <input
        type="range"
        min={minBps}
        max={maxBps}
        value={bps}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 accent-seal h-0.5 cursor-pointer"
      />
      <span className="min-w-[52px] text-right font-mono text-[10px] font-medium text-seal">
        {pct.toFixed(2)}%
      </span>
    </div>
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

const TOKEN_COLORS: Record<string, string> = {
  SOL: '#356049',
  JUP: '#A23E2A',
  JTO: '#7E5CC9',
  PYTH: '#B98A2F',
  RAY: '#3E6FA2',
  MSOL: '#2F8F83',
  BONK: '#C96A2F',
  WIF: '#8A6D3B',
  ORCA: '#5B8C5A',
  USDT: '#4B5D50',
};

function tokenColor(symbol: string): string {
  return TOKEN_COLORS[symbol] ?? '#C9C8B6';
}

export function VaultOpsCreatePanel({ network }: { network: Network }) {
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
  const [feeRecipient, setFeeRecipient] = useState('');
  const [depositFeeBps, setDepositFeeBps] = useState('0');
  const [redeemFeeBps, setRedeemFeeBps] = useState('100');
  const [fundType, setFundType] = useState<'dynamic' | 'fixed'>('dynamic');
  const [maxShares, setMaxShares] = useState('');
  const [rows, setRows] = useState<AssetRow[]>([{ ...EMPTY_ROW }]);

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

  const activeAssets = useMemo(() => registry.filter((a) => a.active), [registry]);
  const assetById = useMemo(() => new Map(registry.map((a) => [a.asset_id, a])), [registry]);

  const allocationTotalBps = rows.reduce((sum, r) => sum + pctToBps(r.allocationPct), 0);
  const allocationTotalPct = (allocationTotalBps / 100).toFixed(2);

  const updateRow = (index: number, patch: Partial<AssetRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const hasViaSol = rows.some((r) => assetById.get(r.assetId)?.route === 'ViaSol');

  const basketDone =
    Math.abs(allocationTotalBps - 10_000) < 0.001 && rows.length > 0 && rows.every((r) => r.assetId);
  const canCreate = basketDone && name.trim() && symbol.trim() && uri.trim();

  const handleCopyMint = () => {
    const v = usdcBase58;
    if (navigator.clipboard) navigator.clipboard.writeText(v);
    showVaultOpsToast('USDC MINT COPIED');
  };

  const handleAddAsset = () => {
    if (rows.length >= 8) {
      showVaultOpsToast('MAX 8 ASSETS PER VAULT');
      return;
    }
    const remaining = Math.max(0, 10000 - allocationTotalBps) / 100;
    setRows((prev) => [...prev, { assetId: '', allocationPct: remaining.toFixed(2) }]);
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

      // Fail fast on data:image base64 / oversize metadata (static-tx packet limit).
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
      showVaultOpsToast('INSTRUCTION QUEUED · CREATE ETF VAULT');
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

  const copyButton = (
    <button
      type="button"
      onClick={handleCopyMint}
      className="absolute right-1.5 top-1.5 bottom-1.5 border border-border-strong bg-background px-3 font-mono text-[8.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
    >
      Copy
    </button>
  );

  return (
    <section className="border border-border-strong bg-background p-1.5 opacity-0 translate-y-6 transition-all duration-700 ease-[cubic-bezier(.22,1,.36,1)] data-[in=true]:opacity-100 data-[in=true]:translate-y-0"
      data-in="true"
    >
      {errorOpen && lastError && (
        <ErrorModal
          error={lastError}
          onClose={() => setErrorOpen(false)}
          network={network}
        />
      )}

      <div className="border border-border">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-6 py-4">
          <div className="flex min-w-0 items-baseline gap-3 font-display text-lg font-semibold uppercase tracking-[0.14em] text-seal">
            <span className="font-mono text-[11px] font-semibold tracking-[0.1em]">№ 01</span>
            Create ETF Vault
          </div>
          <span className="min-w-0 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Vault + share metadata + lookup table
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6">
          <p className="border-l-2 border-seal/30 py-0.5 pl-4 text-sm leading-relaxed text-foreground/80">
            Quote mint is mainnet USDC. Assets are picked from the admin-approved
            registry — pool, route, price source, and swap venue are already set
            per asset; only the weighting is chosen here.
          </p>

          <SectionDivider title="Share metadata" side="A · identity" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <FieldLabel>Share name</FieldLabel>
              <TextInput
                value={name}
                onChange={setName}
                placeholder="cVault Shares"
                maxLength={32}
                required
              />
            </div>
            <div>
              <FieldLabel>Share symbol</FieldLabel>
              <TextInput
                value={symbol}
                onChange={setSymbol}
                placeholder="CVS"
                maxLength={10}
                style={{ textTransform: 'uppercase' }}
                required
              />
            </div>
            <div>
              <FieldLabel>Metadata URI</FieldLabel>
              <TextInput
                value={uri}
                onChange={setUri}
                placeholder="https://arweave.net/… or https://…"
                maxLength={CREATE_ETF_MAX_METADATA_BYTES}
                required
              />
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground/80">
                Short https link only — no base64 <span className="font-mono">data:</span> images.
                Name + symbol + URI max {CREATE_ETF_MAX_METADATA_BYTES} bytes total.
              </p>
            </div>
          </div>

          <SectionDivider title="Economics" side="B · fees in %" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <FieldLabel>Deposit fee (%)</FieldLabel>
              <FeeControl value={depositFeeBps} onChange={setDepositFeeBps} maxBps={600} />
            </div>
            <div>
              <FieldLabel>Redeem fee (%)</FieldLabel>
              <FeeControl value={redeemFeeBps} onChange={setRedeemFeeBps} minBps={50} maxBps={1000} />
            </div>
            <div>
              <FieldLabel>
                Fee recipient <span className="font-normal text-muted-foreground">(blank = you)</span>
              </FieldLabel>
              <TextInput
                value={feeRecipient}
                onChange={setFeeRecipient}
                placeholder="Connected wallet"
              />
            </div>
          </div>

          <SectionDivider title="Fund configuration" side="C · constants" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Base / quote mint</FieldLabel>
              <div className="relative">
                <TextInput value={`USDC · ${usdcBase58}`} readOnly />
                {copyButton}
              </div>
              <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                Program constant — Circle USDC (EPjF…) on every network
              </p>
            </div>
            <div>
              <FieldLabel>Fund type</FieldLabel>
              <Segmented
                options={[
                  { label: 'Dynamic', value: 'dynamic' },
                  { label: 'Static', value: 'fixed' },
                ]}
                value={fundType}
                onChange={(v) => setFundType(v as 'dynamic' | 'fixed')}
              />
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground/80">
                Dynamic funds rebalance; static funds lock the genesis weights
              </p>
              {fundType === 'fixed' && (
                <div className="mt-3">
                  <FieldLabel>Max shares (raw)</FieldLabel>
                  <TextInput value={maxShares} onChange={setMaxShares} placeholder="1000000000" />
                </div>
              )}
            </div>
          </div>

          <div className="border border-border-strong">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-foreground/[0.03] px-5 py-3.5">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground">
                Asset basket
              </span>
              <span
                className={`font-mono text-[11px] tabular-nums transition-colors ${
                  basketDone ? 'text-moss' : 'text-seal'
                }`}
              >
                {allocationTotalPct}% / 100%
              </span>
            </div>

            <div className="h-[3px] bg-border overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  basketDone ? 'bg-moss' : 'bg-seal'
                }`}
                style={{ width: `${Math.min(allocationTotalBps / 100, 100)}%` }}
              />
            </div>

            {registryError && (
              <p className="px-5 py-3 font-mono text-xs text-destructive">
                Asset registry unavailable — {registryError}
              </p>
            )}
            {!registryError && activeAssets.length === 0 && (
              <p className="px-5 py-3 font-mono text-xs text-muted-foreground">
                No active assets on {network} — list some under Admin → Create asset.
              </p>
            )}

            <div className="divide-y divide-border">
              {rows.map((row, i) => {
                const entry = assetById.get(row.assetId);
                const symbol = entry ? assetLabel(entry) : '';
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[44px_minmax(0,1fr)_40px] grid-rows-[auto_auto] items-center gap-x-3 gap-y-2.5 px-4 py-3.5 animate-[slidein_0.45s_ease] sm:grid-cols-[52px_minmax(200px,1.2fr)_minmax(180px,1fr)_120px_40px] sm:grid-rows-1 sm:gap-4 sm:px-5 sm:py-4"
                  >
                    {/* Mockup grid: idx | token select | range | % number | remove */}
                    <span className="flex h-[30px] items-center justify-center bg-seal font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-background">
                      {String(i + 1).padStart(2, '0')}
                    </span>

                    <div className="relative min-w-0">
                      <span
                        className="pointer-events-none absolute left-3.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full"
                        style={{ background: row.assetId ? tokenColor(symbol) : '#C9C8B6' }}
                      />
                      <select
                        value={row.assetId}
                        onChange={(e) => updateRow(i, { assetId: e.target.value })}
                        disabled={!!registryError || activeAssets.length === 0}
                        className="h-[42px] w-full appearance-none border border-border-strong bg-foreground/[0.03] pl-9 pr-9 font-mono text-[12.5px] text-foreground transition-colors hover:border-border-strong focus:border-foreground focus:outline-none disabled:opacity-50"
                      >
                        <option value="">— pick token —</option>
                        {activeAssets.map((a) => (
                          <option key={a.asset_id} value={a.asset_id}>
                            {formatAssetOption(a)}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                        ▾
                      </span>
                    </div>

                    {/*
                      Mobile: keep range + % on row 2 under the select.
                      Desktop: sm:contents so range and number become their own grid cells
                      (columns 3 and 4), matching docs/designs/index.html .asset layout.
                    */}
                    <div className="col-start-2 row-start-2 flex min-w-0 items-center gap-3 sm:contents">
                      <div className="flex min-w-0 flex-1 items-center sm:min-w-0 sm:w-full sm:flex-none">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={0.5}
                          value={row.allocationPct || 0}
                          onChange={(e) => updateRow(i, { allocationPct: e.target.value })}
                          aria-label={`Allocation for asset ${i + 1}`}
                          className="h-0.5 w-full min-w-0 cursor-pointer accent-seal"
                        />
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={row.allocationPct}
                        onChange={(e) => updateRow(i, { allocationPct: e.target.value })}
                        aria-label={`Allocation percent for asset ${i + 1}`}
                        className="h-[42px] w-16 shrink-0 border border-border-strong bg-foreground/[0.03] px-2 text-right font-mono text-xs text-foreground focus:border-foreground focus:outline-none sm:w-full"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setRows((prev) => {
                          const next = prev.filter((_, j) => j !== i);
                          return next.length ? next : [{ ...EMPTY_ROW }];
                        })
                      }
                      className="col-start-3 row-start-1 flex h-8 w-8 items-center justify-center justify-self-end border border-border-strong text-[15px] text-muted-foreground transition-all hover:border-seal hover:text-seal sm:col-auto sm:row-auto sm:h-8 sm:w-8"
                      title="Remove asset"
                    >
                      −
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleAddAsset}
              className="flex w-full items-center gap-2.5 border-t border-border bg-transparent px-5 py-3.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:bg-foreground/[0.03] hover:text-seal"
            >
              <span className="text-sm">+</span> Add asset
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-5 pt-2">
            <button
              type="submit"
              disabled={loading || !canCreate}
              className="relative overflow-hidden border border-moss bg-moss px-8 py-3.5 font-mono text-[11px] font-semibold uppercase tracking-[0.26em] text-background transition-all hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_rgba(23,37,28,0.18)] active:translate-x-0 active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-foreground/[0.06] disabled:text-muted-foreground disabled:shadow-none"
            >
              <span className="relative z-10">{loading ? status ?? 'Processing…' : 'Create ETF'}</span>
            </button>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
              {!canCreate ? (
                !basketDone ? (
                  <>
                    Basket must total <strong className="text-seal">100%</strong> and every asset needs a token
                  </>
                ) : !name.trim() || !symbol.trim() ? (
                  <>
                    Set a <strong className="text-seal">share name</strong> and{' '}
                    <strong className="text-seal">symbol</strong>
                  </>
                ) : (
                  <>
                    Add a <strong className="text-seal">metadata URI</strong>
                  </>
                )
              ) : (
                <>
                  Ready — <strong className="text-seal">1 instruction</strong> will be signed
                </>
              )}
            </span>
          </div>

          {result && (
            <div className="max-h-64 overflow-y-auto rounded-[2px] border border-border-strong bg-foreground/[0.04]">
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
    </section>
  );
}
