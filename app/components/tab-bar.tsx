'use client';

import { SECTION_STYLE, type SectionId } from './function-defs';

const TABS: { id: SectionId; label: string }[] = [
  { id: 'view', label: 'View' },
  { id: 'vaults', label: 'Vaults' },
  { id: 'vault-ops', label: 'Vault Ops' },
  { id: 'admin', label: 'Admin' },
];

export function TabBar({
  activeTab,
  setActiveTab,
}: {
  activeTab: SectionId;
  setActiveTab: (id: SectionId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Vault operations"
      className="flex divide-x divide-border border border-border-strong bg-background"
    >
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        const style = SECTION_STYLE[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-1 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.06em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset sm:px-3 sm:text-[11px] sm:tracking-[0.14em] ${
              active
                ? 'text-background'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
            }`}
            style={active ? { background: style.accent } : undefined}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
