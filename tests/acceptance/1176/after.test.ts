// Criterion 1, after: on macOS, at main, tests/acceptance/806/sessions.test.ts passes all 7 tests with the redrafted stand-in (the
// first draft's 6 and the twin). Imports the suite's helpers so a lane builds what that suite's tests need.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { requireMacos, t26 } from '../806/helpers.ts';
import { SUITE, runSessions, summary } from './redraft.ts';

const RUN_MS = 18 * 60_000;

describe('#1176 criterion 1: the #806 sessions suite at main', () => {
  it('#1176.3cc34af6 sessions.test.ts passes all 7 tests with the redrafted stand-in', async () => {
    requireMacos();
    // The suite runs the built CLI; without it every test would fail for want of a build, not for the stand-in.
    expect(existsSync(t26.CLI), `the CLI the suite runs is built: ${t26.CLI}`).toBe(true);
    const after = await runSessions(SUITE, RUN_MS);
    expect(after.tests.length, `the redrafted suite runs 7 tests:\n${summary(after)}`).toBe(7);
    expect(after.tests.filter((t) => t.status !== 'passed').map((t) => `${t.title}: ${t.status} ${t.failure.slice(0, 600)}`), `every test passes with the redrafted stand-in:\n${summary(after)}`).toEqual([]);
  }, 19 * 60_000);
});
