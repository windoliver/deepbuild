// AC1 #1163.d0a72903: "deep_query reads shot 2's start at exactly 4,233,600,000 flicks and the title placement's at
// 2,822,400,000, and the dot's y at (4 + 2k) × 352,800,000 flicks equals the bounce clip's at 0 bit for bit for k from
// 0 to 7; a cue written as a literal 12.5 s raises literal_time_with_tempo_map, and the bar:beat form it offers lands
// on the same flick; two shots that overlap outside a transition are refused naming both, and the last good revision
// stays current"
//
// The film (README: Fixtures) sent by `deep show` from the test process in the agent's tree, read back with deep_query
// bound to the agent's session (#411): `shots/shot-pan/start`, `placements/title-in/start`, `markers/hit/t` and
// `items/dot/at/pos/1` (README: The surface under test). The bounce clip's value at its local time 0 is its first key's,
// 556, which the dot's base y (856) is not, so a placement that never applies, starts off its bar or repeats too few
// times reads something else at one of the eight wraps. The notice is read from the `deep show` reply's issues; its
// offered bar:beat form is sent back in a fresh run of the hub. The overlap: the pull back moved to bar 7, two bars
// into the pan, with only the cut between them, in a revision that otherwise holds every ID the good one does. No planted program: the issue names none for this criterion; the base
// and those twins are the wrong programs.
import { describe, expect, it } from 'vitest';
import {
  AC, BEAT, DOT, FILM, REVISIONS, TIMEOUT, arr, bedWav, currentOf, film, fl, isObject, mentions, n, none, obj, present, presented,
  putEvidence, query, runShow, scenario, show, stringsIn, useRoot, useShow, type JsonObject, type JsonValue,
} from './helpers.ts';

const shows = useShow();
const temp = useRoot();

const SHOT2 = 'shots/shot-pan/start';
const TITLE = 'placements/title-in/start';
const DOT_Y = 'items/dot/at/pos/1';
const HIT = 'markers/hit/t';
/** (4 + 2k) × 352,800,000 flicks for k = 0 … 7: 2 s to 9 s, each a wrap of the bounce's repeat. */
const WRAPS = Array.from({ length: 8 }, (_, k) => (4 + 2 * k) * BEAT);
const atText = (t: number): string => `${t / fl(1)}s`;

/** deep_query's `values[path]`, one entry per time asked. */
function valuesOf(reply: JsonObject | undefined, p: string, count: number, what: string): JsonValue[] {
  const values = obj(obj(reply, what)['values'], `${what}: values (the reply: ${show(reply)})`);
  const list = arr(values[p], `${what}: values[${p}]`);
  expect(list.length, `${what}: one value of ${p} per time asked`).toBe(count);
  return list;
}

describe(`${AC[1]} the film reads back on the tempo map, a literal cue raises its notice, and an overlapping shot is refused`, () => {
  it(`${AC[1]} deep_query reads shot 2's start at 4,233,600,000 and the title placement's at 2,822,400,000, the dot's y at each of the bounce's eight wraps equals the clip's value at 0, the literal 12.5 s cue raises literal_time_with_tempo_map whose bar:beat form lands on 8,820,000,000, and the pull back moved into the pan is refused naming both shots with the last good revision still current`, () => {
    const evidence = temp();
    const bed = putEvidence(evidence, bedWav());
    const failures: string[] = [];

    const [shown, read, cued, cueRead] = runShow(shows.bin(), scenario(evidence, [
      present(film(bed)),
      query({ paths: [SHOT2, TITLE, DOT_Y], at: WRAPS.map(atText) }),
      present(film(bed, { cue: '12.5s' })),
      query({ paths: [HIT], at: ['0s'] }),
    ]), 'the film, read back, then the literal cue');

    presented(shown, 'the film');
    const shot2 = valuesOf(read, SHOT2, 8, 'deep_query');
    const title = valuesOf(read, TITLE, 8, 'deep_query');
    const dot = valuesOf(read, DOT_Y, 8, 'deep_query');
    if (!shot2.every((v) => v === FILM.shot2)) failures.push(`${SHOT2} reads ${show(shot2)}, not ${n(FILM.shot2)} flicks (bar 4)`);
    if (!title.every((v) => v === FILM.title)) failures.push(`${TITLE} reads ${show(title)}, not ${n(FILM.title)} flicks (bar 3, beat 1)`);
    WRAPS.forEach((t, k) => {
      if (!Object.is(dot[k], DOT.top)) failures.push(`k = ${k}: the dot's y at ${n(t)} flicks reads ${show(dot[k])}, not the bounce clip's value at 0, ${DOT.top}, bit for bit`);
    });

    if (cued!['outcome'] !== 'presented') failures.push(`the film with the literal cue is not presented (a notice is no refusal): ${show(cued)}`);
    const hitLiteral = valuesOf(cueRead, HIT, 1, 'deep_query of the literal cue')[0];
    if (hitLiteral !== fl(12.5)) failures.push(`the cue written as 12.5s reads ${show(hitLiteral)}, not ${n(fl(12.5))}`);
    const issues = Array.isArray(cued!['issues']) ? cued!['issues'] : [];
    const notice = issues.find((i) => isObject(i) && i['code'] === 'literal_time_with_tempo_map' && mentions(i, 'hit'));
    const offered = stringsIn(notice).find((s) => /^\d+:\d+b$/.test(s));
    if (!notice) failures.push(`no literal_time_with_tempo_map notice names the cue hit; the reply's issues: ${show(issues)}`);
    else if (!offered) failures.push(`the notice offers no bar:beat form: ${show(notice)}`);

    // The overlapping revision keeps every ID the good one holds (the cue too), so only the shots' overlap can refuse
    // it, not a removal it doesn't name (Revision: an ID a whole revision leaves out must be in its `removes`).
    const kept = offered ? { cue: offered } : {};
    const overlap = film(bed, { ...kept, pullStart: '7:1b' });
    const [good, goodRead, before, refused, after] = runShow(shows.bin(), scenario(evidence, [
      present(film(bed, kept)),
      query({ paths: [HIT], at: ['0s'] }),
      REVISIONS,
      present(overlap),
      REVISIONS,
    ]), `the cue at the offered ${offered ?? '(none)'}, then the pull back moved into the pan`);
    if (good!['outcome'] !== 'presented') failures.push(`the film with the offered cue is not presented: ${show(good)}`);
    if (offered) {
      const hitOffered = valuesOf(goodRead, HIT, 1, 'deep_query of the offered cue')[0];
      if (hitOffered !== fl(12.5)) failures.push(`the cue written as the offered ${offered} reads ${show(hitOffered)}, not the literal's ${n(fl(12.5))}`);
    }
    if (refused!['outcome'] === 'presented') failures.push('the pull back overlapping the pan outside any transition is presented, not refused');
    if (!(mentions(refused, 'shot-pan') && mentions(refused, 'shot-pull'))) failures.push(`the refusal doesn't name both shot-pan and shot-pull: ${show(refused)}`);
    const was = currentOf(before, 'revisions before the overlap');
    const now = currentOf(after, 'revisions after the overlap');
    if (now.hash !== was.hash || now.rev !== was.rev) failures.push(`the current revision moved from ${was.rev} (${was.hash}) to ${now.rev} (${now.hash}) after the refusal`);

    none(failures, 'the film read back on its tempo map');
  }, TIMEOUT);
});
