// AC1 #1969.880c329e: "A cursor anchored to `#head` sits after the k-th grapheme within 0.5 px while k graphemes show, at
// 100 sampled times, seeked or played"
//
// One film, 640 × 360 u, through `deep-canvas-render raster` (README: The surface under test). "Will it ship?" (13
// graphemes, the body role at 40 u) three times at x = 40: `fading` (y 30) with `reveal: {mode: fade, order: reading,
// progress}`, `writing` (y 130) with the same reveal in write mode, and `still` (y 230) with none. Both reveals' progress
// is keyed linearly from 0 at 0.5 s to 1 at 2.5 s. Two carets, the text "|" in the body role, sit at `at: {anchor:
// "fading#head" | "writing#head", pos: [0, 0, 0]}`; a third, `twin`, sits unanchored at (560, 290) and gives a caret's
// own pen offset from its anchor point (its run's origin), so a caret's anchor point is its pen less that offset.
//
// Expected, from the design: 13 units, lag = min(4 ÷ 13, 0.2) = 0.2, each over w = 1 ÷ 3.4 of the progress; unit u has
// passed 0.5 once the progress passes (0.2u + 0.5) × w, so k(t) units show. A caret sits after the k-th grapheme: at the
// still line's pen of grapheme k − 1 plus its advance (at grapheme 0's pen for k = 0), on the line's baseline (the still
// line's, moved by the lines' 100 u apart), each within 0.5 px (1 u is 1 px here).
//
// The 100 times: the middle of each of the 14 intervals k = 0 … 13 holds, plus 86 drawn by a seeded generator from [0,
// 3] s, none within 2 ms of a unit passing 0.5, so each time's k is unambiguous. Played: one process, the times rising.
// Seeked: a fresh process, the same times in a seeded order, each line a jump. Wrong programs: a head after the last unit
// with any reveal at all (graphemes ahead of k), after the last unit fully revealed (graphemes behind k), at the run's
// origin, on the line's top instead of its baseline, or a head that only follows a fade reveal.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, fl, glyphsOf, halfOf, linear, none, penOf, random, raster, renderFilm, showTime, shownAt, shuffled, textItem,
  useBinary, useFolders, type Glyph, type JsonObject,
} from './helpers.ts';

const render = useBinary('deep-canvas-render');
const folder = useFolders();

const TEXT = 'Will it ship?';
const N = 13;
const SIZE = 40;
const X = 40;
const STILL_Y = 230;
const TWIN: [number, number] = [560, 290];
const START = 0.5; const RUN = 2; const END = 3;
const TOLERANCE = 0.5;
const LINES = [
  { id: 'fading', caret: 'caret_f', mode: 'fade', y: 30 },
  { id: 'writing', caret: 'caret_w', mode: 'write', y: 130 },
] as const;

const words = { text: TEXT, font: 'body', size: SIZE, paint: { fill: { role: 'ink' } } };
const caret = { text: '|', font: 'body', size: SIZE, paint: { fill: { role: 'accent' } } };
const DOC: JsonObject = renderFilm('ac1-head', [
  ...LINES.map((l, i) => textItem(l.id, `a${i}`, { ...words, reveal: { mode: l.mode, order: 'reading', progress: 0 } }, { pos: [X, l.y, 0] })),
  textItem('still', 'a2', words, { pos: [X, STILL_Y, 0] }),
  ...LINES.map((l, i) => textItem(l.caret, `b${i}`, caret, { pos: [0, 0, 0], anchor: `${l.id}#head` })),
  textItem('twin', 'b2', caret, { pos: [TWIN[0], TWIN[1], 0] }),
], {
  channels: Object.fromEntries(LINES.map((l) => [l.id, linear(`items/${l.id}/params/reveal/progress`, [[START, 0], [START + RUN, 1]])])),
}, `${END}s`);

