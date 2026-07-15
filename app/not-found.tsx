import Link from 'next/link';
import { btnSecondaryClass } from '@/app/components/ui-classes';

const MICROPRINT = 'CVAULT · NOT FOUND · SERIES 2026 · '.repeat(24);

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 flex-col items-center justify-center p-3 md:p-6">
        <div className="cert-frame relative w-full max-w-lg overflow-hidden bg-background px-6 py-12 text-center md:px-10 md:py-14">
          <div className="microprint border-y border-border py-1" aria-hidden>
            {MICROPRINT}
          </div>

          <p className="mt-8 font-mono text-[9px] uppercase tracking-[0.34em] text-muted-foreground">
            Instruction void · plate not issued
          </p>

          <h1 className="m-0 mt-4 font-display text-[clamp(48px,10vw,88px)] font-bold uppercase leading-none tracking-[0.04em] text-foreground">
            Not Found
          </h1>

          <p
            className="m-0 mt-3 font-mono text-sm font-bold tabular-nums tracking-[0.1em] text-seal"
            aria-hidden
          >
            &#8470; 404
          </p>

          <p className="m-0 mx-auto mt-6 max-w-[40ch] text-sm leading-[1.65] text-muted-foreground">
            This route is not on the registry. Check the address or return to the
            operations console.
          </p>

          <Link href="/" className={`${btnSecondaryClass} mt-8 inline-flex min-h-11 items-center`}>
            Back to console
          </Link>

          <div className="microprint mt-10 border-y border-border py-1" aria-hidden>
            {MICROPRINT}
          </div>
        </div>
      </div>
    </main>
  );
}