// AC7 #161.01550f9e: On a 539 × 208 title, slice_shift {count: [2, 4], height: [10, 35] px, shift: [18, 64] px, step:
// 0.14 s, seed: 9} draws identical frames inside each 0.14 s step and different ones across steps, moves 2 to 4 strips of
// 10 to 35 px by 18 to 64 px, and leaves every other row equal to the clean title; seeking equals playing and the
// flicker check passes; a planted slice_shift seeded by frame number differs inside a step and fails, naming the op.
//
// The title is a 539 × 208 px card in the shipped clean look: a group `title` whose children are a ramp across the
// whole card, forty thin ticks at uneven places and five block letters, so every row changes when it moves sideways by
// 18 px or more and no two shifts look alike. The group's one pass is `fx.slice_shift@1` with the criterion's params
// (`step` in flicks: 0.14 s is 98,784,000). `film2d` (#417's call, #430's `from` and `hash`, #464's `capture` and
// `flicker`) plays it at 50 frames a second, where a step is exactly 7 frames: frames 0 to 41, six steps. The clean
// title is the same card with no pass, drawn in the same run.
//
// One judge reads the film (`judge`), and the planted film goes through the same one:
//   - inside a step, every frame's pixel hash is the step's first frame's; a frame that differs is named with the op;
//   - each step's hash differs from the step before it;
//   - in each step's first frame, every row either equals the clean title's row or is that row moved sideways by one
//     shift d (the clean row read at x − d, between texels when d isn't whole; 3 codes of 8-bit rounding, on 95% of
//     the row's pixels whose source is on the card). Rows that run together with one shift are a strip: 2 to 4 strips,
//     each 10 to 35 rows, each |d| from 18 to 64 px;
//   - frames 23 and 30, each sought in a fresh process (`from`), have the played frames' hashes;
//   - the flicker check (`flicker: true`) answers PASS.
// Wrong programs: the base (no such operator); `--planted slice_shift_seeded_by_frame`, which draws the strips from
// the seed and the frame number: frames differ inside a step, the judge fails naming `fx.slice_shift@1`, and the
// flicker check answers FAIL with `reseed` naming the op.
import { describe, expect, it } from 'vitest';
import { AC, SLICE_SHIFT, TIMEOUT, buildLine, isObject, listProblems, packOperators, requireGpu, runGpu, shown, useBin, useDir, type Image, type JsonObject, type JsonValue, type Planted } from './helpers.ts';
import { mismatch, stripsOf } from './measures.ts';
import { TITLE, film2d, rowsOf, titleDoc, type Row } from './title.ts';

const ID = AC[7];
const gpu = useBin('deep-gpu');
const dir = useDir();
const H = TITLE.size[1];
const FRAMES = TITLE.step_frames * TITLE.steps;
const SOUGHT = [23, 30];

/** What one sliced frame does to the clean title, by the criterion's words. */
function strips(shot: Image, clean: Image, what: string): string[] {
  const { strips: runs, stray } = stripsOf(shot, clean);
  const found = stray.slice(0, 4).map((y) => `${what}: row ${y} is neither the clean title's row nor that row moved sideways`);
  const said = runs.map((r) => `rows ${r.from} to ${r.from + r.rows - 1} by ${r.d} px`).join('; ');
  if (runs.length < 2 || runs.length > 4) found.push(`${what}: ${runs.length} strips moved, not 2 to 4 (${said})`);
  for (const r of runs) {
    if (r.rows < 10 || r.rows > 35) found.push(`${what}: the strip at row ${r.from} is ${r.rows} px high, not 10 to 35 (${said})`);
    if (Math.abs(r.d) < 18 - 0.05 || Math.abs(r.d) > 64 + 0.05) found.push(`${what}: the strip at row ${r.from} moved ${r.d} px, not 18 to 64 (${said})`);
  }
  return found;
}

