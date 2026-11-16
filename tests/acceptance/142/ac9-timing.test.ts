// AC9 #142.30bc3e5b: "An explain.dark_math example whose cues are a `cues@1` list, with cue 3's span lengthened by 1 s,
// starts every later `after` cue 1 s later with no edit to them and keeps an `at` cue where it was; a planted recipe that
// reads each cue's start as an absolute time leaves cue 4 where it was and fails, naming the cue"
//
// An explain.dark_math film on the 2D stage (README: Fixtures), 120 BPM, its cues in order: cue_one enters ONE over
// 0.5 s; cue_two enters TWO (after); cue_three waits 0.5 s; cue_four enters FOUR, cue_five FIVE (after); cue_six enters
// SIX `at` 5 s. So cue_four starts at 1.5 s and cue_five at 2 s. Its twin differs only in cue_three's span, 1.5 s: there
// cue_four starts at 2.5 s, cue_five at 3 s, cue_six still at 5 s, and cue_one to cue_three where they were.
// The judge, on both films in one process: each cue's marker `cues.<id>` (README: The expansion) moves by exactly 1 s
// for cue_four and cue_five and by nothing for the others; and each later cue's word is drawn from its start (`eval`
// with `texts`: not shown one frame before its marker's start, shown one frame after it), so what plays follows the
// cue list, not only its markers.
// The planted recipe (scenario `planted: "film_cue_starts_absolute"`, README: The planted programs) reads each cue's
// start as an absolute time; it leaves cue_four where it was, and the same judge fails, naming cue_four.
// Wrong programs: the base; the planted recipe; markers that move while the words stay; an `at` cue that moves.
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, INSTANCE, TIMEOUT, brief, docId, enter, errors, evalAt, expansionOf, explainFilm, none, present, run, scenario, showTime, textsOf,
  useFolders, useShow, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const FRAME = FLICKS / 60;
const PLANT = 'film_cue_starts_absolute';
const cues = (wait: number): JsonObject[] => [
  enter('cue_one', 'ONE'), enter('cue_two', 'TWO'), { id: 'cue_three', span: `${wait}s` },
  enter('cue_four', 'FOUR'), enter('cue_five', 'FIVE'), enter('cue_six', 'SIX', 0.5, { when: { at: '5s' } }),
];
const ORIGINAL = explainFilm('A dark-math list', 'dark_math', { cues: cues(0.5), stage: '2d' }, 7);
const LONGER = explainFilm('A dark-math list, cue 3 a second longer', 'dark_math', { cues: cues(1.5), stage: '2d' }, 7);
const WORDS: Record<string, string> = { cue_four: 'FOUR', cue_five: 'FIVE', cue_six: 'SIX' };
/** Where each later cue starts, in each film, by the cue list's rules: `after` follows the cue before, `at` is fixed. */
const STARTS: Record<string, [number, number]> = { cue_four: [1.5 * FLICKS, 2.5 * FLICKS], cue_five: [2 * FLICKS, 3 * FLICKS], cue_six: [5 * FLICKS, 5 * FLICKS] };

/** The judge: every failure names its cue. */
function timingFailures(planted?: string): string[] {
  const calls: JsonObject[] = [present(docId(1), ORIGINAL), present(docId(2), LONGER)];
  for (const starts of Object.values(STARTS)) for (const d of [0, 1]) calls.push(evalAt(docId(d + 1), starts[d]! - FRAME, { texts: true }), evalAt(docId(d + 1), starts[d]! + FRAME, { texts: true }));
  const replies = run(show(), scenario(folder(), calls, planted ? { planted } : {}));
  const failures: string[] = [];
  const shown = [replies[0]!, replies[1]!];
  if (shown.some((r) => r['outcome'] !== 'presented' || errors(r).length)) return [`the films are not both presented with no error: ${brief(shown.map((r) => ({ outcome: r['outcome'] ?? null, issues: errors(r) })), 2000)}`];
  const [a, b] = shown.map((r, i) => expansionOf(r, INSTANCE, i ? 'the longer film' : 'the original film').markers);
  for (const cue of ['cue_one', 'cue_two', 'cue_three', 'cue_four', 'cue_five', 'cue_six']) {
    const [ma, mb] = [a![`cues.${cue}`], b![`cues.${cue}`]];
    if (!ma || !mb) { failures.push(`${cue}: no marker cues.${cue} in ${ma ? 'the longer' : 'the original'} film`); continue; }
    const want = cue === 'cue_four' || cue === 'cue_five' ? FLICKS : 0;
    if (mb.t - ma.t !== want) failures.push(`${cue}: its marker starts at ${showTime(ma.t)}, then ${showTime(mb.t)} with cue_three 1 s longer: moved ${showTime(mb.t - ma.t)}, not ${want ? '1 s' : 'at all'}`);
  }
  let k = 2;
  for (const [cue, starts] of Object.entries(STARTS)) {
    for (const d of [0, 1]) {
      const film = d ? 'the longer film' : 'the original film';
      const drawn = (reply: JsonObject): boolean => Object.values(textsOf(reply, `${film} near ${cue}'s start`)).some((t) => t === WORDS[cue]);
      if (drawn(replies[k]!)) failures.push(`${cue}: in ${film} its word ${WORDS[cue]} already shows at ${showTime(starts[d]! - FRAME)}, before its start ${showTime(starts[d]!)}`);
      if (!drawn(replies[k + 1]!)) failures.push(`${cue}: in ${film} its word ${WORDS[cue]} doesn't show at ${showTime(starts[d]! + FRAME)}, after its start ${showTime(starts[d]!)}`);
      k += 2;
    }
  }
  return failures;
}

describe(`${AC[9]} a longer cue moves the later \`after\` cues and keeps an \`at\` cue, and a recipe reading absolute starts fails`, () => {
  it(`${AC[9]} cue 3 a second longer starts cue 4 and cue 5 a second later with no edit to them, and cue 6 (at 5 s) where it was`, () => {
    const [x, y] = [ORIGINAL, LONGER].map((d) => JSON.stringify((d['items'] as JsonObject)[INSTANCE]).replace('"span":"1.5s"', '"span":"0.5s"'));
    expect(y, 'the two films differ only in cue_three\'s span').toBe(x);
    none(timingFailures(), 'the later cues follow cue_three, and the `at` cue stays');
  }, TIMEOUT);

  it(`${AC[9]} (planted) a recipe reading each cue's start as an absolute time leaves cue 4 where it was and fails, naming cue_four`, () => {
    const failures = timingFailures(PLANT);
    expect(failures.length, `the judge fails the planted ${PLANT}`).toBeGreaterThan(0);
    expect(failures.some((f) => f.startsWith('cue_four:')), `a failure names cue_four: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});
