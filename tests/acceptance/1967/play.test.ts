// AC1 #1967, played and seeked: "A terminal recording that prints `step 1` at 0.5 s and `step 2` at 1.5 s, played in a
// cell grid, shows only `step 1` at 1.0 s and both lines at 2.0 s, the same cells whether played or seeked". The
// recording (README: The recording) sits in the evidence store by its hash; a board's cell grid plays it from film time
// 0 (`play: {asset, start: "0s", in: 0, rate: [1, 1]}`); #488's `determinism` plays to each time (every 144 Hz frame
// from 0) and seeks to it (a fresh session jumping back from a second later), and each side answers the grid it shows
// (`cells`) beside its canonical render (`pixels`). The times are the criterion's two, plus the edges of the two
// prints and a time inside each span (README: Readings), so a grid that rounds the recording's times, or a seek that
// starts from the keyframe and skips the patches after it, is caught. Wrong programs: the base (no grid plays a
// recording), and three planted twins (README: Planted programs).
import { describe, expect, it } from 'vitest';
import {
  PEN_1, PEN_2, TIMEOUT, TIMES, at, fl, gridDiffs, labelOf, penProblems, playAndSeek, shownProblems, useShow, useTemp,
  type Compared, type Expected,
} from './helpers.ts';

const shows = useShow();
const temp = useTemp();

/** Each run once per file, by its planted name ('' for none): a failure is kept and thrown again to every test that
 * reads it, so a run is never repeated. */
const runs = new Map<string, Compared[] | Error>();
function run(planted = '', times?: number[]): Compared[] {
  if (!runs.has(planted)) {
    try { runs.set(planted, playAndSeek(shows(), temp(), planted || undefined, times)); } catch (e) { runs.set(planted, e as Error); }
  }
  const r = runs.get(planted)!;
  if (r instanceof Error) throw r;
  return r;
}
const expected = (t: number): Expected => TIMES.find((e) => e.t === t)!;
const ONE = fl(1);
const TWO = fl(2);

