// The CLI half's scenarios (README: The criteria to tests), each run on the real CLI by its tagged test and on the
// planted wrong programs and the positive control by twins.test.ts. `twin` replaces the `deep` command with a program
// in twins/. Every step reaches DeepBuild through the `deep` command and the files under the temporary home.

import { mkdirSync } from 'node:fs';
import { expect } from 'vitest';
import { breakSettings, deep, finishedRecord, fixSettings, hubAnswers, makeHome, noRecord, ranNoSetup, rootOf, saidSetUp, settingsFile, shown, written, type Home } from './helpers.ts';

const FIRST = 'the first deep command (deep status)';
const NEXT = 'the next deep command (deep status)';

/**
 * With Claude Code's settings file unparseable, the first `deep` command's setup fails naming the file and leaves no
 * finished record. Then `~/.deepbuild` is in place (setup may have made it; the test makes sure: "whatever else exists").
 */
async function stoppedOnSettings(twin?: string): Promise<Home> {
  const h = makeHome();
  breakSettings(h.home);
  const file = settingsFile(h.home);
  const first = await deep(h.home, ['status'], { twin });
  if (first.code === 0 || !first.stderr.includes(file)) expect.fail(`#1002 with Claude Code's settings file unparseable, ${FIRST}'s setup must fail naming ${file}: ${shown(first)}`);
  noRecord(h.home, `${FIRST}'s setup`);
  mkdirSync(rootOf(h.home), { recursive: true });
  return h;
}

/** After that, the next `deep` command offers Set up again, which, the file still broken, fails naming the file again. */
export async function brokenSettingsOfferedAgain(twin?: string): Promise<void> {
  const h = await stoppedOnSettings(twin);
  const file = settingsFile(h.home);
  const next = await deep(h.home, ['status'], { twin });
  if (next.code === 0 || !next.stderr.includes(file)) expect.fail(`#1002 while setup hasn't finished, ${NEXT} must offer Set up again whatever else exists, which fails naming ${file} while it is still unparseable; it ran no setup: ${shown(next)}`);
  noRecord(h.home, `${NEXT}'s setup`);
}

/**
 * Or, after that, the file is fixed: the next `deep` command sets up, finishes and writes its record; the one after runs
 * no setup.
 */
export async function fixedFinishesOnce(twin?: string): Promise<void> {
  const h = await stoppedOnSettings(twin);
  fixSettings(h.home);
  const setUp = await deep(h.home, ['status'], { twin });
  if (setUp.code !== 0) expect.fail(`#1002 after the file is fixed, ${NEXT} must set up, finish and do its own job, exit 0: ${shown(setUp)}`);
  saidSetUp(`#1002 after the file is fixed, ${NEXT}`, setUp.stderr);
  await finishedRecord(h.home, `after the file is fixed, the setup ${NEXT} ran`);
  await hubAnswers(h.home, `after the file is fixed, the setup ${NEXT} ran`);
  const before = written(h.home);
  const after = await deep(h.home, ['status'], { twin });
  ranNoSetup('the deep command after that (deep status)', after, before, written(h.home));
}

/**
 * A setup whose hub doesn't start (a login service that starts nothing) fails naming the hub and leaves no finished
 * record, whatever it did write; the next `deep` command offers Set up again and, with the hub starting, finishes and
 * writes its record; the one after runs no setup.
 */
export async function hubDidntStartOfferedAgain(twin?: string): Promise<void> {
  const h = makeHome();
  fixSettings(h.home);
  const first = await deep(h.home, ['status'], { twin, hub: 'dead' });
  if (first.code === 0 || !/\bhub\b/i.test(first.stderr)) expect.fail(`#1002 with a login service that starts no hub, ${FIRST}'s setup must fail naming the hub: ${shown(first)}`);
  noRecord(h.home, `${FIRST}'s setup, whose hub didn't start,`);
  const next = await deep(h.home, ['status'], { twin });
  if (next.code !== 0) expect.fail(`#1002 after a setup whose hub didn't start, ${NEXT} must offer Set up again, finish it and do its own job, exit 0: ${shown(next)}`);
  saidSetUp(`#1002 after a setup whose hub didn't start, ${NEXT}`, next.stderr);
  await finishedRecord(h.home, `the setup ${NEXT} ran after the hub didn't start`);
  await hubAnswers(h.home, `the setup ${NEXT} ran after the hub didn't start`);
  const before = written(h.home);
  const after = await deep(h.home, ['status'], { twin });
  ranNoSetup('the deep command after that (deep status)', after, before, written(h.home));
}
