import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compare, judgeLimit, measure, measureOnce, parseCpuMs, parsePeakRss, summarize, validateBudgets } from '../scripts/benchmark.mjs';

const budget = { id: 'startup', command: ['binary'], margin: 0.5, limits: { peakBytes: 10_000_000 }, initialReason: 'First measured executable in issue #12.' };
const config = { tasks: [budget] };

test('quantiles and peak memory preserve values under reordered samples', () => {
  const samples = [1, 2, 3, 4, 5].map((ms) => ({ ms, peakBytes: ms * 100 }));
  const expected = { p50Ms: 3, p95Ms: 5, peakBytes: 500 };
  for (let shift = 0; shift < samples.length; shift++) {
    const rotated = [...samples.slice(shift), ...samples.slice(0, shift)];
    assert.deepEqual(summarize(rotated), expected);
    assert.deepEqual(summarize(rotated.reverse()), expected);
  }
  assert.throws(() => summarize([]), /samples/);
  assert.throws(() => summarize([{ ms: NaN, peakBytes: 1 }]), /sample/);
});

test('native peak RSS parses bytes on macOS and KiB on Linux without accepting missing readings', () => {
  for (let value = 1; value <= 100; value++) {
    assert.equal(parsePeakRss(`  ${value}  maximum resident set size\n`, 'darwin'), value);
    assert.equal(parsePeakRss(`peak_rss_kb=${value}\n`, 'linux'), value * 1024);
  }
  for (const invalid of ['', 'peak_rss_kb=NaN', 'peak_rss_kb=-1', 'peak_rss_kb=0']) {
    assert.throws(() => parsePeakRss(invalid, 'linux'), /peak RSS/);
  }
});

test('CPU time parses user plus system seconds on macOS and Linux without accepting missing readings', () => {
  for (const [user, sys] of [[0, 0], [0.01, 0.02], [1.5, 0.25], [123.45, 6.78]]) {
    const expected = Math.round((user + sys) * 1000);
    assert.equal(parseCpuMs(`        9.99 real  ${user.toFixed(2)} user  ${sys.toFixed(2)} sys\n  1  maximum resident set size\n`, 'darwin'), expected);
    assert.equal(parseCpuMs(`Command exited with non-zero status 1\npeak_rss_kb=1\ncpu_s=${user.toFixed(2)} ${sys.toFixed(2)}\n`, 'linux'), expected);
  }
  for (const invalid of ['', 'cpu_s=x y', 'cpu_s=-1 0', 'peak_rss_kb=1']) {
    assert.throws(() => parseCpuMs(invalid, 'linux'), /CPU time/);
  }
  assert.throws(() => parseCpuMs('  1  maximum resident set size', 'darwin'), /CPU time/);
});

test('a measured command reports the CPU it used, not the time it waited', () => {
  const waiting = measureOnce(['sleep', '0.3'], process.cwd());
  assert.ok(waiting.elapsedMs >= 300 && waiting.cpuMs < 100, JSON.stringify(waiting));
  const busy = measureOnce([process.execPath, '-e', 'const start = process.cpuUsage(); for (let used; (used = process.cpuUsage(start)).user + used.system < 300_000;);'], process.cwd());
  assert.ok(busy.cpuMs >= 300, JSON.stringify(busy));
});

test('first measurement names its reason, while established budgets cannot disappear or change', () => {
  validateBudgets(config, null);
  validateBudgets(config, structuredClone(config));
  assert.throws(() => validateBudgets({ tasks: [] }, config), /startup/);
  for (const change of [{ margin: 5 }, { initialReason: 'Reset' }, { limits: {} }, { command: ['other'] }]) {
    assert.throws(() => validateBudgets({ tasks: [{ ...budget, ...change }] }, config), /startup/);
  }
  assert.throws(() => validateBudgets({ tasks: [{ ...budget, initialReason: '' }] }, null), /reason/);
  const initial = compare(budget, { p50Ms: 1, p95Ms: 2, peakBytes: 500 }, null);
  assert.equal(initial.status, 'INITIAL');
  assert.equal(initial.reason, budget.initialReason);
});

test('a cap, or a p50 or peak-memory regression, fails even when another metric improves', () => {
  const base = { p50Ms: 10, p95Ms: 20, peakBytes: 1000 };
  assert.equal(compare(budget, base, base).status, 'PASS');
  for (const metric of ['p50Ms', 'peakBytes']) {
    assert.throws(() => compare(budget, { ...base, [metric]: base[metric] * 2 }, base), new RegExp(metric));
  }
  assert.throws(() => compare(budget, { ...base, peakBytes: 10_000_000 }, null), /peakBytes/);
});

