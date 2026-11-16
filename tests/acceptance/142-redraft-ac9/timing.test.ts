// AC9 #142.30bc3e5b: "An explain.dark_math example whose cues are a `cues@1` list, with cue 3's span lengthened by 1 s,
// starts every later `after` cue 1 s later with no edit to them and keeps an `at` cue where it was; a planted recipe that
// reads each cue's start as an absolute time leaves cue 4 where it was and fails, naming the cue"
//
// Fixture (helpers.ts, README: The fixture): an explain.dark_math film on the 2D stage, 120 BPM, its cues in order:
// cue_one enters MAKE over 0.5 s; cue_two enters LOUD (after); cue_three waits 0.5 s; cue_four enters NORTH and cue_five
// BRIGHT (each after); cue_six enters CALM `at` 5 s. Its twin, the same document but for cue_three's span, 1.5 s.
// Every word shows no number (the base's Honest numbers check refuses a shown number word), and every landing is on a
// beat in both films and under the plant.
//
// The judge, the same for the shipped program and the plant, every failure naming its cue:
//   1. Both films are presented with no error, and each cue's marker `cues.<id>` (the expansion rows' `markers`)
//      starts exactly 1 s later in the longer film for cue_four and cue_five and at the same flick for cue_one,
//      cue_two, cue_three and cue_six.
//   2. Each later cue's word plays where its marker says, in each film: `eval` with `texts` doesn't show it a frame
//      before the marker's start and shows it at the cue's landing (the marker's start plus its span).
// The planted recipe (scenario `planted: "film_cue_starts_absolute"`: each cue starts k seconds in for the k-th cue,
// whatever spans and gaps come before it) leaves cue_four where it was, and the same judge must fail naming cue_four.
// Wrong programs: the base (no explain pack, no plant); the planted recipe; markers that move while the words stay; an
// `at` cue that moves with the list.
import { describe, expect, it } from 'vitest';
import {
  AC9, FLICKS, FRAME, INSTANCE, TIMEOUT, brief, darkMath, docId, enter, errors, markersOf, none, present, run, scenario, showTime, shows, textsAt,
  useFolders, useShow, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const PLANT = 'film_cue_starts_absolute';
/** The list with cue_three waiting `wait`: cue 3 of the criterion is cue_three, cue 4 is cue_four. */
const list = (wait: string): JsonObject[] => [
  enter('cue_one', 'MAKE'),
  enter('cue_two', 'LOUD', { when: 'after' }),
  { id: 'cue_three', span: wait },
  enter('cue_four', 'NORTH', { when: 'after' }),
  enter('cue_five', 'BRIGHT', { when: 'after' }),
  enter('cue_six', 'CALM', { when: { at: '5s' } }),
];
const ORIGINAL = darkMath('A dark-math list', list('0.5s'));
const LONGER = darkMath('A dark-math list', list('1.5s'));
const FILMS = [ORIGINAL, LONGER];
const NAMES = ['the original film', 'the longer film'] as const;
const CUES = ['cue_one', 'cue_two', 'cue_three', 'cue_four', 'cue_five', 'cue_six'] as const;
/** The later `after` cues, which move by 1 s; every other cue stays where it was. */
const MOVED: readonly string[] = ['cue_four', 'cue_five'];
/** Each later cue's word. */
const WORDS: Record<string, string> = { cue_four: 'NORTH', cue_five: 'BRIGHT', cue_six: 'CALM' };

/** The judge: what fails, each failure starting with the cue it names. */
function timingFailures(planted?: string): string[] {
  const shown = run(show(), scenario(folder(), FILMS.map((d, i) => present(docId(i + 1), d)), planted));
  if (shown.some((r) => r['outcome'] !== 'presented' || errors(r).length)) {
    return [`the films are not both presented with no error: ${brief(shown.map((r) => ({ outcome: r['outcome'] ?? null, errors: errors(r) })), 2500)}`];
  }
  const markers = shown.map((r, i) => markersOf(r, INSTANCE, NAMES[i]!));
  const failures: string[] = [];
  for (const cue of CUES) {
    const [a, b] = markers.map((m) => m[`cues.${cue}`]);
    if (!a || !b) { failures.push(`${cue}: ${NAMES[a ? 1 : 0]} writes no marker cues.${cue}`); continue; }
    const want = MOVED.includes(cue) ? FLICKS : 0;
    if (b.t - a.t !== want) failures.push(`${cue}: its marker starts at ${showTime(a.t)}, then at ${showTime(b.t)} with cue_three 1 s longer: moved ${showTime(b.t - a.t)}, not ${want ? '1 s' : 'at all'}`);
  }
  const probes: { cue: string; word: string; film: number; before: number; landing: number }[] = [];
  for (const [cue, word] of Object.entries(WORDS)) {
    markers.forEach((m, film) => { const k = m[`cues.${cue}`]; if (k) probes.push({ cue, word, film, before: k.t - FRAME, landing: k.t + k.span }); });
  }
  const calls = [...FILMS.map((d, i) => present(docId(i + 1), d)), ...probes.flatMap((p) => [textsAt(docId(p.film + 1), p.before), textsAt(docId(p.film + 1), p.landing)])];
  const replies = run(show(), scenario(folder(), calls, planted));
  probes.forEach((p, k) => {
    const film = NAMES[p.film]!;
    if (shows(replies[FILMS.length + 2 * k]!, p.word, `${film} a frame before ${p.cue}'s start`)) {
      failures.push(`${p.cue}: in ${film} its word ${p.word} already shows at ${showTime(p.before)}, a frame before its marker's start`);
    }
    if (!shows(replies[FILMS.length + 2 * k + 1]!, p.word, `${film} at ${p.cue}'s landing`)) {
      failures.push(`${p.cue}: in ${film} its word ${p.word} doesn't show at its landing, ${showTime(p.landing)}`);
    }
  });
  return failures;
}

describe(`${AC9} a longer cue moves the later \`after\` cues and keeps an \`at\` cue, and a recipe reading absolute starts fails`, () => {
  it(`${AC9} cue 3 a second longer starts cue 4 and cue 5 a second later with no edit to them, and keeps cue 6 (at 5 s) where it was`, () => {
    const back = JSON.parse(JSON.stringify(LONGER)) as { items: { film: { params: { cues: JsonObject[] } } } };
    back.items.film.params.cues[2]!['span'] = '0.5s';
    expect(back, 'the two films differ only in cue_three\'s span').toEqual(ORIGINAL);
    none(timingFailures(), 'the later `after` cues follow cue_three, and the `at` cue stays');
  }, TIMEOUT);

  it(`${AC9} (planted) a recipe reading each cue's start as an absolute time leaves cue 4 where it was and fails the judge, naming cue_four`, () => {
    const failures = timingFailures(PLANT);
    expect(failures.some((f) => f.startsWith('cue_four:')), `the judge fails the planted ${PLANT}, naming cue_four: ${failures.join(' | ') || 'no failure'}`).toBe(true);
  }, TIMEOUT);
});
