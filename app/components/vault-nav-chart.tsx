'use client';

import { useMemo, useState } from 'react';
import { panelClass, sectionLabelClass } from './ui-classes';

const RANGES = ['24h', '7d', '30d', 'ALL'] as const;
type Range = (typeof RANGES)[number];

const POINTS_BY_RANGE: Record<Range, number> = {
  '24h': 24,
  '7d': 28,
  '30d': 30,
  ALL: 52,
};

/** Deterministic pseudo-random walk seeded by vaultId — same shape every render, differs per vault. */
function mockSeries(seed: number, points: number): number[] {
  let state = seed * 9301 + 49297;
  const next = () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
  let value = 1;
  const series: number[] = [];
  for (let i = 0; i < points; i++) {
    value = Math.max(0.05, value + (next() - 0.5) * 0.08);
    series.push(value);
  }
  return series;
}

function buildPath(series: number[], width: number, height: number): string {
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const step = width / (series.length - 1 || 1);
  return series
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function VaultNavChart({ seed }: { seed: number }) {
  const [range, setRange] = useState<Range>('30d');
  const series = useMemo(() => mockSeries(seed, POINTS_BY_RANGE[range]), [seed, range]);
  const width = 600;
  const height = 180;
  const path = useMemo(() => buildPath(series, width, height), [series]);

  return (
    <div className={`${panelClass} flex flex-col gap-4 px-5 py-4 md:px-6`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`${sectionLabelClass} uppercase`}>NAV per share</span>
        <div className="t-tabs border border-border" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className="t-tab px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em]"
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Illustrative NAV per share trend"
      >
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
      </svg>

      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
        Illustrative — historical NAV tracking not live yet
      </p>
    </div>
  );
}
