// AC5 #210.92486e89: "A vec source of 3 that sends a value of 2 numbers is refused before it's recorded, naming the
// source; a value whose as-of time is 10 s after its arrival is refused, naming it; and a replay with the plug-in off
// reads the same values at the same steps, by step hash"
//
// deep-logic (README: deep-logic). The piece reads `reading:imu`, a source of shape vec of 3 with `each` and
// `max_per_step` 4, through `tilt`, which writes each step's count and the numbers and as-of times it read. In one
// session the source delivers [1, 2, 3] before step 0; after step 2, [0.5, −1, 4], then [7, 8] (two numbers), then
// [3, 3, 3]; after step 5, [9, 9, 9] stamped 10 s after it reached the hub, then [−2, 0.25, 6] stamped at its arrival.
// The two wrong values are refused `reading_refused`, naming the source `imu` (`why` shape and as_of); the track holds
// the four others and nothing else; `tilt` reads them at steps 0, 3 (two) and 6, and nothing at any other step. A bake
// of that track in a fresh process, nothing delivering, gives the same step records, hashes and arrays, at every step.
import { describe, expect, it } from 'vitest';
import {
  AC, TILT_WRITES, TIMEOUT, arr, bakeCall, deliver, firstDiff, layoutOf, logicBin, logicPiece, none, obj, onLogic, openPiece, prebuild, show, stepTo,
  stepped, stepsOf, str, tiltProgram, type JsonObject, type JsonValue, type Source, type StepRecord,
} from './helpers.ts';

const ID = AC[5];
prebuild(() => { logicBin(); });

const READING = 'reading:imu';
const SOURCES: Record<string, Source> = { imu: { shape: { vec: { n: 3 } }, delivery: 'each', max_per_step: 4 } };
const SECOND = 1_000_000;
interface Sent { after: number; value: number[]; as_of: number; arrived: number; refused?: 'shape' | 'as_of' }
const SENT: Sent[] = [
  { after: -1, value: [1, 2, 3], as_of: 5 * SECOND, arrived: 5 * SECOND + 40 },
  { after: 2, value: [0.5, -1, 4], as_of: 6 * SECOND, arrived: 6 * SECOND + 40 },
  { after: 2, value: [7, 8], as_of: 6 * SECOND + 10, arrived: 6 * SECOND + 50, refused: 'shape' },
  { after: 2, value: [3, 3, 3], as_of: 6 * SECOND + 20, arrived: 6 * SECOND + 60 },
  { after: 5, value: [9, 9, 9], as_of: 17 * SECOND + 70, arrived: 7 * SECOND + 70, refused: 'as_of' },
  { after: 5, value: [-2, 0.25, 6], as_of: 7 * SECOND + 80, arrived: 7 * SECOND + 80 },
];
const KEPT = SENT.filter((s) => !s.refused);
/** Where each kept value is read: the first step not yet run when it arrived. */
const READ_AT = new Map<number, Sent[]>();
for (const s of KEPT) READ_AT.set(s.after + 1, [...(READ_AT.get(s.after + 1) ?? []), s]);
const LAST = 9;

