'use client';

export function NetworkStatus() {
  return (
    <div
      className="flex items-center gap-1 rounded-full border border-border bg-foreground/5 p-1 backdrop-blur-sm"
      role="status"
      aria-label="Connected to devnet. Mainnet coming soon."
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-900">
        <span
          className="h-1.5 w-1.5 rounded-full bg-neutral-900/50 motion-safe:animate-[forge-blink_1.6s_ease_infinite]"
          aria-hidden
        />
        devnet
      </span>
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 opacity-40 select-none"
        aria-disabled="true"
      >
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          mainnet
        </span>
        <span className="rounded-full border border-border/60 px-1.5 py-0.5 font-mono text-[7px] uppercase tracking-[0.24em] text-muted-foreground/80">
          coming soon
        </span>
      </span>
    </div>
  );
}
