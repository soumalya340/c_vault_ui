'use client';

import { useEffect, useRef } from 'react';
import type { Network } from '@/app/providers';

const CHIPS = [
  '3 instruments',
  'one instruction per control',
  'admin-approved registry',
];

function drawGuilloche(svg: SVGSVGElement, stroke: string) {
  const NS = 'http://www.w3.org/2000/svg';
  const cx = 400;
  const cy = 400;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  for (let ring = 0; ring < 3; ring++) {
    const base = 150 + ring * 90;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const e = document.createElementNS(NS, 'ellipse');
      e.setAttribute('cx', String(cx));
      e.setAttribute('cy', String(cy));
      e.setAttribute('rx', String(base + 40));
      e.setAttribute('ry', String(base - 60 - ring * 10));
      e.setAttribute('fill', 'none');
      e.setAttribute('stroke', stroke);
      e.setAttribute('stroke-width', '0.7');
      e.setAttribute('transform', `rotate(${(360 / n) * i + ring * 12} ${cx} ${cy})`);
      svg.appendChild(e);
    }
  }
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', '60');
  c.setAttribute('fill', 'none');
  c.setAttribute('stroke', stroke);
  c.setAttribute('stroke-width', '0.7');
  svg.appendChild(c);
}

export function VaultOpsHero({ network }: { network: Network }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current) drawGuilloche(svgRef.current, '#C4C2AE');
  }, []);

  return (
    <header className="relative overflow-hidden border-b-[1.5px] border-border-strong pb-8 pt-6 md:pb-10 md:pt-8">
      <svg
        ref={svgRef}
        viewBox="0 0 800 800"
        aria-hidden
        className="guilloche pointer-events-none absolute -right-28 -top-40 w-[620px] opacity-40 md:w-[740px]"
      />

      <div className="relative flex flex-wrap items-baseline justify-between gap-3 font-mono text-[9px] uppercase tracking-[0.28em] text-muted-foreground">
        <span>
          Plate <span className="text-seal">№ 03</span> · Series 2026
        </span>
        <span className="hidden sm:inline">Solana · {network}</span>
      </div>

      <div className="relative mt-6 grid min-w-0 items-end gap-6 md:grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_minmax(220px,340px)]">
        <div className="font-mono text-base font-semibold text-seal md:text-lg">03</div>

        <div className="min-w-0">
          <h1 className="font-display text-[clamp(36px,5vw,72px)] font-bold uppercase leading-[0.95] tracking-[-0.01em]">
            Create <em className="not-italic text-seal">ETF</em>
          </h1>
          <div className="mt-5 h-1 w-28 bg-seal" />
          <div className="mt-5 flex flex-wrap gap-2.5">
            {CHIPS.map((label) => (
              <span
                key={label}
                className="inline-flex items-center gap-2 border border-border-strong px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground"
              >
                <span className="h-1.5 w-1.5 bg-seal" />
                {label}
              </span>
            ))}
          </div>
        </div>

        <p className="min-w-0 border-l border-border-strong pl-5 pb-1 text-sm leading-relaxed text-foreground/80 md:col-span-2 lg:col-span-1 lg:max-w-[340px]">
          Create ETF vaults, execute basket swaps, and run the operational instruction set —{' '}
          <strong className="font-medium text-foreground">
            every control below maps to exactly one on-chain instruction.
          </strong>
        </p>
      </div>

      <span
        aria-hidden
        className="absolute -bottom-[1.5px] left-0 h-[3px] w-20 bg-seal"
      />
    </header>
  );
}
