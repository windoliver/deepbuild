import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FIXTURES, ID, SECOND, cleanup, groupsOf, help, shown, startHereFailures } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const SIXTH = 'deep update --check';
const PLANTED = join(FIXTURES, 'sixth-line.mjs');

describe(`${ID.startHere} the first group of deep --help`, () => {
  it(`${ID.startHere} lists five lines: status, inbox, doctor, off | on and setup --undo`, async () => {
    const r = await help();
    expect(r.code, `deep --help exits 0: ${shown(r)}`).toBe(0);
    expect(startHereFailures(r.stdout), `the first group of deep --help must be the five lines:\n${r.stdout}`).toEqual([]);
  }, 120 * SECOND);

  it(`${ID.startHere} a planted sixth line fails the same check, naming it`, async () => {
    const real = await help();
    expect(startHereFailures(real.stdout), `the check passes on the real deep --help before it is held to the plant:\n${real.stdout}`).toEqual([]);
    const planted = await help(PLANTED);
    const first = groupsOf(planted.stdout)[0];
    if (!first?.lines.some((line) => line.startsWith(SIXTH))) throw Error(`BLOCKED: the planted front end added no ${SIXTH} line to the first group: ${shown(planted)}`);
    const failures = startHereFailures(planted.stdout);
    expect(failures.some((failure) => failure.includes(SIXTH)), `the check must fail on the planted sixth line, naming ${SIXTH}: ${JSON.stringify(failures)}`).toBe(true);
  }, 120 * SECOND);
});
