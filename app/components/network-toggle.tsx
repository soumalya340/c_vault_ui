'use client';

import { useCallback, useEffect, useRef } from 'react';
import { isLocalOrigin, type Network } from '@/app/providers';

export function NetworkToggle({
  network,
  onChange,
}: {
  network: Network;
  onChange: (network: Network) => void;
}) {
  // A deployed site can never reach a local validator — only offer the
  // localhost cluster when the page itself is served from a local origin.
  const options = isLocalOrigin()
    ? (['localhost', 'mainnet'] as const)
    : (['mainnet'] as const);

  const pillRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const hasPositioned = useRef(false);

  const movePill = useCallback(
    (animate: boolean) => {
      const pill = pillRef.current;
      const tab = tabRefs.current.get(network);
      if (!pill || !tab) return;

      if (!animate) {
        const prev = pill.style.transition;
        pill.style.transition = 'none';
        pill.style.transform = `translateX(${tab.offsetLeft}px)`;
        pill.style.width = `${tab.offsetWidth}px`;
        void pill.offsetWidth;
        pill.style.transition = prev;
      } else {
        pill.style.transform = `translateX(${tab.offsetLeft}px)`;
        pill.style.width = `${tab.offsetWidth}px`;
      }
    },
    [network],
  );

  useEffect(() => {
    const animate = hasPositioned.current;
    const id = requestAnimationFrame(() => {
      movePill(animate);
      hasPositioned.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [movePill, options.length]);

  useEffect(() => {
    const onResize = () => movePill(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [movePill]);

  return (
    <div className="t-tabs border border-border" role="group" aria-label="Network">
      <span ref={pillRef} className="t-tabs-pill" aria-hidden="true" />
      {options.map((n) => {
        const active = network === n;
        return (
          <button
            key={n}
            ref={(el) => {
              if (el) tabRefs.current.set(n, el);
              else tabRefs.current.delete(n);
            }}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={active}
            className="t-tab px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em]"
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
