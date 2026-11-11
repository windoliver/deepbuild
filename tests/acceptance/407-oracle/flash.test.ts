// #407.2d08dfcb (AC3), the Oracle lane: the upstream flash-detection suite's tests, pinned at commit fd3e09e4e6 and
// vendored under doneright/oracles/vendor/ on branch doneright of DeepBuildAI/deepbuild, ported onto our flicker check
// (README.md here says which file and which cases). No upstream code is copied: each upstream assertion is re-expressed
// as a film this file builds, judged by `deep-show run` through a claim whose one requirement is {kind: film.flicker},
// and the upstream result is held to our verdict's row. Its files carry their own copyright notice in the vendored copy.
//
// Ported (each a 640 × 360 film, whole-frame or banded flat grays, sRGB values whose relative luminance is IEC
// 61966-2-1's decode in linear light, as the upstream RelativeLuminanceTest's white 1, black 0 and gray 0.216 are):
//   - linear light: a swing between sRGB 220 and 240 (linear 0.716 to 0.871, a change of 0.156, though only 0.078 in
//     encoded values) four times a second fails; one between sRGB 20 and 50 (0.007 to 0.032, a change of 0.025, though
//     0.118 encoded) passes.
//   - a transition counts only past a 0.1 change (CheckTransition's threshold, appsettings RelativeLuminanceFlashThreshold
//     0.1): sRGB 124 and 147 (a change of 0.090) four times a second passes; 124 and 154 (0.122) fails.
//   - the darker frame under 0.8 (RelativeDarkLuminanceThreshold 0.8): 230 and 255 (darker 0.791) fails; 232 and 255
//     (darker 0.807) passes; and the upstream gray case below.
//   - at least a quarter of the screen (FlashDetection AreaProportion 0.25, the SafeArea tests): black and white over
//     the top 94 of 360 rows (26.1%) fails; over the top 86 rows (23.9%) passes.
//   - more than six transitions in a second fails (TransitionTracker MaxTransitions 6, the EvaluateFrameMoment tests): a
//     burst of six whole-frame black and white transitions, 0.125 s apart, passes; seven fail.
//   - the video cases (VideoAnalysisTests, their expected logs in cases.json): 2Hz_5s, 2Hz_6s, gray, extendedFLONG and
//     intermitentEF pass, as no frame of their logs is a flash fail; 3Hz_6s fails, its first failing second starting no
//     later than frame 30 (1.16 s), the frame its log first marks a flash fail.
//
// Not ported: the upstream extended-fail rule (four to six transitions a second over four of five seconds, result 2 in
// 2Hz_6s from frame 114 and in 3Hz_6s from frame 120), which neither the issue nor the design holds; its red-saturation
// and pattern checks; its CD luminance mode; and its per-frame log columns, which our verdict doesn't report.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AC, FLASH, FLICKER, FLICKER_SIZE, FULL, TIMEOUT, docId, failsWith, film, flips, holdKeys, judge, lookOf, luminance, none, passFailures, rect,
  useBuilds, useFolders, type Film, type JsonObject, type JsonValue, type Row,
} from '../407/helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();
const HERE = dirname(fileURLToPath(import.meta.url));