test('a slow tail alone is not a regression, while p95 keeps its absolute cap', () => {
  const base = { p50Ms: 10, p95Ms: 20, peakBytes: 1000 };
  const tail = { ...base, p95Ms: 60 };
  assert.equal(compare(budget, tail, base).status, 'PASS');
  assert.throws(() => compare({ ...budget, limits: { p95Ms: 50 } }, tail, base), /p95Ms/);
});

test('real process measurements reject a slower program and a failed command', () => {
  const [slow, fast] = measure(['sleep', '0.1'], process.cwd(), { command: ['true'], cwd: process.cwd() });
  assert.ok(slow.p50Ms >= 100 && slow.p95Ms >= slow.p50Ms && fast.peakBytes > 0);
  assert.throws(() => compare({ ...budget, limits: {} }, slow, fast), /p50Ms/);
  assert.throws(() => measure([process.execPath, '-e', 'process.exit(9)'], process.cwd()), /exited 9/);
});

test('current and merge-base samples alternate, so both see the same machine load', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'deep-benchmark-order-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const append = (side) => ['sh', '-c', `echo ${side} >> order`];
  measure(append('current'), cwd, { command: append('base'), cwd });
  const order = readFileSync(join(cwd, 'order'), 'utf8').trim().split('\n');
  assert.ok(order.length >= 40, `${order.length} samples`);
  assert.deepEqual(order, order.map((_, index) => (index % 2 ? 'base' : 'current')));
});

test('a single workload measurement keeps failed check output and status for later lanes', () => {
  const result = measureOnce([process.execPath, '-e', 'console.log("check failed"); process.exit(7)'], process.cwd());
  assert.equal(result.status, 7);
  assert.match(result.output, /check failed/);
  assert.ok(result.elapsedMs > 0 && result.peakBytes > 0);
});

// #1322: spawnSync stops only /usr/bin/time, so a check stopped past its allowance kept building in perf's kept copy.
test('a run stopped at its timeout or output limit leaves no process it started', { timeout: 60_000 }, async (t) => {
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code !== 'ESRCH';
    }
  };
  // The flood ignores the broken pipe it meets once the run is stopped, so only a signal ends the child.
  for (const [code, flood] of [['ETIMEDOUT', ''], ['ENOBUFS', "process.stdout.on('error', () => {}).write('x'.repeat(33 * 2 ** 20));"]]) {
    const directory = mkdtempSync(join(tmpdir(), 'deep-benchmark-stop-'));
    const pids = join(directory, 'pids');
    const record = `require('fs').appendFileSync(${JSON.stringify(pids)}, process.pid + '\\n');`;
    // The measured command records its PID, starts a child that records its own, and both wait forever.
    const child = `${record} ${flood} setInterval(() => {}, 1000);`;
    const command = [process.execPath, '-e', `${record} require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'inherit' }); setInterval(() => {}, 1000);`];
    let started = [];
    t.after(() => {
      for (const pid of started) if (alive(pid)) process.kill(pid, 'SIGKILL');
      rmSync(directory, { recursive: true, force: true });
    });
    assert.throws(() => measureOnce(command, directory, false, 5_000), (error) => error.code === code);
    // Only real PIDs: a 0 or negative one would make the cleanup's kill reach a whole process group.
    started = readFileSync(pids, 'utf8').trim().split('\n').map(Number).filter((pid) => Number.isSafeInteger(pid) && pid > 1);
    assert.equal(started.length, 2, `${code}: both processes started before the run was stopped`);
    for (let waited = 0; waited < 2_000 && started.some(alive); waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(started.filter(alive), [], `${code}: processes the run started are still running`);
  }
});

test('the measured preflight workload has its own frozen time and peak-memory budgets', () => {
  const preflight = { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'First complete local workload measurement.' };
  const withWorkload = { ...config, preflight };
  validateBudgets(withWorkload, structuredClone(withWorkload));
  assert.throws(() => validateBudgets(config, withWorkload), /preflight/);
  assert.throws(() => validateBudgets({ ...config, preflight: { ...preflight, margin: 5 } }, withWorkload), /preflight/);
  const workload = { id: 'preflight', ...preflight };
  const base = { elapsedMs: 100, peakBytes: 1000 };
  assert.equal(compare(workload, base, base, ['elapsedMs', 'peakBytes']).status, 'PASS');
  for (const metric of Object.keys(base)) {
    assert.throws(() => compare(workload, { ...base, [metric]: base[metric] * 2 }, base, ['elapsedMs', 'peakBytes']), new RegExp(metric));
  }
  assert.throws(() => compare(workload, { elapsedMs: 300_000, peakBytes: 1000 }, null, ['elapsedMs', 'peakBytes']), /elapsedMs/);
});

