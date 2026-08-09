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
  genesisDepositAndDeploy,
  parseUnits,
  formatUnits,
  getUserUsdcBalance,
  WSOL_MINT,
  SOL_USD_PYTH_FEED_ID,
  PRICE_SOURCE_PYTH,
  PRICE_SOURCE_DEX,
  PRICE_SCALE_DECIMALS,
  NETWORK_CONSTANTS,
  type Network,
} from '@/lib/onchain/cvault';
import {
  MAX_METADATA_VALUE_LEN,
  USDC_DECIMALS,
  VAULT_METADATA_DESCRIPTION_KEY,
} from '@/lib/constants';
import { buildVaultAltAddresses, createVaultAlt } from '@/lib/onchain/alt';
import { fetchPoolCtx } from '@/lib/onchain/whirlpool';
import { fetchDammPoolCtx } from '@/lib/onchain/damm';
import {
  fetchAssetRegistry,
  saveVault,
  updateVaultAlts,
  updateVaultGenesisStatus,
  generateVaultDescription,
  uploadVaultMetadataJson,
  type AssetRegistryEntry,
} from '@/lib/registryClient';
import { parseTxError, type UserFacingError } from '@/lib/onchain/txError';
import { CreateEtfModal } from './create-etf-modal';
import { ImageDropzone } from './image-dropzone';
import { showVaultOpsToast } from './vault-ops-toast';

interface AssetRow {
  assetId: string;
  allocationPct: string;
}

const EMPTY_ROW: AssetRow = { assetId: '', allocationPct: '' };

/** Mirrors GENESIS_SEED_USDC in deps/programs/vault/src/constants.rs — 1 USDC (6 decimals), hardcoded on-chain. */
const GENESIS_SEED_USDC_RAW = 1_000_000n;

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
    <div className="mb-5 mt-[34px] flex min-w-0 items-center gap-3.5">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-foreground">
        {title}
      </span>
      <span className="h-px min-w-4 flex-1 bg-white/10" />
      <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-text-ghost">
        {side}
      </span>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-[11px] block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-dim">
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
      className="h-[46px] w-full rounded-[8px] border border-white/[0.12] bg-bg-elevated px-3.5 font-sans text-[14.5px] text-foreground transition-colors duration-150 placeholder:text-text-placeholder hover:border-white/15 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-default disabled:opacity-70"
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

