import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const ISSUE_READINGS = Object.freeze({ load: 57, cores: 18, memory: 50e9 });
export const POOL = ISSUE_READINGS.cores - 1;
export const TURNS = 13;
export const DEALT_WITHIN_MS = 10_000;
export const STAYS_MS = 5_000;

const STUB = `import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const [name, mode, arg] = process.argv.slice(2);
const dir = process.env.T3698_DIR;
const note = (event, more = {}) => appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({ name, event, at: Date.now(), pid: process.pid, ...more }) + '\\n');
note('start', { throttle: process.env.DEEP_THROTTLE ?? null, makeflags: process.env.CARGO_MAKEFLAGS ?? null });
const end = (status = 0) => { note('end'); process.exit(status); };
const stopped = () => existsSync(join(dir, name + '.stop')) || existsSync(join(dir, 'all.stop'));
if (mode === 'hold') setInterval(() => { if (stopped()) end(); }, 50);
else if (mode === 'drive') {
  const steps = JSON.parse(readFileSync(arg, 'utf8')).map((step, k) => ({ ...step, k, asked: false }));
  const env = { ...process.env };
  delete env.DEEP_THROTTLE_RUN;
  let live = 0;
  setInterval(() => {
    for (const step of steps) {
      if (step.asked || (step.go && !existsSync(join(dir, step.go + '.go')))) continue;
      step.asked = true;
      live += 1;
      const child = spawn(step.argv[0], step.argv.slice(1), { env, stdio: 'inherit' });
      note('asked', { step: step.k, job: step.name, child: child.pid ?? null });
      let over = false;
      const answer = (status) => { if (!over) { over = true; live -= 1; note('answered', { step: step.k, job: step.name, status }); } };
      child.on('error', (error) => answer('could not start: ' + error.message));
      child.on('exit', (status, signal) => answer(status ?? signal));
    }
    if (stopped() && !live) end();
  }, 25);
} else { note('unknown mode ' + mode); process.exit(2); }
`;

const UNSET = /^(?:DEEP_|NODE_TEST_CONTEXT$|CARGO_MAKEFLAGS$|MAKEFLAGS$|MFLAGS$)/;

export function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3698-')));
  const table = join(dir, 'table'), home = join(dir, 'home');
  for (const folder of [table, home, join(dir, 'tmp')]) mkdirSync(folder);
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  writeFileSync(join(dir, 'events.jsonl'), '');
  const readings = join(dir, 'readings.json');
  writeFileSync(`${readings}.tmp`, JSON.stringify(ISSUE_READINGS));
  renameSync(`${readings}.tmp`, readings);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !UNSET.test(name)));
  Object.assign(env, { HOME: home, XDG_CACHE_HOME: join(home, '.cache'), TMPDIR: join(dir, 'tmp'), DEEP_THROTTLE_TABLE: table, DEEP_THROTTLE_READINGS: readings, T3698_DIR: dir });
  const box = { dir, table, home, env, stub: join(dir, 'stub.mjs'), children: [], watchers: [] };
  t.after(async () => {
    for (const watcher of box.watchers) clearInterval(watcher);
    try { writeFileSync(join(dir, 'all.stop'), ''); } catch {}
    await until(() => box.children.every((child) => !running(child)), 5_000);
    for (const child of box.children) stopGroup(child);
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

export function stopGroup(child) {
  if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

const words = (box, argv) => argv.map((word) => (word === process.execPath ? 'node' : word === THROTTLE ? 'throttle.mjs' : word === box.stub ? 'stub.mjs' : redact(box, word))).join(' ');

function start(box, argv, { env = {}, label = words(box, argv) } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd: box.dir, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.on('error', (error) => { out += `could not start: ${error.message}\n`; child.status ??= 'no start'; child.ended ??= Date.now(); });
  child.on('close', (status, signal) => { child.status = status ?? signal; child.ended = Date.now(); });
  return Object.assign(child, { label, output: () => out });
}
export const running = (child) => child.ended === undefined;

const stubCommand = (box, name, mode, ...rest) => [process.execPath, box.stub, name, mode, ...rest];
const throttleArgv = (cls, options, command) => [process.execPath, THROTTLE, cls, ...options, '--', ...command];

export function admittedRun(box, name, jobs) {
  const file = join(box.dir, `${name}.steps.json`);
  writeFileSync(file, JSON.stringify(jobs.map((job) => ({ name: job.name, go: job.go, argv: throttleArgv('test', ['--wait', '10'], stubCommand(box, job.name, 'hold')) }))));
  const argv = throttleArgv('test', ['--wait', '1'], stubCommand(box, name, 'drive', file));
  return start(box, argv, { env: { DEEP_THROTTLE_RUN: '0' }, label: `DEEP_THROTTLE_RUN=0 ${words(box, argv)}` });
}

export const release = (box, name) => writeFileSync(join(box.dir, `${name}.go`), '');

const jsonLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
}) : []);
export const notes = (box) => jsonLines(join(box.dir, 'events.jsonl'));
export const startOf = (box, name) => notes(box).find((e) => e.name === name && e.event === 'start');
export const askedJob = (box, job) => notes(box).find((e) => e.event === 'asked' && e.job === job);
export const tableLog = (box) => jsonLines(join(box.table, 'log'));
export const turnGrants = (box) => tableLog(box).filter((e) => e.event === 'turn').sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

