// AC6 #2031.0ee07497: "A document with 17 lights on one group is refused at check and the refusal reads `lights: 17, cap:
// 16`. A lit group inside a lit group and a light with a status role are each refused, naming the group and the light. A
// planted check that accepts the 17th light fails"
//
// Through `deep-canvas-render check` (every platform), with the look `clean`. Each document is a 320 × 180 white rect in
// the group `lamps`, which also holds `tray`, a plain group with a rect of its own:
//   - `sixteen`: 16 lights on `lamps`, the cap: accepted, with no error at all (so a check that refuses every lit
//     group, or every nested group, fails here);
//   - `seventeen`: 17 lights on `lamps`: refused by an error that names `lamps` (its `ids` hold it, or its `path` is
//     under `items/lamps`) and reads the count and the cap: `lights: 17, cap: 16` in its text, or `lights` 17 and
//     `cap` 16 as fields of one object in the issue (README: Readings);
//   - `nested`: `tray` lit too, a lit group inside a lit group: refused by an error that names `tray`;
//   - `status`: light 1 of `lamps` in the status role `status.pass`: refused by an error that names the light by its
//     path, `items/lamps/params/light/lights/1` (the path grammar's list index; a deeper path such as `.../color` too).
// The planted check is `"planted": "light_accepts_seventeenth"` in the `check` line: the check must take the name (not
// `bad_input`) and the 17-light judgement must fail on its answer.
// Wrong programs: the base (no light read, nothing refused), a cap of 17 or more, a count that names no group, a check
// that refuses only the outer of two lit groups, a light's status role let through.
import { describe, expect, it } from 'vitest';
import {
  AC, doc, errorsOf, group, issuesOf, light, LOOK, rect, render, shown, useBin, type Issue, type JsonObject, type JsonValue, type Light,
} from './helpers.ts';

const ID = AC[6];
const bin = useBin('deep-canvas-render');
const lamp = (k: number): Light => ({ at: [10 + 18 * k, 90], energy: 0.5, range: 60 });
function lit(id: string, lights: JsonObject[], tray?: JsonObject): JsonObject {
  return doc(id, [320, 180], [
    group('lamps', 'a0', { ambient: 0.25, lights }),
    rect('sheet', 'a1', [0, 0, 320, 180], 'lamps'),
    group('tray', 'a2', tray, { parent: 'lamps' }),
    rect('chip', 'a3', [20, 20, 40, 40], 'tray', 'accent'),
  ]);
}
const lights = (n: number): JsonObject[] => Array.from({ length: n }, (_, k) => light(lamp(k)));
const DOCS = {
  sixteen: lit('lights-sixteen', lights(16)),
  seventeen: lit('lights-seventeen', lights(17)),
  nested: lit('lights-nested', lights(1), { ambient: 0.5, lights: [light(lamp(3))] }),
  status: lit('lights-status', [light(lamp(0)), light(lamp(1), 'status.pass')]),
};
const LIGHT_PATH = 'items/lamps/params/light/lights/1';

function check(d: JsonObject, planted?: string): { answer: JsonObject; errors: Issue[] } {
  const [answer] = render(bin(), 'check', [{ doc: d, look: LOOK, ...(planted ? { planted } : {}) }]);
  expect(answer!['code'], `check takes the line${planted ? ` with planted ${planted}` : ''}: ${shown(answer)}`).not.toBe('bad_input');
  return { answer: answer!, errors: errorsOf(issuesOf(answer!, `check of ${String(d['id'])}`)) };
}
const names = (e: Issue, id: string): boolean => e.ids.includes(id) || e.path === `items/${id}` || e.path.startsWith(`items/${id}/`);
/** `lights: 17, cap: 16` in the issue's text, or one object in it holding `lights` 17 and `cap` 16. */
function readsCount(v: JsonValue): boolean {
  if (typeof v === 'string') return v.includes('lights: 17, cap: 16');
  if (Array.isArray(v)) return v.some(readsCount);
  if (v !== null && typeof v === 'object') return (v['lights'] === 17 && v['cap'] === 16) || Object.values(v).some(readsCount);
  return false;
}
const shownErrors = (errors: Issue[]): string => errors.map((e) => shown(e.raw)).join('; ') || 'none';
/** The 17-light judgement: refused, by an error naming `lamps` that reads the count and the cap. */
function seventeenFailures(answer: JsonObject, errors: Issue[]): string[] {
  const failures: string[] = [];
  if (answer['ok'] !== false) failures.push(`seventeen lights on lamps: the check answers ok ${shown(answer['ok'])}, not a refusal`);
  if (!errors.some((e) => names(e, 'lamps') && readsCount(e.raw))) failures.push(`seventeen lights on lamps: no error names lamps and reads lights: 17, cap: 16; errors: ${shownErrors(errors)}`);
  return failures;
}

describe(`${ID} the check refuses a 17th light, a lit group in a lit group and a light in a status role`, () => {
  it(`${ID} 16 lights pass; 17 are refused reading lights: 17, cap: 16; the inner lit group and the status-role light are each named`, () => {
    const sixteen = check(DOCS.sixteen);
    expect(sixteen.errors, `16 lights on lamps, with a plain group inside it, are within the cap: ${shownErrors(sixteen.errors)}`).toEqual([]);
    const seventeen = check(DOCS.seventeen);
    const nested = check(DOCS.nested);
    const status = check(DOCS.status);
    const failures = [
      ...seventeenFailures(seventeen.answer, seventeen.errors),
      ...(nested.errors.some((e) => names(e, 'tray')) ? [] : [`a lit group inside a lit group: no error names the inner group tray; errors: ${shownErrors(nested.errors)}`]),
      ...(status.errors.some((e) => e.path === LIGHT_PATH || e.path.startsWith(`${LIGHT_PATH}/`) || e.ids.includes(LIGHT_PATH)) ? [] : [`a light in a status role: no error names the light ${LIGHT_PATH}; errors: ${shownErrors(status.errors)}`]),
    ];
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it(`${ID} a planted check that accepts the 17th light fails`, () => {
    const planted = check(DOCS.seventeen, 'light_accepts_seventeenth');
    const failures = seventeenFailures(planted.answer, planted.errors);
    console.log(`${ID}: under light_accepts_seventeenth: ${failures.join('; ') || 'no failure'}`);
    expect(failures.length, 'the planted check that accepts the 17th light fails the 17-light judgement').toBeGreaterThan(0);
  });
});
