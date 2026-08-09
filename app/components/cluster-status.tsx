'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import type { Network } from '@/app/providers';
import {
  isClusterReady,
  probeClusterHealth,
  type ClusterHealth,
} from '@/lib/onchain/clusterHealth';
import { C_VAULT_PROGRAM_ID } from '@/lib/constants';
import { btnGhostClass } from './ui-classes';

/** Debounce rapid network switches / remounts. */
const MIN_PROBE_GAP_MS = 800;

export type ClusterProbeState =
  | { status: 'idle' | 'loading'; health: null }
  | { status: 'ready' | 'degraded'; health: ClusterHealth };

type ClusterHealthContextValue = {
  network: Network;
  state: ClusterProbeState;
  refresh: () => void;
};

const ClusterHealthContext = createContext<ClusterHealthContextValue | null>(null);

/**
 * Localhost-only probe. Mainnet stays quiet — no diagnostic UI, no polling.
 * Mount once under Providers so nav + banner share one result.
 */
export function ClusterHealthProvider({
  network,
  children,
}: {
  network: Network;
  children: ReactNode;
}) {
  const { connection } = useConnection();
  const [state, setState] = useState<ClusterProbeState>({
    status: network === 'localhost' ? 'loading' : 'idle',
    health: null,
  });
  const inFlight = useRef(0);
  const lastStarted = useRef(0);

  const runProbe = useCallback(async () => {
    if (network !== 'localhost') return;

    const now = Date.now();
    if (now - lastStarted.current < MIN_PROBE_GAP_MS && inFlight.current > 0) {
      return;
    }
    lastStarted.current = now;
    const token = ++inFlight.current;

    setState((prev) => (prev.health ? prev : { status: 'loading', health: null }));

    const health = await probeClusterHealth(connection);
    if (token !== inFlight.current) return;

    setState({
      status: isClusterReady(health) ? 'ready' : 'degraded',
      health,
    });
  }, [connection, network]);

  // One-shot probe on network/connection change — no interval polling.
  // Manual recheck still available via `refresh()` on the chip/banner.
  useEffect(() => {
    inFlight.current += 1;
    lastStarted.current = 0;

    if (network !== 'localhost') {
      setState({ status: 'idle', health: null });
      return;
    }

    setState({ status: 'loading', health: null });
    void runProbe();
  }, [network, connection, runProbe]);

  const value = useMemo(
    () => ({
      network,
      state,
      refresh: () => {
        lastStarted.current = 0;
        void runProbe();
      },
    }),
    [network, state, runProbe],
  );

  return (
    <ClusterHealthContext.Provider value={value}>{children}</ClusterHealthContext.Provider>
  );
}

function useClusterHealth(): ClusterHealthContextValue {
  const ctx = useContext(ClusterHealthContext);
  if (!ctx) {
    throw new Error('useClusterHealth must be used within ClusterHealthProvider');
  }
  return ctx;
}

