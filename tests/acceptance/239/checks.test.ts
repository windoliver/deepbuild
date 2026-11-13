// AC2 #239.a88a17ac: "document.determinism, the frame budget (five runs on the reference Mac's environment
// fingerprint), film.audit and film.layout pass on both films, and each one's planted twin fails, naming its fault"
//
// This file: document.determinism, film.audit and film.layout. Through `deep-show run` with a claim of the agent's whose
// deliverable is the film and whose requirements are the core's check kinds at their defaults, and the `verdict` call
// (#403's rows; #1897's, #407's and #408's checks): on each film all three rows PASS, the determinism row saying it
// holds on `machines: same`. Each check then runs beside its planted twin, made here from the delivered film (README:
// Planted twins), and must fail naming its fault:
// - document.determinism: the film with a grid of #488's `test.tick@1` items (the `full,test-tick` build), whose state
//   steps and is checkpointed every 0.5 s, under the scenario's planted `checkpoint_nearest_in_distance` (a seek that
//   restores the checkpoint nearest in distance): at 0, 0.5 s − 1 flick and 0.5 s it FAILs with an issue at
//   352,799,999 flicks, where the 0.5 s checkpoint is nearer than the one at 0. The same document without the plant
//   PASSes at the same times, so the failure is the plant's.
// - film.audit: the film whose first text holds 15 letters a second for the film's span and 2 s more, more than any
//   of its holds can read (Film audit: hold): FAIL, `film.hold_short` naming that text, at a time inside the film.
// - film.layout: the film with `layout-twin`, a line of capitals eight document widths long across its centre:
//   FAIL, `layout.cut` naming it, at a time inside the film.
// Wrong programs: the base (no film: BLOCKED); a check that passes its twin, or fails it naming another fault.
import { describe, expect, it } from 'vitest';
import {
  AC, CUT_TEXT, FILMS, LABEL, REQ, TIMEOUT, VERDICT, agentScenario, cutText, errorsIn, failsNaming, faultLines, faultNaming, film, longCopy, names, none,
  presentedClean, rowOf, runShow, show, showFilm, stock, tOf, useBuilds, useTemp, withTicks, type Film, type JsonObject,
} from './helpers.ts';

const bin = useBuilds();
const temp = useTemp();

const DETERMINISM: JsonObject = { kind: 'document.determinism', compare: 'same_machine' };
/** 0, the flick before the 0.5 s checkpoint, and the checkpoint (#1897's named times). */
const TWIN_TIMES = [0, 352_799_999, 352_800_000];

/** One verdict on the film (or a twin of it): its rows by requirement. */
function judged(f: Film, document: JsonObject, requirements: [string, JsonObject][], what: string, o: { build?: 'deep-show full' | 'deep-show full,test-tick'; planted?: string } = {}): Map<string, JsonObject> {
  const evidence = temp();
  stock(evidence, f);
  const [shown, verdict] = runShow(bin(o.build ?? 'deep-show full'), agentScenario(evidence, [showFilm(document), VERDICT], { requirements, ...(o.planted ? { planted: o.planted } : {}) }), what);
  expect(shown!['outcome'], `${what}: deep_show presents it: ${show(shown!)}`).toBe('presented');
  if (!o.planted && document === f.document) presentedClean(shown!, `${what}: deep_show`);
  return new Map(requirements.map(([id]) => [id, rowOf(verdict!, id, `${what}: the verdict`)]));
}
const resultLine = (row: JsonObject): string => `${String(row['result'])}: ${show(row, 1500)}`;

