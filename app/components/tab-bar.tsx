'use client';

import { SECTION_STYLE, type SectionId } from './function-defs';

const TABS: { id: SectionId; label: string }[] = [
  { id: 'view', label: 'View' },
  { id: 'deposit', label: 'Deposit' },
  { id: 'redeem', label: 'Redeem' },
  { id: 'feeds', label: 'Feeds' },
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
      className="flex gap-1 rounded-2xl border border-border bg-foreground/5 p-1 shadow-sm backdrop-blur-sm"
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
            className={`flex-1 rounded-xl px-3 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              active
                ? 'border border-accent/40 bg-accent/10 text-foreground'
                : 'border border-transparent text-muted-foreground hover:text-foreground'
            }`}
            style={active ? { color: style.accent } : undefined}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