test('an established harness budget cannot disappear or change, so it can never switch its lane off', () => {
  const harness = { limits: { sessionMs: 60_000, wholeMs: 600_000 }, margin: 1, initialReason: 'First harness measurement in issue #48.' };
  const withHarness = { ...config, harness };
  validateBudgets(withHarness, null);
  validateBudgets(withHarness, structuredClone(withHarness));
  assert.throws(() => validateBudgets(config, withHarness), /harness/);
  for (const change of [{ margin: 5 }, { limits: { sessionMs: 120_000, wholeMs: 600_000 } }, { initialReason: 'Reset' }])
    assert.throws(() => validateBudgets({ ...config, harness: { ...harness, ...change } }, withHarness), /harness/);
});

// The design names three reference Macs (design: The reference Mac). A budget counts on any of them;
// anywhere else it is a reading, and the reason names every machine.
test('a budget counts on any reference Mac and is a reading on any other', () => {
  const conditions = { power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '23H723' };
  const pro = { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, ...conditions };
  const air = { model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30, ...conditions };
  const max = { model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 64 * 2 ** 30, ...conditions };
  const within = [90, 92, 95, 91, 99], over = [110, 111, 110, 112, 111];
  for (const machine of [pro, air, max]) {
    assert.equal(judgeLimit({ limit: 100, runs: within, fingerprint: machine }).status, 'PASS', machine.model);
    assert.equal(judgeLimit({ limit: 100, runs: over, fingerprint: machine }).status, 'FAIL', machine.model);
  }
  // The Air's chip with the Pro's memory, or the other way round, is neither machine.
  // So is the M5 Max's model with an M3's chip or memory.
  for (const mixed of [{ ...air, memoryBytes: pro.memoryBytes }, { ...pro, chip: air.chip }, { ...air, model: 'Mac15,13' },
    { ...max, chip: pro.chip }, { ...max, memoryBytes: pro.memoryBytes }]) {
    const result = judgeLimit({ limit: 100, runs: within, fingerprint: mixed });
    assert.equal(result.status, 'INCONCLUSIVE', JSON.stringify(mixed));
    assert.match(result.reason, /Mac15,7/);
    assert.match(result.reason, /Mac15,12/);
    assert.match(result.reason, /Mac17,10/);
  }
  // Conditions still hold on both.
  assert.equal(judgeLimit({ limit: 100, runs: within, fingerprint: { ...air, power: 'battery' } }).status, 'INCONCLUSIVE');
});

// #1404: what the real benches do. Each of these left a parent's child time unaccounted for until it was
// handled, and read as an uncounted child: a bare name walked along PATH, a clean environment, a child
// nothing waits for that finishes in time, and ps, whose count no one can read.
test('a command counts whole however its children were started', { skip: process.platform !== 'darwin' }, () => {
  const cases = {
    'a bare name walked along PATH': "spawnSync('sh', ['-c', ':'], { env: { PATH: '/nonexistent:/also/not:/bin' } })",
    'a clean environment': `spawnSync(process.execPath, ['-e', "require('node:child_process').spawnSync('/usr/bin/true')"], { env: {} })`,
    // Its parent leaves first, so no one is left to reap it: it reports itself, in time for the end of the run.
    'a child nothing waits for': `spawnSync(process.execPath, ['-e', "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { detached: true, stdio: 'ignore' }).unref()"]); await new Promise((done) => setTimeout(done, 3000))`,
    ps: "spawnSync('/bin/ps', ['-p', '1'])",
  };
  for (const [name, script] of Object.entries(cases)) {
    const run = measureOnce([process.execPath, '--input-type=module', '-e', `import { spawn, spawnSync } from 'node:child_process'; ${script};`], process.cwd());
    assert.equal(run.status, 0, `${name}: ${run.output}`);
    assert.deepEqual(run.uncounted, [], name);
    assert.ok(run.instructions > 0, `${name}: ${run.instructions}`);
  }
});