function TextArea({
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 3,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <textarea
      className={`w-full resize-y rounded-[8px] border border-white/[0.12] bg-bg-elevated px-3.5 py-[13px] font-sans text-[14.5px] leading-[1.5] text-foreground transition-colors duration-150 placeholder:text-text-placeholder hover:border-white/15 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={rows}
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
  const fillPct =
    maxBps > minBps ? Math.max(0, Math.min(100, ((bps - minBps) / (maxBps - minBps)) * 100)) : 0;

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
    <div className="flex h-[52px] items-center gap-3.5 rounded-[8px] border border-white/[0.12] bg-bg-elevated px-3.5 transition-colors focus-within:border-accent">
      <input
        type="number"
        min={minPct}
        max={maxPct}
        step={0.01}
        value={pct}
        onChange={(e) => setFromPct(e.target.value)}
        className="w-12 border-0 bg-transparent font-mono text-[15px] text-foreground focus:outline-none"
      />
      <div className="relative flex h-0.5 flex-1 items-center">
        <div className="absolute inset-0 rounded-full bg-white/[0.14]" />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${fillPct}%` }}
        />
        <input
          type="range"
          min={minBps}
          max={maxBps}
          value={bps}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          aria-valuemin={minBps}
          aria-valuemax={maxBps}
          aria-valuenow={bps}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `calc(${fillPct}% - 6px)` }}
        />
      </div>
      <span
        className={`min-w-[52px] text-right font-mono text-[12.5px] ${
          bps > 0 ? 'text-accent' : 'text-text-faint'
        }`}
      >
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
    <div className="grid h-[52px] grid-cols-2 overflow-hidden rounded-[8px] border border-white/[0.12] bg-bg-elevated">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`font-mono text-[12px] font-medium uppercase tracking-[0.12em] transition-colors ${
              active
                ? 'bg-accent text-background'
                : 'text-text-faint hover:text-foreground'
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
  SOL: '#C8FF3D',
  JUP: '#5AC8E8',
  JTO: '#B78CFF',
  PYTH: '#FF9E4D',
  RAY: '#FF6B4D',
  MSOL: '#7DE8A8',
  BONK: '#FF9E4D',
  WIF: '#B78CFF',
  ORCA: '#5AC8E8',
  USDT: '#7DE8A8',
};

const FALLBACK_COLORS = ['#C8FF3D', '#5AC8E8', '#B78CFF', '#FF9E4D', '#FF6B4D', '#7DE8A8'];

function tokenColor(symbol: string, index = 0): string {
  return TOKEN_COLORS[symbol] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
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
  const [imageUploading, setImageUploading] = useState(false);
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [generatingInfo, setGeneratingInfo] = useState(false);
  const [generateInfoError, setGenerateInfoError] = useState<string | null>(null);
  const [feeRecipient, setFeeRecipient] = useState('');
  const [depositFeeBps, setDepositFeeBps] = useState('0');
  const [redeemFeeBps, setRedeemFeeBps] = useState('100');
  const [fundType, setFundType] = useState<'dynamic' | 'fixed'>('dynamic');
  const [maxShares, setMaxShares] = useState('');
  const [baselineSharePrice, setBaselineSharePrice] = useState('1.00');
  const [rows, setRows] = useState<AssetRow[]>([{ ...EMPTY_ROW }]);

  // Genesis deposit hard-requires exactly 1 USDC from the connected wallet —
  // checked here so a manager can't sign create_etf only to have genesis_deposit
  // fail downstream on insufficient funds.
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!publicKey) {
      setUsdcBalance(null);
      return;
    }
    setCheckingBalance(true);
    getUserUsdcBalance(connection, publicKey, network)
      .then((bal) => {
        if (!cancelled) setUsdcBalance(bal);
      })
      .catch(() => {
        if (!cancelled) setUsdcBalance(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingBalance(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, network]);

  const hasEnoughUsdcForGenesis =
    usdcBalance !== null ? BigInt(usdcBalance) >= GENESIS_SEED_USDC_RAW : false;

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    solscan?: string;
  } | null>(null);
  const [createdVault, setCreatedVault] = useState<{
    vaultId: number;
    sharesMint: string;
    altAddress: string | null;
    genesisSeeded: boolean;
    solscan?: string;
  } | null>(null);
  const [lastError, setLastError] = useState<UserFacingError | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);

  const pushStatus = (message: string) => {
    setStatus(message);
    setSteps((prev) => [...prev, message]);
  };

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
  const canCreate =
    basketDone &&
    name.trim() &&
    symbol.trim() &&
    uri.trim() &&
    !imageUploading &&
    Number(baselineSharePrice) > 0 &&
    hasEnoughUsdcForGenesis;

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
    if (!hasEnoughUsdcForGenesis) {
      setResult({
        type: 'error',
        text: `Insufficient USDC — genesis deposit requires at least 1 USDC in your wallet (${
          usdcBalance !== null ? formatUnits(usdcBalance, USDC_DECIMALS) : '0'
        } available).`,
      });
      return;
    }

    setLoading(true);
    setResult(null);
    setSteps([]);
    setCreatedVault(null);
    setModalOpen(true);

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

      // `uri` state is the raw image URL (dropzone preview). Jupiter needs
      // Metaplex JSON at on-chain `uri` with an `image` field — publish that
      // JSON now and write its URL on-chain (Phantom also accepts this).
      const trimmedInfo = additionalInfo.trim();
      pushStatus('Publishing token metadata JSON…');
      const metadataUri = await uploadVaultMetadataJson({
        name: name.trim(),
        symbol: symbol.trim(),
        image: uri.trim(),
        description: trimmedInfo,
      });
      // Fail fast on data:image base64 / oversize metadata (static-tx packet limit).
      assertCreateEtfMetadata(name, symbol, metadataUri);

      let parsedBaselinePrice: BN;
      try {
        parsedBaselinePrice = parseUnits(baselineSharePrice || '0', PRICE_SCALE_DECIMALS);
      } catch (err) {
        throw new Error(
          `Opening share price: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (parsedBaselinePrice.lten(0)) {
        throw new Error('Opening share price must be greater than $0.');
      }

      const metadataFields = trimmedInfo
        ? [{ key: VAULT_METADATA_DESCRIPTION_KEY, value: trimmedInfo }]
        : undefined;

      pushStatus('Creating vault (create_etf)…');
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
        metadataUri,
        network,
        metadataFields,
      );

      // Normally the description rides along inside create_etf (one signature).
      // It only needs its own transaction when the combined packet was too big.
      let metadataNote = '';
      if (trimmedInfo && !created.metadataInlined) {
        try {
          pushStatus('Setting additional information (set_share_metadata_fields)…');
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
        pushStatus('Creating address lookup table…');
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

      pushStatus('Recording vault…');
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
          uri: metadataUri,
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

      let genesisNote = '';
      let genesisSeeded = false;
      if (altAddress) {
        try {
          pushStatus('Seeding genesis deposit (genesis_deposit)…');
          const genesisResult = await genesisDepositAndDeploy(
            connection,
            anchorWallet,
            created.vaultId,
            parsedBaselinePrice,
            altAddress,
            network,
          );
          if (genesisResult.altAddress && genesisResult.altAddress !== altAddress) {
            altAddress = genesisResult.altAddress;
            try {
              await updateVaultAlts(network, created.vaultId, {
                deposit_alt_address: altAddress,
                redeem_alt_address: altAddress,
              });
            } catch {
              // Non-fatal — genesis itself already succeeded on-chain.
            }
          }
          genesisSeeded = true;
          try {
            await updateVaultGenesisStatus(network, created.vaultId, true);
          } catch (err) {
            genesisNote =
              `\n\nGenesis deposit succeeded on-chain but updating its status failed: ${
                err instanceof Error ? err.message : String(err)
              }. Refresh the portfolio page — it reconciles this automatically.`;
          }
          genesisNote =
            `\n\nGenesis deposit seeded — opening share price pinned at $${baselineSharePrice}.` +
            genesisNote;
        } catch (err) {
          genesisNote =
            `\n\nGenesis deposit failed: ${
              err instanceof Error ? err.message : String(err)
            } Vault is still on-chain — run Genesis deposit from the vault's admin panel to retry.`;
        }
      } else {
        genesisNote =
          '\n\nGenesis deposit skipped — no address lookup table available. Run Genesis deposit from the vault\'s admin panel once the ALT exists.';
      }

      setCreatedVault({
        vaultId: created.vaultId,
        sharesMint: created.sharesMint.toBase58(),
        altAddress,
        genesisSeeded,
        solscan: created.tx ? created.link : undefined,
      });
      setResult({
        type: 'success',
        text:
          `ETF vault №${created.vaultId} created${
            created.metadataInlined
              ? ' — name, symbol, URI and description all set in the same transaction'
              : ' — name, symbol and URI set in the same transaction'
          }.\n` +
          `vault: ${created.vaultPda.toBase58()}\n` +
          `shares mint: ${created.sharesMint.toBase58()}\n` +
          `lookup table: ${altAddress ?? '— (creation failed)'}${metadataNote}${altNote}${genesisNote}${registryNote}`,
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

  return (
    <section className="flex min-h-0 flex-1 flex-col px-[22px] pb-8 pt-6">
      {modalOpen && (
        <CreateEtfModal
          network={network}
          loading={loading}
          steps={steps}
          result={result}
          lastError={lastError}
          errorOpen={errorOpen}
          onErrorOpenChange={setErrorOpen}
          created={createdVault}
          onClose={() => setModalOpen(false)}
          onCreateAnother={() => {
            setModalOpen(false);
            setResult(null);
            setCreatedVault(null);
            setSteps([]);
          }}
        />
      )}

      {/* Outer frame — the double-border plate from the original mockups */}
      <div className="flex min-h-0 flex-1 flex-col border border-border-strong bg-background p-1.5">
        <div className="flex min-h-0 flex-1 flex-col border border-border">
          {/* Section plate — Create ETF vault */}
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-bg-elevated px-[22px] py-[18px]">
            <span className="text-[20px] font-semibold tracking-[-0.02em] text-foreground">
              Create ETF vault
            </span>
          </div>

          <form onSubmit={handleSubmit} className="px-[22px] pb-8 pt-[26px]">
        {connected && (
          <p className="font-mono text-[11.5px] tabular-nums text-text-faint">
            wallet USDC balance:{' '}
            <span className={hasEnoughUsdcForGenesis ? 'text-foreground' : 'text-destructive'}>
              {checkingBalance
                ? '…'
                : usdcBalance !== null
                  ? `${formatUnits(usdcBalance, USDC_DECIMALS)} USDC`
                  : '—'}
            </span>
            {!checkingBalance && !hasEnoughUsdcForGenesis && (
              <span className="text-destructive"> — need at least 1 USDC for genesis deposit</span>
            )}
          </p>
        )}

        <SectionDivider title="Vault metadata" side="A · identity" />
        <div>
          {/* Image dropzone bottom aligns with description textarea bottom. */}
          <div className="grid grid-cols-1 items-stretch gap-[22px] md:grid-cols-[230px_minmax(0,1fr)]">
            <div className="flex h-full min-h-0 flex-col">
              <FieldLabel>Vault image</FieldLabel>
              <ImageDropzone
                value={uri}
                onChange={setUri}
                onUploadingChange={setImageUploading}
                className="min-h-[196px] w-full flex-1"
              />
            </div>
            <div className="flex h-full min-h-0 flex-col gap-[18px]">
              <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
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
                    style={{ textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}
                    required
                  />
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-[11px] flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-dim">
                    Description (Optional)
                  </span>
                  <button
                    type="button"
                    onClick={handleGenerateInfo}
                    disabled={generatingInfo || !name.trim()}
                    className="rounded-full border border-white/[0.12] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {generatingInfo ? 'Generating…' : 'Auto-generate'}
                  </button>
                </div>
                <TextArea
                  value={additionalInfo}
                  onChange={setAdditionalInfo}
                  placeholder="Optional — strategy notes, mandate, or other context shown alongside this vault."
                  maxLength={MAX_METADATA_VALUE_LEN}
                  rows={4}
                  className="min-h-[104px] flex-1 resize-none"
                />
              </div>
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-[22px] md:grid-cols-[230px_minmax(0,1fr)]">
            {uri ? (
              <p className="max-w-full truncate font-mono text-[11px] text-text-ghost">{uri}</p>
            ) : (
              <p className="text-[12.5px] leading-[1.5] text-text-ghost">
                Required before you can create the vault.
              </p>
            )}
          </div>
        </div>
        {generateInfoError && (
          <p className="mt-3 text-xs leading-relaxed text-destructive">{generateInfoError}</p>
        )}
        <p className="mt-4 text-[13px] leading-[1.6] text-text-ghost">
          Optional. Draft from the share name via Auto-generate, then edit freely. Written
          on-chain as share-mint metadata (key{' '}
          <span className="font-mono text-[12px] text-text-dim">
            {VAULT_METADATA_DESCRIPTION_KEY}
          </span>
          ) in a follow-up transaction after the vault is created. Max {MAX_METADATA_VALUE_LEN}{' '}
          bytes.
        </p>

        <SectionDivider title="Economics" side="B · fees in %" />
        <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-3">
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
              Fee recipient <span className="font-normal text-[#5E5E64]">(blank = you)</span>
            </FieldLabel>
            <TextInput
              value={feeRecipient}
              onChange={setFeeRecipient}
              placeholder="Connected wallet"
            />
          </div>
        </div>

        <SectionDivider title="Fund configuration" side="C · constants" />
        <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2">
          <div>
            <FieldLabel>Deposit mint</FieldLabel>
            <div className="relative">
              <div className="flex h-[52px] items-center justify-between gap-2.5 rounded-[8px] border border-white/[0.12] bg-bg-elevated py-0 pl-3.5 pr-1.5">
                <span className="min-w-0 truncate font-mono text-[13px] text-[#DADADE]">
                  <span className="text-accent">USDC</span>
                  <span className="text-text-ghost"> · </span>
                  {usdcBase58}
                </span>
                <button
                  type="button"
                  onClick={handleCopyMint}
                  className="shrink-0 rounded-md border border-white/[0.12] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-accent/40 hover:text-accent"
                >
                  Copy
                </button>
              </div>
            </div>
            <p className="mt-2 text-[12.5px] text-text-ghost">
              All vaults use USDC for deposits and withdrawals — fixed by the protocol
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
            <p className="mt-2 text-[12.5px] leading-relaxed text-text-ghost">
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

        <div className="mt-[22px] grid grid-cols-1 items-start gap-[22px] sm:grid-cols-2">
          <div>
            <FieldLabel>Opening share price (USD)</FieldLabel>
            <TextInput
              value={baselineSharePrice}
              onChange={setBaselineSharePrice}
              placeholder="1.00"
              required
            />
          </div>
          <p className="m-0 text-[12.5px] leading-[1.6] text-text-ghost sm:mt-[26px]">
            Genesis deposit runs automatically right after the vault is created, seeding it
            with 1 USDC priced at this opening share price.
          </p>
        </div>

        <div className="mt-[26px] overflow-hidden rounded-[10px] border border-white/10 bg-bg-elevated">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3.5">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-foreground">
              Asset basket
            </span>
            <span
              className={`font-mono text-[12px] tabular-nums transition-colors ${
                basketDone ? 'text-accent' : 'text-destructive'
              }`}
            >
              {allocationTotalPct}%
              <span className="text-[#5E5E64]"> / 100%</span>
            </span>
          </div>

          {registryError && (
            <p className="px-4 py-3 font-mono text-xs text-destructive">
              Asset registry unavailable — {registryError}
            </p>
          )}
          {!registryError && activeAssets.length === 0 && (
            <p className="px-4 py-3 font-mono text-xs text-muted-foreground">
              No active assets on {network} — list some under Admin → Create asset.
            </p>
          )}

          <div className="divide-y divide-white/[0.06]">
            {rows.map((row, i) => {
              const entry = assetById.get(row.assetId);
              const label = entry ? assetLabel(entry) : '';
              return (
                <div
                  key={i}
                  className="grid grid-cols-[44px_minmax(0,1fr)_40px] grid-rows-[auto_auto] items-center gap-x-3 gap-y-2.5 px-4 py-4 sm:grid-cols-[44px_minmax(180px,1fr)_minmax(140px,1fr)_96px_44px] sm:grid-rows-1 sm:gap-3"
                >
                  <span className="flex h-[34px] items-center justify-center rounded-md border border-accent/30 bg-accent/[0.12] font-mono text-[11.5px] font-medium tracking-[0.06em] text-accent">
                    {String(i + 1).padStart(2, '0')}
                  </span>

                  <div className="relative min-w-0">
                    <span
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full"
                      style={{
                        background: row.assetId
                          ? tokenColor(label, i)
                          : 'rgba(255,255,255,0.12)',
                      }}
                    />
                    <select
                      value={row.assetId}
                      onChange={(e) => updateRow(i, { assetId: e.target.value })}
                      disabled={!!registryError || activeAssets.length === 0}
                      className="h-[42px] w-full appearance-none rounded-[8px] border border-white/[0.12] bg-background pl-10 pr-9 font-sans text-[14px] text-foreground transition-colors hover:border-white/15 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    >
                      <option value="">— pick token —</option>
                      {activeAssets.map((a) => (
                        <option key={a.asset_id} value={a.asset_id}>
                          {formatAssetOption(a)}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-text-ghost">
                      ▾
                    </span>
                  </div>

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
                        className="h-1 w-full min-w-0 cursor-pointer accent-accent"
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
                      className="h-[42px] w-16 shrink-0 rounded-[8px] border border-white/[0.12] bg-background px-3 text-right font-mono text-[13px] text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent sm:w-full"
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
                    className="col-start-3 row-start-1 flex h-[42px] w-[42px] items-center justify-center justify-self-end rounded-[8px] border border-white/[0.12] text-[15px] text-text-faint transition-colors hover:border-destructive/50 hover:text-destructive sm:col-auto sm:row-auto sm:w-full"
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
            className="flex w-full items-center gap-2.5 border-t border-white/[0.07] bg-transparent px-4 py-[15px] font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-accent transition-colors hover:bg-accent/[0.06]"
          >
            + Add asset
          </button>
        </div>

        <div className="mt-[26px] flex flex-wrap items-center gap-[18px]">
          <button
            type="submit"
            disabled={loading || !canCreate}
            className={`inline-flex items-center justify-center rounded-full px-[30px] py-3.5 text-[14.5px] font-semibold transition-[transform,background,color,border-color] duration-150 ${
              canCreate && !loading
                ? 'bg-accent text-background hover:-translate-y-px hover:bg-[#d4ff5c]'
                : 'cursor-not-allowed border border-white/[0.12] bg-white/[0.06] text-text-ghost'
            }`}
          >
            {loading ? status ?? 'Processing…' : imageUploading ? 'Uploading image…' : 'Create ETF'}
          </button>
          <span className="max-w-lg font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-ghost">
            {!canCreate ? (
              imageUploading ? (
                <>
                  Waiting for the <strong className="font-medium text-accent">vault image</strong> to
                  finish uploading
                </>
              ) : !basketDone ? (
                <>
                  Basket must total{' '}
                  <strong className="font-medium text-destructive">100%</strong> and every asset
                  needs a token
                </>
              ) : !name.trim() || !symbol.trim() ? (
                <>
                  Set a <strong className="font-medium text-accent">share name</strong> and{' '}
                  <strong className="font-medium text-accent">symbol</strong>
                </>
              ) : !uri.trim() ? (
                <>
                  Upload a <strong className="font-medium text-accent">vault image</strong> first
                </>
              ) : Number(baselineSharePrice) <= 0 ? (
                <>
                  Set an <strong className="font-medium text-accent">opening share price</strong>{' '}
                  above $0
                </>
              ) : (
                <>
                  Need at least <strong className="font-medium text-accent">1 USDC</strong> in your
                  wallet for genesis deposit
                </>
              )
            ) : (
              <>
                Ready — <strong className="font-medium text-accent">3 wallet approvals</strong>:
                create vault · lookup table · genesis deposit
              </>
            )}
          </span>
        </div>
          </form>

          <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border px-[22px] py-[15px] font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-ghost">
            <span>cVault series 2026</span>
            <span className="text-accent">{network}</span>
          </footer>
        </div>
      </div>
    </section>
  );
}
