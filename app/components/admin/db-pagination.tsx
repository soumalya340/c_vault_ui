'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { btnGhostClass } from '../ui-classes';

export const DB_PAGE_SIZE = 8;

export function DbPagination({
  page,
  pageCount,
  onPageChange,
  totalCount,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  totalCount: number;
}) {
  if (pageCount <= 1) return null;

  const start = page * DB_PAGE_SIZE + 1;
  const end = Math.min(totalCount, start + DB_PAGE_SIZE - 1);

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5"
    >
      <p className="font-mono text-[10px] tabular-nums text-text-ghost">
        {start}–{end} of {totalCount}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          className={`${btnGhostClass} !px-2`}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <span className="px-1.5 font-mono text-[11px] tabular-nums text-foreground">
          {page + 1} / {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page === pageCount - 1}
          className={`${btnGhostClass} !px-2`}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
