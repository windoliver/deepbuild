// AC5 #2053.cf7f4bb1: "Over 4 s with one light whose `at` and `height` are driven by t above the paged image, the frames at
// 1 s, 2 s and 3 s have the same pixel hash by seeking and by playing. A planted evaluator that keeps the height of the
// frame before differs after the seek and fails, naming the frame"
//
// AC1's paged image (the white `wall` with its page of texels (128, 204)) in the lit group `lamps` (ambient 0), lit by
// one white light, energy 0.5, range 400, whose `at` (x and y) and `height` are keyed linearly over the 4 s transport
// (channels `items/lamps/params/light/lights/0/at/0`, `…/at/1` and `…/height`, the path grammar's list index and
// nested keys): it crosses the image from the upper left to the lower right while it rises from 20 u to 420 u. Frames at
// 30 fps: 1 s, 2 s and 3 s are frames 30, 60 and 90. A play is one process from frame 0 in order; a seek is a fresh
// process opened at that frame with nothing drawn before it (README: Readings). Two surfaces, one per half of the
// issue's "Runs on" line:
//   - The evaluated fields, on every platform: `deep-canvas-render path` on the group `lamps`, each frame's `light`, as
//     #2031's suite reads it, now with each light's `height`. The played list equals the sought one at the three frames,
//     and every played frame's `at` and `height` are their channels' values at that time.
//   - The frames, on the reference Mac: `deep-gpu run`'s `film2d` with `from`, `hash` and the store. The three played
//     frames hash apart from one another and from the same frames with the height held at 520 u (so the frames carry
//     the height), and each sought frame hashes as played.
// The planted evaluator is `light_stale_height` on both (`planted` in the `path` line, `deep-gpu run --planted`): a
// played frame's lights take the height of the frame drawn before it; its failure must name frame 30, 60 or 90 with
// the seek.
// Wrong programs: the base (no height evaluated or read, no store), an evaluator that keeps state from the frame before
// or integrates the height frame by frame, a height read once at load.
import { describe, expect, it } from 'vitest';
import {
  AC, arr, doc, fl, films, item, keyed, keyedAt, lamp, LEANING, LOOK, num, obj, render, requireMetal, shown, SIZE, storeIn, uniformPage,
  useBin, useDir, wall, whiteImage, type JsonObject, type JsonValue, type Planted,
} from './helpers.ts';

const ID = AC[5];
const canvas = useBin('deep-canvas-render');
const gpu = useBin('deep-gpu');
const dir = useDir();
const FPS = 30;
const SEEKS = [30, 60, 90];
const SPAN = 4;
const X: [number, number][] = [[0, 100], [SPAN, 220]];
const Y: [number, number][] = [[0, 60], [SPAN, 260]];
const HEIGHT: [number, number][] = [[0, 20], [SPAN, 420]];
const HELD = 520;
const PLAY = Array.from({ length: SEEKS[SEEKS.length - 1]! + 1 }, (_, n) => n);
const flicks = (n: number): number => fl(n / FPS);
const AT = 'items/lamps/params/light/lights/0';

/** The drifting light over the paged image; with `held`, its height stays at 520 u and only `at` is driven. */
function fixture(asset: string, normal: string, held = false): JsonObject {
  const channels: JsonObject = { 'lamp-x': keyed(`${AT}/at/0`, X), 'lamp-y': keyed(`${AT}/at/1`, Y) };
  if (!held) channels['lamp-height'] = keyed(`${AT}/height`, HEIGHT);
  return doc(held ? 'drift-held' : 'drift-height', SIZE, [
    item('lamps', 'group@1', 'a0', { light: { ambient: 0, lights: [lamp({ at: [X[0]![1], Y[0]![1]], energy: 0.5, range: 400, height: held ? HELD : HEIGHT[0]![1] })] } }),
    wall(asset, 'lamps', { normal }),
  ], { transport: { span: `${SPAN}s` }, channels });
}
function pictures(): { store: string; driven: JsonObject; held: JsonObject } {
  const store = storeIn(dir());
  const asset = whiteImage(store, 64, 64);
  const { hash } = uniformPage(store, 64, 64, LEANING);
  return { store, driven: fixture(asset, hash), held: fixture(asset, hash, true) };
}

