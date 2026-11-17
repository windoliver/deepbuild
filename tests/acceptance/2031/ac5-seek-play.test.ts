// AC5 #2031.4cb41821: "Over 6 s with 8 lights whose `at` and `energy` are driven by t, the frames at 1 s, 3 s and 5 s have
// the same pixel hash by seeking and by playing. A planted evaluator that keeps the light list of the frame before
// differs after the seek and fails, naming the frame"
//
// A 320 × 180 white rect in the group `lamps`: ambient 0.1 and 8 lights in three roles, each light's `at` (x and y) and
// `energy` keyed linearly over the 6 s transport (channels `items/lamps/params/light/lights/<k>/at/<0|1>` and
// `.../energy`, the path grammar's list index and nested keys). Frames at 30 fps: 1 s, 3 s and 5 s are frames 30, 90
// and 150. A play is one process from frame 0 in order; a seek is a fresh process opened at that frame with nothing
// drawn before it (README: Readings). Two surfaces, one per half of the issue's "Runs on" line:
//   - The evaluated light list, on every platform: `deep-canvas-render path` on the group `lamps`, each frame's `light`
//     (README: `path`: a lit group's evaluated light list). The played list equals the sought one at the three frames,
//     and every played frame's `at` and `energy` are their channels' values at that time (Scope: "every field drivable
//     by t").
//   - The frames, on the reference Mac: `deep-gpu run`'s `film2d` with `from` and `hash` (#430's), each frame's pixel
//     hash. The three played frames differ from one another (the lights move), and each sought frame hashes as played.
// The planted evaluator is `light_stale_list` on both (`planted` in the `path` line, `deep-gpu run --planted`): its
// failure must name frame 30, 90 or 150 with the seek.
// Wrong programs: the base (no list evaluated, no light drawn), an evaluator that keeps state from the frame before or
// integrates the channels frame by frame, a list keyed on frames drawn rather than t.
import { describe, expect, it } from 'vitest';
import {
  AC, arr, doc, film, fl, group, keyed, keyedAt, light, LOOK, num, obj, rect, render, requireMetal, shown, useBin, useDir, WHITE,
  type JsonObject, type JsonValue, type Light, type Planted,
} from './helpers.ts';

const ID = AC[5];
const canvas = useBin('deep-canvas-render');
const gpu = useBin('deep-gpu');
const dir = useDir();
const FPS = 30;
const SEEKS = [30, 90, 150];
const SPAN = 6;
const ROLES = [WHITE, 'accent', 'focus'];
interface Driven { x: [number, number][]; y: [number, number][]; energy: [number, number][] }
/** Light k drifts across the rect over 6 s while its energy rises and falls. */
const DRIVEN: Driven[] = Array.from({ length: 8 }, (_, k) => ({
  x: [[0, 20 + 40 * k], [SPAN, 300 - 40 * k]],
  y: [[0, 30 + 15 * k], [SPAN, 150 - 10 * k]],
  energy: [[0, 0.2 + 0.05 * k], [3, 0.9 - 0.05 * k], [SPAN, 0.3]],
}));
const base: Light[] = DRIVEN.map((d) => ({ at: [d.x[0]![1], d.y[0]![1]], energy: d.energy[0]![1], range: 90 }));
const channels: JsonObject = {};
DRIVEN.forEach((d, k) => {
  const at = `items/lamps/params/light/lights/${k}`;
  channels[`light-${k}-x`] = keyed(`${at}/at/0`, d.x);
  channels[`light-${k}-y`] = keyed(`${at}/at/1`, d.y);
  channels[`light-${k}-energy`] = keyed(`${at}/energy`, d.energy);
});
const fixture = doc('lit-drift', [320, 180], [
  group('lamps', 'a0', { ambient: 0.1, lights: base.map((l, k) => light(l, ROLES[k % ROLES.length])) }),
  rect('sheet', 'a1', [0, 0, 320, 180], 'lamps'),
], { transport: { span: `${SPAN}s` }, channels });
const PLAY = Array.from({ length: SEEKS[SEEKS.length - 1]! + 1 }, (_, n) => n);
const flicks = (n: number): number => fl(n / FPS);

