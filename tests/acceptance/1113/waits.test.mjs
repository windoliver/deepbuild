// #1113: each caller's grant wait matches section 6's table, read from the throttle log's `wait` (minutes).
// The before lane's 15 minutes is read in before.test.mjs, beside the run it belongs to.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, dump, event, grants, launch, logLines, measuredRepo, sandbox, scratchRepo, topLevel } from './helpers.mjs';

const OBSERVED = JSON.stringify({ status: 0, elapsedMs: 1_000, cpuMs: 400, peakBytes: 50_000_000 });
const CORPUS = `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.T1113_EVENTS, JSON.stringify({ name: 'lane', event: 'start', t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null }) + '\\n');
console.log('PASS stub corpus');
`;

test('#1113.a0183037 a lane command waits up to 30 minutes for its grant, as build for an unlisted command', async (t) => {
  const box = sandbox(t);
  // The corpus lane of lanes.mjs's checks, its script a stub, run as checks.mjs runs lanes.
  const repo = scratchRepo(box, { files: { 'scripts/corpus.mjs': CORPUS } });
  const driver = "import { checks, runLanes } from './scripts/lanes.mjs'; process.exitCode = runLanes(checks.filter(({ name }) => name === 'corpus'));";
  const run = await launch(box, [process.execPath, '--input-type=module', '-e', driver], { cwd: repo }).done;
  const all = dump(box, run);
  assert.equal(run.status, 0, all);
  assert.match(String(event(box, 'lane', 'start')?.throttle), /^build:\S+$/, `the lane's command ran under no build grant\n${all}`);
  const lines = logLines(box).filter(topLevel);
  assert.ok(lines.length, `the throttle log holds no grant for the lane's command\n${all}`);
  for (const line of lines) assert.equal(Number(line.wait), 30, `a lane command's grant wait: ${line.text}`);
});

test('#1113.a0183037 a measured run\'s top-level timed waits up to 60 minutes: preflight, and perf started by hand', async (t) => {
  const box = sandbox(t);
  const { repo, env } = measuredRepo(box);
  for (const argv of [['scripts/preflight.mjs'], ['scripts/perf.mjs', OBSERVED]]) {
    const before = grants(box, 'timed').filter(topLevel).length;
    const run = await launch(box, [process.execPath, ...argv], { cwd: repo, env }).done;
    const timed = grants(box, 'timed').filter(topLevel).slice(before);
    assert.equal(timed.length, 1, `${argv[0]} made one top-level timed grant\n${dump(box, run)}`);
    assert.equal(Number(timed[0].wait), 60, `${argv[0]}'s timed grant wait: ${timed[0].text}`);
  }
});

test('#1113.a0183037 an affected.mjs job waits up to 30 minutes for its grant, its node --test block as test', async (t) => {
  const box = sandbox(t);
  // affected.mjs runs in this checkout, on a probe test it is named as the change; only the HOME is the sandbox's.
  // The probe's path is joined here, so no literal in this file reads to affected.mjs as reaching it, which
  // would make it run this file again.
  const probe = ['tests', 'acceptance', '1113', 'fixtures', 'probe.test.mjs'].join('/');
  // Its selection is read first, so a run that would select more (this file among them) never starts.
  const list = await launch(box, [process.execPath, 'scripts/affected.mjs', '--list', probe], { cwd: CHECKOUT }).done;
  assert.match(list.stdout, new RegExp(`^parallel node: ${probe.replaceAll('.', '\\.')}$`, 'm'), `affected.mjs selects other tests than the probe\n${dump(box, list)}`);
  const run = await launch(box, [process.execPath, 'scripts/affected.mjs', probe], { cwd: CHECKOUT }).done;
  const all = dump(box, run);
  assert.match(String(event(box, 'probe', 'start')?.throttle), /^test:\S+$/, `the probe's node --test job ran under no test grant\n${all}`);
  const lines = logLines(box).filter(topLevel);
  assert.ok(lines.some((line) => line.class === 'test'), `the throttle log holds no test grant for the job\n${all}`);
  for (const line of lines) assert.equal(Number(line.wait), 30, `an affected.mjs job's grant wait: ${line.text}`);
});
