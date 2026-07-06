'use client';

import type { Network } from '@/lib/cvault';
import type { PythFeedRow } from '@/lib/pythFeedsClient';
import { AccordionItem } from './accordion-item';
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
    <div className="space-y-3">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </h2>
        <span
          className="rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.1em]"
          style={{ borderColor: `${style.accent}44`, color: style.accent }}
        >
          {functions.length} ops
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="space-y-2">
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
  );
}
