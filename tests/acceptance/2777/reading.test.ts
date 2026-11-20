// AC7 #2777.71fec45e: "A planted change that adds a closed list with `instead: nothing` shows in the lane's reading as
// one more, naming the list, and the lane still passes"
//
// asserts: the planted change is the test canvas module test.tone (feature `test-tone-closed`), whose kind test.tint@1
// adds the field list test.tint@1.tone, closed with instead "nothing"; the full build's listing doesn't hold it, the
// planted build's does. `node scripts/canvas-closures.mjs fields --listing <listing> --base <the full build's listing>`
// passes on both (exit 0, a PASS fields line, no FAIL); the planted build's one NOTE fields reading counts one more
// closed list saying instead: nothing than the full build's, names test.tint@1.tone among them, and names it alone as
// added by this change, where the full build's reading names none added and doesn't name the list.

import { describe, expect, it } from 'vitest';
import {
  FULL, LANE, TONE_CLOSED, TONE_LIST, closedOf, closures, dumpOf, fieldListsOf, passes, readingOf, show, theList, useBuilds, type Reading,
} from './helpers.ts';

const builds = useBuilds([FULL, TONE_CLOSED]);

/** The lane's reading of a run, failing, saying why, when it prints none. */
function reading(r: ReturnType<typeof closures>, what: string): Reading {
  const x = readingOf(r);
  expect(typeof x === 'string' ? x : '', `${what}: the lane prints one reading`).toBe('');
  return x as Reading;
}

describe('AC7 #2777.71fec45e the lane\'s reading of a change that adds a list saying instead: nothing', () => {
  it('AC7 #2777.71fec45e a planted change that adds a closed list with instead: nothing shows in the lane\'s reading as one more, naming the list, and the lane still passes', () => {
    const main = dumpOf(builds.bin(FULL));
    const change = dumpOf(builds.bin(TONE_CLOSED));
    // The plant is what it claims: the change's listing adds the list, closed with instead nothing.
    expect(fieldListsOf(main.value).some((l) => l.list === TONE_LIST), `the full build's listing holds no ${TONE_LIST}`).toBe(false);
    const added = theList(fieldListsOf(change.value), TONE_LIST);
    expect(closedOf(added.closure)?.instead, `the planted change closes ${TONE_LIST} with instead nothing: ${show(added.closure ?? null)}`).toBe('nothing');

    const before = closures([LANE, '--listing', main.path, '--base', main.path]);
    const after = closures([LANE, '--listing', change.path, '--base', main.path]);
    console.log(`the reading without the planted list:\n${before.out}\nthe reading with it:\n${after.out}`);
    passes(before, LANE, 'the lane on the full build\'s listing');
    passes(after, LANE, `the lane on the listing with ${TONE_LIST}`);
    const [b, a] = [reading(before, 'without the planted list'), reading(after, `with ${TONE_LIST}`)];
    expect(a.count, `one more closed list says instead: nothing: ${b.line} → ${a.line}`).toBe(b.count + 1);
    expect(a.nothing, `the reading names ${TONE_LIST}: ${a.line}`).toContain(TONE_LIST);
    expect(b.nothing, `the reading without the plant doesn't name ${TONE_LIST}: ${b.line}`).not.toContain(TONE_LIST);
    expect(a.added, `the reading names ${TONE_LIST} alone as added by this change: ${a.line}`).toEqual([TONE_LIST]);
    expect(b.added, `the full build against itself adds nothing: ${b.line}`).toEqual([]);
  }, 3_600_000);
});
