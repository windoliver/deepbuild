// #2848: a build in a long affected.mjs run gets the run's full compile share (a token per core less one, less one per
// live shard; docs/parallel-proof.md, "Compiles at once (#2741)"), or the run says it cannot, even after a jobserver
// client holding tokens was SIGKILLed earlier in the run. Written blind from issue #2848, AGENTS.md, the design's
// Dogfooding section and compile job pool text and docs/parallel-proof.md, at base 8005f72fb. This checkout's real
// scripts/ run in a scratch tree made by #1115's helpers, with a HOME of its own (README).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CHECKOUT, dump, sandbox, summary, tree } from '../1115/helpers.mjs';
import { start } from '../2574/helpers.mjs';

const CORES = availableParallelism();
// The run below has no shards (one alone file, DEEP_SHARDS=1), so its share is a token per core less one.
const SHARE = CORES - 1;
// Tokens the SIGKILLed client holds when it dies, and tokens a live job holds across that death.
const KILLED = 3;
const HELD = 2;
const RUN_MS = 40 * 60_000;
// How long a planted file waits for its partner, and how long the live holder lets the run settle after the killed
// client's job has ended before it counts the pipe.
const WAIT_MS = 15 * 60_000;
const SETTLE_MS = 10_000;

// The planted files' shared part: the run's jobserver fifo, as CARGO_MAKEFLAGS names it to cargo, a record, and a
// non-blocking reader that takes tokens from the pipe until it has `want` or has read nothing for `quiet` ms.
const PRELUDE = `import { appendFileSync, constants, existsSync, openSync, readFileSync, readSync, writeSync } from 'node:fs';
const fifo = (process.env.CARGO_MAKEFLAGS ?? '').match(/--jobserver-auth=fifo:(\\S+)/)?.[1] ?? null;
const note = (fields) => appendFileSync(process.env.T2848_RECORD, JSON.stringify({ pid: process.pid, ppid: process.ppid, cwd: process.cwd(), fifo, makeflags: process.env.CARGO_MAKEFLAGS ?? null, at: Date.now(), ...fields }) + '\\n');
const notes = () => (existsSync(process.env.T2848_RECORD) ? readFileSync(process.env.T2848_RECORD, 'utf8').split('\\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const found = predicate();
    if (found || Date.now() > end) return found;
    await sleep(200);
  }
}
async function take(fd, want, quiet) {
  const got = [], buf = Buffer.alloc(256);
  let end = Date.now() + quiet;
  while (got.length < want) {
    let n = 0;
    try { n = readSync(fd, buf, 0, Math.min(buf.length, want - got.length), null); } catch (error) { if (error.code !== 'EAGAIN') throw error; }
    if (n > 0) { got.push(...buf.subarray(0, n)); end = Date.now() + quiet; continue; }
    if (Date.now() > end) break;
    await sleep(100);
  }
  return Buffer.from(got);
}
const pipe = () => openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
`;

// The live holder (vitest, parallel block): takes HELD tokens and keeps them while the killed client's job runs and
// ends, then counts what else the pipe holds, and gives everything it took back.
const holder = `import { test } from 'vitest';
${PRELUDE}
test('a live job holds tokens while another job\\'s client is SIGKILLed, then counts the pipe', async () => {
  if (!fifo) return note({ event: 'holder', error: 'no jobserver' });
  const fd = pipe();
  const held = await take(fd, ${HELD}, 120_000);
  note({ event: 'held', count: held.length });
  const killed = await until(() => notes().find((e) => e.event === 'killed'), ${WAIT_MS});
  if (!killed) { writeSync(fd, held); return note({ event: 'holder', error: 'the killed client never died' }); }
  // The killed client's job is its node --test runner, the planted file's parent: wait for it to end, then settle.
  const ended = await until(() => { try { process.kill(killed.ppid, 0); return false; } catch { return true; } }, ${WAIT_MS});
  await sleep(${SETTLE_MS});
  const free = await take(fd, 1 << 16, 3_000);
  note({ event: 'counted', held: held.length, free: free.length, jobEnded: ended });
  writeSync(fd, Buffer.concat([held, free]));
}, ${WAIT_MS * 3});
`;

