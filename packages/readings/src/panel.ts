// What the Numbers panel shows of each reading, and what deep_search finds.
import type { ClassifierCheck, Reading } from './types.js';

export interface PanelRow {
  id: string; subject: string | null; value: number | string | null; unit: string;
  source: string; age_ms: number; basis: 'observed' | 'modeled';
  status: 'current' | 'STALE';
  agreement: { share: number; n: number; status: ClassifierCheck['status'] } | null;
  cost?: Reading['cost']; complete?: boolean; by?: Reading['by']; band?: Reading['band']; detail?: Reading['detail'];
}
interface Freshness { now: number; fresh_for: Record<string, number> }
/** A source with no freshness limit is current. */
export function freshness(r: Reading, options: Freshness): 'current' | 'STALE' {
  const limit = options.fresh_for[r.source];
  return limit !== undefined && options.now - r.as_of > limit ? 'STALE' : 'current';
}
/** Readings outside their band first. */
export function panelRows(readings: Reading[], options: Freshness): PanelRow[] {
  const rows = readings.map((r): PanelRow => {
    const age_ms = Math.max(0, options.now - r.as_of);
    const check = r.classifier;
    return {
      id: r.id, subject: r.subject, value: r.value, unit: r.unit, source: r.source, age_ms, basis: r.basis,
      status: freshness(r, options),
      agreement: check && check.agreement !== null ? { share: check.agreement, n: check.n, status: check.status } : null,
      ...(r.cost ? { cost: r.cost } : {}), ...(r.complete !== undefined ? { complete: r.complete } : {}), ...(r.by ? { by: r.by } : {}), ...(r.band ? { band: r.band } : {}), ...(r.detail ? { detail: r.detail } : {}),
    };
  });
  return rows.sort((a, b) => Number(b.band === 'over') - Number(a.band === 'over'));
}

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export interface ReadingHit { reading: Reading; source: string; as_of: number }
/** Each word of the query in the reading's id, subject, unit or source; a recorded id runs its words together, so within the id too. */
export function searchReadings(readings: Reading[], query: string): ReadingHit[] {
  const wanted = words(query);
  if (!wanted.length) return [];
  return readings.filter((r) => {
    const have = new Set(words(`${r.id} ${r.subject ?? ''} ${r.unit} ${r.source}`));
    return wanted.every((w) => have.has(w) || r.id.toLowerCase().includes(w));
  }).map((reading) => ({ reading, source: reading.source, as_of: reading.as_of }));
}
