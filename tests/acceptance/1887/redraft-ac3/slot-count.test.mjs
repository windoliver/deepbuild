// #1887 AC3, blind redraft after #210: the slot count `node scripts/slots-check.mjs` prints on its `PASS slots:` line
// is unchanged by the work. #210 published `deep.registerPort` on main, so the base's published API now holds 17 slots
// by the check's own rule, not the first draft's 16 (README). Through the check as it is run: its exit status and its
// `PASS slots: <n> slots ...` line. Nothing in the checkout is written.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const CHECK = 'scripts/slots-check.mjs';
const API_FILE = 'packages/contracts/extension-api.json';
// The base this redraft was written at: main 0f34aacbe, after #210.
const BASE = '0f34aacbe';
// The slots the base's check counts in the base's published API, by its own rule: each `deep.register*` entry's
// variants, or 1 when it names none. At 0f34aacbe: 14 register methods, `deep.registerSource` with 4 variants, so
// 13 + 4 (README, The count).
const SLOTS = 17;
// One run of the check with every kit, on a loaded machine.
const LIMIT = 15 * 60_000;

const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const shown = (run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\n--- stdout\n${run.stdout.trimEnd()}\n--- stderr\n${run.stderr.trimEnd()}`;
const lines = (run, word) => run.stdout.split('\n').filter((line) => line.startsWith(`${word} slots`));
// The check's own counting rule (scripts/slots-check.mjs at the base), used only to see that the merge base still
// holds the count this redraft expects; the judged count is the one the check prints.
const counted = (api) => api.filter((entry) => entry.method.startsWith('deep.register')).reduce((n, entry) => n + (entry.variants?.length ?? 1), 0);

test('#1887.4a851c74 The slot count the check prints is unchanged', { timeout: LIMIT }, () => {
  // "Unchanged" is against the merge base. If main has moved the count since 0f34aacbe, or the checkout predates it,
  // 17 is not the merge base's count and this test can't judge the work: BLOCKED, never a verdict on it.
  const base = git('merge-base', 'HEAD', 'origin/main');
  assert.equal(base.status, 0, `BLOCKED: git merge-base HEAD origin/main fails, so the merge base's count can't be confirmed:\n${base.stderr}`);
  const file = git('show', `${base.stdout.trim()}:${API_FILE}`);
  assert.equal(file.status, 0, `BLOCKED: git show ${base.stdout.trim()}:${API_FILE} fails:\n${file.stderr}`);
  const before = counted(JSON.parse(file.stdout));
  assert.equal(before, SLOTS, `BLOCKED: ${API_FILE} at the merge base ${base.stdout.trim()} holds ${before} slots by the check's rule, not the ${SLOTS} of ${BASE} this test expects; the count moved on main (or the checkout predates ${BASE}), and a redraft is due`);

  const run = spawnSync(process.execPath, [join(repo, CHECK)], { cwd: repo, encoding: 'utf8', timeout: LIMIT, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(run.error, undefined, `BLOCKED: node ${CHECK} could not run: ${run.error?.message}`);
  const passed = lines(run, 'PASS');
  assert.equal(passed.length, 1, `node ${CHECK} prints its slot count on its one \`PASS slots:\` line, and printed ${passed.length}:\n${shown(run)}`);
  const count = passed[0].match(/^PASS slots: (\d+) slots\b/);
  assert.ok(count, `the \`PASS slots:\` line doesn't start with its slot count, as the base's does ("PASS slots: ${SLOTS} slots from the published API, ..."):\n${shown(run)}`);
  assert.equal(Number(count[1]), SLOTS, `the check counts ${count[1]} slots; the base counts ${SLOTS}:\n${shown(run)}`);
  assert.equal(run.status, 0, `the check prints its count and doesn't exit 0:\n${shown(run)}`);
});
