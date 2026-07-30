import type { ReactNode } from 'react';
import { panelClass } from './ui-classes';

/** Certificate-style panel used across the vault detail page. */
export function VaultPanel({
  label,
  right,
  flush,
  children,
  className = '',
}: {
  label?: string;
  right?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${panelClass} overflow-hidden ${className}`}>
      {label ? (
        <header className="flex items-center justify-between gap-3 border-b border-border-strong px-4 py-2.5 md:px-5">
          <h2 className="font-display text-[17px] font-bold tracking-[0.04em] text-foreground">
            {label}
          </h2>
          {right ? (
            <div className="flex flex-wrap items-center justify-end gap-2.5">{right}</div>
          ) : null}
        </header>
      ) : null}
      <div className={flush ? '' : 'px-4 py-4 md:px-5'}>{children}</div>
    </section>
  );
}
