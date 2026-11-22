// AC5 #2777.5fe304dc: "A document that sets a camera's projection to a word its list lacks is refused, and the refusal
// names the list, what would reopen it and `instead`. A planted refusal with only the bad value fails, naming the code"
//
// asserts: the agent's deep_show (on `deep-show run`, as the hub's deep_show tool has the canvas core play it) of a
// scene whose camera `cam` sets projection to fisheye is refused, and an error at items/cam/params/projection carries
// `list` camera@1.projection and the `reopens_if` and `instead` the full build's sealed listing gives that list; the
// same scene with projection perspective passes the document check (helpers.ts, listRefusalFailures). Under
// `--planted refusal_bad_value_only` (the refusal carries only the bad value, fisheye, without the list, reopens_if or
// instead) the same document is still refused at that path, and the check fails, naming the issue's code.

import { describe, expect, it } from 'vitest';
import {
  BAD_PROJECTION, FULL, ISSUE_PATH, PLANT_BAD_VALUE_ONLY, PROJECTION, cameraScene, closedOf, docId, dumpOf, failsNaming, fieldListsOf, issuesOf,
  listRefusalFailures, none, presentedFailures, run, show, showCall, showWorld, theList, useBuilds,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const [REFUSED, CLEAN] = [docId(1), docId(2)];
const CALLS = [showCall(REFUSED, cameraScene(BAD_PROJECTION)), showCall(CLEAN, cameraScene('perspective'))];
const WORLD = showWorld([REFUSED, CLEAN]);

/** What the refusal must name: the list, and its reopens_if and instead as the sealed listing gives them. */
function wanted(bin: string): { list: string; reopens_if: string; instead: string } {
  const c = closedOf(theList(fieldListsOf(dumpOf(bin).value), PROJECTION).closure);
  expect(c, `the sealed listing closes ${PROJECTION} with a reason, reopens_if and instead`).toBeDefined();
  return { list: PROJECTION, reopens_if: c!.reopens_if, instead: c!.instead };
}

describe('AC5 #2777.5fe304dc a value outside a closed list is refused, naming the list', () => {
  it('AC5 #2777.5fe304dc a document that sets a camera\'s projection to a word its list lacks is refused, and the refusal names the list, what would reopen it and instead', () => {
    const bin = builds.bin(FULL);
    const [refused, clean] = run(bin, CALLS, { world: WORLD });
    console.log(`the refusal of projection ${BAD_PROJECTION}: ${show(issuesOf(refused!).map((i) => i.raw), 3000)}`);
    none(presentedFailures(clean!, 'the same scene with projection perspective'), 'the control passes the document check');
    none(listRefusalFailures(refused!, wanted(bin)), `camera@1 with projection ${BAD_PROJECTION}, at ${ISSUE_PATH}`);
  }, 3_600_000);

  it('AC5 #2777.5fe304dc a planted refusal with only the bad value fails, naming the code', () => {
    const bin = builds.bin(FULL);
    const [refused] = run(bin, CALLS, { planted: PLANT_BAD_VALUE_ONLY, world: WORLD });
    const want = wanted(bin);
    const at = issuesOf(refused!).filter((i) => i.path === ISSUE_PATH && i.severity === 'error');
    expect(at.length, `the planted run still refuses projection ${BAD_PROJECTION} at ${ISSUE_PATH}: ${show(refused, 1500)}`).toBeGreaterThan(0);
    expect(at.some((i) => i.raw['actual'] === BAD_PROJECTION), `the planted refusal carries the bad value: ${show(at.map((i) => i.raw))}`).toBe(true);
    failsNaming(listRefusalFailures(refused!, want), [at[0]!.code], 'the refusal that carries only the bad value');
  }, 3_600_000);
});
