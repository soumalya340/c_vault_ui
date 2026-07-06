'use client';

export function NetworkStatus() {
  return (
    <div
      className="flex items-center gap-3"
      role="status"
      aria-label="Connected to devnet. Mainnet coming soon."
    >
      <span className="stamp text-[9px]">
        specimen · devnet
      </span>
      <span
        className="hidden select-none font-mono text-[8px] uppercase tracking-[0.24em] text-muted-foreground/70 sm:inline"
        aria-hidden
      >
        mainnet
        <br />
        pending
      </span>
    </div>
  );
}
