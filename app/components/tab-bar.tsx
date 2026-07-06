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
    <div className="flex gap-0.5 rounded-2xl border border-border bg-foreground/5 p-1">
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        const style = SECTION_STYLE[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-xl px-3 py-2 font-mono text-xs font-bold uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              active ? '' : 'text-muted-foreground hover:text-foreground'
            }`}
            style={
              active
                ? {
                    background: `${style.accent}18`,
                    color: style.accent,
                    border: `1px solid ${style.accent}44`,
                  }
                : { border: '1px solid transparent' }
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
