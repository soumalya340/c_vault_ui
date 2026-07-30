'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  fetchVaultCtx,
  getTotalNavView,
  getUserPosition,
  NETWORK_CONSTANTS,
  type Network,
  type VaultChainAsset,
} from '@/lib/cvault';
import { USDC_DECIMALS } from '@/lib/constants';
import {
  fetchVaults,
  fetchAssetRegistry,
  updateVaultPoolCreated,
  type VaultRecord,
  type AssetRegistryEntry,
} from '@/lib/registryClient';
import { resolveVaultShareUsdcPool } from '@/lib/meteora';
import { PublicKey } from '@solana/web3.js';
import { assetNameForMint, displayAssetName } from '@/lib/presets/canonical-data';
import { Badge } from '@/components/ui/badge';
import { DepositModal } from './deposit-modal';
import { RedeemModal } from './redeem-modal';
import { StakeEarnModal } from './stake-earn-modal';
import { PendingClaimButton, formatTokenUi } from './pending-claim-button';
import { SECTION_STYLE } from './function-defs';
import { AssetRowsSkeleton } from './loading-skeletons';
import { SECTION_ROUTES } from './console-routes';
import { panelClass, sectionLabelClass } from './ui-classes';
import { displayVaultName } from './view-display';
import { VaultStatCard } from './vault-stat-card';
import { VaultNavChart } from './vault-nav-chart';
import { VaultHoldingsCard, type HoldingRow } from './vault-holdings-card';
import { VaultContractCard } from './vault-contract-card';
import { VaultActionPanel } from './vault-action-panel';
import { VaultSourceTag } from './vault-source-tag';

function shorten(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Display label for a vault basket leg — registry name first, then presets. */
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
    shorten(mint)
  );
}

function parseUsdLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const n = Number(label.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseUiNumber(ui: string | null | undefined): number | null {
  if (!ui) return null;
  const n = Number(ui.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Per-vault detail view backing /discover/{vault_id}.
 *
 * Layout follows `ui/vault-page.jsx` (masthead → stat rail → chart + action
 * column → basket / reserves / accounts) with real on-chain + registry data.
 * Chart series is the only mock surface and is labeled as such.
 */
export function VaultDetailView({
  vaultIdParam,
  network,
}: {
  vaultIdParam: string;
  network: Network;
}) {
  // Remount on vault/network change so every piece of fetched state resets
  // together — otherwise the previous vault's row and basket stay on screen
  // while the new ones load.
  return (
    <VaultDetailViewInner
      key={`${network}:${vaultIdParam}`}
      vaultIdParam={vaultIdParam}
      network={network}
    />
  );
}

function VaultDetailViewInner({
  vaultIdParam,
  network,
}: {
  vaultIdParam: string;
  network: Network;
}) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const style = SECTION_STYLE.vaults;

  // Route params are user-controlled strings — only a non-negative integer can
  // ever match a vault_id, so reject anything else before hitting the network.
  const vaultId = useMemo(() => {
    if (!/^\d+$/.test(vaultIdParam)) return null;
    const n = Number(vaultIdParam);
    return Number.isSafeInteger(n) ? n : null;
  }, [vaultIdParam]);

  type VaultState =
    | { status: 'loading' }
    | { status: 'ready'; vault: VaultRecord }
    | { status: 'error'; message: string };

  const [vaultState, setVaultState] = useState<VaultState>({ status: 'loading' });
  const vault = vaultState.status === 'ready' ? vaultState.vault : null;

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
        sharesDecimals: number;
      }
    | { status: 'error'; message: string };

  const [navState, setNavState] = useState<NavState>({ status: 'idle' });
  const [navRefreshing, setNavRefreshing] = useState(false);

  // Vault record for this id, scoped to the active network.
  useEffect(() => {
    if (vaultId === null) return;

    let cancelled = false;

    fetchVaults(network)
      .then(async (rows) => {
        if (cancelled) return;
        let found = rows.find((v) => v.vault_id === vaultId);
        if (!found) {
          setVaultState({
            status: 'error',
            message: 'vault not found on this network',
          });
          return;
        }
        // DB false → on-chain pool check once; pin true for Stake & Earn gate.
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
            // leave flag false — Stake stays hidden until pool exists
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
  }, [vaultId, network, connection]);

  // On-chain basket — resolved atomically, same rationale as vaultState.
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

  // Asset registry for human-readable basket names; failure is non-fatal.
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

  // Bumped after a deposit/redeem/claim to re-read the share balance.
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
    async (isRefresh = false) => {
      if (vaultId === null) return;
      if (isRefresh) setNavRefreshing(true);
      else setNavState({ status: 'loading' });
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
          sharesDecimals: nav.sharesDecimals,
        });
      } catch (err) {
        setNavState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setNavRefreshing(false);
      }
    },
    [connection, vaultId, network, anchorWallet],
  );

  // Live NAV once per mount (and when wallet becomes available for ATA simulation).
  useEffect(() => {
    if (vaultId === null || !vault) return;
    void loadNav(false);
  }, [vaultId, vault, loadNav]);

  const loading = vaultId !== null && vaultState.status === 'loading';
  const error =
    vaultId === null
      ? 'invalid vault id'
      : vaultState.status === 'error'
        ? vaultState.message
        : null;

  const assetsLoading = assetsState.status === 'loading';
  const assetsError = assetsState.status === 'error' ? assetsState.message : null;
  const assets = assetsState.status === 'ready' ? assetsState.assets : null;

  const sharePriceNum =
    navState.status === 'ready' ? parseUsdLabel(navState.sharePriceUsd) : null;
  const sharesDecimals =
    navState.status === 'ready' ? navState.sharesDecimals : USDC_DECIMALS;

  const yourSharesUi =
    publicKey && shareBalance != null
      ? formatTokenUi(shareBalance, sharesDecimals)
      : null;
  const yourSharesNum = parseUiNumber(yourSharesUi);
  const yourValueNum =
    yourSharesNum != null && sharePriceNum != null
      ? yourSharesNum * sharePriceNum
      : null;

  const holdingRows: HoldingRow[] = useMemo(() => {
    if (!assets) return [];
    return assets.map((asset, i) => {
      const mint = asset.mint.toBase58();
      return {
        key: `${mint}-${i}`,
        symbol: resolveAssetLabel(mint, asset.assetId, byMint, byId),
        mint,
        targetPct: asset.allocationBps / 100,
        vaultAssetAtaKey: asset.vaultAssetAtaKey,
        decimals: asset.decimals,
      };
    });
  }, [assets, byMint, byId]);

  const baseMint = NETWORK_CONSTANTS[network].usdcMint.toBase58();

  return (
    <section aria-label="Vault detail" className="flex flex-col gap-5">
      {/* ---------- crumb ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={SECTION_ROUTES.vaults}
          className="inline-flex w-fit items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground transition-colors duration-150 hover:text-seal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ← Discover
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {vault ? (
            <PendingClaimButton
              vault={vault}
              network={network}
              onClaimed={loadPosition}
            />
          ) : null}
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                navState.status === 'ready'
                  ? 'bg-accent'
                  : navState.status === 'loading'
                    ? 'bg-muted-foreground animate-pulse'
                    : 'bg-muted-foreground'
              }`}
            />
            <span>
              {navState.status === 'ready'
                ? 'NAV loaded · on-chain view'
                : navState.status === 'loading'
                  ? 'reading NAV…'
                  : navState.status === 'error'
                    ? 'NAV unavailable'
                    : 'NAV idle'}
            </span>
          </div>
        </div>
      </div>

      {loading && (
        <div className={`${panelClass} px-5 py-6 md:px-6`}>
          <span className="font-mono text-xs text-muted-foreground">
            loading vault…
          </span>
        </div>
      )}

      {!loading && error && (
        <div className={`${panelClass} px-5 py-6 md:px-6`}>
          <p className="font-mono text-xs text-destructive">
            <span className="mr-2 text-muted-foreground/50">&gt;</span>
            {error}
          </p>
        </div>
      )}

      {!loading && !error && vault && (
        <>
          {/* ---------- masthead ---------- */}
          <header className="border-t border-border-strong pt-4">
            <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2">
              <span className="font-mono text-[13px] tracking-[0.12em] text-seal">
                № CVLT-{vault.vault_id}
              </span>
              <h1
                className="font-display text-[clamp(2.25rem,5vw,4rem)] font-bold leading-[0.9] tracking-[-0.01em] text-foreground"
                style={{ color: style.accent }}
              >
                {displayVaultName(vault.name)}
              </h1>
              {vault.is_pool_created ? (
                <Badge
                  variant="secondary"
                  title="DAMM v2 shares×USDC pool is live — use Stake below"
                  className="border border-border-strong bg-foreground/[0.06] font-mono text-[9px] font-bold uppercase tracking-[0.1em]"
                >
                  Stake &amp; earn
                </Badge>
              ) : null}
              <span
                className={`${sectionLabelClass} border border-border px-2 py-1 uppercase`}
              >
                {vault.num_assets} asset{vault.num_assets === 1 ? '' : 's'} ·{' '}
                {vault.fund_type}
              </span>
            </div>
            <p className="mt-3.5 max-w-[56ch] text-base leading-relaxed text-foreground/75">
              On-chain ETF vault. Deposit USDC to mint shares, redeem whenever you
              want capital back. Basket weights are configured on-chain; NAV is
              read live from the program view.
            </p>
          </header>

          {/* ---------- stat rail ---------- */}
          <div
            className={`${panelClass} grid grid-cols-1 overflow-hidden sm:grid-cols-2 lg:grid-cols-3`}
          >
            <VaultStatCard
              label="Share price"
              value={
                navState.status === 'loading'
                  ? '…'
                  : navState.status === 'ready'
                    ? navState.sharePriceUsd
                    : '—'
              }
              sub={
                navState.status === 'error' ? navState.message : undefined
              }
              source="rpc"
              trailing={
                <button
                  type="button"
                  onClick={() => void loadNav(true)}
                  disabled={navRefreshing || navState.status === 'loading'}
                  aria-label="Refresh share price"
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-accent disabled:opacity-40"
                >
                  {navRefreshing ? '…' : '↻'}
                </button>
              }
            />
            <VaultStatCard
              label="TVL"
              value={
                navState.status === 'loading'
                  ? '…'
                  : navState.status === 'ready'
                    ? navState.totalNavUsd
                    : '—'
              }
              sub="total NAV · on-chain view"
              source="rpc"
              trailing={
                <button
                  type="button"
                  onClick={() => void loadNav(true)}
                  disabled={navRefreshing || navState.status === 'loading'}
                  aria-label="Refresh TVL"
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-accent disabled:opacity-40"
                >
                  {navRefreshing ? '…' : '↻'}
                </button>
              }
            />
            <VaultStatCard
              label="Your position"
              value={
                !publicKey
                  ? '—'
                  : yourValueNum != null
                    ? `$${yourValueNum.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 4,
                      })}`
                    : shareBalance === null
                      ? '…'
                      : '$0.00'
              }
              sub={
                !publicKey
                  ? 'wallet not connected'
                  : yourSharesUi != null
                    ? `${yourSharesUi} shares`
                    : 'no shares'
              }
              source="rpc"
            />
          </div>

          {/* ---------- main grid ---------- */}
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_348px]">
            <div className="flex min-w-0 flex-col gap-5">
              <VaultNavChart sharePriceUsd={sharePriceNum} />

              {assetsLoading && (
                <div className={`${panelClass} overflow-hidden`}>
                  <div className="border-b border-border-strong px-4 py-2.5 md:px-5">
                    <span className="font-display text-[17px] font-bold tracking-[0.04em]">
                      Basket
                    </span>
                  </div>
                  <AssetRowsSkeleton rows={3} />
                </div>
              )}

              {!assetsLoading && assetsError && (
                <div className={`${panelClass} px-4 py-5 md:px-5`}>
                  <p className="font-mono text-xs text-destructive">
                    <span className="mr-2 text-muted-foreground/50">&gt;</span>
                    assets unavailable — {assetsError}
                  </p>
                </div>
              )}

              {!assetsLoading && !assetsError && (
                <VaultHoldingsCard
                  rows={holdingRows}
                  connection={connection}
                />
              )}

              <VaultContractCard
                vaultAddress={vault.vault_address}
                baseMint={baseMint}
                sharesMint={vault.shares_mint}
                network={network}
              />
            </div>

            {/* ---------- sticky action column ---------- */}
            <aside className="flex flex-col gap-3.5 xl:sticky xl:top-4">
              <VaultActionPanel
                sharePriceLabel={
                  navState.status === 'ready' ? navState.sharePriceUsd : '—'
                }
                entryFeeBps={vault.deposit_fee_bps}
                exitFeeBps={vault.redeem_fee_bps}
                stakeable={vault.is_pool_created}
                walletConnected={!!publicKey}
                onDeposit={() => setDepositOpen(true)}
                onRedeem={() => setRedeemOpen(true)}
                onStake={() => setStakeOpen(true)}
              />
              <div className="border border-border px-3.5 py-3">
                <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Where the numbers come from
                </div>
                <div className="mb-1.5 flex items-start gap-2 text-[11.5px] leading-snug text-foreground/75">
                  <VaultSourceTag kind="rpc" />
                  <span>
                    Share price, TVL, and position are on-chain reads.
                  </span>
                </div>
                <div className="mb-1.5 flex items-start gap-2 text-[11.5px] leading-snug text-foreground/75">
                  <VaultSourceTag kind="db" />
                  <span>Fees and vault metadata come from the vaults registry.</span>
                </div>
                <div className="flex items-start gap-2 text-[11.5px] leading-snug text-foreground/75">
                  <VaultSourceTag kind="mock" />
                  <span>
                    NAV history chart is illustrative until a history table
                    exists.
                  </span>
                </div>
              </div>
            </aside>
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
            void loadNav(true);
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
            void loadNav(true);
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
