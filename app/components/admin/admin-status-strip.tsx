'use client';

import { useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import type { Network } from '@/app/providers';
import { C_VAULT_PROGRAM_ID, ADMIN_PUBKEY } from '@/lib/constants';
import { StatValueSkeleton } from '../loading-skeletons';
import { panelClass } from '../ui-classes';

type DbInfo = { backend: 'sqlite' | 'supabase'; label: string; tables: string[] };

function short(addr: string, head = 4, tail = 4) {
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function Stat({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      {loading ? (
        <StatValueSkeleton />
      ) : (
        <span className="font-mono text-[11px] text-foreground">{value}</span>
      )}
    </div>
  );
}

export function AdminStatusStrip({ network }: { network: Network }) {
  const { connection } = useConnection();
  const [slot, setSlot] = useState<number | null>(null);
  const [rpcOk, setRpcOk] = useState<boolean | null>(null);
  const [db, setDb] = useState<DbInfo | null>(null);
  const [vaultCount, setVaultCount] = useState<number | null>(null);
  const [registryCount, setRegistryCount] = useState<number | null>(null);
  const [assetPresetCount, setAssetPresetCount] = useState<number | null>(null);
  const [vaultPresetCount, setVaultPresetCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSlot(null);
    setRpcOk(null);
    connection
      .getSlot()
      .then((s) => {
        if (!cancelled) {
          setSlot(s);
          setRpcOk(true);
        }
      })
      .catch(() => {
        if (!cancelled) setRpcOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  useEffect(() => {
    let cancelled = false;
    setDb(null);
    setVaultCount(null);
    setRegistryCount(null);
    setAssetPresetCount(null);
    setVaultPresetCount(null);
    fetch(`/api/admin/db/tables?network=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setDb(d);
      })
      .catch(() => {});
    fetch(`/api/vaults?network=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setVaultCount(Array.isArray(d.vaults) ? d.vaults.length : 0);
      })
      .catch(() => {});
    fetch(`/api/asset-registry?network=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRegistryCount(Array.isArray(d.assets) ? d.assets.length : 0);
      })
      .catch(() => {});
    fetch(`/api/presets?network=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setAssetPresetCount(Array.isArray(d.assetPresets) ? d.assetPresets.length : 0);
          setVaultPresetCount(Array.isArray(d.vaultPresets) ? d.vaultPresets.length : 0);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [network]);

  return (
    <div className={`${panelClass} flex flex-wrap items-center gap-6 px-5 py-3.5 md:px-6`}>
      <Stat
        label="RPC"
        loading={rpcOk === null}
        value={rpcOk ? `live · slot ${slot}` : 'unreachable'}
      />
      <Stat label="DB backend" loading={!db} value={db?.label ?? ''} />
      <Stat
        label="Vaults"
        loading={vaultCount === null}
        value={vaultCount === null ? '' : String(vaultCount)}
      />
      <Stat
        label="Registry"
        loading={registryCount === null}
        value={registryCount === null ? '' : String(registryCount)}
      />
      <Stat
        label="Asset presets"
        loading={assetPresetCount === null}
        value={assetPresetCount === null ? '' : String(assetPresetCount)}
      />
      <Stat
        label="Vault presets"
        loading={vaultPresetCount === null}
        value={vaultPresetCount === null ? '' : String(vaultPresetCount)}
      />
      <Stat label="Program" value={short(C_VAULT_PROGRAM_ID.toBase58())} />
      <Stat label="Admin" value={short(ADMIN_PUBKEY.toBase58())} />
    </div>
  );
}
