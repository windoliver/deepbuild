// AC3 #222.f801fafc (Oracle lane): staggered windows. Ported from the upstream projects' tests the Oracle page pins
// (README: Sources): a fork's TestGetSubAlpha (test_timeline.py, lines 92–119) and an upstream animation library's
// test_animationgroup_with_wait (test_composition.py, lines 124–133). Its graphical tests (test_creation.py,
// test_indication.py, test_specialized.py, test_movements.py and their control frames) are the last case: BLOCKED.
//
// TestGetSubAlpha: n parts staggered by a lag ratio run over (n − 1) × lag + 1 of one part's span, part i running its
// rate function in its own window: progress clip(alpha × span − i × lag, 0, 1). Ours: one cue over n squares,
// `lag`, `span: 1s`, `ease: smoothstep`, setting each square's x from 0 to 1, so square i's x at t s is
// smoothstep(clip(t − i × lag, 0, 1)). The grid is the upstream lags (0, 0.05, 0.1, 0.2, 1/3, 0.5, 0.9, 1) by
// n = 1, 2, 5 and 12 (the upstream draws n from 1 to 12, and 1 to 6 for the rate-function test).
// - test_a_windows_ends_are_exact: at 0 s every part reads exactly 0, and at the cue's end (its marker, which must lie
//   at (n − 1) × lag + 1 s within one flick) every part reads exactly 1.
// - test_parts_go_in_order and test_each_part_runs_the_rate_function_in_its_window (n ≤ 6): at 20 times across the
//   cue, part i reads at least part i + 1, each within [0, 1], and each equals smoothstep(clip(t − i × lag, 0, 1))
//   within 1e-6 (the upstream's 1e-12, widened by the whole-flick rounding of each window's start, under 2e-9 s).
//   The upstream uses its ease_out_back; smoothstep is used here because the design states its formula.
// test_animationgroup_with_wait: a group with lag ratio 1 lays a 1 s wait and a 1 s fade in at (0, 1) and (1, 2). Ours:
// a wait of 1 s and a fade_in after it.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, arr, blocked, cueList, docId, evalAt, film, fl, num, none, present, presented, run, showTime, smoothstep, square, useFolders, useShow,
  valuesOf, windows, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const LAGS = [0, 0.05, 0.1, 0.2, 1 / 3, 0.5, 0.9, 1];
const COUNTS = [1, 2, 5, 12];
const TOLERANCE = 1e-6;

interface Grid { n: number; lag: number; doc: JsonObject; parts: string[] }
const grid: Grid[] = COUNTS.flatMap((n) => LAGS.map((lag): Grid => {
  const parts = Array.from({ length: n }, (_, i) => `p${i}`);
  const doc = film(`${n} parts at lag ${lag}`, [...parts.map((id, i) => square(id, [0, 30 * i])), cueList([{ id: 'stagger', targets: parts, lag, span: '1s', ease: 'smoothstep', set: { 'at/pos/0': 1 } }])], 14);
  return { n, lag, doc, parts };
}));
const name = (g: Grid): string => `${g.n} parts at lag ${g.lag}`;
const xs = (reply: JsonObject, g: Grid, what: string): number[] => {
  const v = valuesOf(reply, what);
  return g.parts.map((p) => num(arr(v[`items/${p}/at/pos`], `${what}: items/${p}/at/pos`)[0], `${what}: ${p}'s x`));
};

/** Every grid film presented: each one's cue window from its marker. */
function windowsOfGrid(): [number, number][] {
  const replies = run(show(), folder(), grid.map((g, k) => present(docId(k + 1), g.doc)));
  return grid.map((g, k) => { presented(replies[k]!, name(g)); return windows(replies[k]!, ['stagger'], name(g))[0]!; });
}

