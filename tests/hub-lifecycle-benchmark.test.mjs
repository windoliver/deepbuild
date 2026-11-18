// Judge protocol/logic only: synthetic inputs are NOT measurements or budget receipts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../benchmarks/hub-lifecycle.mjs', import.meta.url));
const machine = { model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30,
  power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: 'synthetic-judge-test' };
const limits = { start: 60, stop: 30, 'early-close': 30 };
function report(mode = 'start', lower = 10, upper = lower) {
  return { task: `hub-lifecycle-${mode}`, scenarios: Object.fromEntries(
    (mode === 'start' ? ['start'] : ['stop', 'early-close', 'stubborn']).map(kind => [kind, {
      kind, machine, after: machine,
      environmentLoads: Array.from({ length: 5 }, () => ({ start: 0, end: 0 })),
      rows: Array.from({ length: kind === 'stubborn' ? 1 : 5 }, () => kind === 'stubborn'
        ? { kind, semantic: true, loads: [0, 0] }
        : { kind, lower, upper, limit: limits[kind], loads: [0, 0],
          ...(kind === 'start' ? { readyAfterSpawn: 30, answerAfterSpawn: 31 } : {}) }),
    }])) };
}
function judge(current, base = null, path = entry) {
  const ran = spawnSync(process.execPath, [path, 'judge'], {
    input: JSON.stringify({ current, base }), encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(ran.status, 0, ran.stderr || String(ran.error));
  const result = JSON.parse(ran.stdout.trim().split('\n').at(-1));
  assert.equal(typeof result.targets, 'object');
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
  return result;
}
function nonPass(current, path = entry) {
  const result = judge(current, report(), path);
  assert.ok(['BLOCKED', 'INCONCLUSIVE'].includes(result.status), `missing/invalid data cannot pass: ${JSON.stringify(result)}`);
}

test('public judge requires current evidence, never substitutes the base', () => {
  for (const current of [undefined, null, {}, { task: 'unknown' }, { task: 'hub-lifecycle-start' }]) nonPass(current);
  assert.equal(judge(report(), report('start', 100)).status, 'PASS');
  assert.equal(judge(report('start', 100), report()).status, 'FAIL');
  const ran = spawnSync(process.execPath, [entry, 'judge'], { input: '{', encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(JSON.parse(ran.stdout.trim().split('\n').at(-1)).status, 'BLOCKED');
});

test('all five upper bounds must meet literal targets; only failing lower bounds fail', () => {
  for (const mode of ['start', 'stop']) {
    const limit = limits[mode];
    for (const [lower, upper, expected] of [
      [0, 0, 'PASS'], [limit, limit, 'PASS'], [limit, limit + 0.01, 'INCONCLUSIVE'],
      [limit * 1.05, limit * 1.05, 'INCONCLUSIVE'],
      [limit * 1.05 + 0.01, limit * 1.05 + 0.01, 'FAIL'], [100, 100, 'FAIL'],
      [limit - 1, 100, 'INCONCLUSIVE'],
    ]) {
      const result = judge(report(mode, lower, upper));
      assert.equal(result.status, expected, `${mode}: ${lower}..${upper}`);
      assert.equal(result.targets[mode].limit, limit);
    }
    const mixed = report(mode, limit);
    mixed.scenarios[mode].rows[4].upper++;
    assert.equal(judge(mixed).status, 'INCONCLUSIVE');
    const spread = report(mode, limit * 1.06);
    spread.scenarios[mode].rows[4].lower = spread.scenarios[mode].rows[4].upper = limit * 1.2;
    assert.equal(judge(spread).status, 'INCONCLUSIVE', 'spread, not just the 5% floor, sets the failure margin');
  }
});

test('missing, malformed, negative and unordered readings cannot pass', () => {
  const changes = [
    r => { delete r.scenarios.start; },
    r => { r.scenarios.start.rows = []; },
    r => { r.scenarios.start.rows.pop(); },
    r => { r.scenarios.start.rows.push(r.scenarios.start.rows[0]); },
    r => { r.scenarios.start.rows[0] = null; },
    ...['lower', 'upper', 'limit', 'loads', 'readyAfterSpawn', 'answerAfterSpawn', 'kind'].map(key =>
      r => { delete r.scenarios.start.rows[0][key]; }),
    ...[null, '10', -1, Infinity].flatMap(value => ['lower', 'upper'].map(key =>
      r => { r.scenarios.start.rows[0][key] = value; })),
    r => { r.scenarios.start.rows[0].lower = 11; },
    r => { r.scenarios.start.rows[0].limit = 600; },
    r => { r.scenarios.start.rows[0].answerAfterSpawn = 35.01; },
    r => { r.scenarios.start.rows[0].readyAfterSpawn = 29.99; },
    r => { r.scenarios.start.rows[0].readyAfterSpawn = 32; },
    r => { r.scenarios.start.kind = 'stop'; },
  ];
  for (const change of changes) { const current = report(); change(current); nonPass(current); }
});

test('before/after environment and every sample load must qualify, strictly below cores', () => {
  const changes = [
    ...['machine', 'after', 'environmentLoads'].map(key => r => { delete r.scenarios.start[key]; }),
    ...['model', 'chip', 'memoryBytes', 'power', 'lowPowerMode', 'thermalState', 'macosBuild'].flatMap(key =>
      ['machine', 'after'].map(side => r => { r.scenarios.start[side] = { ...machine, [key]: null }; })),
    ...[null, -1, '0', availableParallelism()].flatMap(value => [
      r => { r.scenarios.start.rows[4].loads[1] = value; },
      r => { r.scenarios.start.environmentLoads[4].end = value; },
    ]),
  ];
  for (const change of changes) { const current = report(); change(current); nonPass(current); }
});

test('stop requires early control EOF and stubborn-peer safety evidence too', () => {
  for (const kind of ['stop', 'early-close', 'stubborn']) {
    const current = report('stop'); delete current.scenarios[kind]; nonPass(current);
  }
  const current = report('stop'); current.scenarios.stubborn.rows[0].semantic = false; nonPass(current);
  const late = report('stop');
  late.scenarios['early-close'].rows.forEach(row => { row.lower = row.upper = 100; });
  assert.equal(judge(late).status, 'FAIL');
});

test('registration names the exact targets/criteria and uses the measured CLI, not --check', () => {
  const tasks = JSON.parse(readFileSync(new URL('../benchmarks/budgets.json', import.meta.url))).tasks;
  for (const [mode, criterion, targets] of [
    ['start', '#2330.c6939f4f', { start: 60 }],
    ['stop', '#2330.c4ac049d', { stop: 30, 'early-close': 30 }],
  ]) {
    const task = tasks.find(t => t.id === `hub-lifecycle-${mode}`);
    assert.ok(task);
    assert.deepEqual(task.command, ['node', 'benchmarks/hub-lifecycle.mjs', mode]);
    assert.deepEqual(task.targets, targets);
    assert.deepEqual(task.criteria, [criterion]);
    assert.equal(task.margin, 0.5);
    assert.deepEqual(task.limits, {});
    assert.match(task.initialReason, /20 samples/);
  }
});

test('the same public-CLI assertions reject planted forced-PASS and lower-bound-pass judges', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-lifecycle-judge-twins-'));
  try {
    let source = readFileSync(entry, 'utf8');
    for (const path of ['../tests/acceptance/2330-redraft/run.mjs', '../scripts/benchmark.mjs']) {
      source = source.replaceAll(`'${path}'`, JSON.stringify(new URL(path, import.meta.url).href));
    }
    const forced = source.replace('return { status, targets, reason:', "return { status: 'PASS', targets, reason:");
    assert.notEqual(forced, source, 'forced-PASS mutation must apply');
    const wrong = join(dir, 'forced-pass.mjs'); writeFileSync(wrong, forced);
    assert.throws(() => nonPass({}, wrong), /missing\/invalid data cannot pass/);
    const optimistic = source.replace('judgeScenario(reading)', "judgeScenario({ ...reading, rows: reading.rows.map(row => ({ ...row, upper: row.lower })) })");
    assert.notEqual(optimistic, source, 'lower-bound-pass mutation must apply');
    writeFileSync(wrong, optimistic);
    assert.throws(() => assert.equal(judge(report('start', 10, 100), null, wrong).status, 'INCONCLUSIVE'), /PASS/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
