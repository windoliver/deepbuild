// #2857: a run's test jobs write their temporary files into a folder of the run's own, which is gone once the run
// ends, even when the run is killed, so a stopped run leaves nothing in the machine's shared /tmp (605's repo copies,
// 305's binary copies). The real scripts/affected.mjs runs in #2574's scratch tree, with a sandboxed HOME and TMPDIR.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, LONG, sandbox, start, tree } from './acceptance/2574/helpers.mjs';
import { until } from './acceptance/1115/helpers.mjs';

const VITEST = 'tests/fixture-2857/seen.test.ts';
const NODE = 'tests/fixture-2857-seen.test.mjs';
// Each job notes the temporary folder it was given and leaves a file in it; with T2857_HOLD it then waits to be killed.
const seen = (job, imports, testLine) => `${imports}
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
writeFileSync(join(tmpdir(), 'left-by-${job.replace(/\W/g, '-')}'), 'x');
appendFileSync(process.env.T2857_SEEN, JSON.stringify({ job: ${JSON.stringify(job)}, tmp: tmpdir() }) + '\\n');
${testLine}
`;
const files = {
  [VITEST]: seen(VITEST, "import { test } from 'vitest';", "test('notes its tmpdir', async () => { if (process.env.T2857_HOLD) await new Promise((done) => setTimeout(done, 600_000)); }, 700_000);"),
  [NODE]: seen(NODE, "import test from 'node:test';", "test('notes its tmpdir', async () => { if (process.env.T2857_HOLD) await new Promise((done) => setTimeout(done, 600_000)); });"),
};
const seenBy = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

test('a run\'s test jobs get a temporary folder of the run\'s own, not the shared one, and it is gone once the run ends', LONG, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, files);
  const record = join(box.dir, 'seen.jsonl');
  const run = await start(box, fixture, [VITEST, NODE], { T2857_SEEN: record }).done;
  const all = `${dump(run)}\nseen: ${JSON.stringify(seenBy(record))}`;
  const jobs = seenBy(record);
  assert.deepEqual(jobs.map(({ job }) => job).sort(), [NODE, VITEST].sort(), `both test jobs ran\n${all}`);
  for (const { job, tmp } of jobs) {
    assert.notEqual(tmp, fixture.tmp, `${job} wrote into the shared temporary folder\n${all}`);
    assert.ok(tmp.startsWith(`${fixture.tmp}/`), `${job}'s folder ${tmp} is under the run's own TMPDIR\n${all}`);
    assert.equal(existsSync(tmp), false, `${job}'s folder ${tmp} is still there after the run\n${all}`);
  }
});

test('a run killed with SIGKILL while its test jobs run leaves no temporary folder of theirs behind', LONG, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, files);
  const record = join(box.dir, 'seen.jsonl');
  const child = start(box, fixture, [VITEST, NODE], { T2857_SEEN: record, T2857_HOLD: '1' });
  const both = await until(() => seenBy(record).length === 2, 240_000);
  const jobs = seenBy(record);
  assert.ok(both, `both test jobs started within 240 s\nseen: ${JSON.stringify(jobs)}\nstdout:\n${child.out().slice(-2_000)}`);
  for (const { job, tmp } of jobs) assert.ok(existsSync(tmp), `${job}'s folder ${tmp} is there while it runs`);
  // The run's own process group: affected.mjs, its throttle and its jobs (sandbox started it detached).
  process.kill(-child.pid, 'SIGKILL');
  const gone = await until(() => jobs.every(({ tmp }) => !existsSync(tmp)), 30_000);
  assert.ok(gone, `a folder outlived the killed run by 30 s: ${jobs.filter(({ tmp }) => existsSync(tmp)).map(({ tmp }) => tmp).join(' ')}`);
});
