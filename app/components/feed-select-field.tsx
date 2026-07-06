'use client';

import type { PythFeedRow } from '@/lib/pythFeedsClient';
import { inputClass, selectClass } from './ui-classes';

export function FeedSelectField({
  value,
  onChange,
  savedFeeds,
}: {
  value: string;
  onChange: (v: string) => void;
  savedFeeds: PythFeedRow[];
}) {
  return (
    <div className="space-y-2">
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        className={selectClass}
      >
        <option value="">Pick saved pair</option>
        {savedFeeds.map((f) => (
          <option key={f.id} value={f.address}>
            {f.pair} ({f.address.slice(0, 6)}…)
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Or paste feed account address"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}
