// Criterion 1: no string the hub sends into a chat says "your answer", "you said" or "once you say" of the person, and
// one lint-lane check reads every such string (README, Pinned 1). Two halves in one test, so the plant can't pass
// alone: the dump of the fixture run (README, The fixture run), where every hold, no and yes reached is answered by the
// person alone, so each of the three phrases there means the person; and the lint, which passes the checkout's
// sources and fails a copy of them holding a planted "It waits for your answer", naming the string and its file.
import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as t83 from '../83/helpers.ts';
import { dumpFailures, fixtureRun, git, ID, LINT, LINT_FOLDERS, MIN, PLANTED, PLANTED_FILE, PLANTED_WORDS, REPO } from './helpers.ts';

const made: string[] = [];
afterAll(async () => {
  await t83.cleanup();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 60_000);

/** A copy of the checkout's lint folders, every file git tracks or would track there, as it is on disk. */
function copy(): string {
  const root = mkdtempSync('/tmp/dd1813-lint-');
  made.push(root);
  for (const file of git('ls-files', '-c', '-o', '--exclude-standard', '--', ...LINT_FOLDERS).split('\n').filter(Boolean)) {
    const from = join(REPO, file);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(from, join(root, file));
  }
  return root;
}
function lint(root: string): { code: number | null; out: string } {
  const ran = spawnSync(process.execPath, [join(REPO, LINT), '--root', root], { cwd: REPO, encoding: 'utf8', timeout: 300_000 });
  return { code: ran.status, out: `${ran.stdout ?? ''}${ran.stderr ?? ''}` };
}

describe(`AC1 ${ID.dump} A dump of every string the hub sends into a chat, on the fixture run that reaches each, holds no "your answer", "you said" or "once you say" that means the person. A planted "It waits for your answer" fails, naming the string and its file`, () => {
  it(`AC1 ${ID.dump} the fixture run's dump holds none of the three phrases, and ${LINT}, run by the lint lane, passes the checkout and fails a planted "${PLANTED_WORDS}" in ${PLANTED_FILE}, naming the string and the file`, async () => {
    const sent = await fixtureRun();
    expect(sent.length, 'the fixture run reached strings the hub sent into the chat').toBeGreaterThan(0);
    expect(dumpFailures('the fixture run on this checkout', sent)).toEqual([]);

    const failures: string[] = [];
    if (!existsSync(join(REPO, LINT))) failures.push(`${LINT} doesn't exist (README, Pinned 1): no check reads every string the hub sends into a chat`);
    else {
      if (!readFileSync(join(REPO, 'scripts/lanes.mjs'), 'utf8').includes(LINT)) failures.push(`scripts/lanes.mjs's lint lane doesn't run ${LINT}`);
      const root = copy();
      const clean = lint(root);
      if (clean.code !== 0) failures.push(`the lint fails the checkout's own strings (exit ${clean.code}): ${clean.out.slice(0, 1200)}`);
      appendFileSync(join(root, PLANTED_FILE), PLANTED);
      const planted = lint(root);
      const line = planted.out.split('\n').find((l) => l.includes(PLANTED_FILE) && l.includes(PLANTED_WORDS));
      if (planted.code === 0) failures.push(`the lint passes a planted "${PLANTED_WORDS}" in ${PLANTED_FILE} (exit 0): ${planted.out.slice(0, 600)}`);
      else if (!line) failures.push(`the lint fails the plant (exit ${planted.code}) without a line naming both the string "${PLANTED_WORDS}" and its file ${PLANTED_FILE}: ${planted.out.slice(0, 600)}`);
    }
    expect(failures).toEqual([]);
  }, 15 * MIN);
});
