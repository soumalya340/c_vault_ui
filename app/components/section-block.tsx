'use client';

import type { Network } from '@/lib/cvault';
import type { PythFeedRow } from '@/lib/pythFeedsClient';
import { AccordionItem } from './accordion-item';
import { panelClass, sectionLabelClass } from './ui-classes';
import { SECTION_STYLE, type FunctionDef, type SectionId } from './function-defs';

export function SectionBlock({
  id,
  label,
  functions,
  network,
  savedFeeds,
}: {
  id: SectionId;
  label: string;
  functions: FunctionDef[];
  network: Network;
  savedFeeds: PythFeedRow[];
}) {
  const style = SECTION_STYLE[id];

  return (
    <section aria-label={label} className="flex flex-col gap-4">
      <div className={`${panelClass} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
          <span className={`${sectionLabelClass} font-bold uppercase`}>{label}</span>
          <span
            className="rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.1em]"
            style={{ borderColor: `${style.accent}44`, color: style.accent }}
          >
            {functions.length} ops
          </span>
        </div>

        <div className="flex flex-col gap-2 p-3 md:p-4">
          {functions.map((fn) => (
            <AccordionItem
              key={fn.id}
              fn={fn}
              section={id}
              network={network}
              savedFeeds={savedFeeds}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
