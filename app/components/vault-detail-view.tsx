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
  type NavView,
  type VaultChainAsset,
} from '@/lib/cvault';
import { USDC_DECIMALS } from '@/lib/constants';
import {
  fetchVaults,
  fetchAssetRegistry,
  type VaultRecord,
  type AssetRegistryEntry,
} from '@/lib/registryClient';
import { PendingClaimButton, formatTokenUi } from './pending-claim-button';
import { SECTION_STYLE, VIEW_FUNCTIONS, type FunctionDef } from './function-defs';
import { SectionBlock } from './section-block';
import { SECTION_ROUTES } from './console-routes';
import { panelClass, sectionLabelClass } from './ui-classes';
import { displayVaultName } from './view-display';
import { shorten, VaultHoldingsCard } from './vault-holdings-card';
import { VaultStatCard } from './vault-stat-card';
import { VaultNavChart } from './vault-nav-chart';
import { VaultTradePanel } from './vault-trade-panel';
import { VaultFeesCard } from './vault-fees-card';
import { VaultContractCard } from './vault-contract-card';

/**
 * View plate for this vault — vault_id locked, Vault State omitted
 * (Portfolio · View vault info covers that read).
 */
function viewFunctionsForVault(vault: VaultRecord): FunctionDef[] {
  const fixedVault = String(vault.vault_id);
  const vaultLabel = `№ ${vault.vault_id} · ${displayVaultName(vault.name)}`;
  return VIEW_FUNCTIONS.filter((fn) => fn.id !== 'view_vault_state').map(
    (fn, i) => ({
      ...fn,
      number: String(i + 1).padStart(2, '0'),
      fields: fn.fields.map((field) =>
        field.name === 'vault_id'
          ? {
              ...field,
              // Submit value must stay a bare id — display shows which vault.
              fixed: fixedVault,
              label: 'Vault',
              hint: vaultLabel,
            }
          : field,
      ),
    }),
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-xs tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/**
 * Per-vault detail view backing /discover/{vault_id}.
 *
 * Vault rows come from the same `/api/vaults` list the Vaults tab uses (there
 * is no single-vault endpoint), filtered by `vault_id`. The basket is read
 * on-chain via fetchVaultCtx. Deposit, Redeem & Claim, and Pending claim reuse
 * the exact components the list rows use, so the transaction paths stay
 * identical across both surfaces.
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

  // One atomic result per (vaultId, network) resolution — a single setState in
  // the async callback, so no reset-then-fill cascade and no stale row leaking
  // across a network switch.
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

  // Vault record for this id, scoped to the active network.
  useEffect(() => {
    if (vaultId === null) return;

    let cancelled = false;

    fetchVaults(network)
      .then((rows) => {
        if (cancelled) return;
        const found = rows.find((v) => v.vault_id === vaultId);
        setVaultState(
          found
            ? { status: 'ready', vault: found }
            : { status: 'error', message: 'vault not found on this network' },
        );
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
  }, [vaultId, network]);

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

  type NavState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; nav: NavView }
    | { status: 'error'; message: string };

  const [navState, setNavState] = useState<NavState>({ status: 'idle' });

  const loadNav = useCallback(() => {
    if (vaultId === null) return;
    setNavState({ status: 'loading' });
    fetchVaultCtx(connection, vaultId, network)
      .then(() => getTotalNavView(connection, vaultId, network, anchorWallet))
      .then((nav) => setNavState({ status: 'ready', nav }))
      .catch((err) =>
        setNavState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, vaultId, network]);

  useEffect(() => {
    if (vaultId === null || !vault) return;
    loadNav();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultId, vault, network]);

  useEffect(() => {
    // No wallet — the render falls back to "wallet not connected", so there's
    // nothing to reset here.
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

  // An invalid id never triggers a fetch, so surface it directly from render.
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

  return (
    <section aria-label="Vault detail" className="flex flex-col gap-4">
      <Link
        href={SECTION_ROUTES.vaults}
        className="inline-flex w-fit items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ← Discover
      </Link>

      {loading && (
        <div className={`${panelClass} px-5 py-6 md:px-6`}>
          <span className="font-mono text-xs text-muted-foreground">loading vault…</span>
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
          <div className={`${panelClass} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-5 py-3.5 md:px-6">
              <div className="flex items-baseline gap-4">
                <span className="flex-shrink-0 font-mono text-xs font-bold tabular-nums tracking-[0.08em] text-seal">
                  &#8470;&nbsp;CVLT-{vault.vault_id}
                </span>
                <span
                  className="font-display text-base font-semibold tracking-[0.04em] text-foreground"
                  style={{ color: style.accent }}
                >
                  {displayVaultName(vault.name)}
                </span>
              </div>
              <span className={`${sectionLabelClass} uppercase`}>
                {vault.num_assets} asset{vault.num_assets === 1 ? '' : 's'} ·{' '}
                {vault.fund_type}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-5 md:grid-cols-4 md:px-6">
              <MetaRow label="Vault" value={shorten(vault.vault_address)} />
              <MetaRow
                label="Base"
                value={shorten(NETWORK_CONSTANTS[network].usdcMint.toBase58())}
              />
              <MetaRow label="Shares mint" value={shorten(vault.shares_mint)} />
              <MetaRow
                label="Your shares"
                value={
                  !publicKey
                    ? 'wallet not connected'
                    : shareBalance === null
                      ? '—'
                      : formatTokenUi(shareBalance, USDC_DECIMALS)
                }
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border-strong px-5 py-4 md:px-6">
              <PendingClaimButton
                vault={vault}
                network={network}
                onClaimed={loadPosition}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <VaultStatCard
              label="NAV / share"
              value={navState.status === 'ready' ? navState.nav.sharePriceUsd : '—'}
              loading={navState.status === 'loading' || navState.status === 'idle'}
              onRefresh={loadNav}
              refreshing={navState.status === 'loading'}
            />
            <VaultStatCard
              label="AUM"
              value={navState.status === 'ready' ? navState.nav.totalNavUsd : '—'}
              loading={navState.status === 'loading' || navState.status === 'idle'}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_360px]">
            <VaultNavChart seed={vault.vault_id} />
            <VaultTradePanel
              vault={vault}
              network={network}
              sharePriceUsd={navState.status === 'ready' ? navState.nav.sharePriceUsd : null}
              onDeposited={() => {
                loadPosition();
                loadNav();
              }}
              onRedeemed={() => {
                loadPosition();
                loadNav();
              }}
            />
          </div>

          {/* Read ops minus Vault State (that lives on Portfolio · View vault info). */}
          <SectionBlock
            id="view"
            label="Read operations"
            functions={viewFunctionsForVault(vault)}
            network={network}
          />

          <VaultHoldingsCard
            assets={assets}
            assetsLoading={assetsLoading}
            assetsError={assetsError}
            totalNavUsd={navState.status === 'ready' ? navState.nav.totalNavUsd : null}
            byMint={byMint}
            byId={byId}
            connection={connection}
          />

          <VaultFeesCard
            depositFeeBps={vault.deposit_fee_bps}
            redeemFeeBps={vault.redeem_fee_bps}
          />

          <VaultContractCard vaultAddress={vault.vault_address} network={network} />
        </>
      )}
    </section>
  );
}