// The killed client (node --test, parallel block): once the holder holds its tokens, starts a jobserver client that
// reads KILLED tokens and keeps them, as a compiling cargo does, and SIGKILLs it, as a timed-out test's spawnSync or a
// stopped job's tree kill does.
const killer = `import { spawn } from 'node:child_process';
import test from 'node:test';
${PRELUDE}
const CLIENT = "const fs = require('node:fs'); const [fifo, want] = process.argv.slice(1); const fd = fs.openSync(fifo, 'r'); const buf = Buffer.alloc(1); for (let k = 0; k < Number(want); k += 1) fs.readSync(fd, buf, 0, 1, null); console.log('held ' + want); setInterval(() => {}, 60000);";
test('a jobserver client holding tokens is SIGKILLed', async () => {
  if (!fifo) return note({ event: 'killer', error: 'no jobserver' });
  const held = await until(() => notes().find((e) => e.event === 'held'), ${WAIT_MS});
  if (!held) return note({ event: 'killer', error: 'the holder never held its tokens' });
  const client = spawn(process.execPath, ['-e', CLIENT, fifo, '${KILLED}'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  client.stdout.on('data', (chunk) => { out += chunk; });
  const read = await until(() => out.includes('held'), 120_000);
  note({ event: 'client-held', client: client.pid, count: read ? ${KILLED} : 0 });
  const exited = new Promise((done) => client.on('close', (status, signal) => done(signal)));
  client.kill('SIGKILL');
  note({ event: 'killed', client: client.pid, signal: await exited });
});
`;

// The later build (node --test, alone block, run in the worktree after the parallel block): counts what the pipe holds
// for it, with no other job of the run live, and gives it back.
const later = `import test from 'node:test';
${PRELUDE}
test('a later job counts the run\\'s tokens', async () => {
  if (!fifo) return note({ event: 'later', free: null });
  const fd = pipe();
  const free = await take(fd, 1 << 16, 3_000);
  note({ event: 'later', free: free.length });
  writeSync(fd, free);
});
`;

/** The first folder of lanes.mjs's alone list where a planted node file is in the alone block and in no other list. */
function aloneFolder(name) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href)});
    console.log(JSON.stringify(Object.fromEntries(['alone', 'exclusive', 'timed', 'slow', 'byHand', 'ownLane'].map((name) => [name, lanes[name] ?? []]))));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: CHECKOUT, encoding: 'utf8' });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  const lists = JSON.parse(result.stdout.trim().split('\n').at(-1));
  const covers = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
  const folder = lists.alone.find((entry) => /^tests\/.+\/$/.test(entry) && [...lists.exclusive, ...lists.alone].find((other) => covers([other], `${entry}${name}`)) === entry
    && ![lists.timed, lists.slow, lists.byHand, lists.ownLane].some((list) => covers(list, `${entry}${name}`)));
  assert.ok(folder, 'scripts/lanes.mjs\'s alone list has no folder a planted file runs alone in');
  for (const file of ['tests/fixture-2848/holder.test.ts', 'tests/fixture-2848/killer.test.mjs']) {
    assert.ok(!Object.values(lists).some((list) => covers(list, file)), `${file} is on a lanes.mjs list, so it doesn't run in the parallel block`);
  }
  return folder;
}

const lines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
}) : []);

