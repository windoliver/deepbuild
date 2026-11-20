// AC6 #2777.af753bc6: "`deep_kinds` on a closed list returns its reason, `reopens_if` and `instead`"
//
// asserts: on `deep-show run`, deep_kinds `{op: "closure", list: "camera@1.projection"}` answers the list (`list`) and
// its closure `{closed: <reason>, reopens_if, instead}`, each equal to what the full build's sealed listing (`deep-show
// kinds --dump`, `field_lists`) gives it; and so does the same call for every closed list of that listing (helpers.ts,
// closureAnswerFailures; each failure names the list).

import { describe, expect, it } from 'vitest';
import { FULL, PROJECTION, closedOf, closureAnswerFailures, closureCall, dumpOf, fieldListsOf, none, run, show, useBuilds } from './helpers.ts';

const builds = useBuilds([FULL]);

describe('AC6 #2777.af753bc6 deep_kinds answers a closed list\'s closure', () => {
  it('AC6 #2777.af753bc6 deep_kinds on a closed list returns its reason, reopens_if and instead', () => {
    const bin = builds.bin(FULL);
    const [first] = run(bin, [closureCall(PROJECTION)]);
    console.log(`deep_kinds on ${PROJECTION}: ${show(first)}`);
    const closed = fieldListsOf(dumpOf(bin).value).filter((l) => closedOf(l.closure) !== undefined);
    const projection = closed.filter((l) => l.list === PROJECTION);
    expect(projection.length, `the sealed listing closes ${PROJECTION}`).toBe(1);
    none(closureAnswerFailures(projection, [first!]), `deep_kinds on ${PROJECTION}`);
    none(closureAnswerFailures(closed, run(bin, closed.map((l) => closureCall(l.list)))), `deep_kinds on each of the listing's ${closed.length} closed lists`);
  }, 3_600_000);
});