describe(`AC5 ${ID} a value its source's shape doesn't fit, or stamped after its arrival, is refused before it's recorded; a replay needs no plug-in`, () => {
  it(`AC5 ${ID} [7, 8] and a value 10 s ahead of its arrival are refused naming imu; the four others are read at their steps, and a bake of the track reads the same by step hash`, () => {
    const layout = layoutOf('tilt', [READING], TILT_WRITES, SOURCES);
    const piece = logicPiece(210_05, { tilt: { program: tiltProgram(layout, READING), reads: [READING], writes: TILT_WRITES } }, SOURCES);
    const s = 's1';
    const calls: JsonObject[] = [openPiece(piece)];
    let ran = -1;
    for (const at of [...new Set(SENT.map((x) => x.after)), LAST]) {
      if (at > ran) { calls.push(stepTo(s, at)); ran = at; }
      for (const x of SENT.filter((y) => y.after === at)) calls.push(deliver(s, READING, x.value, x.as_of, x.arrived));
    }
    const rs = onLogic(calls);
    expect(rs[0]!['ok'], `AC5: the session opens the piece with a vec source of 3: ${show(rs[0], 800)}`).toBe(true);
    expect(str(rs[0]!['session'], 'open: session'), 'AC5: the session is s1').toBe(s);

    const f: string[] = [];
    const answers = rs.filter((_, i) => calls[i]!['call'] === 'append');
    SENT.forEach((x, i) => {
      const a = obj(answers[i], `AC5: the answer to delivery ${i}`);
      if (!x.refused && a['ok'] !== true) f.push(`${JSON.stringify(x.value)} (as-of ${x.as_of}, arrived ${x.arrived}) was refused: ${show(a, 300)}`);
      if (x.refused && (a['ok'] !== false || a['code'] !== 'reading_refused' || a['source'] !== 'imu' || a['why'] !== x.refused)) {
        f.push(`${JSON.stringify(x.value)} (as-of ${x.as_of}, arrived ${x.arrived}) answers ${show(a, 300)}, not {ok: false, code: reading_refused, source: imu, why: ${x.refused}}`);
      }
    });

    const steps: StepRecord[] = [];
    let track: JsonObject[] = [];
    rs.forEach((r, i) => { if (calls[i]!['call'] === 'step') { const st = stepped(r, `AC5: step to ${String(calls[i]!['to'])}`); steps.push(...st.steps); track = st.track; } });
    if (JSON.stringify(steps.map((x) => x.step)) !== JSON.stringify([...Array(LAST + 1).keys()])) f.push(`the steps run are ${JSON.stringify(steps.map((x) => x.step))}, not 0 to ${LAST} once each`);
    const recorded = track.map((e) => [e['reading'] ?? null, e['value'] ?? null, e['as_of'] ?? null]);
    const want = KEPT.map((x) => [READING, x.value, x.as_of]);
    if (JSON.stringify(recorded) !== JSON.stringify(want)) f.push(`the track holds ${JSON.stringify(recorded)}, not exactly the four values kept ${JSON.stringify(want)}`);
    for (const st of steps) {
      const at = READ_AT.get(st.step) ?? [];
      const nums = (k: string): number[] => (st.arrays[k] ?? []).map((v: JsonValue) => Number(v));
      const got = { count: nums('tilt.count')[0], seen: nums('tilt.seen'), as_of: nums('tilt.as_of') };
      const pad = (xs: number[], n: number): number[] => [...xs, ...Array<number>(n).fill(0)].slice(0, n);
      const wanted = { count: at.length, seen: pad(at.flatMap((x) => x.value), 12), as_of: pad(at.map((x) => x.as_of), 4) };
      if (JSON.stringify(got) !== JSON.stringify(wanted)) f.push(`step ${st.step}: tilt read ${JSON.stringify(got)}, not ${JSON.stringify(wanted)}`);
    }

    // The replay: a fresh process, the recorded track, nothing delivering.
    const [replay] = onLogic([bakeCall(piece, track, LAST + 1)]);
    expect(replay!['ok'], `AC5: the bake of the recorded track runs: ${show(replay, 800)}`).toBe(true);
    const replayed = stepsOf(replay!['steps'], 'AC5: replay.steps');
    if (JSON.stringify(arr(replay!['track'], 'AC5: replay.track')) !== JSON.stringify(track)) f.push(`the replay read the track ${show(replay!['track'], 300)}, not the one the session recorded`);
    const diff = firstDiff(replayed, steps);
    if (diff !== null) f.push(`the replay with the plug-in off parts from the live session at ${diff}`);
    none(f, `AC5 ${ID}`);
  }, TIMEOUT);
});
