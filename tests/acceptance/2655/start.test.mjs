// AC3 #2655: "The main thread's heap after two full collections is at least 0.5 MB under the merge base's (drafted from
// the report's 0.6 MB), and the instructions the hub's own process retires from start to its socket's first answer are
// no more than the merge base's."
//
// Both sides are measured here, in alternated rounds (the side that goes first swaps every round), 20 a side as the
// design's budgets take them (Numbers version 0 has to hold: Every task carries its own budgets):
// - Heap: `deep hub run` under Node's inspector on a fresh home; once it is ready and its socket has answered a
//   connection, the main thread makes two full collections (HeapProfiler.collectGarbage, as benchmarks/hub-churn.mjs
//   forces one) and its heapUsed is read. The medians are compared; 0.5 MB is 0.5 * 2^20 bytes, as
//   packages/hub/test/startup-memory.test.ts counts MB.
// - Instructions: `deep hub run` on a fresh home with nothing attached; a client connects the moment the socket exists,
//   and at the first bytes the hub writes it (its hello) the hub is stopped where it stands (SIGSTOP, by PID) and its own
//   process's instructions retired are read (proc_pid_rusage, the perf lane's counter, through #2332's reader), children
//   apart. Judged as the design judges an instruction count: FAIL when the pairs show the change above the merge base
//   (seeded one-sided sign-flip test, p under 0.01), PASS when they reject "2% or more above" at p under 0.01, and
//   INCONCLUSIVE otherwise. A count that can't be read is missing, never 0, and the comparison is INCONCLUSIVE.
//   DEEP_2655_BASE=<built merge base> node --test tests/acceptance/2655/start.test.mjs
// DEEP_2655_ROUNDS=<n> runs fewer rounds as a sanity run: INCONCLUSIVE at best, FAIL where it already fails.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { counter, flips } from '../2332/measure.mjs';
import { hubEnv, inspector, MB, mb, median, needBase, needChange, sleep, standIns, startHub, tempHome } from './lib.mjs';

const ROUNDS = 20;
const rounds = Number(process.env.DEEP_2655_ROUNDS) || ROUNDS;
const UNDER = 0.5 * MB;

/** The main thread's heap after two full collections, in a hub of `checkout` that is ready and has answered its socket once. */
async function idleHeap(checkout) {
  const hub = await startHub(checkout, { nodeArgs: ['--inspect=127.0.0.1:0'] });
  try {
    await new Promise((done, fail) => {
      const sock = net.connect(hub.socket);
      sock.once('data', () => { sock.destroy(); done(); });
      sock.once('error', (error) => fail(Error(`BLOCKED: the hub's socket didn't answer: ${error.message}`)));
    });
    const insp = await inspector(hub);
    try {
      await sleep(300);
      return await insp.heap();
    } finally { insp.close(); }
  } finally {
    await hub.stop();
  }
}