function Dot({
  tone,
  pulse,
}: {
  tone: 'ok' | 'bad' | 'wait' | 'muted';
  pulse?: boolean;
}) {
  const color =
    tone === 'ok'
      ? 'bg-accent'
      : tone === 'bad'
        ? 'bg-destructive'
        : tone === 'wait'
          ? 'bg-muted-foreground'
          : 'bg-border-strong';

  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color} ${
        pulse ? 'motion-safe:animate-[cert-blink_1.6s_ease_infinite]' : ''
      }`}
    />
  );
}

function Metric({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'bad' | 'wait' | 'muted';
  loading?: boolean;
}) {
  const text =
    tone === 'ok'
      ? 'text-accent'
      : tone === 'bad'
        ? 'text-destructive'
        : 'text-muted-foreground';

  return (
    <span className={`inline-flex items-center gap-1.5 ${text}`}>
      <Dot tone={loading ? 'wait' : tone} pulse={loading || tone === 'ok'} />
      <span className="tracking-[0.14em]">
        {label}
        <span className="mx-1 text-border-strong" aria-hidden>
          ·
        </span>
        <span className="tabular-nums">{value}</span>
      </span>
    </span>
  );
}

/**
 * Localhost-only nav chip: RPC live? · program deployed?
 * Hidden on mainnet — production chrome stays clean.
 */
export function ClusterStatusChip() {
  const { network, state, refresh } = useClusterHealth();
  if (network !== 'localhost') return null;

  const loading = state.status === 'loading' || state.status === 'idle';
  const health = state.health;

  const rpcTone: 'ok' | 'bad' | 'wait' | 'muted' = loading
    ? 'wait'
    : health?.rpcOnline
      ? 'ok'
      : 'bad';
  const progTone: 'ok' | 'bad' | 'wait' | 'muted' = loading
    ? 'wait'
    : !health?.rpcOnline
      ? 'muted'
      : health.programDeployed
        ? 'ok'
        : 'bad';

  const summary = loading
    ? 'Checking local validator…'
    : !health?.rpcOnline
      ? 'Local validator unreachable'
      : !health.programDeployed
        ? 'Program not deployed'
        : `Local ready · slot ${health.slot ?? '—'}`;

  return (
    <button
      type="button"
      onClick={refresh}
      title={`${summary} · click to recheck`}
      aria-label={`${summary}. Recheck cluster.`}
      className="hidden min-h-9 items-center gap-3 rounded-[2px] border border-border px-2.5 py-1.5 font-mono text-[9px] uppercase transition-colors duration-150 hover:border-border-strong hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:inline-flex"
    >
      <Metric
        label="Rpc"
        value={loading ? '…' : health?.rpcOnline ? 'live' : 'down'}
        tone={rpcTone}
        loading={loading}
      />
      <span className="text-border" aria-hidden>
        |
      </span>
      <Metric
        label="Prog"
        value={
          loading
            ? '…'
            : !health?.rpcOnline
              ? '—'
              : health.programDeployed
                ? 'on'
                : 'off'
        }
        tone={progTone}
        loading={loading}
      />
    </button>
  );
}

/**
 * Localhost-only strip when validator is down or program is missing.
 * Never renders on mainnet.
 */
export function ClusterStatusBanner() {
  const { network, state, refresh } = useClusterHealth();
  if (network !== 'localhost') return null;

  if (state.status === 'loading' || state.status === 'idle') return null;
  if (state.status === 'ready' && state.health) return null;

  const health = state.health;
  if (!health) return null;

  const programShort = `${C_VAULT_PROGRAM_ID.toBase58().slice(0, 8)}…${C_VAULT_PROGRAM_ID.toBase58().slice(-8)}`;

  let title: string;
  let body: string;

  if (!health.rpcOnline) {
    title = 'Local validator offline';
    body =
      'No RPC at the localhost endpoint. Start a validator (solana-test-validator or Surfpool), then recheck.';
  } else if (!health.programDeployed) {
    title = 'c_vault program not deployed';
    body = `RPC is live (slot ${health.slot ?? '—'}) but no executable program at ${programShort}. Deploy the program to this validator, then recheck.`;
  } else {
    return null;
  }

  return (
    <div
      role="alert"
      className="border-b-[1.5px] border-border-strong bg-foreground/[0.03]"
    >
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 md:px-8">
        <div className="min-w-0 space-y-1">
          <p className="m-0 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-destructive">
            <Dot tone="bad" pulse />
            {title}
          </p>
          <p className="m-0 max-w-[72ch] text-[12px] leading-[1.55] text-muted-foreground">
            {body}
            {health.detail && health.rpcOnline === false ? (
              <span className="mt-1 block font-mono text-[10px] text-muted-foreground/80">
                {health.detail}
              </span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className={`${btnGhostClass} min-h-10 shrink-0 self-start border border-border sm:self-center`}
        >
          Recheck
        </button>
      </div>
    </div>
  );
}

/**
 * Hero serial-register status.
 * Mainnet: quiet "mainnet" live mark — no slot / probe chrome.
 * Localhost: reflects validator + program probe.
 */
export function ClusterLiveLabel() {
  const { network, state } = useClusterHealth();

  if (network === 'mainnet') {
    return (
      <span className="inline-flex items-center gap-1.5 font-normal tracking-[0.14em] text-accent">
        <Dot tone="ok" pulse />
        mainnet
      </span>
    );
  }

  const loading = state.status === 'loading' || state.status === 'idle';
  const health = state.health;

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 font-normal tracking-[0.14em] text-muted-foreground">
        <Dot tone="wait" pulse />
        checking local
      </span>
    );
  }

  if (!health?.rpcOnline) {
    return (
      <span className="inline-flex items-center gap-1.5 font-normal tracking-[0.14em] text-destructive">
        <Dot tone="bad" pulse />
        offline
      </span>
    );
  }

  if (!health.programDeployed) {
    return (
      <span className="inline-flex items-center gap-1.5 font-normal tracking-[0.14em] text-destructive">
        <Dot tone="bad" pulse />
        no program
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 font-normal tracking-[0.14em] text-accent">
      <Dot tone="ok" pulse />
      local
      {health.slot != null ? (
        <span className="tabular-nums text-muted-foreground">
          · slot {health.slot}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Specimen stamp — localhost only.
 */
export function LocalhostStamp() {
  const { network, state } = useClusterHealth();
  if (network !== 'localhost') return null;

  const health = state.health;
  const loading = state.status === 'loading' || state.status === 'idle';

  let label = 'Local · Validator';
  let aria = 'Local validator network';
  if (loading) {
    label = 'Local · Checking';
    aria = 'Checking local validator';
  } else if (!health?.rpcOnline) {
    label = 'Local · Offline';
    aria = 'Local validator offline';
  } else if (!health.programDeployed) {
    label = 'Local · No Program';
    aria = 'Local validator online but c_vault program not deployed';
  }

  return (
    <div
      className="stamp absolute -right-2 -top-4 font-mono text-[10px] sm:-right-8 sm:top-0 motion-safe:animate-[cert-fadeup_0.8s_ease_0.5s_both]"
      role="status"
      aria-label={aria}
    >
      {label}
    </div>
  );
}
