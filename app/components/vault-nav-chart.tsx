'use client';

import { useMemo, useState } from 'react';
import { VaultPanel } from './vault-panel';
import { VaultSourceTag } from './vault-source-tag';

const RANGES = ['24h', '7d', '30d', 'ALL'] as const;
type Range = (typeof RANGES)[number];

function makeSeries(range: Range, endPrice: number): { t: string; v: number }[] {
  const cfg = {
    '24h': { n: 60, vol: 0.0035, drift: 0.00018 },
    '7d': { n: 84, vol: 0.01, drift: 0.00055 },
    '30d': { n: 120, vol: 0.017, drift: 0.0009 },
    ALL: { n: 160, vol: 0.024, drift: 0.0016 },
  }[range];

  let seed = range.charCodeAt(0) * 7919 + range.length * 131 + 17;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };

  const back: number[] = [];
  let p = endPrice;
  for (let i = 0; i < cfg.n; i++) {
    back.push(p);
    p = p * (1 - cfg.drift + rnd() * cfg.vol * 2);
  }
  back.reverse();

  const label = (i: number) => {
    if (range === '24h')
      return `${String(Math.floor((i / cfg.n) * 24)).padStart(2, '0')}:00`;
    if (range === '7d') return `D${Math.max(1, Math.ceil((i / cfg.n) * 7))}`;
    if (range === '30d') return `${Math.max(1, Math.ceil((i / cfg.n) * 30))}d`;
    return `M${Math.max(1, Math.ceil((i / cfg.n) * 6))}`;
  };

  return back.map((v, i) => ({ t: label(i), v: Number(v.toFixed(6)) }));
}

/**
 * Illustrative NAV series only — historical tracking is not live yet.
 * Seeded from the current on-chain share price so the shape feels related.
 */
export function VaultNavChart({ sharePriceUsd }: { sharePriceUsd: number | null }) {
  const [range, setRange] = useState<Range>('30d');
  const endPrice = sharePriceUsd && sharePriceUsd > 0 ? sharePriceUsd : 1;

  const series = useMemo(() => makeSeries(range, endPrice), [range, endPrice]);
  const ret =
    series.length >= 2
      ? (series[series.length - 1].v / series[0].v - 1) * 100
      : 0;

  const w = 640;
  const h = 220;
  const padX = 8;
  const padY = 12;
  const minV = Math.min(...series.map((s) => s.v));
  const maxV = Math.max(...series.map((s) => s.v));
  const span = maxV - minV || 1;

  const coords = series.map((s, i) => {
    const x = padX + (i / Math.max(series.length - 1, 1)) * (w - padX * 2);
    const y = padY + (1 - (s.v - minV) / span) * (h - padY * 2);
    return { x, y };
  });
  const points = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const areaPath =
    coords.length > 0
      ? `M ${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)} ${coords
          .slice(1)
          .map((c) => `L ${c.x.toFixed(1)},${c.y.toFixed(1)}`)
          .join(' ')} L ${(w - padX).toFixed(1)},${(h - padY).toFixed(1)} L ${padX},${(h - padY).toFixed(1)} Z`
      : '';

  return (
    <VaultPanel
      label="NAV per share"
      right={
        <>
          <div className="flex border border-border">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] transition-colors ${
                  range === r
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <VaultSourceTag kind="mock" />
        </>
      }
    >
      <div className="relative h-[220px] w-full">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-full w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Illustrative ${range} NAV chart`}
        >
          <defs>
            <linearGradient id="vaultNavFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaPath ? (
            <path d={areaPath} fill="url(#vaultNavFill)" />
          ) : null}
          <polyline
            points={points}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-border pt-2.5 font-mono text-[10px] text-muted-foreground">
        <span>
          Illustrative — historical NAV tracking not live yet ·{' '}
          <span className={ret >= 0 ? 'text-accent' : 'text-seal'}>
            {ret >= 0 ? '+' : '−'}
            {Math.abs(ret).toFixed(2)}%
          </span>{' '}
          mock {range}
        </span>
        <span>seeded from live share price</span>
      </div>
    </VaultPanel>
  );
}
