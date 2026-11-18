// AC3: the time of the session's last finished stop, and the plan resets a block reads from its stops, are the merge
// base's at every step of #340's and #84's suites, unchanged. Two legs (README: AC3): those suites stay as on the merge
// base and in the preflight, which runs them against the change; and the two readings, which their steps never make
// decide anything, are compared with the merge base's at every step where they do.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { changeBase, HERE, mergeBaseCore, REPO } from './helpers.ts';
import { readings } from './scenarios.ts';

const SUITES = ['tests/acceptance/340/', 'tests/acceptance/84/'];

test("AC3 #2653.d3fb687c #340's and #84's suites are unchanged from the merge base, and the preflight runs each", async () => {
  // The change's own edits: this checkout against the merge base, or, once the change has landed, the commit that brought it.
  const { sha, landed } = changeBase();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  const changed = landed
    ? git('diff', '--name-status', sha, landed, '--', ...SUITES)
    : [...git('diff', '--name-status', sha, '--', ...SUITES), ...git('ls-files', '--others', '--exclude-standard', '--', ...SUITES).map((f) => `?\t${f}`)];
  expect(changed, `#340's and #84's suites as on the merge base ${sha.slice(0, 12)}`).toEqual([]);
  const { alone, byHand } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { alone: string[]; byHand: string[] };
  const covers = (list: string[], suite: string) => list.filter((p) => suite.startsWith(p) || p.startsWith(suite));
  for (const suite of SUITES) {
    expect(covers(alone, suite), `scripts/lanes.mjs runs ${suite} in its one-at-a-time block`).not.toEqual([]);
    expect(covers(byHand, suite), `scripts/lanes.mjs leaves no part of ${suite} to a person`).toEqual([]);
  }
});

test("AC3 #2653.d3fb687c the time of a session's last finished stop and the plan resets a block reads from its stops decide as on the merge base at every step, 1,200 stops on from the stops they come from", async () => {
  await readings(await mergeBaseCore(), HERE);
}, 1_800_000);