test('#2848 AC: a later build in an affected.mjs run gets the run\'s full compile share, or the run says it cannot, after a jobserver client holding tokens was SIGKILLed earlier in the run', { timeout: RUN_MS + 5 * 60_000 }, async (t) => {
  assert.ok(SHARE >= KILLED + HELD + 1, `${CORES} cores leave a share of ${SHARE} tokens, too few for this test's ${KILLED} + ${HELD} held tokens`);
  const box = sandbox(t);
  // No job count or jobserver reaches the run from this process: its pipe is the code under test's.
  for (const name of Object.keys(box.env)) if (/^(?:CARGO_|MAKEFLAGS$|MFLAGS$)/.test(name)) delete box.env[name];
  const LATER = `${aloneFolder('fixture-2848-later.test.mjs')}fixture-2848-later.test.mjs`;
  const files = { 'tests/fixture-2848/holder.test.ts': holder, 'tests/fixture-2848/killer.test.mjs': killer, [LATER]: later };
  const fixture = tree(box, files);
  const tmp = join(box.dir, 'tmp');
  mkdirSync(tmp);
  const record = join(box.dir, 'record.jsonl');
  const child = start(box, { cwd: fixture.cwd, env: { ...fixture.env, TMPDIR: tmp, DEEP_SHARDS: '1', T2848_RECORD: record } }, Object.keys(files));
  let run, timer;
  try {
    run = await Promise.race([child.done, new Promise((done) => { timer = setTimeout(() => done(null), RUN_MS); })]); // deadline: bounds the run so a hang fails the test instead of hanging it
  } finally {
    clearTimeout(timer);
  }
  const events = lines(record);
  const all = `the machine's cores: ${CORES}; the run's share: ${SHARE} tokens (no shards)\nrecord:\n${events.map((e) => JSON.stringify(e)).join('\n')}\n${run ? dump(run) : `stdout so far:\n${child.out().slice(-2_500)}`}`;
  assert.ok(run, `affected.mjs did not end within ${RUN_MS / 60_000} min\n${all}`);

  // The run did what the criterion needs, or the counts below prove nothing: a client of the run's jobserver held
  // tokens and was SIGKILLed while another job of the run held tokens of the same pipe, and a later job ran after.
  const find = (event) => events.find((e) => e.event === event);
  const errors = events.filter((e) => e.error);
  assert.ok(!errors.length, `a planted file could not do its part: ${errors.map((e) => `${e.event}: ${e.error}`).join('; ')}\n${all}`);
  const held = find('held'), clientHeld = find('client-held'), killed = find('killed'), counted = find('counted'), late = find('later');
  assert.equal(held?.count, HELD, `the live job took ${held?.count ?? 'no'} tokens from the run's jobserver, not ${HELD}\n${all}`);
  assert.equal(clientHeld?.count, KILLED, `the planted client took ${clientHeld?.count ?? 'no'} tokens from the run's jobserver, not ${KILLED}\n${all}`);
  assert.equal(killed?.signal, 'SIGKILL', `the planted client holding tokens was not SIGKILLed (it ended by ${killed?.signal ?? 'nothing'})\n${all}`);
  assert.equal(held.fifo, clientHeld.fifo, `two jobs of the run running at once were handed different jobservers (${held.fifo}, ${clientHeld.fifo}), not one of the run's\n${all}`);
  assert.ok(counted?.jobEnded, `the killed client's job never ended while the live job held its tokens\n${all}`);
  assert.ok(late, `the later job never ran\n${all}`);
  assert.ok(late.at > counted.at && late.cwd === fixture.cwd, `the later job ran ${late.cwd === fixture.cwd ? 'before the parallel block ended' : `in ${late.cwd}, not the worktree, so the run had a shard`}\n${all}`);

  const told = /^(?:BLOCKED|INCONCLUSIVE) /.test(summary(run.stdout)) && /jobserver/i.test(`${run.stdout}\n${run.stderr}`);
  t.diagnostic(`tokens: the live job held ${counted.held} and found ${counted.free} more free after the killed client's job ended (in all ${counted.held + counted.free}); the later job found ${late.free ?? 'no jobserver'}; the share is ${SHARE} on ${CORES} cores`);
  t.diagnostic(`the run's summary: ${summary(run.stdout) || 'none'}`);
  // Never more than the share: a run that tops its pipe up while a job still holds tokens over-provisions.
  assert.ok(counted.held + counted.free <= SHARE, `while a live job held ${counted.held} tokens the run's jobserver held ${counted.free} more, ${counted.held + counted.free} in all, more than the run's share of ${SHARE}: it was topped up while a build still held tokens\n${all}`);
  assert.ok(late.free !== null, `the later job got no jobserver (CARGO_MAKEFLAGS: ${late.makeflags ?? 'unset'})\n${all}`);
  assert.ok(late.free <= SHARE, `the later job found ${late.free} tokens in the run's jobserver, more than the run's share of ${SHARE}\n${all}`);
  assert.ok(late.free === SHARE || told, `the later job found ${late.free} tokens in the run's jobserver, not the run's share of ${SHARE} (${CORES} cores less one, no shards), after a client holding ${KILLED} was SIGKILLed, and the run did not say it cannot give the share (${summary(run.stdout) || 'no summary'})\n${all}`);
});
