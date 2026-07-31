'use client';
import { Spinner } from '@/components/ui/spinner';

export default function Preview() {
  return (
    <main className="mx-auto max-w-[480px] space-y-4 p-8 bg-background">
      <button
        disabled
        className="rounded-[2px] border border-accent bg-accent px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.18em] text-background disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="inline-flex items-center gap-2">
          <Spinner className="size-3.5" />
          Processing…
        </span>
      </button>
      <div className="flex items-center gap-3">
        <button
          disabled
          className="rounded-[2px] border border-accent bg-accent px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.18em] text-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="inline-flex items-center gap-2">
            <Spinner className="size-3.5" />
            Processing…
          </span>
        </button>
        <button
          disabled
          className="rounded-[2px] border border-accent bg-accent px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.18em] text-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          Claim
        </button>
      </div>
    </main>
  );
}
