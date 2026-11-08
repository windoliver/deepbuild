// AC5 #432.5c39ff99: A figure whose finish chain holds grain, vignette, tint and grade, with two variant sets, day or
// night (each a patch that swaps the tint) and print or screen (each a patch that adds or drops a halftone pass), is
// played live through all four combinations: no pipeline is created and no frame reports settling after the first frame,
// counted on the noop lane and on the reference Mac. With a third set of nine options, each swapping the grade, so the
// fused chains would pass 32, the operators that differ run as their own passes, the session holds at most 32 operator
// pipelines, and still none is created after the first frame. A warm-up that fuses only the default options creates a
// pipeline at the first switch and fails, naming the option and the time; and the same revision reached through two edit
// orders fuses the same passes, by pipeline key.
//
// The figure (helpers: `finishDoc`, `FINISH`): a still board under the finish chain grain, vignette, tint, grade (each
// pixel-wise, chain finish, half resolution); variant set `time` (day, the default; night), each setting the tint's
// steps; set `medium` (screen, the default, the empty patch; print, creating the pixel-wise pass `halftone` after the
// grade); each picked by a document-class choice control (`time_choice`, `medium_choice`). `live` at 30 fps:
// - Four states: day+screen from frame 1, night+screen from 31 (1 s), night+print from 61 (2 s), day+print from 91 (3 s),
//   120 frames. Nine grades more (`look`, g0 … g8, each setting the grade's steps to another blend; `look_choice`) make
//   2 × 2 × 9 = 36 fused chains, past the 32 operator pipelines a session holds: the session is played through all 36
//   states, one every 3 frames from frame 1, each by entries on all three controls (110 frames).
// - On the noop lane and on Metal: after each session's first drawn frame no view row lists a created pipeline or reports
//   `settled: false`, and every view row's `operator_pipelines` is at most 32. On Metal with `report: ["passes"]`, in the
//   36-state session every pass that runs tint, halftone or grade runs it alone (the three differ between states), and
//   tint and grade each run in some pass.
// - Two edit orders (Metal, `report: ["passes"]`): sessions `order_a` and `order_b` open the two-set figure; `order_a` is
//   revised at frame 11 to a grain of another amount and at 21 to that plus a pass `lift` between vignette and tint;
//   `order_b` gets `lift` first, then the grain, its items written in another order. The last revisions are one revision;
//   the last frame each session drew with operator passes lists the same passes, in order, with the same pipeline keys
//   and operators.
// - `--planted fuses_default_options` (noop lane): the four-state play creates a pipeline first at frame 31, the first
//   switch, to night at 1 s, and the failure names the option and the time.
// Off a reference Mac the Metal counts are INCONCLUSIVE after they held.
// Wrong programs: a warm-up that fuses only the defaults; fused chains kept past 32; fusion that follows the edit order.
import { describe, expect, it } from 'vitest';
import {
  AC, FINISH, GRADES, WRITER, WRITER_B, asItem, clone, colorPass, createdAt, createdFrames, finishDoc, finishExtra, finishItems, inputAt, liveCall,
  liveReply, named, operatorPasses, payload, requireGpu, requireReferenceMac, reviseAt, run, sceneDoc, seconds, shown, useBin, useOut, viewsOf,
  warmProblems, writeJson, type JsonObject, type Lane, type Live,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const FPS = FINISH.fps;
const FOUR: { frame: number; time: string; medium: string }[] = [
  { frame: 31, time: 'night', medium: 'screen' }, { frame: 61, time: 'night', medium: 'print' }, { frame: 91, time: 'day', medium: 'print' },
];
function fourEvents(session: string): JsonObject[] {
  const ev: JsonObject[] = [];
  let at = { time: 'day', medium: 'screen' };
  for (const s of FOUR) {
    if (s.time !== at.time) ev.push(inputAt(s.frame, session, 'time_choice', s.time));
    if (s.medium !== at.medium) ev.push(inputAt(s.frame, session, 'medium_choice', s.medium));
    at = s;
  }
  return ev;
}
/** All 36 states, one every 3 frames from frame 1, each set on all three controls. */
function allStates(session: string): JsonObject[] {
  const ev: JsonObject[] = [];
  for (let k = 0; k < 36; k++) {
    const frame = 1 + 3 * k;
    ev.push(inputAt(frame, session, 'time_choice', k % 2 ? 'night' : 'day'));
    ev.push(inputAt(frame, session, 'medium_choice', Math.floor(k / 2) % 2 ? 'print' : 'screen'));
    ev.push(inputAt(frame, session, 'look_choice', GRADES[Math.floor(k / 4)]!));
  }
  return ev;
}
function play(dir: string, lane: Lane, report: boolean, planted?: 'fuses_default_options'): { four: Live; grades: Live } {
  const rep = report ? { report: ['passes'] } : {};
  const doc = (name: string, grades: boolean) => writeJson(dir, `${name}-${lane}-${planted ?? 'shipped'}.json`, payload(finishDoc(`${name}-432`, grades)));
  const [a, b] = run(bin(), dir, [
    liveCall({ frames: 120, fps: FPS, sessions: [{ session: 'four', writer: WRITER, doc: doc('four', false), size: FINISH.size }], events: fourEvents('four'), ...rep }),
    liveCall({ frames: 110, fps: FPS, sessions: [{ session: 'grades', writer: WRITER, doc: doc('grades', true), size: FINISH.size }], events: allStates('grades'), ...rep }),
  ], planted ? { lane, planted } : { lane });
  return { four: liveReply(a!, `the four-state figure on ${lane}`), grades: liveReply(b!, `the 36-state figure on ${lane}`) };
}
function heldProblems(live: Live, session: string): string[] {
  return viewsOf(live, session).filter((v) => v.operator_pipelines > 32).map((v) => `${session}: frame ${v.frame} holds ${v.operator_pipelines} operator pipelines, past 32`);
}

/** The two edit orders' documents: the two-set figure, then a grain of 0.05 and a pass `lift`, in either order. */
function editOrders(): { r0: JsonObject; a1: JsonObject; a2: JsonObject; b1: JsonObject; b2: JsonObject } {
  const lift = asItem(colorPass('lift', { s: { op: 'mul@1', args: { a: 'rgb', b: 0.9 } }, res: { op: 'add@1', args: { a: 's', b: 0.05 } } },
    { chain: 'finish', order: 'a15', resolution: 'half', cost: FINISH.cost }));
  const items = finishItems(0.03);
  const grained = finishItems(0.05);
  const doc = (id: string, its: Record<string, JsonObject>) => payload(sceneDoc(id, FINISH.size, its, 'figure', finishExtra(false)));
  const r0 = doc('order-432', items);
  const a1 = doc('order-432', { ...items, grain: grained['grain']! });
  const a2 = doc('order-432', { ...items, grain: grained['grain']!, lift });
  const b1 = doc('order-432', { ...items, lift });
  // The same revision as a2, its items in another order: lift written before the board, the grain last.
  const b2 = clone(a2);
  const its = b2['items'] as JsonObject;
  const reordered: JsonObject = { lift: its['lift']! };
  for (const [k, v] of Object.entries(its)) if (k !== 'lift' && k !== 'grain') reordered[k] = v;
  reordered['grain'] = its['grain']!;
  b2['items'] = reordered;
  return { r0, a1, a2, b1, b2 };
}
/** The passes of the last frame a session drew with operator passes: each pass's key and operators. */
function lastPasses(live: Live, session: string): { key: string | null; operators: string[] }[] {
  const rows = operatorPasses(live, session);
  expect(rows.length, `${session} reports operator passes`).toBeGreaterThan(0);
  return rows.at(-1)!.passes.map((p) => ({ key: p.key, operators: p.operators.map((o) => o.operator) }));
}

describe(`${AC[5]} a finish chain with variant sets, played through every state, creates no pipeline after its first frame`, () => {
  it(`${AC[5]} four states, and 36 with nine grades: none created and none settling after the first frame, at most 32 operator pipelines, the differing operators in passes of their own, on the noop lane and on Metal; two edit orders of one revision fuse the same passes by key`, () => {
    const dir = out();
    const lanes: Lane[] = process.platform === 'darwin' ? ['noop', 'gpu'] : ['noop'];
    for (const lane of lanes) {
      const { four, grades } = play(dir, lane, lane === 'gpu');
      const problems = [...warmProblems(four, 'four', FPS), ...warmProblems(grades, 'grades', FPS), ...heldProblems(four, 'four'), ...heldProblems(grades, 'grades')];
      console.log(`${AC[5]}: ${lane}: ${problems.length} problems${problems.length ? `, first: ${problems[0]}` : ''}; the 36-state session holds at most ${Math.max(0, ...viewsOf(grades, 'grades').map((v) => v.operator_pipelines))} operator pipelines`);
      expect(problems, `${lane}: nothing compiles or settles after the first frame, and no session holds more than 32 operator pipelines`).toEqual([]);
      if (lane !== 'gpu') continue;
      const differ = ['tint', 'halftone', 'grade'];
      const shared: string[] = [];
      const seen = new Set<string>();
      for (const { frame, passes } of operatorPasses(grades, 'grades')) {
        for (const p of passes) {
          const ops = p.operators.map((o) => o.operator);
          ops.forEach((o) => seen.add(o));
          if (ops.some((o) => differ.includes(o)) && ops.length !== 1) shared.push(`frame ${frame}: ${ops.join(' + ')} in one pass`);
        }
      }
      expect(shared.slice(0, 10), 'tint, halftone and grade, which differ between the 36 states, each run in a pass of its own').toEqual([]);
      expect(['tint', 'grade'].filter((o) => !seen.has(o)), `tint and grade each run in some pass: ${[...seen].join(', ')}`).toEqual([]);

      const d = editOrders();
      const w = (name: string, v: JsonObject) => writeJson(dir, `${name}.json`, v);
      const [r] = run(bin(), dir, [liveCall({
        frames: 30, fps: FPS, report: ['passes'],
        sessions: [{ session: 'order_a', writer: WRITER, doc: w('r0a', d.r0), size: FINISH.size }, { session: 'order_b', writer: WRITER_B, doc: w('r0b', d.r0), size: FINISH.size }],
        events: [reviseAt(11, 'order_a', w('a1', d.a1)), reviseAt(21, 'order_a', w('a2', d.a2)), reviseAt(11, 'order_b', w('b1', d.b1)), reviseAt(21, 'order_b', w('b2', d.b2))],
      })], { lane });
      const live = liveReply(r!, 'the two edit orders');
      const a = lastPasses(live, 'order_a'); const b = lastPasses(live, 'order_b');
      console.log(`${AC[5]}: edit orders: a ${JSON.stringify(a)}; b ${JSON.stringify(b)}`);
      for (const p of [...a, ...b]) expect(p.key, `every operator pass names its pipeline key: ${JSON.stringify(p)}`).toMatch(/^[0-9a-f]{32}$/);
      expect(a.flatMap((p) => p.operators).includes('lift'), 'the last revision, with lift, is the one drawn').toBe(true);
      expect(b, 'the same revision reached through two edit orders fuses the same passes, by pipeline key').toEqual(a);
    }
    if (process.platform === 'darwin') requireReferenceMac('The finish figure\'s count');
    else requireGpu();
  }, 3_600_000);

  it(`${AC[5]} a planted warm-up that fuses only the default options (--planted fuses_default_options) creates a pipeline at the first switch, to night at 1 s, and fails, naming the option and the time`, () => {
    const { four } = play(out(), 'noop', false, 'fuses_default_options');
    const frames = createdFrames(four, 'four');
    const first = frames[0];
    const failure = first === undefined ? 'nothing was created' : `the switch to ${first === 31 ? 'night' : `the state at frame ${first}`} at ${seconds(first, FPS)} created ${createdAt(four, 'four', first).map((c) => named(c, first, FPS)).join('; ')}`;
    console.log(`${AC[5]}: fuses_default_options: ${failure}`);
    expect(warmProblems(four, 'four', FPS).length, 'the check fails').toBeGreaterThan(0);
    expect(first, `the first pipeline created after the first frame is at the first switch, frame 31: ${shown(frames)}`).toBe(31);
    expect(failure.includes('night') && failure.includes('1.000 s'), `the failure names the option and the time: ${failure}`).toBe(true);
  }, 1_800_000);
});
