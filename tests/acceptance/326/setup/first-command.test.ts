// #326 setup, Scope: "the first `deep` command does the same without a click" as the one Set up click, which "adds the
// hooks in watch-only mode and starts the hub, and says so in one line". Held to the same criterion as the click:
// "the hooks are in place in watch-only mode, and no stop is held and no verdict blocks until a repo's checks are
// approved; the fast safety rules apply from the start".
//
// The first command is `deep status`, run inside a repo with drafted, unapproved checks in a fresh home where nothing
// is set up (README: The surface). It must set DeepBuild up, say so in one line on stderr, and then do its own job
// (exit 0). The second `deep` command sets nothing up again and says nothing about it. Then the watch-only scenario
// (scenario.ts) holds.

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TWINS, cleanup, draftedRepo, firstCommand, installedHub, makeHome, onMac, oneLine, setsNothingUpAgain, shown, written } from './helpers.ts';
import { hooksInPlace, watchOnlyFromTheStart } from './scenario.ts';

afterAll(cleanup, 60_000);

const who = 'the first deep command (deep status)';

/** The first command, then the second, then the scenario. `deepBin` replaces the CLI with a planted twin. */
async function firstDeep(deepBin?: string): Promise<void> {
  onMac();
  const { home } = makeHome();
  const { repo, commit } = draftedRepo(home);
  const first = await firstCommand(home, { cwd: repo, deepBin });
  hooksInPlace(home, who);
  if (first.code !== 0) expect.fail(`#326 ${who} must set DeepBuild up and then do its own job, exit 0: ${shown(first)}`);
  const line = oneLine(`#326 ${who}`, first.stderr);
  await installedHub(home, `#326 ${who}`);

  const before = written(home);
  const second = await firstCommand(home, { cwd: repo, deepBin });
  if (second.code !== 0) expect.fail(`#326 the second deep command (deep status) must do its own job, exit 0: ${shown(second)}`);
  setsNothingUpAgain('the second deep command (deep status)', second, before, written(home), line);

  await watchOnlyFromTheStart(home, repo, commit, who);
}

describe('#326 setup: the first deep command sets up as the click does, without a click', () => {
  it('#326.523de34e the first deep status in a fresh home sets DeepBuild up and says so in one line, the second says nothing and writes nothing, and then a failed claim stops unheld and unblocked while pkill -f vite is denied with the hub up and down', async () => {
    await firstDeep();
  }, 600_000);

  it('#326 (control deep-sets-up-once) a right first command built from merged code passes these checks', async () => {
    await firstDeep(join(TWINS, 'deep-sets-up-once'));
  }, 600_000);

  it('#326 (wrong program deep-sets-up-every-time) a deep that sets up again on every command fails, naming the second command', async () => {
    let failure = '';
    try {
      await firstDeep(join(TWINS, 'deep-sets-up-every-time'));
    } catch (error) {
      failure = (error as Error).message;
      if (failure.startsWith('BLOCKED')) throw error;
    }
    expect(failure).toMatch(/^#326 only the first deep command sets DeepBuild up: the second deep command \(deep status\) said so again/);
  }, 600_000);
});
