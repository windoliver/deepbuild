// #2848, redrafted for #3221: a build in a long affected.mjs run gets its full compile share, or the run says it cannot,
// even after a jobserver client holding tokens was SIGKILLed earlier in the run; and its jobserver never holds more than
// that share. Under #3221 (docs/parallel-proof.md sections 6, 7a and 13) a build's jobserver is its job's own pipe, which
// starts empty and is lent tokens each second from the machine's pool of job tokens (a core less one, the cores being a
// test's own table's readings'), up to an even share: the pool over the turns held, less the turn's own. Written blind
// from issue #2848, that design text, AGENTS.md and the base's tests/acceptance/2848, at base f8c6cff82 (README).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CHECKOUT, dump, sandbox, summary, tree } from '../1115/helpers.mjs';
import { start } from '../2574/helpers.mjs';

// The run's table is the test's own and reads these cores (DEEP_THROTTLE_READINGS), so its pool is theirs less one,
// whatever this machine has. A job alone on the pool, as the later one is, holds one turn, so its share is the pool less
// that turn. With two turns held each job's share is 5, room for the 2 and 3 tokens the planted clients take.
const CORES = 13;
const POOL = CORES - 1;
const SHARE = POOL - 1;
// Tokens the SIGKILLed client holds when it dies, and tokens a live job holds across that death.
const KILLED = 3;
const HELD = 2;
// The most a planted reader takes: past the pool, so a pipe topped up without end still ends its count.
const CAP = 4 * POOL;
const RUN_MS = 40 * 60_000;
// How long a planted file waits for its partner; how long the live holder lets the pool settle after the killed
// client's job has ended; how long a reader waits for a token before it stops; and how long a count waits with none.
const WAIT_MS = 15 * 60_000;
const SETTLE_MS = 10_000;
const FILL_MS = 120_000;
const QUIET_MS = 5_000;

// The planted files' shared part: the job's jobserver fifo, as CARGO_MAKEFLAGS names it to cargo, a record, and a
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

// The live holder (vitest, parallel block): takes HELD tokens from its job's pipe and keeps them while the killed
// client's job runs and ends, lets the pool settle, then counts what else its pipe was lent, and gives everything back.
const holder = `import { test } from 'vitest';
${PRELUDE}
test('a live job holds tokens while another job\\'s client is SIGKILLed, then counts its pipe', async () => {
  if (!fifo) return note({ event: 'holder', error: 'no jobserver' });
  const fd = pipe();
  const held = await take(fd, ${HELD}, ${FILL_MS});
  note({ event: 'held', count: held.length });
  const killed = await until(() => notes().find((e) => e.event === 'killed'), ${WAIT_MS});
  if (!killed) { writeSync(fd, held); return note({ event: 'holder', error: 'the killed client never died' }); }
  // The killed client's job is its node --test runner, the planted file's parent: wait for it to end, then settle.
  const ended = await until(() => { try { process.kill(killed.ppid, 0); return false; } catch { return true; } }, ${WAIT_MS});
  await sleep(${SETTLE_MS});
  const free = await take(fd, ${CAP} - held.length, ${QUIET_MS});
  note({ event: 'counted', held: held.length, free: free.length, jobEnded: ended });
  writeSync(fd, Buffer.concat([held, free]));
}, ${WAIT_MS * 3});
`;

// The killed client (node --test, parallel block): once the holder holds its tokens, starts a jobserver client that opens
// its job's pipe as cargo does (read and write), reads KILLED tokens and keeps them, as a compiling cargo does, and
// SIGKILLs it, as a timed-out test's spawnSync or a stopped job's tree kill does.
const killer = `import { spawn } from 'node:child_process';
import test from 'node:test';
${PRELUDE}
const CLIENT = "const fs = require('node:fs'); const [fifo, want] = process.argv.slice(1); const fd = fs.openSync(fifo, 'r+'); const buf = Buffer.alloc(1); for (let k = 0; k < Number(want); k += 1) fs.readSync(fd, buf, 0, 1, null); console.log('held ' + want); setInterval(() => {}, 60000);";
test('a jobserver client holding tokens is SIGKILLed', async () => {
  if (!fifo) return note({ event: 'killer', error: 'no jobserver' });
  const held = await until(() => notes().find((e) => e.event === 'held'), ${WAIT_MS});
  if (!held) return note({ event: 'killer', error: 'the holder never held its tokens' });
  const client = spawn(process.execPath, ['-e', CLIENT, fifo, '${KILLED}'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  client.stdout.on('data', (chunk) => { out += chunk; });
  const read = await until(() => out.includes('held'), ${FILL_MS});
  note({ event: 'client-held', client: client.pid, count: read ? ${KILLED} : 0 });
  const exited = new Promise((done) => client.on('close', (status, signal) => done(signal)));
  client.kill('SIGKILL');
  note({ event: 'killed', client: client.pid, signal: await exited });
});
`;

