// Criterion 1, before: the same run before the redraft fails the two AC2 tests that call deep_claim from the Codex session, with
// unbound. The first draft is main's tests/acceptance/806 with the three files the redraft changed taken from its parent
// (git show 43d428e86^:<path>), laid in a sibling folder named for this process; only those two tests run (-t), to stay under the
// lane's 20 minutes. Imports the suite's helpers so a lane builds what that suite's tests need.
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { requireMacos, t26 } from '../806/helpers.ts';
import { BEFORE, REDRAFT, REPO, STAND_IN, SUITE, at, dropBefore, dropStale, runSessions, summary } from './redraft.ts';

/** The two AC2 tests of the first draft whose showFigure calls deep_claim from the Codex session. */
const CODEX_TESTS = [
  'AC2 each agent\'s figure is drawn in its own layer, outlined with its own name, when both show theirs on the same panel',
  'AC2 the Codex session\'s deep_show of the six-item figure is presented at revision 1 with a snapshot hash, drawn by the app in that agent\'s layer outlined with the session\'s name, and held by the record by hash',
];
const PATTERN = '(the Codex session\'s deep_show of the six-item figure|each agent\'s figure is drawn in its own layer)';
const RUN_MS = 18 * 60_000;
afterAll(dropBefore);

describe('#1176 criterion 1: the #806 sessions suite before the redraft', () => {
  it('#1176.3cc34af6 before the redraft the two AC2 tests that call deep_claim from the Codex session fail with unbound', async () => {
    requireMacos();
    expect(existsSync(t26.CLI), `the CLI the suite runs is built: ${t26.CLI}`).toBe(true);
    dropStale();
    cpSync(join(REPO, SUITE), join(REPO, BEFORE), { recursive: true, filter: (src) => !src.includes('node_modules') });
    for (const file of STAND_IN) {
      const was = at(`${REDRAFT}^`, `${SUITE}/${file}`);
      expect(was, `git holds the first draft's ${file} at ${REDRAFT.slice(0, 9)}^`).toBeDefined();
      writeFileSync(join(REPO, BEFORE, file), was ?? '');
    }
    expect(existsSync(join(REPO, BEFORE, 'sessions.test.ts')), 'the folder before the redraft has its sessions suite').toBe(true);

    const before = await runSessions(BEFORE, RUN_MS, PATTERN);
    const ran = before.tests.filter((t) => t.status === 'passed' || t.status === 'failed');
    expect(ran.map((t) => t.title).sort(), `the two Codex deep_claim tests of the first draft run:\n${summary(before)}`).toEqual(CODEX_TESTS);
    expect(ran.filter((t) => t.status !== 'failed').map((t) => t.title), `before the redraft both fail:\n${summary(before)}`).toEqual([]);
    for (const t of ran) expect(t.failure, `${t.title} fails on deep_claim refused unbound`).toMatch(/deep_claim[\s\S]*unbound|unbound[\s\S]*deep_claim/);
  }, 19 * 60_000);
});
