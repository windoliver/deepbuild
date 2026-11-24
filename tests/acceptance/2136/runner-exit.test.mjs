// #2136, criterion 1: a test job whose runner exited non-zero with no failed test is never passed. Reached by running
// `node scripts/affected.mjs <test file>` in a scratch tree holding this checkout's scripts (README: The affected.mjs
// tree). node --test writes a test's start row only once the test has ended, so the tree's one node test file holds
// two tests: the first passes, which puts the file's first start row in the job's report; the second waits for that
// row, then ends the node --test runner above it with SIGKILL, as memory pressure would, and exits. No test of the
// job failed, and the second never ended.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { affected, affectedTree, dump, lastLine, sandbox } from './helpers.mjs';

const KILLED = 'tests/fixture-2136/killed.test.mjs';
const SECOND = 'the runner is killed while this test runs';

/** The tree's test file: it writes what it saw to `witness`, then kills its runner. */
const killsItsRunner = (witness) => `import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

test('a test that ends before the runner is killed', () => {});

test(${JSON.stringify(SECOND)}, async () => {
  // The runner is this file's parent; its command line names the report the job reads.
  const command = execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(process.ppid)], { encoding: 'utf8' }).trim();
  const report = command.match(/--test-reporter-destination=(\\S+\\.jsonl)/)?.[1] ?? null;
  const read = () => { try { return readFileSync(report, 'utf8'); } catch { return ''; } };
  const rows = () => read().split('\\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const started = () => rows().some((row) => row.type === 'start' && String(row.file).endsWith(${JSON.stringify(KILLED)}));
  for (let waited = 0; report && !started() && waited < 30_000; waited += 50) await sleep(50);
  writeFileSync(${JSON.stringify(witness)}, JSON.stringify({ runner: process.ppid, command, report, rows: rows() }));
  process.kill(process.ppid, 'SIGKILL');
  process.exit(0);
});
`;

test('#2136.bcf37dea a node job whose report holds a start row for its file and no fail row, and whose runner a signal ended, leaves the run\'s last line INCONCLUSIVE, not PASS', async (t) => {
  const box = sandbox(t);
  const witness = join(box.dir, 'witness.json');
  const tree = affectedTree(box, { [KILLED]: killsItsRunner(witness) });
  const run = await affected(box, tree, [KILLED]);
  const out = dump(box, run);

  // Given: the job ran (it had its grant), its report held a start row for its file and no fail row, and its runner
  // was node --test, ended by the signal.
  assert.ok(existsSync(witness), `the tree's test file never ran, so no job's runner was killed\n${out}`);
  const seen = JSON.parse(readFileSync(witness, 'utf8'));
  assert.match(seen.command, /--test\b/, `the test file's parent was not a node --test runner: ${seen.command}\n${out}`);
  assert.ok(seen.report, `the runner's command names no report: ${seen.command}\n${out}`);
  assert.ok(seen.rows.some((row) => row.type === 'start' && String(row.file).endsWith(KILLED)), `the report held no start row for ${KILLED} when the runner was killed: ${JSON.stringify(seen.rows)}\n${out}`);
  // The killed runner may have left its last row cut short; a row that doesn't parse names no result.
  const after = readFileSync(seen.report, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  assert.deepEqual(after.filter((row) => row.type === 'fail'), [], `the report holds a fail row, so the job reported a failed test\n${out}`);
  assert.deepEqual(after.filter((row) => row.name === SECOND), [], `the report holds a row for the test that killed its runner, so the runner outlived it\n${out}`);

  // Then: the run's last line is INCONCLUSIVE, not PASS.
  const last = lastLine(run.stdout);
  assert.doesNotMatch(last, /^PASS\b/, `the run's last line is PASS though its node job's runner was killed part way through its file\n${out}`);
  assert.match(last, /^INCONCLUSIVE\b/, `the run's last line is not INCONCLUSIVE\n${out}`);
});
