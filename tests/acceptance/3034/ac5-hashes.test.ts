// #3034.dd678c04: "A shot that crosses the surface hashes the same at 20 sampled times seeked and played, and #166's
// suite hashes the same as on the merge base"
//
// One test, in two parts (README: Readings, "One test for criterion 5").
//
// #166's suite hashes the same as on the merge base. base166.ts writes out #166's documents, looks and calls again
// (suites don't import each other): 17 `view3d` calls, 23 frames, every one with its camera above the water. Each
// frame's `pixel_hash`, and the `depth`, `reflection` or `pre_tone` target's SHA-256 where #166's test reads that
// target, must equal the merge base's, held in base-hashes.json with the machine they were drawn on (README: The merge
// base's hashes). The run logs its own hashes on one line, `… base-hashes: {…}`, which is how the file is made again
// on the merge base. A difference on the machine the file names fails, naming each frame; a difference on another
// machine or macOS build can't be told from the GPU's own, and fails `INCONCLUSIVE:` naming both. With no file the
// test fails `BLOCKED:`.
//
// A shot that crosses the surface hashes the same seeked and played (helpers.ts `lakeDoc`, 320 × 180): the camera
// `diver` keyed from 2 m above the lake's surface at rest to 2 m below it over 4 s, over waves and ripples, its eye at
// the surface at 2.0078125 s. The shot is played from frame 0 to frame 120 at 30 fps; 20 frames, 10 drawn from those
// with the eye above the surface (frames 0 to 60) and 10 from those with it below (61 to 120) by a seeded generator,
// are each opened cold by a seek (`from`) and must have the played frames' pixel hashes. Not vacuous: the 20 played
// frames are 20 pictures, and what is compared under the surface is the view: the frame at 3.5 s differs between the
// default `ior` and 1.5. On the merge base no code reads `ior`, so the test fails there, at that guard: its frames
// under the surface are drawn by no rule.
//
// Wrong programs: the merge base; a view that keeps state from frame to frame (which side the eye was on, a mirror or
// a tint carried over), so a cold seek below the surface differs from the played frame; a change to the water as seen
// from above, which moves #166's hashes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { call166, draws166 } from './base166.ts';
import {
  AC, DIVE_SPAN, type JsonObject, type JsonValue, Lcg, OTHER_IOR, REPO, SAMPLED_TIMES, SHA, belowFrame, blocked, diveHeight, frameAt, framesOf, hashAt, inconclusive,
  isObject, lakeDoc, look3d, machine, none, requireMachine, runGpu, sample, str, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const HELD = join(REPO, 'tests', 'acceptance', '3034', 'base-hashes.json');
const SIZE: [number, number] = [320, 180];
const LOOK = look3d('crossing-3034');
const FPS = 30;
/** The shot's last frame, and its frames by the side of the surface the eye is on. */
const LAST = DIVE_SPAN * FPS;
const ALL = Array.from({ length: LAST + 1 }, (_, n) => n);
const ABOVE = ALL.filter((n) => diveHeight(n / FPS) > 0);
const BELOW = ALL.filter((n) => diveHeight(n / FPS) < 0);

type Hashes = Record<string, Record<string, string>>;

/** #166's draws at this tree: each frame's pixel hash and, where #166 reads one, its float target's SHA-256. */
function draw166(dir: string): Hashes {
  const draws = draws166();
  const replies = runGpu(bin(), dir, draws.map((d, k) => call166(dir, d, k)));
  const drawn: Hashes = {};
  draws.forEach((d, k) => {
    const frames = framesOf(replies[k]!, `#166's ${d.name}`);
    for (const n of d.frames) {
      const f = frameAt(frames, n, `#166's ${d.name}`);
      const row: Record<string, string> = { pixel_hash: f.pixel_hash };
      if (d.target) {
        row[d.target] = str(f.raw[d.target], `#166's ${d.name}, frame ${n}: ${d.target}`);
        expect(row[d.target], `#166's ${d.name}, frame ${n}: ${d.target} is named by a SHA-256`).toMatch(SHA);
      }
      drawn[`${d.name}, frame ${n}`] = row;
    }
  });
  return drawn;
}

/** The merge base's hashes, as base-hashes.json holds them. */
function held(): { base: string; machine: JsonObject; hashes: Hashes } {
  if (!existsSync(HELD)) blocked('tests/acceptance/3034/base-hashes.json isn\'t there: the merge base\'s hashes of #166\'s suite aren\'t recorded (README: The merge base\'s hashes)');
  const v = JSON.parse(readFileSync(HELD, 'utf8')) as JsonValue;
  expect(isObject(v) && isObject(v['machine']) && isObject(v['hashes']) && typeof v['base'] === 'string', 'base-hashes.json holds {base, machine, hashes}').toBe(true);
  const o = v as JsonObject;
  return { base: o['base'] as string, machine: o['machine'] as JsonObject, hashes: o['hashes'] as unknown as Hashes };
}

describe(`${AC[5]} the view is a function of t, and the water seen from above draws as on the merge base`, () => {
  it(`${AC[5]} #166's suite hashes the same as on the merge base, and a shot that crosses the surface hashes the same at 20 sampled times seeked and played`, () => {
    requireMachine();
    const dir = out();

    // #166's suite hashes the same as on the merge base.
    const here = machine();
    const drawn = draw166(dir);
    console.log(`${AC[5]} base-hashes: ${JSON.stringify({ machine: here, hashes: drawn })}`);
    const base = held();
    const differ: string[] = [];
    for (const key of new Set([...Object.keys(base.hashes), ...Object.keys(drawn)])) {
      const [was, is] = [base.hashes[key], drawn[key]];
      if (!was || !is) { differ.push(`#166's ${key}: ${was ? 'not drawn here' : 'not held in base-hashes.json'}`); continue; }
      for (const field of new Set([...Object.keys(was), ...Object.keys(is)])) {
        if (was[field] !== is[field]) differ.push(`#166's ${key}: ${field} is ${String(is[field]).slice(0, 12)}, on the merge base ${String(was[field]).slice(0, 12)}`);
      }
    }
    expect(Object.keys(base.hashes).length, 'base-hashes.json holds the merge base\'s hashes of all 23 frames').toBe(23);
    const sameMachine = (['model', 'chip', 'macosBuild'] as const).every((k) => base.machine[k] === here[k]);
    if (differ.length > 0 && !sameMachine) {
      inconclusive(`${differ.length} of #166's hashes differ from the merge base's, which were drawn on ${JSON.stringify(base.machine)}; this is ${JSON.stringify(here)}, so the difference may be the machine's (README: The merge base's hashes): ${differ.slice(0, 4).join('; ')}`);
    }
    none(differ, `#166's suite hashes the same as on the merge base (${base.base.slice(0, 12)})`);
    console.log(`${AC[5]}: #166's 23 frames hash as on the merge base ${base.base.slice(0, 12)}`);

    // A shot that crosses the surface hashes the same at 20 sampled times seeked and played.
    expect([ABOVE.length, BELOW.length], 'the eye is above the surface in frames 0 to 60 and below it in frames 61 to 120').toEqual([61, 60]);
    const rng = new Lcg(3034);
    const times = [...sample(rng, ABOVE, SAMPLED_TIMES / 2), ...sample(rng, BELOW, SAMPLED_TIMES / 2)];
    expect(times.length, 'the sample holds 20 times, ten on each side of the surface').toBe(SAMPLED_TIMES);
    const below = belowFrame(FPS);
    const doc = writeJson(dir, 'shot', lakeDoc('shot', SIZE));
    const seekTo = (d: string, n: number): JsonObject => view3d({ doc: d, look: LOOK, size: SIZE, from: n, frames: 1, fps: FPS });
    const [played, other, ...seeked] = runGpu(bin(), dir, [
      view3d({ doc, look: LOOK, size: SIZE, frames: LAST + 1, fps: FPS }),
      seekTo(writeJson(dir, 'shot-ior', lakeDoc('shot-ior', SIZE, OTHER_IOR)), below),
      ...times.map((n) => seekTo(doc, n)),
    ]);
    const film = framesOf(played!, 'the shot played');
    expect(film.length, 'the shot plays every frame from 0 to 4 s').toBe(LAST + 1);
    const p = (n: number): string => frameAt(film, n, 'the shot played').pixel_hash;
    const withOther = hashAt(other!, below, `the shot with ior ${OTHER_IOR}`);
    expect(withOther, `what is compared under the surface is the view, whose cone follows ior: but at 3.5 s, 1.49 m under the surface, ior ${OTHER_IOR} draws the default's very frame, so no rule draws the shot there (the merge base draws so)`).not.toBe(p(below));
    expect(new Set(times.map(p)).size, 'the shot moves: the 20 sampled frames are 20 pictures').toBe(SAMPLED_TIMES);
    const failures: string[] = [];
    times.forEach((n, k) => {
      const s = hashAt(seeked[k]!, n, `the seek to frame ${n}`);
      const h = diveHeight(n / FPS);
      if (s !== p(n)) failures.push(`at ${(n / FPS).toFixed(3)} s (frame ${n}, the eye ${Math.abs(h).toFixed(2)} m ${h < 0 ? 'below' : 'above'} the surface) the frame seeked (${s.slice(0, 12)}) differs from the one played (${p(n).slice(0, 12)})`);
    });
    console.log(`${AC[5]}: the shot seeked at frames ${times.join(', ')}: ${SAMPLED_TIMES - failures.length} of ${SAMPLED_TIMES} equal the played frames`);
    none(failures, 'the shot that crosses the surface hashes the same seeked and played at 20 sampled times');
  });
});
