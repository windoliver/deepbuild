import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const THROTTLE = join(CHECKOUT, 'scripts/throttle.mjs');
export const ISSUE_READINGS = Object.freeze({ load: 57, cores: 18, memory: 50e9 });
export const POOL = ISSUE_READINGS.cores - 1;
export const TEST_CEILING = process.platform === 'darwin' ? 2 : 6;

const STUB = `import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const [name, mode, arg] = process.argv.slice(2);
const dir = process.env.T3694_DIR;
const note = (event, more = {}) => appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({ name, event, at: Date.now(), pid: process.pid, ...more }) + '\\n');
note('start', { throttle: process.env.DEEP_THROTTLE ?? null, makeflags: process.env.CARGO_MAKEFLAGS ?? null });
const end = (status = 0) => { note('end'); process.exit(status); };
const stopped = () => existsSync(join(dir, name + '.stop')) || existsSync(join(dir, 'all.stop'));
if (mode === 'exit') end();
else if (mode === 'hold') setInterval(() => { if (stopped()) end(); }, 50);
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

export function sandbox(t, value = ISSUE_READINGS) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3694-')));
  const table = join(dir, 'table'), home = join(dir, 'home');
  for (const folder of [table, home, join(dir, 'tmp')]) mkdirSync(folder);
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  writeFileSync(join(dir, 'events.jsonl'), '');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !UNSET.test(name)));
  Object.assign(env, { HOME: home, XDG_CACHE_HOME: join(home, '.cache'), TMPDIR: join(dir, 'tmp'), DEEP_THROTTLE_TABLE: table, T3694_DIR: dir });
  const box = { dir, table, home, env, stub: join(dir, 'stub.mjs'), children: [] };
  writeReadings(box, value);
  t.after(async () => {
    try { writeFileSync(join(dir, 'all.stop'), ''); } catch {}
    await until(() => box.children.every((child) => !running(child)), 5_000);
    for (const child of box.children) stopGroup(child);
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

export function writeReadings(box, value) {
  const file = join(box.dir, 'readings.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
  box.env.DEEP_THROTTLE_READINGS = file;
}

export function stopGroup(child) {
  if (Number.isInteger(child.pid) && child.pid > 1) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

const words = (box, argv) => argv.map((word) => (word === process.execPath ? 'node' : word === THROTTLE ? 'throttle.mjs' : word === box.stub ? 'stub.mjs' : redact(box, word))).join(' ');

export function start(box, argv, { env = {}, label = words(box, argv) } = {}) {
  const asked = Date.now();
  const child = spawn(argv[0], argv.slice(1), { cwd: box.dir, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.on('error', (error) => { out += `could not start: ${error.message}\n`; child.status ??= 'no start'; child.ended ??= Date.now(); });
  child.on('close', (status, signal) => { child.status = status ?? signal; child.ended = Date.now(); });
  return Object.assign(child, { label, asked, output: () => out, named: `\`${label}\` (throttle pid ${child.pid})` });
}
export const running = (child) => child.ended === undefined;

export const stubCommand = (box, name, mode, ...rest) => [process.execPath, box.stub, name, mode, ...rest];
export const throttleArgv = (cls, options, command) => [process.execPath, THROTTLE, cls, ...options, '--', ...command];

export const plainTest = (box, name, wait, mode = 'exit') => start(box, throttleArgv('test', ['--wait', wait], stubCommand(box, name, mode)));
export const topLevelBuild = (box, name, wait, mode = 'hold') => start(box, throttleArgv('build', ['--wait', wait], stubCommand(box, name, mode)));
export const timedRequest = (box, name, wait) => start(box, throttleArgv('timed', ['--wait', wait], stubCommand(box, name, 'exit')));

export function admittedRun(box, name, jobs = []) {
  const file = join(box.dir, `${name}.steps.json`);
  writeFileSync(file, JSON.stringify(jobs.map((job) => ({ name: job.name, go: job.go, argv: throttleArgv('test', ['--wait', '10'], stubCommand(box, job.name, 'hold')) }))));
  const argv = throttleArgv('test', ['--wait', '1'], stubCommand(box, name, jobs.length ? 'drive' : 'hold', ...(jobs.length ? [file] : [])));
  return start(box, argv, { env: { DEEP_THROTTLE_RUN: '0' }, label: `DEEP_THROTTLE_RUN=0 ${words(box, argv)}` });
}

export const finish = (box, name) => writeFileSync(join(box.dir, `${name}.stop`), '');
export const release = (box, name) => writeFileSync(join(box.dir, `${name}.go`), '');

const jsonLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
}) : []);
export const notes = (box) => jsonLines(join(box.dir, 'events.jsonl'));
export const startOf = (box, name) => notes(box).find((e) => e.name === name && e.event === 'start');
export const endOf = (box, name) => notes(box).find((e) => e.name === name && e.event === 'end');
export const askedJob = (box, job) => notes(box).find((e) => e.event === 'asked' && e.job === job);
export const tableLog = (box) => jsonLines(join(box.table, 'log'));
export const entryOf = (box, child, event) => tableLog(box).find((e) => e.event === event && e.pid === child.pid);

export async function until(check, ms) {
  const over = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > over) return false;
    await new Promise((done) => setTimeout(done, 25));
  }
}
export async function endedWithin(child, ms) {
  await until(() => !running(child), ms);
  return running(child) ? null : child.status;
}
export const refusedNoGrant = (child) => child.status === 3 && /^INCONCLUSIVE no grant: /m.test(child.output());

export async function sampledInLine(box, want, { ms = 120_000, stopped = () => false } = {}) {
  const file = join(box.table, 'load.log');
  const alive = [];
  let read = jsonLines(file).length, last = 0;
  const over = Date.now() + ms;
  try {
    for (;;) {
      const why = stopped();
      if (why) return { stopped: why };
      for (const sample of jsonLines(file).slice(read)) {
        read += 1;
        const done = alive.shift();
        if (done) stopGroup(done);
        if (sample.waiting && want(sample.waiting)) return { at: Date.now(), waiting: sample.waiting };
      }
      if (Date.now() > over) return {};
      if (alive.length < 4 && Date.now() >= last + 400) {
        alive.push(start(box, [process.execPath, THROTTLE, 'load'], { label: 'throttle.mjs load' }));
        last = Date.now();
      }
      await new Promise((done) => setTimeout(done, 25));
    }
  } finally {
    for (const child of alive) stopGroup(child);
  }
}

export async function holdsStill(check, ms) {
  const over = Date.now() + ms;
  while (Date.now() < over) {
    if (!check()) return false;
    await new Promise((done) => setTimeout(done, 25));
  }
  return check();
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
    `notes:\n${tail(notes(box).map((e) => JSON.stringify(e)).join('\n'), 6_000)}`,
    `log:\n${tail(tableLog(box).map((e) => JSON.stringify(e)).join('\n'), 6_000)}`,
    ...children.flat().filter(Boolean).map((child) => `${child.label}: ${running(child) ? 'still running' : `exit ${child.status}`}\n${tail(child.output(), 2_000)}`),
  ].join('\n'));
}
