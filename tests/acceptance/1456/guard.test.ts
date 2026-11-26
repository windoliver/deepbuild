// AC3 #1456.86f6be87: a planted `LIKE` on a reading fails the guard, naming the line. The display-text guard (README:
// Defined here 3) run with --root over a copy of this checkout's packages/hub/src/status.ts and
// crates/deep-app/src/states.rs: as they are it passes; with one comparison against display text appended to either,
// it fails, naming that file and line.
import { afterAll, describe, expect, test } from 'vitest';
import { AC3, cleanup, guard, guardRoot, shown, STATES_RS, STATUS_TS } from './helpers.ts';

afterAll(cleanup, 60_000);

/** The guard's finding lines, as Defined here 3 writes them. */
const findings = (stdout: string): string[] => stdout.split('\n').filter((l) => l.startsWith('FAIL display text: '));

describe(AC3, () => {
  test(`${AC3}: the guard passes this checkout's status.ts and states.rs`, async () => {
    const { root } = guardRoot();
    const r = await guard(root);
    expect({ code: r.code, findings: findings(r.stdout), pass: r.stdout.split('\n').includes('PASS display text') }, `the guard over status.ts and states.rs as they are: ${shown(r)}`).toEqual({ code: 0, findings: [], pass: true });
  }, 120_000);

  test(`${AC3}: a planted LIKE on a reading in status.ts fails the guard, naming its line`, async () => {
    const { root, line } = guardRoot({ file: STATUS_TS, line: "export const planted1456 = `SELECT session_id FROM events WHERE kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Waiting on its monitor%'`;" });
    const r = await guard(root);
    const named = findings(r.stdout).filter((l) => l.startsWith(`FAIL display text: ${STATUS_TS}:${line}:`));
    expect({ code: r.code, named: named.length }, `the guard fails, with a finding naming ${STATUS_TS}:${line}, the planted LIKE: ${shown(r)}`).toEqual({ code: 1, named: 1 });
  }, 120_000);

  test(`${AC3}: a planted comparison against shown words in states.rs fails the guard, naming its line`, async () => {
    const { root, line } = guardRoot({ file: STATES_RS, line: 'pub fn planted_1456(word: &str) -> bool { word == shown("stuck") }' });
    const r = await guard(root);
    const named = findings(r.stdout).filter((l) => l.startsWith(`FAIL display text: ${STATES_RS}:${line}:`));
    expect({ code: r.code, named: named.length }, `the guard fails, with a finding naming ${STATES_RS}:${line}, the planted comparison: ${shown(r)}`).toEqual({ code: 1, named: 1 });
  }, 120_000);
});
