'use client';

export interface PythFeedRow {
  id: number;
  pair: string;
  address: string;
  updated_at: string;
}

export async function fetchFeeds(): Promise<PythFeedRow[]> {
  const res = await fetch('/api/pyth-feeds');
  if (!res.ok) throw new Error('Failed to load Pyth feeds');
  return res.json();
}

export async function saveFeed(pair: string, address: string): Promise<PythFeedRow> {
  const res = await fetch('/api/pyth-feeds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pair, address }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to save feed' }));
    throw new Error(err.error ?? 'Failed to save feed');
  }
  return res.json();
}

export async function removeFeed(id: number): Promise<void> {
  const res = await fetch(`/api/pyth-feeds/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete feed');
}
