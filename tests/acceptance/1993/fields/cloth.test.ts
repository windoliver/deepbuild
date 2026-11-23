// #1993.9b40f0f2: "A 64 × 64 cloth held as three fields (position, previous position, pinned) hangs from its pinned
// top row under gravity, with 8 constraint passes a step. Over 600 steps every pinned point moves 0 m, the longest
// edge stays within 10% of its rest length, and a seek to step 300 equals play by hash. A planted step that ignores
// the pinned field drops the top row and fails the 0 m line"
//
// The cloth (helpers.ts: clothOps) is 4,096 points, an edge 0.1 m at rest, stepped 600 times a second: its three
// fields are the carried storage outputs `position`, `previous` and `pinned` of the one stepped operator `cloth`,
// and a step is a Verlet move under gravity (9.81 m/s²), 8 constraint passes over the edges' four colours, and the
// operator that keeps the three fields. Through #378's `view3d` at 600 frames a second, so frame k shows step k,
// with #483's `read` of the three fields on every frame, and #484's `seeks`: played to step 600, then seeked back
// to 300 in the same session.
//
// What is held, each line read off the fields' own words:
// - the start is the closed form the document states (helpers.ts: clothStart), its top row pinned, and it steps:
//   `previous` at step k is `position` at step k − 1 bit for bit, and the cloth has come down by step 600;
// - the 0 m line: at every step each pinned point's position is its starting one bit for bit, so it moved 0 m;
// - the longest edge (4,032 across and 4,032 down) is at most 1.1 × 0.1 m at every step;
// - held as fields: Scope says a stepped operator's fields "are carried and checkpointed together, so a seek never
//   restores fields from two different steps". Each field declares the same ring (every 60 steps, 294,912 bytes:
//   six checkpoints of a 12,288-word field), so on every frame the three rows of #252's `carried` report the same
//   step and hold the same checkpoints, and the seek restores all three from one;
// - the seek to step 300 has each field's hash (its read file's name) as play had it at step 300.
//
// The planted step is a wrong document, not a wrong binary: the same operators, except that none reads the `pinned`
// field to hold a point (helpers.ts: clothOps, ignoresPinned). Its top row falls with the rest, and the 0 m line
// fails on it, naming the first pinned point that moved and how far.
//
// At the base (9550dc0f) a stepped operator's three carried storage outputs each keep a ring of their own: from
// step 360 `position` and `previous` have thinned to every 120 steps while `pinned`, a third their size, still holds
// every 60, so the fields aren't checkpointed together, and the held-as-fields line fails.
import { describe, expect, it } from 'vitest';
import {
  AC, CLOTH_FIELDS, CLOTH_RATE, PASSES, POINTS, POSITION_WORDS, REST, SIDE, checks, clothOps, clothStart, framesNumbered, refusal, refusals, requireGpu, run, sceneDoc,
  useBin, useOut, view3dCall, view3dFrames, withEstimates, wordsOf, writeJson, type V3Frame, type Words,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const STEPS = 600;
const SEEK = 300;
const KEYS = Object.values(CLOTH_FIELDS);
/** "Within 10% of its rest length". */
const LONGEST = 1.1 * REST;

interface State { position: Words; previous: Words; pinned: Words }
interface Played { refused: string[]; drew: string; frames: V3Frame[]; played: Map<number, State>; sought: State | null; soughtFrame: V3Frame | null }

/** The cloth played to step 600 at one frame a step and seeked back to 300: every frame's three fields. */
function play(name: string, ignoresPinned: boolean): Played {
  const dir = out();
  const ops = clothOps({ ignoresPinned });
  const replies = checks(bin(), dir, ops);
  const refused = refusals(ops, replies);
  const none: Played = { refused, drew: '', frames: [], played: new Map(), sought: null, soughtFrame: null };
  if (refused.length > 0) return none;
  const doc = writeJson(dir, `${name}.json`, sceneDoc(`${name}-1993`, withEstimates(ops, replies)));
  const [reply] = run(bin(), dir, [view3dCall({ doc, fps: CLOTH_RATE, frames: STEPS + 2, seeks: [{ after: STEPS, to: SEEK }], capture: 'every', read: KEYS })]);
  const frames = view3dFrames(reply!, name);
  if (frames.length === 0) return { ...none, drew: refusal(reply!) };
  const state = (f: V3Frame): State => ({
    position: wordsOf(dir, f, CLOTH_FIELDS.position, name), previous: wordsOf(dir, f, CLOTH_FIELDS.previous, name), pinned: wordsOf(dir, f, CLOTH_FIELDS.pinned, name),
  });
  const played = new Map<number, State>();
  for (let k = 0; k <= STEPS; k++) {
    const f = framesNumbered(frames, k)[0];
    if (f) played.set(k, state(f));
  }
  const soughtFrame = framesNumbered(frames, SEEK)[1] ?? null;
  return { refused, drew: '', frames, played, sought: soughtFrame ? state(soughtFrame) : null, soughtFrame };
}

const at = (words: Float32Array, p: number): [number, number, number] => [words[3 * p]!, words[3 * p + 1]!, words[3 * p + 2]!];
const apart = (a: [number, number, number], b: [number, number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const place = (p: number): string => `(row ${Math.floor(p / SIDE)}, column ${p % SIDE})`;
const sizes = (s: State): number[] => [s.position.f32.length, s.previous.f32.length, s.pinned.u32.length];

/** Step 0 is the cloth the document states, and the three fields step: each problem as a sentence. */
function startAndStepProblems(run1: Played): string[] {
  const p: string[] = [];
  const s0 = run1.played.get(0);
  if (!s0) return ['no frame shows step 0'];
  if (JSON.stringify(sizes(s0)) !== JSON.stringify([POSITION_WORDS, POSITION_WORDS, POINTS])) return [`the fields hold ${sizes(s0).join(', ')} words, not ${POSITION_WORDS}, ${POSITION_WORDS} and ${POINTS}`];
  for (let q = 0; q < POINTS && p.length < 3; q++) {
    const off = apart(at(s0.position.f32, q), clothStart(Math.floor(q / SIDE), q % SIDE));
    if (!(off <= 1e-5)) p.push(`at step 0 point ${q} ${place(q)} is ${off} m from its start`);
    const pin = s0.pinned.u32[q]!;
    if (pin !== (q < SIDE ? 1 : 0)) p.push(`at step 0 point ${q} ${place(q)} has pinned ${pin}`);
  }
  if (s0.previous.hash !== s0.position.hash) p.push('at step 0 the previous position isn\'t the position: the cloth doesn\'t start at rest');
  for (let k = 1; k <= STEPS && p.length < 3; k++) {
    const [now, before] = [run1.played.get(k), run1.played.get(k - 1)];
    if (!now || !before) { p.push(`no frame shows step ${now ? k - 1 : k}`); continue; }
    if (now.previous.hash !== before.position.hash) p.push(`at step ${k} the previous position isn't the position step ${k - 1} had`);
    if (now.position.hash === before.position.hash) p.push(`the cloth didn't move from step ${k - 1} to step ${k}`);
  }
  const last = run1.played.get(STEPS);
  if (last && p.length === 0) {
    const height = (w: Float32Array): number => { let sum = 0; for (let q = 0; q < POINTS; q++) sum += w[3 * q + 1]!; return sum / POINTS; };
    if (!(height(last.position.f32) < height(s0.position.f32))) p.push(`the cloth's mean height is ${height(last.position.f32)} m at step ${STEPS} and ${height(s0.position.f32)} m at step 0: it didn't come down under gravity`);
  }
  return p;
}

/** The 0 m line: every pinned point's position at every step is the one it started at. Each problem names a point and how far it moved. */
function pinnedProblems(run1: Played): string[] {
  const p: string[] = [];
  const s0 = run1.played.get(0);
  if (!s0) return ['no frame shows step 0'];
  const pinned = Array.from({ length: POINTS }, (_, q) => q).filter((q) => s0.pinned.u32[q] !== 0);
  if (pinned.length !== SIDE) p.push(`${pinned.length} points are pinned at step 0, not the top row's ${SIDE}`);
  for (let k = 1; k <= STEPS && p.length < 3; k++) {
    const s = run1.played.get(k);
    if (!s) { p.push(`no frame shows step ${k}`); continue; }
    if (s.pinned.hash !== s0.pinned.hash) p.push(`the pinned field at step ${k} isn't the one at step 0`);
    const moved = pinned.map((q) => ({ q, m: apart(at(s.position.f32, q), at(s0.position.f32, q)) })).filter(({ m }) => !(m === 0));
    if (moved.length > 0) p.push(`pinned point ${moved[0]!.q} ${place(moved[0]!.q)} moved ${moved[0]!.m} m by step ${k}, not 0 m (${moved.length} pinned points moved)`);
  }
  return p;
}

/** The longest edge at every step is within 10% of its rest length. */
function edgeProblems(run1: Played): string[] {
  const p: string[] = [];
  for (let k = 0; k <= STEPS && p.length < 3; k++) {
    const s = run1.played.get(k);
    if (!s) { p.push(`no frame shows step ${k}`); continue; }
    let longest = 0; let from = 0; let to = 0;
    for (let q = 0; q < POINTS; q++) {
      for (const n of [q % SIDE < SIDE - 1 ? q + 1 : -1, q + SIDE < POINTS ? q + SIDE : -1]) {
        if (n < 0) continue;
        const d = apart(at(s.position.f32, q), at(s.position.f32, n));
        if (!(d <= longest)) { longest = d; from = q; to = n; }
      }
    }
    if (!(longest <= LONGEST)) p.push(`the longest edge at step ${k} is ${longest} m, from ${place(from)} to ${place(to)}: more than 10% over its rest length of ${REST} m`);
  }
  return p;
}

/** Held as fields: on every frame the three fields report one step and hold the same checkpoints. */
function togetherProblems(run1: Played): string[] {
  const p: string[] = [];
  for (const f of run1.frames) {
    if (p.length >= 3) break;
    const rows = KEYS.map((key) => ({ key, row: f.carried.get(key) }));
    const missing = rows.filter(({ row }) => !row).map(({ key }) => key);
    if (missing.length > 0) { p.push(`frame ${f.frame} reports no carried row for ${missing.join(', ')}`); continue; }
    const seen = rows.map(({ key, row }) => `${key} at step ${row!.step} holding checkpoints [${row!.checkpoints.join(', ')}]`);
    const same = rows.every(({ row }) => row!.step === rows[0]!.row!.step && JSON.stringify(row!.checkpoints) === JSON.stringify(rows[0]!.row!.checkpoints));
    if (!same) p.push(`at frame ${f.frame} the three fields aren't carried and checkpointed together: ${seen.join('; ')}`);
    else if (rows[0]!.row!.step !== f.frame) p.push(`frame ${f.frame} shows the cloth at step ${rows[0]!.row!.step}`);
  }
  return p;
}

/** The seek to step 300 restores the three fields from one checkpoint and has play's hashes. */
function seekProblems(run1: Played): string[] {
  const p: string[] = [];
  const want = run1.played.get(SEEK);
  if (!want || !run1.sought || !run1.soughtFrame) return [`the seek from step ${STEPS} drew no second frame ${SEEK}`];
  for (const [name, got, played] of [['position', run1.sought.position, want.position], ['previous', run1.sought.previous, want.previous], ['pinned', run1.sought.pinned, want.pinned]] as const) {
    if (got.hash !== played.hash) p.push(`at step ${SEEK} the seek's ${name} hashes ${got.hash}, the play's ${played.hash}`);
  }
  const restored = KEYS.map((key) => run1.soughtFrame!.carried.get(key)?.restored ?? null);
  if (restored.some((r) => r === null)) p.push(`the seek's frame doesn't say which checkpoint each field was restored from: ${JSON.stringify(restored)}`);
  else if (restored.some((r) => r!.from !== restored[0]!.from || r!.from + r!.steps !== SEEK)) p.push(`the seek restored the fields from different steps, or not to step ${SEEK}: ${JSON.stringify(restored)}`);
  return p;
}

describe(`${AC[5]} a 64 × 64 cloth held as three fields hangs from its pinned top row`, () => {
  it(`${AC[5]} over 600 steps of ${PASSES} constraint passes every pinned point moves 0 m, the longest edge stays within 10% of its rest length, the three fields are checkpointed together and a seek to step 300 equals play by hash; a planted step that ignores the pinned field drops the top row and fails the 0 m line`, () => {
    requireGpu();
    const cloth = play('cloth', false);
    expect(cloth.refused, 'the cloth\'s ten operators check').toEqual([]);
    expect(cloth.drew, 'view3d drew the cloth').toBe('');
    expect(cloth.frames.length, `one frame a step to step ${STEPS}, and the seek's`).toBe(STEPS + 2);
    expect(startAndStepProblems(cloth), 'the cloth starts as the document states and its three fields step').toEqual([]);
    expect(pinnedProblems(cloth), 'the 0 m line: every pinned point moves 0 m over 600 steps').toEqual([]);
    expect(edgeProblems(cloth), 'the longest edge stays within 10% of its rest length over 600 steps').toEqual([]);
    expect(togetherProblems(cloth), 'held as three fields: carried and checkpointed together on every frame').toEqual([]);
    expect(seekProblems(cloth), `the seek to step ${SEEK} equals play by hash`).toEqual([]);

    // The planted step: the same cloth, its operators never reading the pinned field to hold a point.
    const planted = play('cloth-ignores-pinned', true);
    expect(planted.refused, 'the planted cloth\'s operators check').toEqual([]);
    expect(planted.drew, 'view3d drew the planted cloth').toBe('');
    const [start, end] = [planted.played.get(0), planted.played.get(STEPS)];
    expect(start && end, 'the planted cloth played to step 600').toBeTruthy();
    const kept = Array.from({ length: SIDE }, (_, c) => c).filter((c) => !(end!.position.f32[3 * c + 1]! < start!.position.f32[3 * c + 1]!));
    expect(kept, 'the planted step drops the top row: no top-row point is as high at step 600 as it started').toEqual([]);
    const failed = pinnedProblems(planted).join('\n');
    expect(failed, 'the planted step fails the 0 m line, naming a pinned point and how far it moved').toMatch(/pinned point \d+ \(row 0, column \d+\) moved [0-9.e+-]+ m by step \d+, not 0 m/);
  }, 3_600_000);
});
