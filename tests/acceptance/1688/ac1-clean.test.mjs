import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, LINT, LINT_NAME, makeCopy, run, shown, widenBase } from './helpers.mjs';

const ID = '#1688.e0a10d9d';
const passed = (r) => r.status === 0 && r.lines.some((l) => l.startsWith(`PASS ${LINT_NAME}`)) && !r.lines.some((l) => /^(FAIL|BLOCKED|INVALID|INCONCLUSIVE)\b/.test(l));

test(`${ID} AC1: the lint passes on the change's files`, { timeout: 1_800_000 }, async (t) => {
  assert.ok(existsSync(join(CHECKOUT, LINT)), `${LINT}, the lint of exports with no reader outside their file, does not exist`);
  const { sandbox, repo } = makeCopy(t);
  const r = await run(repo, sandbox, [LINT]);
  t.diagnostic(shown(r, 10));
  assert.ok(passed(r), `the lint does not pass the change against its merge base\n${shown(r)}`);
});

test(`${ID} AC1: the lint passes with every packages/*/src file in the change`, { timeout: 1_800_000 }, async (t) => {
  assert.ok(existsSync(join(CHECKOUT, LINT)), `${LINT}, the lint of exports with no reader outside their file, does not exist`);
  const { sandbox, repo } = makeCopy(t);
  const sources = widenBase(repo, sandbox);
  const r = await run(repo, sandbox, [LINT]);
  t.diagnostic(`${sources.length} packages/*/src files at the merge base, all in the widened change\n${shown(r, 10)}`);
  assert.ok(passed(r), `the lint does not pass the cleaned packages: with every packages/*/src file in the change, it finds exports with no reader outside their file\n${shown(r, 200)}`);
});
