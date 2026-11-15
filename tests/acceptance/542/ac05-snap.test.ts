// AC5 #542.e6403c8d: A scroll control with step 24 u, range [0, 21] and snap 7 (pages of 168 u): a 34 px trackpad
// gesture down writes position 1 and, at its end, 7; a 34 px gesture up from 7 ends on 0; a 10 px gesture writes
// nothing; the same deltas replayed at 30, 60 and 120 frames a second give one track hash; and a planted control that
// rounds to the nearest snap point ends the first gesture on 0 and fails, naming the control
//
// Through `deep-input input` (#308; README: The surface under test), on the list fixture with `pager` (document class,
// step 24 u at 1 px a u, range [0, 21], `snap: 7`, `page: 7`, over `listbox`): three trackpad gestures over the list,
// each a begin, its changes and an end: two changes of 17 px down; two of 17 px up; one of 10 px down. The same ops are
// played at 30, 60 and 120 frames a second. The planted `scroll_snaps_to_nearest` (README: Planted twins) ends a
// gesture on the snap point nearest its position instead of the next one in its direction.
import { describe, expect, it } from 'vitest';
import { tilesProgram } from './programs.ts';
import { OVER, PAGE, listDoc, putAtlas } from './fixtures.ts';
import { AC, FLICKS, TIMEOUT, failsNaming, none, once, prebuild, runInput, show, useTemp, type InputPlanted, type InputRun, type JsonObject } from './helpers.ts';

prebuild('deep-input');
const temp = useTemp();
const RATES = [30, 60, 120];
const F = FLICKS / 120;

const scroll = (t: number, phase: 'begin' | 'change' | 'end', dy: number): JsonObject => ({ op: 'scroll', phase, at: OVER, delta: [0, dy], t });
/** A gesture at `t0`: its begin, a change of each of `dys` px every 1/120 s, half a frame off the frames, and its end. */
const gestureOps = (t0: number, dys: number[]): JsonObject[] =>
  [scroll(t0, 'begin', 0), ...dys.map((dy, k) => scroll(t0 + F / 2 + k * F, 'change', dy)), scroll(t0 + F / 2 + dys.length * F, 'end', 0)];
const GESTURES = [
  { what: 'the 34 px gesture down', ops: gestureOps(FLICKS, [17, 17]) },
  { what: 'the 34 px gesture up from 7', ops: gestureOps(2 * FLICKS, [-17, -17]) },
  { what: 'the 10 px gesture', ops: gestureOps(3 * FLICKS, [10]) },
];
const OPS = GESTURES.flatMap((g) => g.ops);

function doc(): JsonObject {
  return listDoc('pager', { atlas: putAtlas(temp()), tiles: tilesProgram(), scroll: { id: 'pager', spec: { class: 'document', range: [0, 21], snap: 7, page: 7 } } });
}
/** Per gesture, the positions its changes wrote and those its end wrote, by the results' `appended` over the track. */
function byGesture(run: InputRun): { changes: number[]; end: number[] }[] {
  let at = 0;
  let op = 0;
  return GESTURES.map((g) => {
    const out = { changes: [] as number[], end: [] as number[] };
    g.ops.forEach((_, k) => {
      const r = run.results[op++];
      const n = r && typeof r['appended'] === 'number' ? r['appended'] : 0;
      const values = run.track.slice(at, at + n).map((e) => (typeof e['value'] === 'number' ? e['value'] : NaN));
      at += n;
      (k === g.ops.length - 1 ? out.end : out.changes).push(...values);
    });
    return out;
  });
}

/** The criterion's failures for one run, at `fps`. */
function judge(run: InputRun, fps: number): string[] {
  const failures: string[] = [];
  const [down, up, small] = byGesture(run);
  const strangers = run.track.filter((e) => e['control'] !== 'pager' || e['writer'] !== 'you');
  if (strangers.length) failures.push(`at ${fps} fps the track holds entries that aren't yours on pager: ${show(strangers, 400)}`);
  if (show(down!.changes) !== '[1]' || show(down!.end) !== '[7]')
    failures.push(`at ${fps} fps control pager: the first gesture writes ${show(down!.changes)} as it moves and ${show(down!.end)} at its end, so it ends on ${show([...down!.changes, ...down!.end].at(-1) ?? 0)}, not 1 and then 7`);
  const upLast = [...up!.changes, ...up!.end].at(-1);
  if (upLast !== 0 || show(up!.end) !== '[0]') failures.push(`at ${fps} fps control pager: the gesture up from 7 writes ${show(up!.changes)} as it moves and ${show(up!.end)} at its end, not ending on 0`);
  if (small!.changes.length || small!.end.length) failures.push(`at ${fps} fps control pager: the 10 px gesture writes ${show([...small!.changes, ...small!.end])}, not nothing`);
  return failures;
}
const play = (planted?: InputPlanted): InputRun[] => runInput(doc(), PAGE, RATES, OPS, 'AC5 three gestures over the snapping list', planted);
const honest = once(() => play());

describe(`${AC[5]} a snapping scroll control moves on to the next snap point in a gesture's direction as one more entry`, () => {
  it(`${AC[5]} 34 px down writes 1 and, at its end, 7; 34 px up from 7 ends on 0; 10 px writes nothing`, () => {
    none(honest().flatMap((run, i) => judge(run, RATES[i]!)), 'the three gestures at 30, 60 and 120 fps');
  }, TIMEOUT);

  it(`${AC[5]} the same deltas replayed at 30, 60 and 120 frames a second give one track hash`, () => {
    const runs = honest();
    expect(runs.map((r) => r.hash), `one track hash at 30, 60 and 120 fps; the tracks: ${runs.map((r) => show(r.track.map((e) => [e['t'], e['value']]), 400)).join(' | ')}`).toEqual(runs.map(() => runs[0]!.hash));
  }, TIMEOUT);

  it(`${AC[5]} planted scroll_snaps_to_nearest ends the first gesture on 0 and fails, naming the control`, () => {
    const runs = play('scroll_snaps_to_nearest');
    const first = byGesture(runs[1]!)[0]!;
    expect([...first.changes, ...first.end].at(-1), `at 60 fps the planted control ends the first gesture on 0: ${show(first)}`).toBe(0);
    failsNaming(judge(runs[1]!, 60), [/control pager: the first gesture/, /ends on 0, not 1 and then 7/], 'the planted nearest-snap control');
  }, TIMEOUT);
});
