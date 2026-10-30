// AC5: freshness on three surfaces. A recorded test source answers 182.40 at 10:00:00, is fresh for 60 s, and fails
// every call after it on the test clock (the scenario's virtual clock; 10:00:00 is flick 60 s, README). A bound value
// of it in a panel's text, in a sheet cell and in a chart's label draws live until 10:01:00 and greyed from then,
// with an age of 2 minutes at 10:02:00; the reading's as-of stays 10:00:00 after every failed call. At the base
// `deep-show` has no `install` call and answers the scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  Driver, LEAD, MS, PERIOD_A, SEC, SLOTS, at, drawnOf, isObject, num, obj, useOut, useShow, type Bind, type Drawn, type JsonObject, type Planted,
} from './helpers.ts';

const show = useShow();
const out = useOut();

/** 10:00:00 on the test clock. */
const TEN = 60 * SEC;
const FRESH = 60 * SEC;
/** Within one frame of an instant: the first vsync at or after it on A (120 Hz), with the latch lead. */
const FRAME = PERIOD_A + LEAD;
const BIND: Bind = { source: 'reading:quotes', select: 'value', format: { unit: 'USD', precision: 2, notation: 'fixed' }, show: { source: true, as_of: true }, stale_after: FRESH, missing: 'dash' };
/** The three surfaces: each panel, and the element path its bound value is drawn at. */
const SURFACES = [
  { name: 'panel quote (text price)', panel: 'quote', element: 'price' },
  { name: 'sheet cell table (grid/price)', panel: 'table', element: 'grid/price' },
  { name: 'chart label chart (trend/label)', panel: 'chart', element: 'trend/label' },
] as const;
const LIVE_AT = [TEN + 2 * FRAME, TEN + 30 * SEC, TEN + 60 * SEC - MS];
const STALE_AT = [TEN + 60 * SEC + FRAME, TEN + 90 * SEC, TEN + 120 * SEC + FRAME];
const CALLS_AT = [1, 2, 3, 4, 5, 6].map((k) => TEN + k * 20 * SEC); // the failed calls, 10:00:20 … 10:02:00

function world(evidence: string, planted?: Planted) {
  return {
    evidence, panels: { quote: SLOTS[0]!, table: SLOTS[1]!, chart: SLOTS[2]! }, ...(planted ? { planted } : {}),
    plugins: {
      stocks: {
        sources: { quotes: { fresh_for: FRESH, replay: [{ value: 182.4, unit: 'USD' }], then: { fails: 'http_503' } } },
        panels: {
          // The quote panel reads the source through the hub every 20 s from 10:00:00: one answer, then failures.
          quote: { tree: [{ id: 'price', component: 'text' as const, bind: BIND }], script: { timers: [{ first: TEN, every: 20 * SEC, until: TEN + 125 * SEC, do: [{ op: 'read' as const, source: 'quotes' }] }] } },
          table: { tree: [{ id: 'grid', component: 'sheet' as const, cells: [{ id: 'symbol', text: 'AAPL' }, { id: 'price', bind: BIND }] }] },
          chart: { tree: [{ id: 'trend', component: 'chart' as const, label: { bind: BIND } }] },
        },
      },
    },
  };
}

