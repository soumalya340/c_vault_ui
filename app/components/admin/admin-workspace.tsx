'use client';

import { useId, useState } from 'react';
import type { Network } from '@/app/providers';
import { AdminOnChainSection } from './admin-onchain-section';
import { AdminDbSection } from './admin-db-section';

type Workspace = 'onchain' | 'db';

const WORKSPACES: {
  id: Workspace;
  label: string;
  detail: string;
  mark: string;
  /** Active plate fill — accent (mechanism) vs seal (authority / ledger). */
  activeClass: string;
  focusRingClass: string;
}[] = [
  {
    id: 'onchain',
    label: 'On-chain calls',
    detail: 'Instructions · global state',
    mark: 'Σ',
    activeClass: 'bg-accent text-background',
    focusRingClass: 'focus-visible:ring-accent',
  },
  {
    id: 'db',
    label: 'DB management',
    detail: 'Vaults · registry · danger',
    mark: '⊞',
    activeClass: 'bg-seal text-background',
    focusRingClass: 'focus-visible:ring-seal',
  },
];

export function AdminWorkspace({ network }: { network: Network }) {
  const [workspace, setWorkspace] = useState<Workspace>('onchain');
  const tablistId = useId();

  return (
    <div className="flex flex-col gap-5">
      <div
        role="tablist"
        aria-label="Admin workspace"
        aria-orientation="horizontal"
        id={tablistId}
        className="cert-frame grid grid-cols-2 gap-0 overflow-hidden p-0"
      >
        {WORKSPACES.map((w, i) => {
          const active = workspace === w.id;
          return (
            <button
              key={w.id}
              type="button"
              role="tab"
              id={`${tablistId}-${w.id}`}
              aria-selected={active}
              aria-controls={`${tablistId}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => setWorkspace(w.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  const next: Workspace = w.id === 'onchain' ? 'db' : 'onchain';
                  setWorkspace(next);
                  requestAnimationFrame(() => {
                    document.getElementById(`${tablistId}-${next}`)?.focus();
                  });
                }
              }}
              className={`group relative flex min-h-[4.5rem] flex-col items-start justify-center gap-1 px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset md:min-h-[5rem] md:px-6 md:py-4 ${
                w.focusRingClass
              } ${i === 0 ? 'border-r border-border-strong' : ''} ${
                active
                  ? w.activeClass
                  : 'bg-background text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
              }`}
            >
              <span
                className={`font-mono text-[9px] font-bold uppercase tracking-[0.22em] ${
                  active ? 'text-background/70' : 'text-muted-foreground'
                }`}
              >
                <span aria-hidden className="mr-1.5 opacity-80">
                  {w.mark}
                </span>
                Plate {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className={`font-display text-base font-semibold uppercase tracking-[0.12em] md:text-lg md:tracking-[0.14em] ${
                  active ? 'text-background' : 'text-foreground'
                }`}
              >
                {w.label}
              </span>
              <span
                className={`hidden font-mono text-[10px] uppercase tracking-[0.14em] sm:block ${
                  active ? 'text-background/75' : 'text-muted-foreground'
                }`}
              >
                {w.detail}
              </span>
              {active && (
                <span
                  aria-hidden
                  className="absolute bottom-0 left-0 right-0 h-[3px] bg-background/35"
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${tablistId}-panel`}
        aria-labelledby={`${tablistId}-${workspace}`}
        className="min-w-0"
      >
        {workspace === 'onchain' ? (
          <AdminOnChainSection network={network} />
        ) : (
          <AdminDbSection network={network} />
        )}
      </div>
    </div>
  );
}
