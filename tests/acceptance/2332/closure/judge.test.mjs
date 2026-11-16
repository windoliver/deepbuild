// Self-tests of the judgments and of the harness's own controls. Run: node --test tests/acceptance/2332/closure/
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { childrenOf, judge, judgeMemory, offReference, usableReply } from './judge.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// Pairs at a given current/base ratio with deterministic +-2% noise.
const pairs = (n, ratio, noise = 0.02) => Array.from({ length: n }, (_, i) => ({ base: 4_500_000_000 + i * 1_000_000, current: Math.round((4_500_000_000 + i * 1_000_000) * ratio * (1 + noise * Math.sin(i * 12.9898))) }));
const reference = { model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal' };

test('start to ready: 30% under main passes, 25% is not proven, 20% fails, 19 pairs and missing counts never pass', () => {
  assert.equal(judge(pairs(20, 0.7), 0.75).status, 'PASS');
  assert.equal(judge(pairs(20, 0.75, 0), 0.75).status, 'INCONCLUSIVE');
  assert.equal(judge(pairs(20, 0.8), 0.75).status, 'FAIL');
  assert.equal(judge(pairs(19, 0.5), 0.75).status, 'INCONCLUSIVE');
  assert.equal(judge([...pairs(19, 0.5), { base: 4e9, current: null }], 0.75).status, 'INCONCLUSIVE');
  assert.equal(judge([...pairs(19, 0.5), { base: 4e9, current: 0 }], 0.75).status, 'INCONCLUSIVE');
});

test('one outlier pair moves the sum by its own size: a rise in one of 20 is not a pass', () => {
  const mixed = pairs(20, 0.7);
  mixed[3] = { base: 4_500_000_000, current: 4_500_000_000 * 3 };
  assert.notEqual(judge(mixed, 0.75).status, 'PASS');
});

test('first-hook counts: 0% allowed, so +1% fails where the lane\'s 2% margin would not', () => {
  assert.equal(judge(pairs(20, 1.01, 0.002), 1).status, 'FAIL');
  assert.equal(judge(pairs(20, 0.97, 0.002), 1).status, 'PASS');
  assert.equal(judge(pairs(20, 1, 0), 1).status, 'INCONCLUSIVE');
  assert.equal(judge(pairs(20, 1, 0.05), 1).status, 'INCONCLUSIVE');
});

test('seeded and reproducible', () => {
  const a = judge(pairs(20, 0.97), 1), b = judge(pairs(20, 0.97), 1);
  assert.deepEqual(a, b);
  assert.equal(a.seed, 1405);
  assert.equal(a.pairs, 20);
  assert.ok(a.pBelow > 0 && a.pBelow < 0.01 && typeof a.medianDelta === 'number');
});

test('memory counts only on a named reference Mac on AC, Low Power off, thermal nominal, read per run', () => {
  const runs = Array(40).fill(reference);
  const lower = pairs(20, 0.9, 0.01);
  assert.equal(judgeMemory(lower, runs).status, 'PASS');
  assert.match(judgeMemory(lower, runs.map((fp, i) => (i === 7 ? { ...fp, thermalState: 'fair' } : fp))).reason, /thermal fair/);
  for (const bad of [{ power: 'battery' }, { lowPowerMode: true }, { lowPowerMode: null }, { model: 'MacBookAir10,1' }, { power: null }]) {
    assert.equal(judgeMemory(lower, runs.map((fp, i) => (i === 3 ? { ...fp, ...bad } : fp))).status, 'INCONCLUSIVE');
  }
  assert.equal(judgeMemory(lower, runs.slice(0, 39)).status, 'INCONCLUSIVE');
  assert.equal(judgeMemory(pairs(20, 1.05, 0.01), runs).status, 'FAIL');
  assert.equal(offReference(reference), null);
});

test('a hook reply must be a real reply line, and the guard control must deny', () => {
  assert.equal(usableReply({ exit: 0, stdout: '', stderr: '' }, { exit: 0 }), null);
  assert.match(usableReply({}, { exit: 0 }), /not a hook reply/);
  assert.match(usableReply(undefined), /not a hook reply/);
  assert.match(usableReply({ exit: 0, stdout: '', stderr: '' }, { exit: 2, stderr: 'DeepBuild blocked' }), /exit 0/);
  assert.equal(usableReply({ exit: 2, stdout: '', stderr: 'DeepBuild blocked this: [x] y\n' }, { exit: 2, stderr: 'DeepBuild blocked' }), null);
});

test('the hub\'s children are read apart from its own count', () => {
  const log = ['start 10 11 /usr/bin/git', 'reap 10 11 5000 1 0 0 0 0 0 0 0', 'start 10 12 /bin/sh', 'reap 10 12 700 1 0 0 0 0 0 0 0', 'reap 99 98 123456 1 0', 'exit 10 9000 5 0 0 0 0 0 0 0'].join('\n');
  assert.deepEqual(childrenOf(log, 10), { started: ['/usr/bin/git', '/bin/sh'], reapedCount: 2, instructions: 5700, ownAtExit: 9000, unread: 0 });
  assert.equal(childrenOf('', 10).ownAtExit, null);
});

test('the live counter reads a running process and moves with its work', { skip: process.platform !== 'darwin' && 'macOS counter' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-2332-self-'));
  try {
    execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', join(dir, 'insn'), join(HERE, 'insn.c')]);
    const busy = spawn(process.execPath, ['-e', 'setInterval(() => { for (let i = 0; i < 1e6; i++); }, 20)']);
    await new Promise((done) => setTimeout(done, 300));
    const read = () => Number(spawnSync(join(dir, 'insn'), { input: `${busy.pid}\n`, encoding: 'utf8' }).stdout);
    const [a] = [read()];
    await new Promise((done) => setTimeout(done, 300));
    const b = read();
    busy.kill();
    assert.ok(a > 0, 'a live process has a count');
    assert.ok(b > a + 1_000_000, `count rises with work: ${a} -> ${b}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A fake hub: `answer` false never answers; true replies exit 0 to every call, as a hub that ignores its guards would.
for (const [answer, why] of [[false, /connect ENOENT|no reply/], [true, /did not deny pkill|no ledger|record has no ledger/]]) test(`a no-op hub cannot pass (${answer ? 'allows everything' : 'answers nothing'}): INCONCLUSIVE, exit 2, never PASS`, { skip: process.platform !== 'darwin' && 'macOS counter' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'deep-2332-noop-'));
  try {
    const side = (name) => {
      const dir = join(root, name);
      mkdirSync(join(dir, 'packages/cli/dist'), { recursive: true });
      mkdirSync(join(dir, 'crates/deep-hook'), { recursive: true });
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      mkdirSync(join(dir, 'node_modules'));
      const serve = "const net = require('node:net'), path = require('node:path'), fs = require('node:fs'); const dir = path.join(process.env.HOME, '.deepbuild'); fs.mkdirSync(dir, { recursive: true }); const socket = path.join(dir, 'hub.sock'); net.createServer((c) => { c.write(JSON.stringify({ hello: 1 }) + '\\n'); c.on('data', () => c.write(JSON.stringify({ exit: 0, stdout: '', stderr: '' }) + '\\n')); }).listen(socket, () => console.log(JSON.stringify({ v: 1, ready: true, pid: process.pid, socket })));";
      writeFileSync(join(dir, 'packages/cli/dist/main.js'), answer ? serve : "console.log(JSON.stringify({ v: 1, ready: true, pid: process.pid, socket: '/nonexistent.sock' })); setInterval(() => {}, 1000);\n");
      writeFileSync(join(dir, 'crates/deep-hook/default-rules.json'), '{"v":1,"entries":{}}');
      return dir;
    };
    const [main, candidate] = [side('main'), side('candidate')];
    // The perf lane's own files are the measurement tooling both sides share; a real checkout supplies them.
    const real = join(HERE, '../../../..');
    for (const dir of [main, candidate]) for (const file of ['benchmark.mjs', 'count-children.c']) copyFileSync(join(real, 'scripts', file), join(dir, 'scripts', file));
    const out = join(root, 'out');
    const ran = spawnSync(process.execPath, [join(HERE, 'hub-ready.mjs'), '--main', main, '--candidate', candidate, '--rounds', '2', '--only', 'startup', '--out', out], { encoding: 'utf8', timeout: 120_000 });
    assert.equal(ran.status, 2, ran.stdout + ran.stderr);
    const result = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));
    for (const name of ['startToReady', 'sessionStart', 'prompt', 'preToolUse', 'idleMemory']) assert.equal(result.verdicts[name].status, 'INCONCLUSIVE', name);
    assert.match(result.verdicts.startToReady.reason, /invalid/);
    assert.match(result.verdicts.startToReady.reason, why);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
