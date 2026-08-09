'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  fetchVaultCtx,
  getTotalNavView,
  getUserPosition,
  NETWORK_CONSTANTS,
  type Network,
  type VaultChainAsset,
} from '@/lib/onchain/cvault';
import { C_VAULT_PROGRAM_ID, USDC_DECIMALS } from '@/lib/constants';
import {
  fetchVaults,
  fetchAssetRegistry,
  updateVaultPoolCreated,
  type VaultRecord,
  type AssetRegistryEntry,
} from '@/lib/registryClient';
import { resolveVaultShareUsdcPool } from '@/lib/meteora';
import { PublicKey } from '@solana/web3.js';
import {
  assetFullName,
  assetNameForMint,
  displayAssetName,
} from '@/lib/presets/canonical-data';
import { DepositModal } from './deposit-modal';
import { RedeemModal } from './redeem-modal';
import { StakeEarnModal } from './stake-earn-modal';
import { PendingClaimButton, formatTokenUi } from './pending-claim-button';
import { AssetRowsSkeleton } from './loading-skeletons';
import { VaultActionPanel } from './vault-action-panel';
import { vaultDetailPath } from './console-routes';
import { useVaultBreadcrumb } from './console-shell';

const ASSET_COLORS = [
  '#C8FF3D',
  '#5AC8E8',
  '#B78CFF',
  '#FF9E4D',
  '#FF6B4D',
  '#7DE8A8',
] as const;

function shorten(addr: string, head = 8, tail = 8): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function resolveAssetLabel(
  mint: string,
  assetId: number,
  byMint: Map<string, AssetRegistryEntry>,
  byId: Map<number, AssetRegistryEntry>,
): string {
  const fromDb = byMint.get(mint) ?? byId.get(assetId);
  return (
    displayAssetName(fromDb?.asset_name ?? '') ||
    assetNameForMint(mint) ||
    // Never surface a raw mint as the primary label when a name exists elsewhere.
    (fromDb?.asset_name?.trim() || '') ||
    `Asset ${assetId}`
  );
}

function parseUsdLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const n = Number(label.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function formatUsdCompact(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
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

/**
 * Per-vault detail — layout matches new_ui/cVault-2A-Vault-Detail.html.
 * Route key is the vault PDA (`vault_address`); numeric vault_id still
 * resolves for legacy links and rewrites to the PDA URL.
 */
export function VaultDetailView({
  vaultKeyParam,
  network,
}: {
  vaultKeyParam: string;
  network: Network;
}) {
  return (
    <VaultDetailViewInner
      key={`${network}:${vaultKeyParam}`}
      vaultKeyParam={vaultKeyParam}
      network={network}
    />
  );
}

function VaultDetailViewInner({
  vaultKeyParam,
  network,
}: {
  vaultKeyParam: string;
  network: Network;
}) {
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { setVaultName } = useVaultBreadcrumb();

  const routeKey = vaultKeyParam.trim();
  const keyLooksValid =
    routeKey.length > 0 &&
    (/^\d+$/.test(routeKey) || isBase58Pubkey(routeKey));

  type VaultState =
    | { status: 'loading' }
    | { status: 'ready'; vault: VaultRecord }
    | { status: 'error'; message: string };

  const [vaultState, setVaultState] = useState<VaultState>({ status: 'loading' });
  const vault = vaultState.status === 'ready' ? vaultState.vault : null;
  const vaultId = vault?.vault_id ?? null;

  type AssetsState =
    | { status: 'loading' }
    | { status: 'ready'; assets: VaultChainAsset[] }
    | { status: 'error'; message: string };

  const [assetsState, setAssetsState] = useState<AssetsState>({ status: 'loading' });

  const [byMint, setByMint] = useState<Map<string, AssetRegistryEntry>>(new Map());
  const [byId, setById] = useState<Map<number, AssetRegistryEntry>>(new Map());

  const [shareBalance, setShareBalance] = useState<string | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [stakeOpen, setStakeOpen] = useState(false);

  type NavState =
    | { status: 'idle' }
    | { status: 'loading' }
    | {
        status: 'ready';
        sharePriceUsd: string;
        totalNavUsd: string;
        totalShares: string;
        sharesDecimals: number;
      }
    | { status: 'error'; message: string };

  const [navState, setNavState] = useState<NavState>({ status: 'idle' });

  // Publish breadcrumb name; clear on leave.
  useEffect(() => {
    if (vault) {
      const label = vault.name.trim() || vault.symbol.trim() || null;
      setVaultName(label);
    } else {
      setVaultName(null);
    }
    return () => setVaultName(null);
  }, [vault, setVaultName]);

  useEffect(() => {
    if (!keyLooksValid) {
      setVaultState({ status: 'error', message: 'invalid vault address' });
      return;
    }

    let cancelled = false;

    fetchVaults(network)
      .then(async (rows) => {
        if (cancelled) return;

        let found: VaultRecord | undefined;
        if (/^\d+$/.test(routeKey)) {
          const id = Number(routeKey);
          if (Number.isSafeInteger(id)) {
            found = rows.find((v) => v.vault_id === id);
          }
        } else {
          const needle = routeKey.toLowerCase();
          found = rows.find(
            (v) => v.vault_address.toLowerCase() === needle,
          );
        }

        if (!found) {
          setVaultState({
            status: 'error',
            message: 'vault not found on this network',
          });
          return;
        }

        // Legacy /discover/{vault_id} → /discover/{pda}
        if (
          /^\d+$/.test(routeKey) &&
          found.vault_address &&
          found.vault_address !== routeKey
        ) {
          router.replace(vaultDetailPath(found.vault_address));
        }

        if (!found.is_pool_created) {
          try {
            const info = await resolveVaultShareUsdcPool(
              connection,
              new PublicKey(found.shares_mint),
              NETWORK_CONSTANTS[network].usdcMint,
            );
            if (!cancelled && info.exists) {
              found = await updateVaultPoolCreated(network, found.vault_id, true);
            }
          } catch {
            // leave flag false
          }
        }
        if (cancelled) return;
        setVaultState({ status: 'ready', vault: found });
      })
      .catch((err) => {
        if (cancelled) return;
        setVaultState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [routeKey, keyLooksValid, network, connection, router]);

  useEffect(() => {
    if (vaultId === null || !vault) return;

    let cancelled = false;

    fetchVaultCtx(connection, vaultId, network)
      .then((ctx) => {
        if (cancelled) return;
        setAssetsState({ status: 'ready', assets: ctx.assets });
      })
      .catch((err) => {
        if (cancelled) return;
        setAssetsState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [connection, vaultId, network, vault]);

  useEffect(() => {
    let cancelled = false;
    fetchAssetRegistry(network)
      .then((rows) => {
        if (cancelled) return;
        const mintMap = new Map<string, AssetRegistryEntry>();
        const idMap = new Map<number, AssetRegistryEntry>();
        for (const a of rows) {
          mintMap.set(a.mint, a);
          const id = Number(a.asset_id);
          if (Number.isFinite(id)) idMap.set(id, a);
        }
        setByMint(mintMap);
        setById(idMap);
      })
      .catch(() => {
        if (cancelled) return;
        setByMint(new Map());
        setById(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [network]);

  const [positionNonce, setPositionNonce] = useState(0);
  const loadPosition = useCallback(() => setPositionNonce((n) => n + 1), []);

  useEffect(() => {
    if (vaultId === null || !publicKey) return;

    let cancelled = false;
    getUserPosition(connection, vaultId, publicKey, network)
      .then((pos) => {
        if (!cancelled) setShareBalance(pos.shareBalance);
      })
      .catch(() => {
        if (!cancelled) setShareBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connection, vaultId, publicKey, network, positionNonce]);

  const loadNav = useCallback(
    async () => {
      if (vaultId === null) return;
      setNavState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
      try {
        const nav = await getTotalNavView(
          connection,
          vaultId,
          network,
          anchorWallet ?? null,
        );
        setNavState({
          status: 'ready',
          sharePriceUsd: nav.sharePriceUsd,
          totalNavUsd: nav.totalNavUsd,
          totalShares: nav.totalShares,
          sharesDecimals: nav.sharesDecimals,
        });
      } catch (err) {
        setNavState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [connection, vaultId, network, anchorWallet],
  );

  // NAV when vault becomes ready. Manual ↻ on the masthead still calls loadNav().
  // Dep array length must stay fixed across renders (React requirement).
  useEffect(() => {
    if (vaultId === null || !vault) return;
    void loadNav();
  }, [vaultId, vault, loadNav]);

  const loading = keyLooksValid && vaultState.status === 'loading';
  const error =
    !keyLooksValid
      ? 'invalid vault address'
      : vaultState.status === 'error'
        ? vaultState.message
        : null;

  const assetsLoading = assetsState.status === 'loading';
  const assetsError = assetsState.status === 'error' ? assetsState.message : null;
  const assets = assetsState.status === 'ready' ? assetsState.assets : null;

  const sharePriceNum =
    navState.status === 'ready' ? parseUsdLabel(navState.sharePriceUsd) : null;
  const totalNavNum =
    navState.status === 'ready' ? parseUsdLabel(navState.totalNavUsd) : null;
  const sharesDecimals =
    navState.status === 'ready' ? navState.sharesDecimals : USDC_DECIMALS;

  const yourSharesUi =
    publicKey && shareBalance != null
      ? formatTokenUi(shareBalance, sharesDecimals)
      : null;

  const symbol = vault ? (vault.symbol || `V${vault.vault_id}`).toUpperCase() : '';
  const creatorShort = vault ? shorten(vault.creator, 4, 4) : '';
  const programShort = shorten(C_VAULT_PROGRAM_ID.toBase58(), 8, 8);
  const vaultAddrShort = vault ? shorten(vault.vault_address, 8, 8) : '';

  return (
    <section aria-label="Vault detail" className="flex flex-1 flex-col">
      {loading && (
        <div className="px-[22px] py-10 font-mono text-xs text-text-dim">
          loading vault…
        </div>
      )}

      {!loading && error && (
        <div className="px-[22px] py-10">
          <p className="font-mono text-xs text-destructive">{error}</p>
        </div>
      )}

      {!loading && !error && vault && (
        <>
          {/* Masthead */}
          <div className="relative flex flex-wrap items-end justify-between gap-[30px] overflow-hidden border-b border-border px-[22px] pb-7 pt-8">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(48% 130% at 10% 0%, rgba(200,255,61,0.09), transparent 70%)',
              }}
            />
            <div className="relative min-w-0">
              <div className="flex flex-wrap items-center gap-[13px]">
                <h2 className="m-0 text-[46px] font-semibold tracking-[-0.045em]">
                  {symbol}
                </h2>
                <span className="rounded-full border border-accent/35 px-2 py-1 font-mono text-[10px] text-accent">
                  LIVE
                </span>
                {vault.is_pool_created ? (
                  <span className="rounded-full border border-border-strong px-2 py-1 font-mono text-[10px] text-text-dim">
                    STAKE READY
                  </span>
                ) : null}
              </div>
              <p className="mt-2.5 text-[15px] text-text-dim">
                {vault.name.trim() || 'On-chain ETF vault'}
                {vault.fund_type ? ` · ${vault.fund_type}` : ''}
                {creatorShort ? ` · created by ${creatorShort}` : ''}
              </p>
              <div className="mt-3">
                <PendingClaimButton
                  vault={vault}
                  network={network}
                  onClaimed={loadPosition}
                />
              </div>
            </div>
            <div className="relative text-right">
              <div className="font-mono text-[10px] tracking-[0.14em] text-text-faint">
                NAV / SHARE
              </div>
              <div className="mt-1.5 flex items-baseline justify-end gap-2.5">
                <span className="text-[38px] font-semibold tracking-[-0.035em]">
                  {navState.status === 'loading'
                    ? '…'
                    : navState.status === 'ready'
                      ? navState.sharePriceUsd
                      : '—'}
                </span>
                <button
                  type="button"
                  onClick={() => void loadNav()}
                  className="font-mono text-[11px] text-text-faint transition-colors hover:text-accent"
                  aria-label="Refresh NAV"
                >
                  ↻
                </button>
              </div>
              {totalNavNum != null && (
                <p className="mt-1 font-mono text-[11px] text-text-ghost">
                  TVL {navState.status === 'ready' ? navState.totalNavUsd : '—'}
                </p>
              )}
            </div>
          </div>

          {/* Two-column body */}
          <div className="grid flex-1 grid-cols-1 gap-px bg-border lg:grid-cols-[1.35fr_1fr]">
            {/* Left: basket, fees */}
            <div className="bg-background px-[22px] pb-8 pt-[26px]">
              <div className="font-mono text-[10px] tracking-[0.14em] text-text-ghost">
                BASKET COMPOSITION
              </div>

              {assetsLoading && (
                <div className="mt-4">
                  <AssetRowsSkeleton rows={4} />
                </div>
              )}

              {!assetsLoading && assetsError && (
                <p className="mt-4 font-mono text-xs text-destructive">
                  assets unavailable — {assetsError}
                </p>
              )}

              {!assetsLoading && !assetsError && assets && assets.length === 0 && (
                <p className="mt-4 text-sm text-text-dim">No assets on-chain yet.</p>
              )}

              {!assetsLoading && !assetsError && assets && assets.length > 0 && (
                <div className="mt-4">
                  {assets.map((asset, i) => {
                    const mint = asset.mint.toBase58();
                    const label = resolveAssetLabel(
                      mint,
                      asset.assetId,
                      byMint,
                      byId,
                    );
                    const pct = (asset.allocationBps / 100).toFixed(1);
                    const color = ASSET_COLORS[i % ASSET_COLORS.length];
                    const legUsd =
                      totalNavNum != null
                        ? formatUsdCompact(
                            (totalNavNum * asset.allocationBps) / 10_000,
                          )
                        : '—';
                    return (
                      <div
                        key={`${mint}-${i}`}
                        className={`grid grid-cols-[22px_1fr_auto_auto] items-center gap-3.5 py-3.5 ${
                          i < assets.length - 1
                            ? 'border-b border-white/[0.06]'
                            : ''
                        }`}
                      >
                        <span
                          className="h-5 w-5 rounded-full"
                          style={{ background: color }}
                        />
                        <span className="text-[15.5px]">
                          {label}
                          {assetFullName(label) ? (
                            <span className="text-sm text-text-ghost">
                              {' '}
                              {assetFullName(label)}
                            </span>
                          ) : null}
                        </span>
                        <span className="font-mono text-[14.5px] tabular-nums">
                          {pct}%
                        </span>
                        <span className="w-[106px] text-right font-mono text-[14.5px] tabular-nums text-text-dim">
                          {legUsd}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-8 font-mono text-[10px] tracking-[0.14em] text-text-ghost">
                FEES
              </div>
              <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FeeCard
                  label="ENTRY"
                  value={`${(vault.deposit_fee_bps / 100).toFixed(2)}%`}
                  hint="charged on mint"
                />
                <FeeCard
                  label="EXIT"
                  value={`${(vault.redeem_fee_bps / 100).toFixed(2)}%`}
                  hint="charged on redeem"
                />
                <FeeCard
                  label="FUND TYPE"
                  value={vault.fund_type === 'fixed' ? 'Fixed' : 'Dynamic'}
                  hint={
                    vault.num_assets === 1
                      ? '1 asset'
                      : `${vault.num_assets} assets`
                  }
                />
              </div>

              {yourSharesUi != null && (
                <>
                  <div className="mt-8 font-mono text-[10px] tracking-[0.14em] text-text-ghost">
                    YOUR POSITION
                  </div>
                  <div className="mt-3.5 flex items-center justify-between border-b border-white/[0.06] py-3 text-sm">
                    <span>Shares held</span>
                    <span className="font-mono text-accent">
                      {yourSharesUi} {symbol}
                    </span>
                  </div>
                  {sharePriceNum != null && shareBalance != null && (
                    <div className="flex items-center justify-between py-3 text-sm">
                      <span>Est. value</span>
                      <span className="font-mono">
                        {formatUsdCompact(
                          Number(yourSharesUi.replace(/,/g, '')) * sharePriceNum,
                        )}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Right: trade + stake + addresses */}
            <div className="bg-bg-elevated px-[22px] pb-8 pt-[26px]">
              <VaultActionPanel
                network={network}
                sharePriceLabel={
                  navState.status === 'ready' ? navState.sharePriceUsd : '—'
                }
                entryFeeBps={vault.deposit_fee_bps}
                exitFeeBps={vault.redeem_fee_bps}
                stakeable={vault.is_pool_created}
                shareSymbol={symbol}
                shareBalanceRaw={shareBalance}
                shareBalanceLabel={yourSharesUi}
                walletConnected={!!publicKey}
                onDeposit={() => setDepositOpen(true)}
                onRedeem={() => setRedeemOpen(true)}
                onStake={() => setStakeOpen(true)}
              />

              <div className="mt-[18px] flex flex-col gap-[11px] font-mono text-[11.5px]">
                <AddrRow label="VAULT" value={vaultAddrShort} />
                <AddrRow label="PROGRAM" value={programShort} />
                <AddrRow label="SHARES" value={shorten(vault.shares_mint, 4, 4)} />
                <AddrRow label="ORACLE" value="PYTH" />
              </div>
            </div>
          </div>
        </>
      )}

      {depositOpen && vault && (
        <DepositModal
          vault={vault}
          network={network}
          onClose={() => {
            setDepositOpen(false);
            loadPosition();
            void loadNav();
          }}
        />
      )}
      {redeemOpen && vault && (
        <RedeemModal
          vault={vault}
          network={network}
          onClose={() => {
            setRedeemOpen(false);
            loadPosition();
            void loadNav();
          }}
        />
      )}
      {stakeOpen && vault && (
        <StakeEarnModal
          vault={vault}
          network={network}
          onClose={() => {
            setStakeOpen(false);
            loadPosition();
          }}
        />
      )}
    </section>
  );
}

function FeeCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[11px] border border-white/[0.08] p-4">
      <div className="font-mono text-[9.5px] tracking-[0.12em] text-text-ghost">
        {label}
      </div>
      <div className="mt-2 text-[22px] font-semibold tracking-[-0.02em]">{value}</div>
      <div className="mt-1 text-[12.5px] text-text-ghost">{hint}</div>
    </div>
  );
}

function AddrRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2.5">
      <span className="tracking-[0.1em] text-text-ghost">{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  );
}