/** The instructions a hub of `checkout` retired, its own process alone, from its start to its socket's first answer; null when unreadable. */
async function toFirstAnswer(checkout, bin) {
  const home = tempHome('i');
  const socket = join(home, '.deepbuild', 'hub.sock');
  const child = spawn(process.execPath, [join(checkout, 'packages/cli/dist/main.js'), 'hub', 'run'], { cwd: join(home, 'work'), env: hubEnv(home, { PATH: standIns(home) }), stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  try {
    return await new Promise((done, fail) => {
      const deadline = Date.now() + 120_000;
      let over = false;
      child.once('exit', (code, signal) => { over = true; fail(Error(`BLOCKED: the hub of ${checkout} exited ${code ?? signal} before its socket answered: ${stderr.slice(-300)}`)); });
      const attempt = () => {
        if (over) return;
        if (Date.now() > deadline) { over = true; return fail(Error(`BLOCKED: the socket of ${checkout}'s hub gave no answer within 120 s: ${stderr.slice(-300)}`)); }
        // Looked for on every turn of this process's loop, not on a timer: a millisecond's wait here is some ten million
        // instructions of the hub's other threads, counted or not by chance.
        if (!existsSync(socket)) return void setImmediate(attempt);
        const sock = net.connect(socket);
        sock.once('error', () => { sock.destroy(); setImmediate(attempt); });
        sock.once('data', () => {
          if (over) return;
          over = true;
          // Stopped where it stands: the count is of the start up to this answer, and of nothing the hub does after it.
          process.kill(child.pid, 'SIGSTOP');
          sock.destroy();
          const read = spawnSync(bin, [String(child.pid)], { encoding: 'utf8' });
          const count = Number(read.stdout.trim());
          done(read.status === 0 && Number.isSafeInteger(count) && count > 0 ? count : null);
        });
      };
      attempt();
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const gone = new Promise((done) => child.once('exit', done));
      try { process.kill(child.pid, 'SIGCONT'); process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ }
      const timer = setTimeout(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } }, 20_000);
      await gone;
      clearTimeout(timer);
    }
    rmSync(home, { recursive: true, force: true });
  }
}

/** The heap criterion on both sides' readings: the change's median at least 0.5 MB under the merge base's. */
export function judgeHeap(base, change, taken = ROUNDS) {
  if (!base.length || !change.length || [...base, ...change].some((b) => !Number.isSafeInteger(b) || b <= 0)) return { status: 'INCONCLUSIVE', reason: 'a heap reading is missing' };
  const [b, c] = [median(base), median(change)];
  const said = `the main thread's heap after two full collections is ${mb(c)} (median of ${change.length}), the merge base's ${mb(b)}: ${mb(b - c)} under it`;
  if (b - c < UNDER) return { status: 'FAIL', reason: `${said}; at least ${mb(UNDER)} under is required` };
  if (taken < ROUNDS) return { status: 'INCONCLUSIVE', reason: `${said}, over ${taken} rounds where ${ROUNDS} are required` };
  return { status: 'PASS', reason: said };
}
/** The instruction criterion on the paired counts: no more than the merge base's. */
export function judgeInstructions(pairs, taken = ROUNDS) {
  if (!pairs.length || pairs.some((p) => !Number.isSafeInteger(p.main) || p.main <= 0 || !Number.isSafeInteger(p.change) || p.change <= 0)) return { status: 'INCONCLUSIVE', reason: 'an instruction count is missing, so the sides can\'t be compared' };
  const change = median(pairs.map((p) => p.change / p.main - 1));
  const above = flips(pairs, 1, 2655);
  const margin = flips(pairs, 1.02, 2655);
  const said = `from start to the socket's first answer the hub retires ${(change * 100).toFixed(2)}% against the merge base (median of ${pairs.length} pairs; p ${above.pAbove.toPrecision(2)} that it is above, p ${margin.pBelow.toPrecision(2)} that it is under 2% above; seed 2655)`;
  if (above.pAbove < 0.01) return { status: 'FAIL', reason: `${said}; no more than the merge base's is required` };
  if (taken < ROUNDS) return { status: 'INCONCLUSIVE', reason: `${said}, over ${taken} rounds where ${ROUNDS} are required` };
  if (margin.pBelow >= 0.01) return { status: 'INCONCLUSIVE', reason: `${said}: the pairs can't tell it from 2% above` };
  return { status: 'PASS', reason: said };
}
const hold = (verdict) => { if (verdict.status !== 'PASS') throw Error(`${verdict.status === 'FAIL' ? '' : `${verdict.status}: `}${verdict.reason}`); };

test('the judging fails planted numbers: a heap 0.4 MB under, and 3% more instructions; and passes their twins', () => {
  const heaps = (bytes) => Array.from({ length: 20 }, (_, i) => Math.round(bytes) + i * 1000);
  assert.equal(judgeHeap(heaps(20 * MB), heaps(19.6 * MB)).status, 'FAIL');
  assert.equal(judgeHeap(heaps(20 * MB), heaps(19.4 * MB)).status, 'PASS');
  assert.equal(judgeHeap(heaps(20 * MB), heaps(19.4 * MB), 5).status, 'INCONCLUSIVE');
  assert.equal(judgeHeap(heaps(20 * MB), [0]).status, 'INCONCLUSIVE');
  const pairs = (ratio) => Array.from({ length: 20 }, (_, i) => ({ main: 2_000_000_000 + ((i * 7919) % 13) * 1_000_000, change: Math.round((2_000_000_000 + ((i * 104_729) % 13) * 1_000_000) * ratio) }));
  assert.equal(judgeInstructions(pairs(1.03)).status, 'FAIL');
  assert.equal(judgeInstructions(pairs(0.99)).status, 'PASS');
  assert.equal(judgeInstructions(pairs(1)).status, 'PASS');
  assert.equal(judgeInstructions(pairs(0.99), 5).status, 'INCONCLUSIVE');
  assert.equal(judgeInstructions([{ main: 2_000_000_000, change: null }]).status, 'INCONCLUSIVE');
});

/** Both measurements, taken once for the two tests below. */
let measured;
const measure = () => (measured ??= (async () => {
  const sides = { main: needBase(), change: needChange() };
  const c = counter();
  const heaps = { main: [], change: [] };
  const pairs = [];
  let noCount = c.blocked;
  for (let round = 0; round < rounds; round++) {
    const pair = {};
    for (const side of round % 2 ? ['change', 'main'] : ['main', 'change']) {
      heaps[side].push(await idleHeap(sides[side]));
      if (!noCount) pair[side] = await toFirstAnswer(sides[side], c.bin);
    }
    if (!noCount) pairs.push(pair);
  }
  return { heaps, pairs, noCount };
})().then((r) => ({ r }), (error) => ({ error })));

test("AC3 #2655 the main thread's heap after two full collections is at least 0.5 MB under the merge base's", { timeout: 7_200_000 }, async (t) => {
  const { r, error } = await measure();
  if (error) throw error;
  t.diagnostic(`heap after two full collections, bytes: merge base ${JSON.stringify(r.heaps.main)}; change ${JSON.stringify(r.heaps.change)}`);
  const verdict = judgeHeap(r.heaps.main, r.heaps.change, rounds);
  t.diagnostic(`${verdict.status}: ${verdict.reason}`);
  hold(verdict);
});

test("AC3 #2655 the hub's own process retires no more instructions from start to its socket's first answer than the merge base's", { timeout: 7_200_000 }, async (t) => {
  const { r, error } = await measure();
  if (error) throw error;
  if (r.noCount) throw Error(r.noCount.startsWith('BLOCKED') ? r.noCount : `INCONCLUSIVE: ${r.noCount}`);
  t.diagnostic(`instructions retired, start to first answer, per round: ${JSON.stringify(r.pairs)} (proc_pid_rusage ri_instructions of the hub's own process)`);
  const verdict = judgeInstructions(r.pairs, rounds);
  t.diagnostic(`${verdict.status}: ${verdict.reason}`);
  hold(verdict);
});
