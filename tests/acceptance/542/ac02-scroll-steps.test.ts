// AC2 #542.e7435bc2: A scroll control over a 200-row list, with step 24 px and range [0, 190]: three wheel lines down
// write positions 1, 2 and 3; a trackpad gesture of 60 px down writes 4 and 5 and keeps 12 px, and 12 px more in the
// same gesture writes 6; the same recorded deltas replayed at 30, 60 and 120 frames a second give one track hash; and a
// planted control that rounds each frame's share of a delta on its own writes different positions at 30 and 120 frames
// a second and fails, naming the entry
//
// Through `deep-input input` (#308: the input module's session, played at a frame rate; README: The surface under
// test), on the list fixture (a document-class `list`, step 24 u at 1 px a u, range [0, 190], over `listbox`): three
// wheel lines, then one trackpad gesture over the list, its begin, four changes of 15 px (60 px) and one of 12 px, then
// its end. The events come every 1/120 s, half a 120 Hz frame off the frames, so at 120 frames a second each frame
// takes one change and at 30 each takes four. The same ops are played at 30, 60 and 120 frames a second. The planted
// `scroll_rounds_each_frame` (README: Planted twins) quantizes each frame's summed delta on its own, keeping no rest.
import { describe, expect, it } from 'vitest';
import { tilesProgram } from './programs.ts';
import { OVER, PAGE, listDoc, putAtlas } from './fixtures.ts';
import { AC, FLICKS, MS, TIMEOUT, failsNaming, none, num, once, prebuild, runInput, show, useTemp, type InputPlanted, type InputRun, type JsonObject } from './helpers.ts';

prebuild('deep-input');
const temp = useTemp();
const RATES = [30, 60, 120];
/** A 120 Hz frame, and the gesture's events half a frame off the frames. */
const F = FLICKS / 120;
const T0 = FLICKS;
const T1 = 2 * FLICKS;

const scroll = (t: number, phase: 'begin' | 'change' | 'end', dy: number, unit?: 'line'): JsonObject =>
  ({ op: 'scroll', phase, at: OVER, delta: [0, dy], ...(unit ? { unit } : {}), t });
/** The recorded ops, and which belong to which part of the criterion. */
const OPS: JsonObject[] = [
  scroll(T0, 'change', 1, 'line'), scroll(T0 + 100 * MS, 'change', 1, 'line'), scroll(T0 + 200 * MS, 'change', 1, 'line'),
  scroll(T1, 'begin', 0),
  ...[0, 1, 2, 3].map((k) => scroll(T1 + F / 2 + k * F, 'change', 15)),
  scroll(T1 + F / 2 + 4 * F, 'change', 12),
  scroll(T1 + F / 2 + 5 * F, 'end', 0),
];
const PARTS = [
  { what: 'the first wheel line', ops: [0], want: [1] },
  { what: 'the second wheel line', ops: [1], want: [2] },
  { what: 'the third wheel line', ops: [2], want: [3] },
  { what: 'the gesture\'s begin and 60 px down', ops: [3, 4, 5, 6, 7], want: [4, 5] },
  { what: '12 px more in the same gesture', ops: [8], want: [6] },
  { what: 'the gesture\'s end', ops: [9], want: [] },
];

function doc(): JsonObject {
  return listDoc('list', { atlas: putAtlas(temp()), tiles: tilesProgram(), scroll: { id: 'list', spec: { class: 'document', range: [0, 190] } } });
}
/** The positions each op wrote, by the results' `appended` counts over the track in order. */
function written(run: InputRun): number[][] {
  let at = 0;
  return run.results.map((r) => {
    const n = typeof r['appended'] === 'number' ? r['appended'] : 0;
    const out = run.track.slice(at, at + n).map((e) => (typeof e['value'] === 'number' ? e['value'] : NaN));
    at += n;
    return out;
  });
}
const entryText = (e: JsonObject | undefined): string => (e ? `{t: ${String(e['t'])}, value: ${show(e['value'])}}` : 'none');

/** The criterion's failures for the three runs (30, 60 and 120 frames a second). */
function judge(runs: InputRun[]): string[] {
  const failures: string[] = [];
  runs.forEach((run, i) => {
    const by = written(run);
    for (const p of PARTS) {
      const got = p.ops.flatMap((k) => by[k] ?? []);
      if (show(got) !== show(p.want)) failures.push(`at ${RATES[i]} fps ${p.what} writes positions ${show(got)}, not ${show(p.want)}`);
    }
    const strangers = run.track.filter((e) => e['control'] !== 'list' || e['writer'] !== 'you');
    if (strangers.length) failures.push(`at ${RATES[i]} fps the track holds entries that aren't yours on list: ${show(strangers, 400)}`);
  });
  // One track hash, and the entry where two rates' tracks part, named.
  for (let i = 1; i < runs.length; i++) {
    const [a, b] = [runs[0]!, runs[i]!];
    if (a.hash === b.hash) continue;
    const k = Array.from({ length: Math.max(a.track.length, b.track.length) }, (_, j) => j).find((j) => show(a.track[j]) !== show(b.track[j]));
    failures.push(k === undefined
      ? `the track hashes differ at ${RATES[0]} and ${RATES[i]} fps (${a.hash}, ${b.hash}) with the same entries`
      : `the entry ${k} of list differs: at ${RATES[0]} fps ${entryText(a.track[k])}, at ${RATES[i]} fps ${entryText(b.track[k])}`);
  }
  return failures;
}
const play = (planted?: InputPlanted): InputRun[] => runInput(doc(), PAGE, RATES, OPS, 'AC2 the wheel lines and the gesture over the list', planted);
const honest = once(() => play());

describe(`${AC[2]} a scroll control turns wheel lines and trackpad pixels into whole steps once, at the gesture`, () => {
  it(`${AC[2]} three wheel lines write 1, 2 and 3; 60 px down writes 4 and 5 and keeps 12 px; 12 px more in the same gesture writes 6`, () => {
    const runs = honest();
    none(judge(runs).filter((f) => !/differ/.test(f)), 'the positions each event writes, at 30, 60 and 120 fps');
  }, TIMEOUT);

  it(`${AC[2]} the same recorded deltas replayed at 30, 60 and 120 frames a second give one track hash`, () => {
    const runs = honest();
    expect(runs.map((r) => r.hash), `one track hash at 30, 60 and 120 fps: ${show(judge(runs).filter((f) => /differ/.test(f)))}`).toEqual(runs.map(() => runs[0]!.hash));
    none(judge(runs), 'the replays at three frame rates');
  }, TIMEOUT);

  it(`${AC[2]} planted scroll_rounds_each_frame writes different positions at 30 and 120 frames a second and fails, naming the entry`, () => {
    const runs = play('scroll_rounds_each_frame');
    const values = (r: InputRun): number[] => r.track.map((e) => num(e['value'], 'a position'));
    expect(show(values(runs[0]!)), `the planted control writes other positions at 30 fps (${show(values(runs[0]!))}) than at 120 (${show(values(runs[2]!))})`).not.toBe(show(values(runs[2]!)));
    failsNaming(judge(runs), [/the entry \d+ of list differs: at 30 fps .* at 120 fps/], 'the planted per-frame rounding');
  }, TIMEOUT);
});