/** The keyed progress at t seconds. */
const progress = (s: number): number => Math.min(1, Math.max(0, (s - START) / RUN));
/** The time, in seconds, at which unit u passes 0.5. */
const passes = (u: number): number => START + RUN * halfOf(u, N);

/** The 100 sampled times, whole flicks, ascending: every k = 0 … 13 held at least once, none near a unit's half. */
function sampled(): number[] {
  const edges = [0, ...Array.from({ length: N }, (_, u) => passes(u)), END];
  const times = new Set<number>(edges.slice(1).map((b, k) => fl((edges[k]! + b) / 2)));
  const next = random('AC1 #1969 #head');
  while (times.size < 100) {
    const s = next() * END;
    if (Array.from({ length: N }, (_, u) => passes(u)).every((p) => Math.abs(p - s) > 0.002)) times.add(fl(s));
  }
  return [...times].sort((a, b) => a - b);
}

/** Where a caret sits after the k-th grapheme on the line at y, from the still line's run. */
function after(still: Glyph[], k: number, y: number): [number, number] {
  const baseline = penOf(still[0]!)[1] + (y - STILL_Y);
  if (k === 0) return [penOf(still.find((g) => g.grapheme === 0)!)[0], baseline];
  const ends = still.filter((g) => g.grapheme === k - 1).map((g) => penOf(g)[0] + g.advance);
  return [Math.max(...ends), baseline];
}

/** Every way the carets miss the grapheme they should follow, at each time of one process's answers. */
function misses(answers: JsonObject[], times: number[], how: string): string[] {
  const out: string[] = [];
  answers.forEach((a, i) => {
    const t = times[i]!; const what = `${how} at ${showTime(t)}`;
    const still = glyphsOf(a, 'still', what);
    const twin = penOf(glyphsOf(a, 'twin', what)[0]!);
    const offset = [twin[0] - TWIN[0], twin[1] - TWIN[1]];
    const k = shownAt(progress(t / FLICKS), N);
    for (const l of LINES) {
      const pen = penOf(glyphsOf(a, l.caret, what)[0]!);
      const at = [pen[0] - offset[0]!, pen[1] - offset[1]!];
      const want = after(still, k, l.y);
      if (!(Math.abs(at[0]! - want[0]) <= TOLERANCE && Math.abs(at[1]! - want[1]) <= TOLERANCE)) {
        out.push(`${what}: ${k} graphemes of ${l.id} (${l.mode}) show, and its caret sits at (${at[0]!.toFixed(3)}, ${at[1]!.toFixed(3)}), not after grapheme ${k} at (${want[0].toFixed(3)}, ${want[1].toFixed(3)})`);
      }
    }
  });
  return out;
}

describe(`${AC[1]} a cursor anchored to #head follows the graphemes that show`, () => {
  it(`${AC[1]} a cursor anchored to #head sits after the k-th grapheme within 0.5 px while k graphemes show, at 100 sampled times, played and seeked, in fade and in write mode`, () => {
    const times = sampled();
    expect(times.length, 'one hundred sampled times').toBe(100);
    const held = new Set(times.map((t) => shownAt(progress(t / FLICKS), N)));
    expect([...held].sort((a, b) => a - b), 'the sampled times hold every count of graphemes from 0 to 13').toEqual(Array.from({ length: N + 1 }, (_, k) => k));

    const played = raster(render(), folder(), DOC, times).answers;
    const still = glyphsOf(played[0]!, 'still', 'the first frame');
    const graphemes = [...new Set(still.map((g) => g.grapheme))].sort((a, b) => a - b);
    expect(graphemes, `the still line's run holds every grapheme of "${TEXT}" in order`).toEqual(Array.from({ length: N }, (_, k) => k));

    const order = shuffled(times, 'AC1 #1969 seek');
    const seeked = raster(render(), folder(), DOC, order).answers;
    none([...misses(played, times, 'played'), ...misses(seeked, order, 'seeked')], 'each caret sits after the k-th grapheme within 0.5 px while k graphemes show');
  }, TIMEOUT);
});