const clock = (t: number): string => {
  const s = Math.floor((t - TEN) / SEC) + 600 * 60;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.round(((t - TEN) % SEC) / MS)).padStart(3, '0')}`;
};
const AGE_2_MIN = /\b2\s*(?:m|min|mins|minutes?)\b/i;

/** The criterion's check, as failures each naming its surface (or the reading). */
function freshness(planted?: Planted): string[] {
  const d = new Driver(show(), world(out(), planted));
  const drawnCalls = [...LIVE_AT, ...STALE_AT].flatMap((t) => SURFACES.map((s) => at('drawn', t, { panel: s.panel })));
  const readingCalls = CALLS_AT.map((t) => at('reading', t + MS, { source: 'quotes' }));
  const r = d.step([...drawnCalls, ...readingCalls], `the freshness fixture${planted ? ` (planted ${planted})` : ''}`);
  const f: string[] = [];
  const times = [...LIVE_AT, ...STALE_AT];
  times.forEach((t, i) => SURFACES.forEach((s, j) => {
    const frame = drawnOf(r[i * SURFACES.length + j], `${s.name} at ${clock(t)}`);
    const b: Drawn | undefined = frame.bound.find((x) => x.element === s.element);
    if (!b) { f.push(`${s.name}: no bound value drawn at ${clock(t)}`); return; }
    if (b.source !== BIND.source) f.push(`${s.name}: draws source ${b.source}, not ${BIND.source}`);
    if (b.as_of !== TEN) f.push(`${s.name}: at ${clock(t)} its as-of is ${b.as_of === null ? 'none' : clock(b.as_of)}, not 10:00:00.000`);
    if (!b.text.includes('182.40')) f.push(`${s.name}: at ${clock(t)} its text ${JSON.stringify(b.text)} doesn't show 182.40`);
    if (i < LIVE_AT.length) {
      if (b.stale) f.push(`${s.name}: drawn greyed at ${clock(t)}, before 10:01:00`);
    } else {
      if (!b.stale) f.push(`${s.name}: drawn live at ${clock(t)} (frame at ${clock(frame.vsync)}), past its freshness at 10:01:00`);
      if (frame.vsync > t) f.push(`${s.name}: the frame on screen at ${clock(t)} is from ${clock(frame.vsync)}, later than asked`);
      // Its age: the frame's pinned time less the as-of time (#392's reading of Bound value).
      if (b.stale && b.age !== frame.vsync - TEN) f.push(`${s.name}: greyed at ${clock(t)} with age ${b.age === null ? 'none' : `${b.age / SEC} s`}, not ${(frame.vsync - TEN) / SEC} s, its frame's time less 10:00:00`);
    }
    if (t === STALE_AT[2]) {
      if (b.age === null || b.age < 120 * SEC || b.age > 120 * SEC + FRAME) f.push(`${s.name}: at 10:02:00 its age is ${b.age === null ? 'none' : `${b.age / SEC} s`}, not 2 minutes`);
      if (!AGE_2_MIN.test(b.text)) f.push(`${s.name}: at 10:02:00 its text ${JSON.stringify(b.text)} doesn't show an age of 2 minutes`);
    }
  }));
  // The reading itself: one answer at 10:00:00, and each later call failed and made no reading.
  CALLS_AT.forEach((t, k) => {
    const reply = obj(r[drawnCalls.length + k], `the reading after the call at ${clock(t)}`);
    const reading = isObject(reply['reading']) ? reply['reading'] : null;
    if (!reading) { f.push(`reading quotes: none after the failed call at ${clock(t)}`); return; }
    if (reading['as_of'] !== TEN) f.push(`reading quotes: as-of ${typeof reading['as_of'] === 'number' ? clock(reading['as_of']) : JSON.stringify(reading['as_of'])} after the failed call at ${clock(t)}, not 10:00:00.000`);
    if (reading['value'] !== 182.4) f.push(`reading quotes: value ${JSON.stringify(reading['value'])} after the failed call at ${clock(t)}, not 182.40`);
    const calls = (Array.isArray(reply['calls']) ? reply['calls'] : []) as JsonObject[];
    const outcomes = calls.map((c) => `${clock(num(c['at'], 'call.at'))} ${String(c['outcome'])}`);
    const want = [`${clock(TEN)} answered`, ...CALLS_AT.slice(0, k + 1).map((c) => `${clock(c)} failed`)];
    if (JSON.stringify(outcomes) !== JSON.stringify(want)) f.push(`reading quotes: the calls by ${clock(t)} were ${JSON.stringify(outcomes)}, not ${JSON.stringify(want)}`);
  });
  return f;
}

describe('AC5 a cached answer keeps its as-of time, a failed call makes no reading, and every surface greys the value with its age', () => {
  it('AC5 the panel, the sheet cell and the chart label draw 182.40 live until 10:01:00 and greyed from then, with an age of 2 minutes at 10:02:00; the as-of stays 10:00:00', () => {
    expect(freshness(), 'the three surfaces and the reading').toEqual([]);
    // Wrong program: a refresh that serves the cached answer with a new as-of after each failed call keeps all three live.
    const twin = freshness('refresh_restamps_cached');
    for (const s of SURFACES) expect(twin.some((m) => m.startsWith(`${s.name}: drawn live`)), `the planted refresh_restamps_cached fails, naming ${s.name}: ${JSON.stringify(twin.slice(0, 6))}`).toBe(true);
  }, 600_000);
});