function readTable(box) {
  try {
    return JSON.parse(readFileSync(join(box.table, 'table.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function watchTable(box) {
  const readings = [];
  const read = () => {
    const table = readTable(box);
    if (!table) return;
    const turns = table.grants.filter((grant) => grant.class === 'turn').map((grant) => ({ id: grant.id, pid: grant.pid, lent: grant.lent ?? 0 }));
    const waiting = table.requests.filter((request) => request.class === 'turn').map((request) => ({ id: request.id, pid: request.pid }));
    readings.push({ at: Date.now(), turns, waiting, dealt: turns.reduce((sum, turn) => sum + 1 + turn.lent, 0) });
  };
  read();
  // deadline: the criteria's readings of the table, every 20 ms until the test ends.
  box.watchers.push(setInterval(read, 20));
  return readings;
}

export function settledAt(readings, want) {
  let k = readings.length;
  while (k > 0 && readings[k - 1].dealt === want) k -= 1;
  return k < readings.length ? readings[k] : null;
}

export const spread = (reading) => (reading.turns.length ? Math.max(...reading.turns.map((turn) => turn.lent)) - Math.min(...reading.turns.map((turn) => turn.lent)) : 0);
export const lentOf = (reading) => reading.turns.map((turn) => turn.lent).sort((a, b) => b - a).join(',');

export function story(readings, since) {
  const steps = [];
  for (const reading of readings) {
    const shown = `+${((reading.at - since) / 1000).toFixed(2)} s: ${reading.turns.length} turns, ${reading.waiting.length} waiting, Σ(1 + lent) ${reading.dealt}, lent [${lentOf(reading)}]`;
    const key = shown.replace(/^[^:]*: /, '');
    if (steps.at(-1)?.key !== key) steps.push({ key, shown });
  }
  const lines = steps.map((step) => step.shown);
  return lines.length > 40 ? [...lines.slice(0, 10), `… ${lines.length - 30} more changes …`, ...lines.slice(-20)].join('\n') : lines.join('\n');
}

export async function thirteenTurns(box, t, extra = []) {
  const jobs = Array.from({ length: TURNS }, (_, k) => ({ name: `job-${k + 1}` }));
  const readings = watchTable(box);
  const run = admittedRun(box, 'run', [...jobs, ...extra]);
  const all = () => dump(box, run);
  await until(() => turnGrants(box).length >= TURNS || !running(run), 180_000);
  const grants = turnGrants(box);
  assert.ok(grants.length >= TURNS, `only ${grants.length} of the run's ${TURNS} jobs got a turn on a pool of ${POOL} tokens (18 cores) within 180 s: the others waited for a turn the lent tokens never freed\nthe turns' lent:\n${story(readings, readings[0]?.at ?? Date.now())}\n${all()}`);
  const thirteenth = Date.parse(grants[TURNS - 1].at);
  t.diagnostic(`the thirteenth turn was granted ${((thirteenth - Date.parse(grants[0].at)) / 1000).toFixed(2)} s after the first`);
  return { run, readings, thirteenth, all };
}

export async function until(check, ms) {
  const over = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > over) return false;
    // deadline: polls its condition until its bound, so it can only turn a hang into a failure.
    await new Promise((done) => setTimeout(done, 25));
  }
}

export function redact(box, text) {
  let out = String(text);
  for (const [path, name] of [[box.home, '~'], [box.dir, '<sandbox>'], [CHECKOUT, '<checkout>'], [homedir(), '~'], [realpathSync(tmpdir()), '<tmp>'], [tmpdir(), '<tmp>']]) {
    if (path.length < 2) continue;
    out = out.replaceAll(`/private${path}`, name).replaceAll(path, name).replaceAll(path.replace(/^\/private/, ''), name);
  }
  return out;
}

export function dump(box, ...children) {
  const tail = (text, size) => (text.length > size ? `…${text.slice(-size)}` : text);
  return redact(box, [
    `log:\n${tail(tableLog(box).map((e) => JSON.stringify(e)).join('\n'), 4_000)}`,
    ...children.flat().filter(Boolean).map((child) => `${child.label}: ${running(child) ? 'still running' : `exit ${child.status}`}\n${tail(child.output(), 2_000)}`),
  ].join('\n'));
}
