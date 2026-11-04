// Planted wrong program (#45): the low cache reading ignores the 50,000-token floor and shows for every turn whose hits are
// under 20% of its context, a turn under 50,000 input tokens included.
export * from './impl.js';
import { readingsOf as realReadingsOf, recompute as realRecompute, update as realUpdate } from './impl.js';
import type { Reading, RecordEvent, ReadingsState } from './impl.js';

interface Wrapped { real: ReadingsState; events: RecordEvent[] }

export function recompute(events: RecordEvent[]): ReadingsState {
  return { real: realRecompute(events), events: [...events] } satisfies Wrapped;
}

export function update(state: ReadingsState, events: RecordEvent[]): ReadingsState {
  const { real, events: seen } = state as Wrapped;
  return { real: realUpdate(real, events), events: [...seen, ...events] } satisfies Wrapped;
}

export function readingsOf(state: ReadingsState): Reading[] {
  const { real, events } = state as Wrapped;
  const read = realReadingsOf(real);
  const extra: Reading[] = [];
  for (const e of events) {
    if (e.kind !== 'turn.usage') continue;
    const data = e.data as { turn: string; tokens: { input: number; cached: number } };
    const context = data.tokens.input + data.tokens.cached;
    const share = context === 0 ? 0 : (100 * data.tokens.cached) / context;
    if (context >= 50_000 || share >= 20) continue;
    if (read.some((r) => r.id === 'cache.low' && r.subject === data.turn)) continue;
    extra.push({ id: 'cache.low', subject: data.turn, value: share, unit: '%', source: 'record', as_of: e.ts, basis: 'observed', band: 'over' });
  }
  return [...read, ...extra];
}
