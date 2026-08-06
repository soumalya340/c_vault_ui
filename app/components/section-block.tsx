'use client';

import type { Network } from '@/lib/onchain/cvault';
import { AccordionItem } from './accordion-item';
import { panelClass, sectionLabelClass } from './ui-classes';
import { SECTION_STYLE, type FunctionDef, type SectionId } from './function-defs';

export function SectionBlock({
  id,
  label,
  functions,
  network,
}: {
  id: SectionId;
  label: string;
  functions: FunctionDef[];
  network: Network;
}) {
  const style = SECTION_STYLE[id];

  return (
    <section aria-label={label} className="flex flex-col gap-4">
      <div className={`${panelClass} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong px-5 py-3.5 md:px-6">
          <span
            className="font-display text-base font-semibold uppercase tracking-[0.18em]"
            style={{ color: style.accent }}
          >
            {label}
          </span>
          <span className={`${sectionLabelClass} uppercase`}>
            {functions.length} instruments · series 2026
          </span>
        </div>

        <div className="flex flex-col divide-y divide-border px-3 py-1 md:px-4">
          {functions.map((fn) => (
            <AccordionItem
              key={fn.id}
              fn={fn}
              section={id}
              network={network}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