/** `path` on `lamps` at `frames`, in one process: each frame's evaluated `light`. */
function lists(frames: number[], planted?: Planted): JsonObject[] {
  const [answer] = render(canvas(), 'path', [{ doc: fixture, item: 'lamps', times: frames.map(flicks), look: LOOK, ...(planted ? { planted } : {}) }]);
  expect(answer!['ok'], `path answers the lit group's frames${planted ? ` under ${planted}` : ''}, not a refusal: ${shown(answer)}`).toBe(true);
  const rows = arr(answer!['frames'], 'path: frames');
  expect(rows.length, 'path: one frame per time').toBe(frames.length);
  return rows.map((f, i) => obj(obj(f, `frames[${i}]`)['light'], `frame ${frames[i]}: its evaluated light list (README: \`path\`)`));
}
/** Each seek whose list or hash isn't the play's at that frame: `frame <n>: the seek …`. */
function seekFailures(played: Map<number, JsonValue>, sought: Map<number, JsonValue>, what: string): string[] {
  return SEEKS.flatMap((n) => JSON.stringify(sought.get(n)) === JSON.stringify(played.get(n)) ? [] : [`frame ${n}: the seek's ${what} ${shown(sought.get(n)).slice(0, 200)} isn't the play's ${shown(played.get(n)).slice(0, 200)}`]);
}
/** Each played frame whose lights' `at` or `energy` isn't its channel's value at that time. */
function channelFailures(played: JsonObject[]): string[] {
  return played.flatMap((l, i) => {
    const t = flicks(PLAY[i]!);
    const got = arr(l['lights'], `frame ${PLAY[i]}: lights`);
    if (got.length !== DRIVEN.length) return [`frame ${PLAY[i]}: ${got.length} lights, not ${DRIVEN.length}`];
    return DRIVEN.flatMap((d, k) => {
      const g = obj(got[k], `frame ${PLAY[i]}: lights[${k}]`);
      const at = arr(g['at'], `frame ${PLAY[i]}: lights[${k}].at`).map((v, j) => num(v, `lights[${k}].at[${j}]`));
      const want = [keyedAt(d.x, t), keyedAt(d.y, t), keyedAt(d.energy, t)];
      const e = num(g['energy'], `frame ${PLAY[i]}: lights[${k}].energy`);
      return Math.abs(at[0]! - want[0]!) <= 1e-3 && Math.abs(at[1]! - want[1]!) <= 1e-3 && Math.abs(e - want[2]!) <= 1e-4
        ? [] : [`frame ${PLAY[i]}: light ${k} at [${at.join(', ')}] energy ${e}, its channels give [${want[0]}, ${want[1]}] energy ${want[2]}`];
    });
  });
}
const listRun = (planted?: Planted): { played: JsonObject[]; sought: Map<number, JsonValue> } => ({
  played: lists(PLAY, planted),
  sought: new Map(SEEKS.map((n) => [n, lists([n], planted)[0]!])),
});
const frameRun = (planted?: Planted): { played: Map<number, JsonValue>; sought: Map<number, JsonValue> } => {
  const play = film(gpu(), dir(), fixture, { fps: FPS, from: 0, frames: PLAY.length, planted });
  return {
    played: new Map(SEEKS.map((n) => [n, play.get(n)?.hash ?? null])),
    sought: new Map(SEEKS.map((n) => [n, film(gpu(), dir(), fixture, { fps: FPS, from: n, frames: 1, planted }).get(n)?.hash ?? null])),
  };
};
const namesASeek = (failures: string[]): boolean => failures.some((f) => /^frame (30|90|150): the seek/.test(f));

describe(`${ID} lights driven by t: seeking equals playing`, () => {
  it(`${ID} the evaluated light list at 1 s, 3 s and 5 s is the same by seeking and by playing, and follows its channels`, () => {
    const { played, sought } = listRun();
    const failures = [...seekFailures(new Map(PLAY.map((n, i) => [n, played[i]!])), sought, 'light list'), ...channelFailures(played)];
    expect(failures, `the evaluated light lists:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
  });

  it(`${ID} a planted evaluator that keeps the frame before's light list differs after the seek and fails, naming the frame`, () => {
    const { played, sought } = listRun('light_stale_list');
    const failures = seekFailures(new Map(PLAY.map((n, i) => [n, played[i]!])), sought, 'light list');
    expect(namesASeek(failures), `under light_stale_list a seek's light list differs from the play's, naming frame 30, 90 or 150; got:\n  ${failures.join('\n  ')}`).toBe(true);
  });

  it(`${ID} the frames at 1 s, 3 s and 5 s have the same pixel hash by seeking and by playing`, () => {
    requireMetal();
    const { played, sought } = frameRun();
    console.log(`${ID}: played ${SEEKS.map((n) => `${n}: ${String(played.get(n)).slice(0, 12)}`).join(', ')}; sought ${SEEKS.map((n) => `${n}: ${String(sought.get(n)).slice(0, 12)}`).join(', ')}`);
    expect(new Set(SEEKS.map((n) => played.get(n))).size, 'the lights move: the played frames 30, 90 and 150 hash apart').toBe(SEEKS.length);
    const failures = seekFailures(played, sought, 'pixel hash');
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it(`${ID} a planted evaluator that keeps the frame before's light list draws a seek unlike the play and fails, naming the frame`, () => {
    requireMetal();
    const { played, sought } = frameRun('light_stale_list');
    const failures = seekFailures(played, sought, 'pixel hash');
    expect(namesASeek(failures), `under light_stale_list a sought frame's pixel hash differs from the played one's, naming frame 30, 90 or 150; got:\n  ${failures.join('\n  ')}`).toBe(true);
  });
});
