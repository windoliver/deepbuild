// #24.4963284a: an answer given in the CLI (`deep inbox answer <id> <option>`, run by you, the OS confirming
// you) is saved as a decision with its scope: this repo's, `repo:<the ask's project>` (design: Decision and rule,
// "An answer is saved for this repo").

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { cleanup, deep, expectCountedOnce, listed, PROJECT, seed, startHub, tempDir } from './helpers.ts';

afterEach(cleanup, 30_000);

test('#24.4963284a an answer given in deep inbox answer is saved as a decision with its scope', async () => {
  const home = join(tempDir(), 'h');
  mkdirSync(home);
  let authority = '';
  let choice = '';
  await seed(home, async (s) => {
    await s.start('S1');
    authority = await s.raise('S1', 'authority', 'feature/login');
    choice = await s.raise('S1', 'choice', 'the store');
  });
  const hub = await startHub(home, { confirm: 'confirmed' });
  for (const [ask, option] of [[authority, 'decline'], [choice, 'files']] as const) {
    const r = await deep(home, ['inbox', 'answer', ask, option]);
    expect(r.code, `deep inbox answer ${ask} ${option} exits 0: ${r.stdout}${r.stderr}`).toBe(0);
    expect(r.stdout, `deep inbox answer says which ask it answered`).toContain(ask);
    expect(r.stdout, `deep inbox answer says the scope the decision was saved at`).toContain(`repo:${PROJECT}`);
    const { decision } = await expectCountedOnce(hub, ask, option, 'answered in the CLI');
    expect(decision.writer, `the decision from ${ask} is the core's`).toBe('core');
    expect(decision.data, `the decision saved from ${ask} names it, its answer and its scope, this repo`).toMatchObject({ ask, answer: option, scope: `repo:${PROJECT}` });
  }
  const left = await deep(home, ['inbox']);
  expect(left.code, `deep inbox exits 0: ${left.stderr}`).toBe(0);
  const open = listed(left.stdout).map((row) => row.ask);
  expect(open, `deep inbox no longer lists ${authority}, answered`).not.toContain(authority);
  expect(open, `deep inbox no longer lists ${choice}, answered`).not.toContain(choice);
}, 120_000);