// The later build (node --test, alone block, run in the worktree after the parallel block, alone on the pool): waits
// for its pipe to fill to the share, as the pool lends each second, then takes whatever more it is lent until its pipe
// stays empty, counts it, and gives it back.
const later = `import test from 'node:test';
${PRELUDE}
test('a later job counts its pipe\\'s tokens', async () => {
  if (!fifo) return note({ event: 'later', free: null });
  const fd = pipe();
  const filled = await take(fd, ${SHARE}, ${FILL_MS});
  const more = await take(fd, ${CAP} - filled.length, ${QUIET_MS});
  note({ event: 'later', free: filled.length + more.length });
  writeSync(fd, Buffer.concat([filled, more]));
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

test('#2848 AC: a later build in an affected.mjs run gets its full compile share, or the run says it cannot, after a jobserver client holding tokens was SIGKILLed earlier in the run', { timeout: RUN_MS + 5 * 60_000 }, async (t) => {
  const box = sandbox(t);
  // No job count, jobserver or throttle setting reaches the run from this process: its pipes and pool are the code under test's.
  for (const name of Object.keys(box.env)) if (/^(?:CARGO_|MAKEFLAGS$|MFLAGS$|DEEP_THROTTLE)/.test(name)) delete box.env[name];
  const LATER = `${aloneFolder('fixture-2848-later.test.mjs')}fixture-2848-later.test.mjs`;
  const files = { 'tests/fixture-2848/holder.test.ts': holder, 'tests/fixture-2848/killer.test.mjs': killer, [LATER]: later };
  const fixture = tree(box, files);
  const tmp = join(box.dir, 'tmp');
  mkdirSync(tmp);
  const readings = join(box.dir, 'readings.json');
  writeFileSync(readings, JSON.stringify({ memory: 2 ** 40, load: 0, cores: CORES }));
  const record = join(box.dir, 'record.jsonl');
  const env = { ...fixture.env, TMPDIR: tmp, DEEP_SHARDS: '1', DEEP_THROTTLE_TABLE: join(box.dir, 'throttle'), DEEP_THROTTLE_READINGS: readings, T2848_RECORD: record };
  const child = start(box, { cwd: fixture.cwd, env }, Object.keys(files));
  let run, timer;
  try {
    run = await Promise.race([child.done, new Promise((done) => { timer = setTimeout(() => done(null), RUN_MS); })]); // deadline: bounds the run so a hang fails the test instead of hanging it
  } finally {
    clearTimeout(timer);
  }
  const events = lines(record);
  const all = `the pool: ${POOL} tokens on the readings' ${CORES} cores; a lone job's share: ${SHARE}\nrecord:\n${events.map((e) => JSON.stringify(e)).join('\n')}\n${run ? dump(run) : `stdout so far:\n${child.out().slice(-2_500)}`}`;
  assert.ok(run, `affected.mjs did not end within ${RUN_MS / 60_000} min\n${all}`);

  const find = (event) => events.find((e) => e.event === event);
  const held = find('held'), clientHeld = find('client-held'), killed = find('killed'), counted = find('counted'), late = find('later');
  const pipes = new Set([held?.fifo, clientHeld?.fifo].filter(Boolean)).size;
  t.diagnostic(`tokens: the live job held ${counted?.held ?? 'none'} and its pipe was lent ${counted?.free ?? 'no'} more after the killed client's job ended (in all ${counted ? counted.held + counted.free : 'none'}); the later job's pipe was lent ${late ? late.free ?? 'no jobserver' : 'nothing (it never ran)'}; a lone job's share is ${SHARE}, the pool ${POOL} on the readings' ${CORES} cores`);
  t.diagnostic(`pipes: the live job and the killed client's job ${pipes === 1 ? 'were handed one jobserver' : pipes === 2 ? 'each had a pipe of its own' : 'were not both handed a jobserver'}`);
  t.diagnostic(`the run's summary: ${run && summary(run.stdout) ? summary(run.stdout) : 'none'}`);
  // What the run said of its jobserver or pool, which the output's tail in a failure message can miss.
  const said = (run?.stdout ?? '').split('\n').filter((line) => /^(?:BLOCKED|INCONCLUSIVE|JOBSERVER)\b/.test(line) && / affected: /.test(line) === false);
  t.diagnostic(`the run's BLOCKED, INCONCLUSIVE and JOBSERVER lines: ${said.length ? said.join(' | ') : 'none'}`);

  // The run did what the criterion needs, or the counts below prove nothing: a client of a job's jobserver held tokens
  // and was SIGKILLed while another job of the run held tokens of its own pipe, and a later job ran after.
  const errors = events.filter((e) => e.error);
  assert.ok(!errors.length, `a planted file could not do its part: ${errors.map((e) => `${e.event}: ${e.error}`).join('; ')}\n${all}`);
  assert.equal(held?.count, HELD, `the live job took ${held?.count ?? 'no'} tokens from its jobserver, not ${HELD}\n${all}`);
  assert.equal(clientHeld?.count, KILLED, `the planted client took ${clientHeld?.count ?? 'no'} tokens from its job's jobserver, not ${KILLED}\n${all}`);
  assert.equal(killed?.signal, 'SIGKILL', `the planted client holding tokens was not SIGKILLed (it ended by ${killed?.signal ?? 'nothing'})\n${all}`);
  assert.notEqual(held.fifo, clientHeld.fifo, `two jobs of the run running at once were handed one jobserver (${held.fifo}), not each a pipe of its own lent from the pool\n${all}`);
  assert.ok(counted?.jobEnded, `the killed client's job never ended while the live job held its tokens\n${all}`);
  assert.ok(late, `the later job never ran\n${all}`);
  assert.ok(late.at > counted.at && late.cwd === fixture.cwd, `the later job ran ${late.cwd === fixture.cwd ? 'before the parallel block ended' : `in ${late.cwd}, not the worktree, so the run had a shard`}\n${all}`);

  // Never more than the share: with the killed client's job ended the live job is alone on the pool, so what it holds and
  // what its pipe was lent besides are at most a lone job's share. A pipe topped up whatever its job's builds hold fails.
  assert.ok(counted.held + counted.free <= SHARE, `while the live job held ${counted.held} tokens its pipe was lent ${counted.free} more, ${counted.held + counted.free} in all, more than a lone job's share of ${SHARE} (the pool of ${POOL} less its turn): it was topped up while its build still held tokens\n${all}`);
  assert.ok(late.free !== null, `the later job got no jobserver (CARGO_MAKEFLAGS: ${late.makeflags ?? 'unset'})\n${all}`);
  assert.ok(late.free <= SHARE, `the later job's pipe was lent ${late.free} tokens, more than a lone job's share of ${SHARE} (the pool of ${POOL} less its turn)\n${all}`);
  const told = /^(?:BLOCKED|INCONCLUSIVE) /.test(summary(run.stdout))
    && `${run.stdout}\n${run.stderr}`.split('\n').some((line) => /^(?:BLOCKED|INCONCLUSIVE)\b/.test(line) && /jobserver|pool|token/i.test(line));
  assert.ok(late.free === SHARE || told, `the later job's pipe was lent ${late.free} tokens, not a lone job's share of ${SHARE} (the pool of ${POOL} on the readings' ${CORES} cores, less its turn), after a client holding ${KILLED} was SIGKILLed earlier in the run, and the run did not say it cannot give the share (${summary(run.stdout) || 'no summary'})\n${all}`);
});