describe(`${AC[3]} staggered parts run in their own windows, as the upstream projects' tests lay them`, () => {
  it(`${AC[3]} TestGetSubAlpha.test_a_windows_ends_are_exact: every part reads exactly 0 at the start and exactly 1 at the cue's end, which lies at (n − 1) × lag + 1 s`, () => {
    const win = windowsOfGrid();
    const failures: string[] = [];
    grid.forEach((g, k) => {
      const want = fl((g.n - 1) * g.lag + 1);
      if (win[k]![0] !== 0 || Math.abs(win[k]![1] - want) > 1) failures.push(`${name(g)}: the cue runs ${showTime(win[k]![0])} to ${showTime(win[k]![1])}, not 0 to ${showTime(want)} within one flick`);
    });
    none(failures, 'each staggered cue spans (n − 1) × lag + 1 of its span');
    const calls = [...grid.map((g, k) => present(docId(k + 1), g.doc)), ...grid.flatMap((g, k) => [evalAt(docId(k + 1), 0, g.parts.map((p) => `items/${p}/at/pos`)), evalAt(docId(k + 1), win[k]![1], g.parts.map((p) => `items/${p}/at/pos`))])];
    const replies = run(show(), folder(), calls);
    grid.forEach((g, k) => {
      const start = xs(replies[grid.length + 2 * k]!, g, `${name(g)} at 0 s`);
      const end = xs(replies[grid.length + 2 * k + 1]!, g, `${name(g)} at its end`);
      start.forEach((x, i) => { if (x !== 0) failures.push(`${name(g)}: part ${i} reads ${x} at 0 s, not exactly 0`); });
      end.forEach((x, i) => { if (x !== 1) failures.push(`${name(g)}: part ${i} reads ${x} at the cue's end, not exactly 1`); });
    });
    none(failures, 'every window\'s ends are exact');
  }, TIMEOUT);

  it(`${AC[3]} TestGetSubAlpha's parts go in order, each running the ease in its own window: smoothstep(clip(t − i × lag, 0, 1)) within ${TOLERANCE}`, () => {
    const small = grid.filter((g) => g.n <= 6);
    const win = windowsOfGrid();
    const times = small.map((g) => { const end = win[grid.indexOf(g)]![1]; return Array.from({ length: 20 }, (_, j) => Math.round((end * (j + 0.5)) / 20)); });
    const calls = [...small.map((g, k) => present(docId(k + 1), g.doc)), ...small.flatMap((g, k) => times[k]!.map((t) => evalAt(docId(k + 1), t, g.parts.map((p) => `items/${p}/at/pos`))))];
    const replies = run(show(), folder(), calls);
    const failures: string[] = [];
    let at = small.length;
    small.forEach((g, k) => {
      for (const t of times[k]!) {
        const x = xs(replies[at++]!, g, `${name(g)} at ${showTime(t)}`);
        x.forEach((v, i) => {
          const want = smoothstep(Math.min(Math.max(t / fl(1) - i * g.lag, 0), 1));
          if (Math.abs(v - want) > TOLERANCE) failures.push(`${name(g)}: part ${i} at ${showTime(t)} reads ${v}, not ${want}`);
          if (v < 0 || v > 1) failures.push(`${name(g)}: part ${i} at ${showTime(t)} reads ${v}, outside [0, 1]`);
          if (i > 0 && x[i - 1]! < v) failures.push(`${name(g)}: at ${showTime(t)} part ${i} (${v}) is ahead of part ${i - 1} (${x[i - 1]})`);
        });
      }
    });
    none(failures, 'each part runs the ease in its own window, in order');
  }, TIMEOUT);

  it(`${AC[3]} test_animationgroup_with_wait: a 1 s wait and a 1 s fade in laid one after the other run at (0, 1) and (1, 2)`, () => {
    const doc = film('A wait and a fade in', [square('sq'), cueList([{ id: 'wait', span: '1s' }, { id: 'show', kind: 'fade_in', targets: ['sq'], span: '1s' }])], 3);
    const [reply] = run(show(), folder(), [present(docId(1), doc)]);
    presented(reply!, 'a wait and a fade in');
    expect(windows(reply!, ['wait', 'show'], 'a wait and a fade in'), 'the windows are (0, 1) and (1, 2) s, in flicks').toEqual([[0, fl(1)], [fl(1), fl(2)]]);
  }, TIMEOUT);

  it(`${AC[3]} the upstream graphical tests of the verbs (control frames of Create, FadeIn, Indicate, Circumscribe and the rest)`, () => {
    blocked(
      'the upstream graphical tests compare every frame of a verb with control frames its own renderer drew (its camera, stroke widths and color space); matching ours to them needs those frames rendered outside the repo, which this lane does not do.',
      'render the pinned upstream graphical tests once outside the repo and store their frames as goldens beside the 40-cue explainer\'s (the issue\'s Proof line), then port each verb\'s comparison here.',
    );
  }, TIMEOUT);
});
