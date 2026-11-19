// #1993.82266148: "A reaction-diffusion pattern in two carried 1,024 × 1,024 `r32float` textures runs 600 steps a
// second for 10 s with a ring budget of 160 MiB, which is 20 checkpoints of 8 MiB. The ring never holds more than
// that, and a seek to step 3,000 equals play at step 3,000 by hash. A planted ring that checkpoints the two textures
// on alternate steps restores a mixed state and fails the seek line"
//
// The pattern (helpers.ts: patternOps) is a spiral wave in an excitable medium, its two fields u and v the two carried
// r32float textures of one operator stepped 600 times a second. A texture is 1,024 × 1,024 × 4 bytes, 4 MiB, so a
// checkpoint of the pair is 8 MiB; each texture's `carry` is {every: 60, budget: 80 MiB}, which together is the ring's
// 160 MiB, 20 checkpoints of 8 MiB. Checkpoints every 60 steps would be 101 by step 6,000, 808 MiB, so the budget
// binds from step 1,200 on and the ring has to thin (Checkpoint ring: the spacing doubles).
//
// The play is `view3d` at 60 frames a second, ten steps a frame, to frame 600 (10 s, step 6,000), then a seek back to
// frame 300 (step 3,000). Each state is the two textures as `read` wrote them, and its hash is their files' SHA-256s.
//
// - The ring never holds more than that: on every frame drawn, the seek's too, the two textures' rings hold the same
//   checkpoint steps, each checkpoint's bytes are its texture's 4 MiB, each ring names its 80 MiB, and together they
//   hold at most 160 MiB.
// - The pattern runs: at step 3,000 both fields are finite, u is not flat and the state has moved since step 2,990,
//   so two equal blank states can't pass the seek line.
// - The seek line: the frame the seek drew hashes as the played frame 300, at step 3,000. The seek restored the
//   nearest checkpoint the ring held at or before step 3,000 and stepped the rest.
//
// The planted `ring_checkpoints_textures_on_alternate_steps` copies u into a checkpoint at its step and v one step
// later, so the checkpoint a seek restores holds the two fields from two different steps; the steps after it start
// from that mixed state and the sought frame hashes differently from the play's.
//
// At the base nothing is carried in a texture: a stepped operator reads and writes storage only, so no frame reports
// a carried row for the pattern, and the planted name is unknown.
import { describe, expect, it } from 'vitest';
import {
  AC, PATTERN, PATTERN_RATE, PATTERN_RING, PATTERN_STEPS, PATTERN_TEXTURE_BYTES, PATTERN_TEXTURE_RING, PATTERN_U, PATTERN_V, carriedProblems, framesNumbered,
  patternDoc, requireGpu, run, stateOf, useBin, useOut, view3dCall, viewOf, type Planted, type View,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const KEYS: [string, string] = [PATTERN_U, PATTERN_V];
const FPS = 60;
const FRAME = (step: number): number => step * FPS / PATTERN_RATE;
const SEEK_STEP = 3000;
/** The step of the frame before the sought one: ten steps earlier. */
const EARLIER_STEP = SEEK_STEP - PATTERN_RATE / FPS;
const LAST_FRAME = FRAME(PATTERN_STEPS);

interface Played { refusal: string; dir: string; view: View }
/** The pattern played for 10 s and sought back to step 3,000. */
function playAndSeek(planted?: Planted): Played {
  const dir = out();
  const doc = patternDoc(bin(), dir);
  if (doc.refusal !== '') return { refusal: doc.refusal, dir, view: { frames: [], refusal: '' } };
  const session = run(bin(), dir, [
    view3dCall({ doc: doc.path, fps: FPS, frames: LAST_FRAME + 2, seeks: [{ after: LAST_FRAME, to: FRAME(SEEK_STEP) }], capture: [FRAME(EARLIER_STEP), FRAME(SEEK_STEP)], read: KEYS }),
  ], planted);
  const view = viewOf(session.replies[0], 'the play');
  return { refusal: session.refusal || view.refusal, dir, view };
}

/** The ring never holds more than its budget: the first frame on which the two textures' rings break it, or disagree. */
function ringProblems(v: View): string[] {
  for (const f of v.frames) {
    const [u, w] = [f.carried.get(PATTERN_U)!, f.carried.get(PATTERN_V)!];
    const at = `at frame ${f.frame} (reply entry ${f.index}), step ${String(u.step)}`;
    if (JSON.stringify(u.checkpoints) !== JSON.stringify(w.checkpoints)) return [`${at}, the ring holds ${PATTERN_U} at steps ${u.checkpoints.join(', ')} and ${PATTERN_V} at steps ${w.checkpoints.join(', ')}: a checkpoint holds both textures`];
    for (const [key, c] of [[PATTERN_U, u], [PATTERN_V, w]] as const) {
      if (c.budget !== PATTERN_TEXTURE_RING) return [`${at}, ${key}'s ring names budget ${c.budget}, not its ${PATTERN_TEXTURE_RING} (80 MiB)`];
      if (c.ringBytes !== c.checkpoints.length * PATTERN_TEXTURE_BYTES) return [`${at}, ${key}'s ring holds ${c.ringBytes} bytes in ${c.checkpoints.length} checkpoints, not ${PATTERN_TEXTURE_BYTES} (4 MiB) each`];
    }
    if (u.ringBytes + w.ringBytes > PATTERN_RING) return [`${at}, the pattern's ring holds ${u.ringBytes + w.ringBytes} bytes (${u.checkpoints.length} checkpoints of 8 MiB), past its budget of ${PATTERN_RING} (160 MiB, 20 checkpoints)`];
  }
  return [];
}

/** The pattern runs: its played state at step 3,000 is finite, not flat, and has moved in the ten steps before it. */
function patternProblems(p: Played): string[] {
  const at = stateOf(p.dir, framesNumbered(p.view, FRAME(SEEK_STEP))[0], KEYS, PATTERN, `the play at step ${SEEK_STEP}`);
  if (at.state === null) return [at.problem];
  const earlier = stateOf(p.dir, framesNumbered(p.view, FRAME(EARLIER_STEP))[0], KEYS, PATTERN, `the play at step ${EARLIER_STEP}`);
  if (earlier.state === null) return [earlier.problem];
  const problems: string[] = [];
  const [u, w] = [at.state.first.cells, at.state.second.cells];
  if (!u.every((x) => Number.isFinite(x)) || !w.every((x) => Number.isFinite(x))) problems.push(`at step ${SEEK_STEP} the pattern holds a value that is not finite`);
  let [low, high] = [Infinity, -Infinity];
  for (const x of u) { low = Math.min(low, x); high = Math.max(high, x); }
  if (!(low < high)) problems.push(`at step ${SEEK_STEP} u is flat: every cell reads ${low}`);
  if (at.state.hash === earlier.state.hash) problems.push(`the pattern did not move between steps ${EARLIER_STEP} and ${SEEK_STEP}: both hash ${at.state.hash}`);
  return problems;
}

/** The seek line: the frame the seek drew at step 3,000 hashes as the frame the play drew there, and holds step 3,000. */
function seekProblems(p: Played): string[] {
  const [played, sought] = framesNumbered(p.view, FRAME(SEEK_STEP));
  const before = stateOf(p.dir, played, KEYS, PATTERN, `the play at step ${SEEK_STEP}`);
  if (before.state === null) return [before.problem];
  const after = stateOf(p.dir, sought, KEYS, PATTERN, `the seek to step ${SEEK_STEP}`);
  if (after.state === null) return [after.problem];
  const problems: string[] = [];
  if (after.state.hash !== before.state.hash) problems.push(`the seek to step ${SEEK_STEP} hashes ${after.state.hash}, the play at step ${SEEK_STEP} ${before.state.hash}`);
  for (const key of KEYS) if (sought!.carried.get(key)?.step !== SEEK_STEP) problems.push(`the seek to step ${SEEK_STEP} reports ${key} at step ${String(sought!.carried.get(key)?.step)}`);
  return problems;
}

describe(`${AC[4]} a pattern in two carried textures keeps its ring within budget, and a seek equals the play`, () => {
  it(`${AC[4]} a reaction-diffusion pattern in two carried 1,024 × 1,024 r32float textures runs 600 steps a second for 10 s; its ring never holds more than 160 MiB, 20 checkpoints of 8 MiB, and a seek to step 3,000 equals play at step 3,000 by hash`, () => {
    requireGpu();
    const p = playAndSeek();
    expect(p.refusal, 'the pattern played and sought').toBe('');
    expect(carriedProblems(p.view, KEYS, 'the play'), 'every frame reports the pattern\'s two carried textures').toEqual([]);

    // 10 s at 600 steps a second: step 6,000.
    const last = framesNumbered(p.view, LAST_FRAME)[0];
    expect(last, `the play drew frame ${LAST_FRAME}`).toBeDefined();
    for (const key of KEYS) expect(last!.carried.get(key)!.step, `the play's frame ${LAST_FRAME} holds ${key} at step ${PATTERN_STEPS}`).toBe(PATTERN_STEPS);
    expect(ringProblems(p.view), 'the ring never holds more than 160 MiB, 20 checkpoints of 8 MiB').toEqual([]);
    expect(patternProblems(p), 'the pattern runs').toEqual([]);

    // The seek restores the nearest checkpoint the ring held at or before step 3,000, and steps the rest.
    const sought = framesNumbered(p.view, FRAME(SEEK_STEP))[1];
    expect(sought, `the seek drew frame ${FRAME(SEEK_STEP)} again`).toBeDefined();
    const held = last!.carried.get(PATTERN_U)!.checkpoints.filter((s) => s <= SEEK_STEP);
    expect(held.length, `the ring holds a checkpoint at or before step ${SEEK_STEP} when the seek starts`).toBeGreaterThan(0);
    const nearest = Math.max(...held);
    for (const key of KEYS) expect(sought!.carried.get(key)!.restored, `the seek restored ${key}'s checkpoint at step ${nearest} and stepped the rest`).toEqual({ from: nearest, steps: SEEK_STEP - nearest });
    expect(seekProblems(p), 'the seek line').toEqual([]);
  }, 1_800_000);

  it(`${AC[4]} a planted ring that checkpoints the two textures on alternate steps (--planted ring_checkpoints_textures_on_alternate_steps) restores a mixed state and fails the seek line`, () => {
    requireGpu();
    const p = playAndSeek('ring_checkpoints_textures_on_alternate_steps');
    expect(p.refusal, 'the planted ring_checkpoints_textures_on_alternate_steps played and sought the pattern').toBe('');
    const problems = seekProblems(p);
    expect(problems.length, 'the planted ring_checkpoints_textures_on_alternate_steps fails the seek line').toBeGreaterThan(0);
    expect(problems.join('\n'), 'the failure is the sought state\'s hash').toContain(`the seek to step ${SEEK_STEP} hashes`);
  }, 1_800_000);
});
