// #3238 AC2, where the ancestor's test grant is an affected.mjs run's admission (#3221, docs/parallel-proof.md section
// 6): a lint that builds nothing, which affected.mjs runs through scripts/lease under its run's grant, passes through on
// that grant and asks for none of its own. The pool is one token (readings of two cores). With the token free the lint
// starts at once. With the token held by another job of the run, the issue ("waits for nothing", "starts at once") and
// section 6 ("then waits for a turn") read differently (README: Open question), so that test asserts what both require
// and prints which of the two happened.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC2, copyScripts, dump, finish, log, running, sandbox, start, startOf, starts, table, when, within } from './helpers.mjs';

const OTHER = 'other-job';
const LINT = 'repo-rules-lint';

// node run.mjs <steps>: an admitted run's process. It starts each step's command, once its `go` file exists when it has
// one, and exits 0 when all of them did. DEEP_THROTTLE_RUN is the run's own marker, so its jobs never carry it.
const RUN = `import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const steps = JSON.parse(process.argv[2]);
const env = { ...process.env };
delete env.DEEP_THROTTLE_RUN;
const codes = await Promise.all(steps.map(async ({ argv, go }) => {
  while (go && !existsSync(go)) await new Promise((done) => setTimeout(done, 50));
  return new Promise((done) => {
    const child = spawn(argv[0], argv.slice(1), { env, stdio: 'inherit' });
    child.on('error', () => done(127));
    child.on('exit', (status, signal) => done(signal ? 128 : status));
  });
}));
process.exit(codes.some(Boolean) ? 1 : 0);
`;

/** A run admitted on a table whose pool is one token, with the lint as its job and `other` beside it when wanted. */
function admit(box, lease, other) {
  const readings = join(box.dir, 'readings.json');
  writeFileSync(readings, JSON.stringify({ memory: 2 ** 40, load: 1, cores: 2 }));
  box.env.DEEP_THROTTLE_READINGS = readings;
  writeFileSync(join(box.dir, 'run.mjs'), RUN);
  const throttle = join(box.scripts, 'throttle.mjs');
  const steps = [
    ...other ? [{ argv: [process.execPath, throttle, 'test', '--wait', '30', '--', 'node', box.stub, OTHER] }] : [],
    { argv: [lease, 'node', box.stub, LINT, 'exit'], go: join(box.dir, 'lint.go') },
  ];
  return start(box, [process.execPath, throttle, 'test', '--wait', '1', '--', process.execPath, join(box.dir, 'run.mjs'), JSON.stringify(steps)], 'run', { DEEP_THROTTLE_RUN: '0' });
}

/** The run's admission, `test:<id>`, once the log shows it granted. */
const admission = (box) => {
  const granted = log(box).find((entry) => entry.event === 'granted' && entry.class === 'test' && entry.run === true);
  return granted ? `test:${granted.id}` : null;
};
/** The job's passed entries through `token`, less those of `others` (throttle.mjs pids). */
const passed = (box, token, others = []) => log(box).filter((entry) => entry.event === 'passed' && entry.through === token && !others.includes(entry.pid));
/** Any `build` grant or timeout in the log: the script asked for one of its own. */
const asked = (box) => log(box).filter((entry) => entry.class === 'build' && ['granted', 'timeout'].includes(entry.event));

test(`${AC2} under an affected.mjs run's admission with a token of the pool free, a lint scripts/lease runs starts at once, the log showing passed for it and no build request`, async (t) => {
  const box = sandbox(t);
  const lease = copyScripts(box);
  const run = admit(box, lease, false);
  writeFileSync(join(box.dir, 'lint.go'), '');
  const shown = () => dump(box, run);
  const seen = await when(box, () => {
    if (startOf(box, LINT)) return 'started';
    if ((table(box)?.requests ?? []).some((request) => ['build', 'test'].includes(request.class) && request.pid !== run.pid)) return 'waits';
    if (!running(run)) return 'ended';
    return null;
  }, 180_000);
  assert.equal(seen, 'started', `the lint \`node stub.mjs ${LINT}\` didn't start at once under its run's admission: ${seen === 'waits' ? 'a request of its own waits in the table' : seen === 'ended' ? 'its run ended first' : 'nothing happened in 3 min'}\n${shown()}`);
  const token = admission(box);
  assert.ok(token, `the log shows no admission for the run\n${shown()}`);
  assert.equal(startOf(box, LINT).throttle, token, `the lint \`${LINT}\` doesn't hold its run's grant ${token}\n${shown()}`);
  assert.ok(passed(box, token).length, `the log shows no passed entry through the run's admission ${token} for the lint \`${LINT}\`\n${shown()}`);
  assert.deepEqual(asked(box), [], `the log shows a build request for the lint \`${LINT}\`\n${shown()}`);
});

test(`${AC2} under an admission whose every pool token another job of the run holds, a lint scripts/lease runs passes through with no build request, and runs once`, async (t) => {
  const box = sandbox(t);
  const lease = copyScripts(box);
  const run = admit(box, lease, true);
  const shown = () => dump(box, run);
  // The other job holds the pool's only token: it started, under a turn.
  await when(box, () => (startOf(box, OTHER) && log(box).some((entry) => entry.event === 'turn')) || !running(run), 180_000);
  const token = admission(box);
  assert.ok(token && startOf(box, OTHER) && log(box).some((entry) => entry.event === 'turn'), `the run's other job never held the pool's token (the harness proves nothing)\n${shown()}`);
  const holder = startOf(box, OTHER).ppid;

  writeFileSync(join(box.dir, 'lint.go'), '');
  // Either the lint started, or it waits for a turn (a request of class turn), or a request of its own waits.
  const seen = await when(box, () => {
    if (startOf(box, LINT)) return 'started at once, beside the job that holds the token';
    if ((table(box)?.requests ?? []).some((request) => request.class === 'turn')) return 'waited for a turn';
    if ((table(box)?.requests ?? []).some((request) => ['build', 'test'].includes(request.class) && request.pid !== run.pid)) return 'asked for a grant of its own';
    if (!running(run)) return 'run ended';
    return null;
  }, 180_000);
  // A diagnostic and no assertion: the issue and section 6 read differently here (README: Open question).
  t.diagnostic(`with every token of the pool held by another job of the run, the lint ${seen ?? 'did nothing in 3 min'}`);
  assert.ok(seen === 'started at once, beside the job that holds the token' || seen === 'waited for a turn', `the lint \`node stub.mjs ${LINT}\` neither started nor waited for a turn: ${seen ?? 'nothing happened in 3 min'}\n${shown()}`);
  assert.ok(passed(box, token, [holder]).length, `the log shows no passed entry through the run's admission ${token} for the lint \`${LINT}\`\n${shown()}`);
  assert.deepEqual(asked(box), [], `the log shows a build request for the lint \`${LINT}\`\n${shown()}`);

  // The token goes back: whichever of the two happened, the lint runs, once, and the run ends with 0.
  finish(box, OTHER);
  const ended = await within(run.done, 180_000);
  assert.ok(ended, `the run didn't end within 3 min of its other job\n${shown()}`);
  assert.equal(starts(box, LINT).length, 1, `the lint \`${LINT}\` ran ${starts(box, LINT).length} times\n${shown()}`);
  assert.equal(ended.status, 0, `the run ended ${ended.status ?? ended.signal}\n${shown()}`);
});