describe(`${AC[2]} document.determinism, film.audit and film.layout pass on both films, and each one's planted twin fails, naming its fault`, () => {
  for (const name of FILMS) {
    it(`${AC[2]} ${LABEL[name]}: document.determinism (holding on machines: same), film.audit and film.layout each PASS`, () => {
      const f = film(name);
      const rows = judged(f, f.document, [[REQ.determinism, DETERMINISM], [REQ.audit, { kind: 'film.audit' }], [REQ.layout, { kind: 'film.layout' }]], f.label);
      for (const [id, kind] of [[REQ.determinism, 'document.determinism'], [REQ.audit, 'film.audit'], [REQ.layout, 'film.layout']] as const) {
        const row = rows.get(id)!;
        expect(row['result'], `${f.label}: ${kind} passes: ${resultLine(row)}`).toBe('PASS');
        none(faultLines(row), `${f.label}: ${kind} raises no error`);
      }
      expect(rows.get(REQ.determinism)!['machines'], `${f.label}: a comparison of GPU pixel hashes holds on one machine: ${show(rows.get(REQ.determinism)!)}`).toBe('same');
    }, TIMEOUT);

    it(`${AC[2]} ${LABEL[name]}: document.determinism's planted twin (the film with stepping ticks, under checkpoint_nearest_in_distance) FAILs at 352,799,999 flicks, while the same document unplanted PASSes`, () => {
      const f = film(name);
      const twin = withTicks(f);
      const check: JsonObject = { ...DETERMINISM, at_times: TWIN_TIMES };
      const control = judged(f, twin, [[REQ.determinism, check]], `${f.label} with ticks`, { build: 'deep-show full,test-tick' }).get(REQ.determinism)!;
      expect(control['result'], `${f.label} with ticks, unplanted: document.determinism passes at ${TWIN_TIMES.join(', ')} flicks: ${resultLine(control)}`).toBe('PASS');
      const planted = judged(f, twin, [[REQ.determinism, check]], `${f.label} with ticks`, { build: 'deep-show full,test-tick', planted: 'checkpoint_nearest_in_distance' }).get(REQ.determinism)!;
      expect(planted['result'], `the planted seek fails document.determinism: ${resultLine(planted)}`).toBe('FAIL');
      const at = errorsIn(planted).map((i) => tOf(i));
      failsNaming(faultLines(planted), /t=352799999\b/, `${f.label}: the planted seek (checkpoint_nearest_in_distance)`);
      expect(at.every((t) => t === 352_799_999), `${f.label}: every error names 352,799,999 flicks, the one time the plant moves: ${show(at)}`).toBe(true);
      expect(errorsIn(planted).every((i) => typeof i['code'] === 'string'), `${f.label}: each error carries its code: ${show(errorsIn(planted) as JsonObject[])}`).toBe(true);
    }, TIMEOUT);

    it(`${AC[2]} ${LABEL[name]}: film.audit's planted twin, its first text given more words than any of its holds can read, FAILs with film.hold_short naming that text`, () => {
      const f = film(name);
      const { document, item } = longCopy(f);
      const row = judged(f, document, [[REQ.audit, { kind: 'film.audit' }]], `${f.label}, its text ${item} too long to read`).get(REQ.audit)!;
      expect(row['result'], `the long text fails film.audit: ${resultLine(row)}`).toBe('FAIL');
      const named = errorsIn(row).filter((i) => i['code'] === 'film.hold_short' && names(i, item));
      failsNaming(faultLines(row), faultNaming('film.hold_short', item), `${f.label}: the audit twin`);
      const t = tOf(named[0]!);
      expect(t !== null && t >= 0 && t <= f.span, `${f.label}: film.hold_short says when, a time inside the film: ${show(named[0]!)}`).toBe(true);
    }, TIMEOUT);

    it(`${AC[2]} ${LABEL[name]}: film.layout's planted twin, a line the frame cuts at both sides, FAILs with layout.cut naming it`, () => {
      const f = film(name);
      const row = judged(f, cutText(f), [[REQ.layout, { kind: 'film.layout' }]], `${f.label} with ${CUT_TEXT}`).get(REQ.layout)!;
      expect(row['result'], `the cut line fails film.layout: ${resultLine(row)}`).toBe('FAIL');
      const named = errorsIn(row).filter((i) => i['code'] === 'layout.cut' && names(i, CUT_TEXT));
      failsNaming(faultLines(row), faultNaming('layout.cut', CUT_TEXT), `${f.label}: the layout twin`);
      const t = tOf(named[0]!);
      expect(t !== null && t >= 0 && t <= f.span, `${f.label}: layout.cut says when, a time inside the film: ${show(named[0]!)}`).toBe(true);
    }, TIMEOUT);
  }
});