describe('AC1 a terminal recording played in a cell grid', () => {
  it('AC1 at 1.0 s the grid shows only `step 1`, played and seeked: its row in bold gold on navy, nothing under it, the cursor at the start of row 1; the render shows step 1 but not step 2; a planted grid that shows every patch whatever t fails', () => {
    const frames = run();
    const one = at(frames, ONE);
    for (const [side, s] of [['played', one.play], ['seeked', one.seek]] as const) {
      expect(shownProblems(s.grid, expected(ONE), side), `${side} to 1.0 s, the grid shows only step 1`).toEqual([]);
      expect(penProblems(s.grid, 0, 'step 1', PEN_1, 'underline', `${side} to 1.0 s`), 'step 1 keeps the pen it was printed with').toEqual([]);
    }
    expect(one.play.pixels, 'the render at 1.0 s draws step 1: it differs from the render at 0.25 s, before anything was printed').not.toBe(at(frames, fl(0.25)).play.pixels);
    expect(one.play.pixels, 'the render at 1.0 s doesn\'t draw step 2: it differs from the render at 2.0 s').not.toBe(at(frames, TWO).play.pixels);
    // Wrong program: a grid that applies every patch of the recording whatever t.
    const twin = at(run('cells_play_every_patch', [ONE]), ONE);
    const caught = shownProblems(twin.play.grid, expected(ONE), 'played');
    expect(caught.some((m) => m.includes('step 2')), `the planted cells_play_every_patch shows step 2 at 1.0 s and fails: ${JSON.stringify(caught)}`).toBe(true);
  }, TIMEOUT);

  it('AC1 at 2.0 s the grid shows both lines, played and seeked: `step 1` as before and `step 2` underlined in turquoise on the default background, the cursor at the start of row 2; a planted seek that skips the patches after its keyframe fails', () => {
    const two = at(run(), TWO);
    for (const [side, s] of [['played', two.play], ['seeked', two.seek]] as const) {
      expect(shownProblems(s.grid, expected(TWO), side), `${side} to 2.0 s, the grid shows both lines`).toEqual([]);
      expect(penProblems(s.grid, 0, 'step 1', PEN_1, 'underline', `${side} to 2.0 s`), 'step 1 keeps its pen').toEqual([]);
      expect(penProblems(s.grid, 1, 'step 2', PEN_2, 'bold', `${side} to 2.0 s`), 'step 2 keeps the pen it was printed with').toEqual([]);
    }
    // Wrong program: a seek that shows the keyframe at or before the source time (1 s, holding step 1) and none of the
    // patches after it.
    const twin = at(run('cells_seek_skips_patches'), TWO);
    const caught = shownProblems(twin.seek.grid, expected(TWO), 'seeked');
    expect(caught.some((m) => m.startsWith('seeked at 2.0 s: shows ')), `the planted cells_seek_skips_patches shows too little when seeked to 2.0 s and fails: ${JSON.stringify(caught)}`).toBe(true);
  }, TIMEOUT);

  it('AC1 the same cells whether played or seeked: at every time read, the seeked grid equals the played one cell for cell (grapheme, colors, attributes, link), row for row and in its cursor, and the two renders are the same picture; a planted seek that skips the patches after its keyframe fails, naming 2.0 s', () => {
    const frames = run();
    const failures = (fs: Compared[]): string[] => fs.flatMap((f) => [
      ...gridDiffs(f.seek.grid, f.play.grid).map((d) => `at ${labelOf(f.t)} seeked against played: ${d}`),
      ...(f.seek.pixels === f.play.pixels ? [] : [`at ${labelOf(f.t)} the seeked render ${f.seek.pixels} isn't the played ${f.play.pixels}`]),
    ]);
    expect(frames.map((f) => f.t), 'one comparison per time asked, in order').toEqual(TIMES.map((e) => e.t));
    expect(failures(frames), 'seeking to each time shows what playing to it shows').toEqual([]);
    // Not vacuous: the grid changes over the recording, so equal sides are equal grids that differ by time.
    expect(gridDiffs(at(frames, fl(0.25)).play.grid, at(frames, ONE).play.grid).length, 'the grid at 0.25 s differs from the grid at 1.0 s').toBeGreaterThan(0);
    expect(gridDiffs(at(frames, ONE).play.grid, at(frames, TWO).play.grid).length, 'the grid at 1.0 s differs from the grid at 2.0 s').toBeGreaterThan(0);
    // Wrong program: a seek that shows the keyframe at or before the source time and none of the patches after it,
    // while playing applies each patch as its time is reached.
    const caught = failures(run('cells_seek_skips_patches'));
    expect(caught.some((m) => m.startsWith('at 2.0 s seeked against played: ')), `the planted cells_seek_skips_patches fails, naming 2.0 s: ${JSON.stringify(caught.slice(0, 6))}`).toBe(true);
  }, TIMEOUT);

  it('AC1 the recording plays at its own times: before 0.5 s nothing, from 0.5 s exactly `step 1`, from 1.5 s exactly both lines, played and seeked, at 0.25 s, 0.5 s and one flick before it, 0.75 s, 1.5 s and one flick before it, and 1.75 s; a planted import that stamps each patch at the nearest whole second fails, naming 0.5 s and 1.5 s', () => {
    const frames = run();
    const problems = (fs: Compared[]): string[] => fs.flatMap((f) => [...shownProblems(f.play.grid, expected(f.t), 'played'), ...shownProblems(f.seek.grid, expected(f.t), 'seeked')]);
    expect(problems(frames), 'at each time the grid shows what the recording had printed by then').toEqual([]);
    // Wrong program: the import stamps each patch at its time rounded to the nearest whole second, halves up, so
    // step 1 lands at 1 s and step 2 at 2 s (it shows the right grid at 1.0 s and 2.0 s, and only the edges catch it).
    const caught = problems(run('cells_patch_times_whole_seconds'));
    for (const label of ['0.5 s', '1.5 s']) {
      expect(caught.some((m) => m.startsWith(`played at ${label}:`)), `the planted cells_patch_times_whole_seconds fails at ${label}: ${JSON.stringify(caught.slice(0, 6))}`).toBe(true);
    }
  }, TIMEOUT);
});
