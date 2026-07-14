import { TWAP_OBSERVATION_MAX_STALE_SECS } from '../constants';

export function formatAge(secs: number): string {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return r ? `${m}m${r}s` : `${m}m`;
  return `${r}s`;
}

export function isObservationStale(
  lastUpdateTs: number,
  now: number,
  maxAgeSecs: number = TWAP_OBSERVATION_MAX_STALE_SECS,
): boolean {
  const ts = Number(lastUpdateTs);
  if (!Number.isFinite(ts) || ts <= 0) return true;
  return now - ts > maxAgeSecs;
}