interface Case { case: string; fps: number; frames: number; low: number; high: number; high_frames: [number, number][]; upstream: { max_transitions: number; first_flash_fail: number | null; first_extended_fail: number | null } }
const CASES = (JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8')) as { cases: Case[] }).cases;

/** The sRGB gray whose relative luminance is `y`, within 0.001. */
function grayOf(y: number): number {
  let best = 0;
  for (let v = 0; v <= 255; v++) if (Math.abs(luminance(v) - y) < Math.abs(luminance(best) - y)) best = v;
  expect(Math.abs(luminance(best) - y), `an sRGB gray has relative luminance ${y}`).toBeLessThan(0.001);
  return best;
}

/**
 * A swing: the top `rows` of the frame (all 360 by default) at sRGB `low`, an sRGB `high` band over it shown at each
 * of `at` in turn (hidden first), the rest of the frame white; `fps` frames a second, `span` seconds.
 */
interface Swing { name: string; low: number; high: number; at: number[]; rows?: number; fps?: number; span?: number }
function swingFilm(n: number, s: Swing): Film {
  const doc = docId(n);
  const look = lookOf(`oracle-${n}`, { ground: 255, muted: s.low, accent: s.high, raised: 255 });
  const box: [number, number, number, number] = [0, 0, FLICKER_SIZE[0], s.rows ?? FLICKER_SIZE[1]];
  let v = 0;
  const keys: [number, JsonValue][] = [[0, v]];
  for (const t of s.at) { v = 1 - v; keys.push([t, v]); }
  const document: JsonObject = film(doc, s.name, [rect('low', box, 'muted', 0), rect('high', box, 'accent', 1)], {
    span: s.span ?? 4, fps: s.fps ?? 24, size: FLICKER_SIZE, look, channels: { swing: holdKeys('items/high/adjust/opacity', 'f32', keys) },
  });
  return { name: s.name, doc, document, stored: [look.bytes], check: FLICKER };
}
/** A video case: each frame wholly at `low` or `high` as its expected log reads, at its frame rate. */
function caseFilm(n: number, c: Case): Film {
  const at: number[] = [];
  for (const [a, b] of c.high_frames) at.push((a - 1) / c.fps, b / c.fps);
  return swingFilm(n, { name: `the upstream case ${c.case}`, low: grayOf(c.low), high: grayOf(c.high), at: at.filter((t) => t < c.frames / c.fps), fps: c.fps, span: c.frames / c.fps });
}
const flashFrom = (row: Row | undefined, what: string, tIn: [number, number]): string[] =>
  failsWith(row, FLASH, { subject: 'a flash', match: () => true, tIn }, what);
const FOUR_HZ = flips(4, 1, 3);
const ABOUT_1S: [number, number] = [1 - 1 / 24 - 1e-6, 1 + 1 / 24 + 1e-6];

describe(`${AC[3]} the upstream flash-detection suite's rules and video cases, run on our flicker check`, () => {
  it(`${AC[3]} oracle: relative luminance in linear light, a 0.1 change, the darker frame under 0.8, a quarter of the screen and six transitions a second`, () => {
    const swings: (Swing & { fails: boolean })[] = [
      { name: 'sRGB 220 and 240 four times a second', low: 220, high: 240, at: FOUR_HZ, fails: true },
      { name: 'sRGB 20 and 50 four times a second', low: 20, high: 50, at: FOUR_HZ, fails: false },
      { name: 'sRGB 124 and 147 four times a second', low: 124, high: 147, at: FOUR_HZ, fails: false },
      { name: 'sRGB 124 and 154 four times a second', low: 124, high: 154, at: FOUR_HZ, fails: true },
      { name: 'sRGB 230 and 255 four times a second', low: 230, high: 255, at: FOUR_HZ, fails: true },
      { name: 'sRGB 232 and 255 four times a second', low: 232, high: 255, at: FOUR_HZ, fails: false },
      { name: 'black and white over 26.1% of the frame', low: 0, high: 255, at: FOUR_HZ, rows: 94, fails: true },
      { name: 'black and white over 23.9% of the frame', low: 0, high: 255, at: FOUR_HZ, rows: 86, fails: false },
      { name: 'six transitions in a second', low: 0, high: 255, at: [1, 1.125, 1.25, 1.375, 1.5, 1.625], fails: false },
      { name: 'seven transitions in a second', low: 0, high: 255, at: [1, 1.125, 1.25, 1.375, 1.5, 1.625, 1.75], fails: true },
    ];
    // The fixtures' own numbers, each on its side of the upstream thresholds.
    const d = (a: number, b: number): number => luminance(b) - luminance(a);
    expect(d(220, 240)).toBeGreaterThan(0.12); expect((240 - 220) / 255).toBeLessThan(0.1); expect(luminance(220)).toBeLessThan(0.8);
    expect(d(20, 50)).toBeLessThan(0.05); expect((50 - 20) / 255).toBeGreaterThan(0.1);
    expect(d(124, 147)).toBeLessThan(0.095); expect(d(124, 154)).toBeGreaterThan(0.115);
    expect(luminance(230)).toBeLessThan(0.8); expect(luminance(232)).toBeGreaterThan(0.8);
    expect(94 / 360).toBeGreaterThan(0.26); expect(86 / 360).toBeLessThan(0.24);
    const films = swings.map((s, i) => swingFilm(i + 1, s));
    const { judged } = judge(bin(FULL), folder(), films);
    none(swings.flatMap((s) => s.fails ? flashFrom(judged[s.name]?.row, s.name, ABOUT_1S) : passFailures(judged[s.name]?.row, s.name)), 'the upstream rules');
  }, TIMEOUT);

  it(`${AC[3]} oracle: the video cases 2Hz_5s, 2Hz_6s, 3Hz_6s, gray, extendedFLONG and intermitentEF`, () => {
    expect(CASES.map((c) => c.case)).toEqual(['2Hz_5s', '2Hz_6s', '3Hz_6s', 'gray', 'extendedFLONG', 'intermitentEF']);
    const films = CASES.map((c, i) => caseFilm(i + 1, c));
    const { judged } = judge(bin(FULL), folder(), films);
    none(CASES.flatMap((c) => {
      const name = `the upstream case ${c.case}`;
      const fail = c.upstream.first_flash_fail;
      return fail === null ? passFailures(judged[name]?.row, name) : flashFrom(judged[name]?.row, name, [(fail - 1) / c.fps - 1 - 1e-6, (fail - 1) / c.fps + 1e-6]);
    }), 'the upstream video cases');
  }, TIMEOUT);
});