/** `path` on `lamps` at `frames`, in one process: each frame's evaluated `light`. */
function lists(d: JsonObject, frames: number[], planted?: Planted): JsonObject[] {
  const [answer] = render(canvas(), 'path', [{ doc: d, item: 'lamps', times: frames.map(flicks), look: LOOK, ...(planted ? { planted } : {}) }]);
  expect(answer!['ok'], `path answers the lit group's frames${planted ? ` under ${planted}` : ''}, not a refusal: ${shown(answer)}`).toBe(true);
  const rows = arr(answer!['frames'], 'path: frames');
  expect(rows.length, 'path: one frame per time').toBe(frames.length);
  return rows.map((f, i) => obj(obj(f, `frames[${i}]`)['light'], `frame ${frames[i]}: its evaluated light list (README: \`path\`)`));
}
/** Each seek whose list or hash isn't the play's at that frame: `frame <n>: the seek …`. */
function seekFailures(played: Map<number, JsonValue>, sought: Map<number, JsonValue>, what: string): string[] {
  return SEEKS.flatMap((n) => JSON.stringify(sought.get(n)) === JSON.stringify(played.get(n)) ? [] : [`frame ${n}: the seek's ${what} ${shown(sought.get(n)).slice(0, 200)} isn't the play's ${shown(played.get(n)).slice(0, 200)}`]);
}
/** Each played frame whose light's `at` or `height` isn't its channel's value at that time. */
function channelFailures(played: JsonObject[]): string[] {
  return played.flatMap((l, i) => {
    const t = flicks(PLAY[i]!);
    const got = arr(l['lights'], `frame ${PLAY[i]}: lights`);
    if (got.length !== 1) return [`frame ${PLAY[i]}: ${got.length} lights, not 1`];
    const g = obj(got[0], `frame ${PLAY[i]}: lights[0]`);
    const at = arr(g['at'], `frame ${PLAY[i]}: lights[0].at`).map((v, j) => num(v, `lights[0].at[${j}]`));
    const h = num(g['height'], `frame ${PLAY[i]}: lights[0].height, the evaluated height`);
    const want = [keyedAt(X, t), keyedAt(Y, t), keyedAt(HEIGHT, t)];
    return Math.abs(at[0]! - want[0]!) <= 1e-3 && Math.abs(at[1]! - want[1]!) <= 1e-3 && Math.abs(h - want[2]!) <= 1e-3
      ? [] : [`frame ${PLAY[i]}: the light at [${at.join(', ')}] height ${h}, its channels give [${want[0]}, ${want[1]}] height ${want[2]}`];
  });
}
const listRun = (planted?: Planted): { played: JsonObject[]; sought: Map<number, JsonValue> } => {
  const { driven } = pictures();
  return { played: lists(driven, PLAY, planted), sought: new Map(SEEKS.map((n) => [n, lists(driven, [n], planted)[0]!])) };
};
const hashOf = (rows: Map<number, JsonObject>, n: number): string | null => (typeof rows.get(n)?.['pixel_hash'] === 'string' ? rows.get(n)!['pixel_hash'] as string : null);
const frameRun = (planted?: Planted): { played: Map<number, JsonValue>; sought: Map<number, JsonValue>; held: Map<number, JsonValue> } => {
  const p = pictures();
  const [play] = films(gpu(), dir(), p.store, [p.driven], { fps: FPS, from: 0, frames: PLAY.length, planted });
  const [held] = planted ? [new Map<number, JsonObject>()] : films(gpu(), dir(), p.store, [p.held], { fps: FPS, from: SEEKS[0]!, frames: PLAY.length - SEEKS[0]! });
  return {
    played: new Map(SEEKS.map((n) => [n, hashOf(play!, n)])),
    sought: new Map(SEEKS.map((n) => [n, hashOf(films(gpu(), dir(), p.store, [p.driven], { fps: FPS, from: n, frames: 1, planted })[0]!, n)])),
    held: new Map(SEEKS.map((n) => [n, hashOf(held!, n)])),
  };
};
const namesASeek = (failures: string[]): boolean => failures.some((f) => /^frame (30|60|90): the seek/.test(f));

describe(`${ID} a light's at and height driven by t over a paged image: seeking equals playing`, () => {
  it(`${ID} the evaluated light at 1 s, 2 s and 3 s is the same by seeking and by playing, and its at and height follow their channels`, () => {
    const { played, sought } = listRun();
    const failures = [...seekFailures(new Map(PLAY.map((n, i) => [n, played[i]!])), sought, 'light list'), ...channelFailures(played)];
    expect(failures, `the evaluated light lists:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
  });

  it(`${ID} a planted evaluator that keeps the frame before's height differs after the seek and fails, naming the frame`, () => {
    const { played, sought } = listRun('light_stale_height');
    const failures = seekFailures(new Map(PLAY.map((n, i) => [n, played[i]!])), sought, 'light list');
    expect(namesASeek(failures), `under light_stale_height a seek's light list differs from the play's, naming frame 30, 60 or 90; got:\n  ${failures.join('\n  ')}`).toBe(true);
  });

  it(`${ID} the frames at 1 s, 2 s and 3 s have the same pixel hash by seeking and by playing`, () => {
    requireMetal();
    const { played, sought, held } = frameRun();
    console.log(`${ID}: played ${SEEKS.map((n) => `${n}: ${String(played.get(n)).slice(0, 12)}`).join(', ')}; sought ${SEEKS.map((n) => `${n}: ${String(sought.get(n)).slice(0, 12)}`).join(', ')}; held ${SEEKS.map((n) => `${n}: ${String(held.get(n)).slice(0, 12)}`).join(', ')}`);
    expect(new Set(SEEKS.map((n) => played.get(n))).size, 'the light moves: the played frames 30, 60 and 90 hash apart').toBe(SEEKS.length);
    const carried = SEEKS.filter((n) => played.get(n) === held.get(n));
    expect(carried, 'each played frame hashes apart from the same frame with the height held at 520 u: the page reads the height').toEqual([]);
    const failures = seekFailures(played, sought, 'pixel hash');
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it(`${ID} a planted evaluator that keeps the frame before's height draws a seek unlike the play and fails, naming the frame`, () => {
    requireMetal();
    const { played, sought } = frameRun('light_stale_height');
    const failures = seekFailures(played, sought, 'pixel hash');
    expect(namesASeek(failures), `under light_stale_height a sought frame's pixel hash differs from the played one's, naming frame 30, 60 or 90; got:\n  ${failures.join('\n  ')}`).toBe(true);
  });
});