interface Film { played: Row[] | string; clean: Row[] | string; sought: (Row[] | string)[]; flicker: JsonObject }
function play(planted?: Planted): Film {
  const out = dir();
  const all = Array.from({ length: FRAMES }, (_, n) => n);
  const ran = runGpu(gpu().bin, out, [film2d(titleDoc('title-clean', false), { frames: 1, capture: [0] }), film2d(titleDoc('title-sliced', true), { frames: FRAMES, capture: all as JsonValue[], flicker: true })], planted);
  const sought = SOUGHT.map((n) => {
    const fresh = runGpu(gpu().bin, out, [film2d(titleDoc('title-sliced', true), { from: n, frames: 1 })], planted);
    return fresh.problem || rowsOf(out, fresh.replies[0], `frame ${n} sought`);
  });
  return {
    clean: ran.problem || rowsOf(out, ran.replies[0], 'the clean title'), played: ran.problem || rowsOf(out, ran.replies[1], 'the sliced title'), sought,
    flicker: !ran.problem && isObject(ran.replies[1]!['flicker']) ? ran.replies[1]!['flicker'] : {},
  };
}
/** Everything wrong with the film, each line naming what the criterion names. */
function judge(film: Film): string[] {
  const { played, clean } = film;
  if (typeof played === 'string') return [played];
  if (typeof clean === 'string') return [clean];
  const found: string[] = [];
  const at = (n: number): Row | undefined => played.find((r) => r.frame === n);
  const card = clean[0]?.picture;
  if (played.length !== FRAMES || !card) return [`the film plays ${played.length} frames of ${FRAMES}, and the clean title ${card ? 'draws' : 'has no picture'}`];
  for (let k = 0; k < TITLE.steps; k++) {
    const first = at(k * TITLE.step_frames)!;
    for (let j = 1; j < TITLE.step_frames; j++) {
      const n = k * TITLE.step_frames + j;
      if (at(n)!.hash !== first.hash) { found.push(`${SLICE_SHIFT}: frame ${n} differs from frame ${first.frame} inside step ${k} (${(k * 0.14).toFixed(2)} s to ${((k + 1) * 0.14).toFixed(2)} s)`); break; }
    }
    if (k > 0 && first.hash === at((k - 1) * TITLE.step_frames)!.hash) found.push(`${SLICE_SHIFT}: step ${k} draws step ${k - 1}'s frame again`);
    if (!first.picture) found.push(`frame ${first.frame} has no picture`);
    else found.push(...strips(first.picture, card, `${SLICE_SHIFT}, step ${k}`));
  }
  SOUGHT.forEach((n, i) => {
    const s = film.sought[i]!;
    if (typeof s === 'string') found.push(s);
    else if (s[0]?.frame !== n || s[0].hash !== at(n)!.hash) found.push(`${SLICE_SHIFT}: frame ${n} sought in a fresh process isn't the played frame ${n}`);
  });
  if (film.flicker['verdict'] !== 'PASS') found.push(`the flicker check answers ${shown(film.flicker, 300)}, not PASS`);
  return found;
}

describe(`${ID} slice_shift on a title`, () => {
  it(`${ID} the criterion's slice_shift draws one frame a 0.14 s step, another the next, each moving 2 to 4 strips of 10 to 35 px by 18 to 64 px over an otherwise clean title; seeking equals playing and the flicker check passes`, () => {
    expect(listProblems(packOperators()).filter((p) => p.includes(SLICE_SHIFT)), 'the pack holds fx.slice_shift@1').toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const film = play();
    // The card shows a strip wherever it moves: every row of the clean title changes when moved by 18 px.
    if (typeof film.clean !== 'string' && film.clean[0]?.picture) {
      const card = film.clean[0].picture;
      const blind = Array.from({ length: H }, (_, y) => y).filter((y) => { const m = mismatch(card, card, y, 18); return m.bad < 0.2 * m.read; });
      expect(blind, 'rows of the clean title that a sideways move of 18 px wouldn\'t change').toEqual([]);
    }
    const found = judge(film);
    expect(found, found.slice(0, 20).join('\n  ')).toEqual([]);
  }, TIMEOUT);

  it(`${ID} planted: a slice_shift seeded by frame number (--planted slice_shift_seeded_by_frame) differs inside a step and fails, the judge and the flicker check both naming the op`, () => {
    expect(listProblems(packOperators()).filter((p) => p.includes(SLICE_SHIFT)), 'the pack holds fx.slice_shift@1').toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const film = play('slice_shift_seeded_by_frame');
    const found = judge(film);
    expect(found.filter((f) => f.startsWith(`${SLICE_SHIFT}: frame `) && f.includes('inside step')).length, `the planted film differs inside a step, named with the op; the judge found:\n  ${found.slice(0, 10).join('\n  ')}`).toBeGreaterThan(0);
    expect(film.flicker['verdict'], `the flicker check fails the planted film: ${shown(film.flicker, 300)}`).toBe('FAIL');
    const reseed = (Array.isArray(film.flicker['reseed']) ? film.flicker['reseed'] : []).filter(isObject).map((r) => r['op']);
    expect(reseed, 'its `reseed` names the op').toContain(SLICE_SHIFT);
  }, TIMEOUT);
});
