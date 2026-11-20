// Issue #2649's readings: which processes one sandboxed run starts, and how soon a fork inside a run is tracked.
// Run from the repo root on macOS with Node 24, after `npm run build --workspaces`:
//   node docs/spikes/2649/measure.mjs starts command-check     one command check (runCommandCheck, a 200-test
//                                                               Vitest project, as benchmarks/command-check.mjs runs
//                                                               it) through the supervisor's sandbox, from the
//                                                               supervisor's open to its close
//   node docs/spikes/2649/measure.mjs starts idle-hour [s]     one sandboxed /bin/sleep of s seconds (3600 unless
//                                                               given) that forks nothing, open to close
//   node docs/spikes/2649/measure.mjs latency [forks]          a sandboxed program forks `forks` children (200 unless
//                                                               given) at random gaps; each fork's time against its
//                                                               process.tracked event's
// `starts` runs the subject under the perf lane's child counter, scripts/count-children.c built as
// scripts/benchmark.mjs builds it, and keeps its log as out/<subject>.counter.log; sites.mjs, loaded into the same
// process, keeps which code started each process as out/<subject>.sites.jsonl (gzipped for idle-hour). `latency` runs with no counter, as a
// hub does, and keeps out/latency.samples.jsonl. Each prints one JSON line: the date, main's commit, the machine, the
// load averages before and after, and what it kept.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const HERE = join(REPO, 'docs/spikes/2649');
const OUT = join(HERE, 'out');
const [mode, subject, arg] = process.argv.slice(2);
const phase = (name) => { globalThis.__phase2649 = name; };

async function openAll(dir) {
  const { openAsks } = await import('../../../packages/asks/dist/index.js');
  const { openRecord } = await import('../../../packages/record/dist/index.js');
  const { openSupervisor } = await import('../../../packages/supervisor/dist/index.js');
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
  return { record, sup };
}

// ---- Inside the measured process.

async function innerCommandCheck(dir) {
  const { runCommandCheck } = await import('../../../packages/checks-command/dist/index.js');
  phase('open');
  const { record, sup } = await openAll(dir);
  const run = 'run:SPIKE2649C';
  phase('run');
  const r = await runCommandCheck({
    host: sup, run, checkout: join(dir, 'project'), deadline: 600_000,
    spec: { kind: 'command', runner: 'node_modules/.bin/vitest run', inputs: [], depth: 'unit', oracle: 'code', contract: null },
  });
  phase('cleanup');
  await sup.cleanup(run);
  phase('close');
  await sup.close();
  await record.close();
  if (r.outcome !== 'passed' || r.testsRun !== 200) throw Error(`the check ended ${r.outcome} with ${r.testsRun} tests`);
  return { outcome: r.outcome, testsRun: r.testsRun };
}

async function innerIdle(dir, seconds) {
  phase('open');
  const { record, sup } = await openAll(dir);
  const run = 'run:SPIKE2649I';
  phase('run');
  const t0 = Date.now();
  const started = await sup.start({ run, cwd: dir, argv: ['/bin/sleep', String(seconds)] });
  if (started.status !== 'started') throw Error(`didn't start: ${JSON.stringify(started)}`);
  const exit = await sup.wait(run);
  const durationSeconds = (Date.now() - t0) / 1000;
  phase('cleanup');
  await sup.cleanup(run);
  phase('close');
  await sup.close();
  await record.close();
  if (exit.code !== 0) throw Error(`sleep exited ${exit.code}`);
  return { durationSeconds };
}

// ---- The forker the latency run sandboxes: forks children at random gaps of 20 to 260 ms, so each lands at an even
// chance anywhere in the scan's 100 ms beat, each living 2 s, longer than any scan takes to find it.
const FORKER = `
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const [forks, out] = process.argv.slice(2);
const kids = [];
for (let i = 0; i < Number(forks); i++) {
  await new Promise((done) => setTimeout(done, 20 + Math.random() * 240));
  const forkedAtMs = Date.now();
  const child = spawn('/bin/sleep', ['2'], { stdio: 'ignore' });
  appendFileSync(out, JSON.stringify({ pid: child.pid, forkedAtMs }) + '\\n');
  kids.push(new Promise((done) => child.on('exit', done)));
}
await Promise.all(kids);
`;

async function latency(forks) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2649-latency-')));
  const before = loadavg();
  try {
    writeFileSync(join(dir, 'forker.mjs'), FORKER);
    const forked = join(dir, 'forked.jsonl');
    writeFileSync(forked, '');
    const { record, sup } = await openAll(dir);
    const run = 'run:SPIKE2649L';
    const started = await sup.start({ run, cwd: dir, argv: [process.execPath, join(dir, 'forker.mjs'), String(forks), forked], grant: { read: [dirname(dirname(process.execPath))], write: [dir] } });
    if (started.status !== 'started') throw Error(`didn't start: ${JSON.stringify(started)}`);
    const exit = await sup.wait(run);
    await sup.cleanup(run);
    const tracked = new Map((await record.raw("SELECT ts, data FROM events WHERE kind = 'process.tracked' AND subject = ?", [run])).map(({ ts, data }) => [JSON.parse(data).pid, ts]));
    await sup.close();
    await record.close();
    if (exit.code !== 0) throw Error(`the forker exited ${exit.code}`);
    const samples = readFileSync(forked, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).map(({ pid, forkedAtMs }) => ({ pid, forkedAtMs, trackedAtMs: tracked.get(pid) ?? null }));
    const lines = samples.map((s) => JSON.stringify(s)).join('\n') + '\n';
    writeFileSync(join(OUT, 'latency.samples.jsonl'), lines);
    const deltas = samples.filter((s) => s.trackedAtMs !== null).map((s) => s.trackedAtMs - s.forkedAtMs).sort((a, b) => a - b);
    const rank = (p) => deltas[Math.max(0, Math.ceil((p / 100) * deltas.length) - 1)];
    return { forks, samples: samples.length, untracked: samples.length - deltas.length, p50: rank(50), p95: rank(95), max: deltas.at(-1), samplesSha256: createHash('sha256').update(lines).digest('hex'), load: { before, after: loadavg() } };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- The counter, built as scripts/benchmark.mjs builds it, from the same source.
function counterBuild(dir) {
  const source = join(REPO, 'scripts/count-children.c');
  const build = { run: join(dir, 'run'), library: join(dir, 'count.dylib') };
  for (const [output, flags] of [['count.dylib', ['-dynamiclib']], ['run', ['-DRUNNER']]]) execFileSync('cc', ['-O2', '-Wall', '-Werror', ...flags, '-o', join(dir, output), source], { stdio: 'ignore' });
  return build;
}

async function starts(name, seconds) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2649-starts-')));
  const before = loadavg();
  try {
    if (name === 'command-check') {
      // The project as benchmarks/command-check.mjs writes it, made here, outside the measured process.
      const project = join(dir, 'project');
      mkdirSync(join(project, 'test'), { recursive: true });
      writeFileSync(join(project, 'package.json'), '{ "name": "bench", "private": true, "type": "module" }\n');
      const tests = Array.from({ length: 200 }, (_, i) => `test('adds ${i}', () => {\n  expect(${i} + 1).toBe(${i + 1});\n});\n`).join('\n');
      writeFileSync(join(project, 'test/sum.test.ts'), `import { expect, test } from 'vitest';\n\n${tests}`);
      execFileSync('/bin/cp', ['-cR', join(REPO, 'node_modules'), join(project, 'node_modules')]);
    }
    const counter = counterBuild(mkdtempSync(join(tmpdir(), 'deep-2649-counter-')));
    const log = join(OUT, `${name}.counter.log`);
    const sites = join(OUT, `${name}.sites.jsonl`);
    writeFileSync(log, '');
    writeFileSync(sites, '');
    const argv = [counter.run, counter.library, process.execPath, `--import=${join(HERE, 'sites.mjs')}`, fileURLToPath(import.meta.url), 'inner', name, dir, String(seconds ?? '')];
    const t0 = Date.now();
    const child = spawnSync(argv[0], argv.slice(1), { cwd: REPO, env: { ...process.env, DEEP_COUNT_LOG: log, DEEP_2649_SITES: sites, DEEP_2649_ROOT: REPO }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (child.status !== 0) throw Error(`the measured run exited ${child.status}: ${child.stderr}`);
    const inner = JSON.parse(child.stdout.trim().split('\n').at(-1));
    const text = readFileSync(log, 'utf8');
    // An hour's sites are tens of MB of the same few lines: kept gzipped.
    if (name === 'idle-hour') {
      writeFileSync(`${sites}.gz`, gzipSync(readFileSync(sites), { level: 9 }));
      rmSync(sites);
    }
    return {
      subject: name, ...inner, wallSeconds: (Date.now() - t0) / 1000,
      command: ['DEEP_COUNT_LOG=<log>', `DEEP_2649_SITES=<sites>`, 'DEEP_2649_ROOT=<repo>', '<count-children run>', '<count-children dylib>', 'node', '--import=docs/spikes/2649/sites.mjs', 'docs/spikes/2649/measure.mjs', 'inner', name, '<temp dir>', ...(seconds ? [String(seconds)] : [])].join(' '),
      log: `out/${name}.counter.log`, sha256: createHash('sha256').update(text).digest('hex'), starts: text.split('\n').filter((l) => l.startsWith('start ')).length,
      load: { before, after: loadavg() },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A cut tried. The copy: cp -cR <this checkout> <copy>; cd <copy>; git apply docs/spikes/2649/cut-<id>.patch;
// npm run build -w packages/supervisor. Then each of the three tasks run as benchmarks/budgets.json has it, in this checkout (the merge base: main)
// and in `changeDir` (a copy of it with the cut applied and built), 15 rounds a side after one unkept round each,
// the side that goes first alternating round by round. Each reading is the perf lane's child counter's
// (scripts/count-children.c), summed as scripts/benchmark.mjs's countChildren sums it: every process's count, read
// as it was reaped or as it exited by itself. On this Mac countChildren gives these tasks no total at all, on main as
// on a cut: the leash's watcher and /usr/bin/log are killed at the supervisor's close, so no count of theirs is ever
// written. So the sum here is of every process the counter could read, and `uncounted` names the rest, the same
// processes on both sides.
const TASKS = ['sandbox-setup', 'runner-job', 'command-check-count'];
function counted(build, command, cwd) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-2649-count-'));
  try {
    const log = join(dir, 'log');
    writeFileSync(log, '');
    const child = spawnSync(build.run, [build.library, ...command], { cwd, env: { ...process.env, DEEP_COUNT_LOG: log }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
    const rows = readFileSync(log, 'utf8').split('\n').map((l) => l.split(' '));
    const waited = new Set(rows.filter(([k]) => k === 'reap' || k === 'unread').map(([, , c]) => c));
    const reaps = rows.filter(([k]) => k === 'reap').map(([, , , n]) => Number(n));
    const exits = rows.filter(([k, c]) => k === 'exit' && !waited.has(c)).map(([, , n]) => Number(n));
    const ended = new Set([...waited, ...rows.filter(([k]) => k === 'exit').map(([, c]) => c)]);
    const uncounted = rows.filter(([k, , c]) => k === 'start' && !ended.has(c)).map(([, , , ...p]) => basename(p.join(' ')));
    return { status: child.status, output: child.stderr, instructions: [...reaps, ...exits].reduce((a, b) => a + b, 0), starts: rows.filter(([k]) => k === 'start').length, uncounted: [...new Set(uncounted)].sort() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function cut(id, changeDir) {
  const build = counterBuild(mkdtempSync(join(tmpdir(), 'deep-2649-counter-')));
  const measureOnce = (command, cwd) => counted(build, command, cwd);
  const budgets = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8'));
  const measurements = {};
  for (const task of TASKS) {
    const { command } = budgets.tasks.find((t) => t.id === task);
    const sides = { base: REPO, change: realpathSync(changeDir) };
    const read = (side) => {
      const result = measureOnce(command, sides[side]);
      if (result.status !== 0) throw Error(`${task} on the ${side} exited ${result.status}: ${result.output}`);
      return { instructions: result.instructions, starts: result.starts, uncounted: result.uncounted, load: loadavg()[0] };
    };
    read('base');
    read('change');
    const rounds = [];
    for (let round = 0; round < 15; round++) {
      const first = round % 2 ? 'change' : 'base';
      const second = first === 'base' ? 'change' : 'base';
      const a = read(first);
      const b = read(second);
      const [base, change] = first === 'base' ? [a, b] : [b, a];
      rounds.push({ first, base: base.instructions, change: change.instructions, baseStarts: base.starts, changeStarts: change.starts, uncounted: [...new Set([...a.uncounted, ...b.uncounted])], load: [a.load, b.load] });
      process.stderr.write(`${task} round ${round + 1}: base ${rounds.at(-1).base} change ${rounds.at(-1).change}\n`);
    }
    measurements[task] = { command: `node docs/spikes/2649/measure.mjs cut ${id} <copy with the cut>  (each side: ${command.join(' ')}, under scripts/count-children.c)`, rounds };
  }
  return { id, measurements };
}

// What the counter can't read: /bin/ps is setuid root, so the kernel refuses its count of instructions retired to
// the counter's proc_pid_rusage, and to /usr/bin/time too: every ps start is `unread` in the logs. Its CPU time can be
// read: wait4 gives a parent its waited children's, so /usr/bin/time -p over one shell that runs 200 of a shape gives
// their user and system seconds. Each shape the supervisor runs, against this process (one PID, as a beat with one
// held process asks), and `helper scan` for an unheld marker the same way, whose instructions the counter does read.
function psReadings() {
  const HELPER = join(REPO, 'packages/supervisor/dist/helper');
  const shapes = {
    'ps -p <pid> -o pid=,ppid=,pgid=,lstart= (start-time, beat-ps)': `/bin/ps -p ${process.pid} -o pid=,ppid=,pgid=,lstart=`,
    'ps -E -ww -o command= -p <pid> (token)': `/bin/ps -E -ww -o command= -p ${process.pid}`,
    'ps -A -o pid=,ppid=,pgid=,lstart= (provable)': '/bin/ps -A -o pid=,ppid=,pgid=,lstart=',
    'helper scan <marker> (scan-beat, scan-cleanup)': `${HELPER} scan dev.deepbuild.run.none`,
    // The floor: the loop, a fork and an exec of the smallest program, which every shape above pays too.
    '/usr/bin/true (the floor)': '/usr/bin/true',
  };
  const N = 200;
  return Object.fromEntries(Object.entries(shapes).map(([name, line]) => {
    const script = `i=0; while [ $i -lt ${N} ]; do ${line} >/dev/null; i=$((i+1)); done`;
    const r = spawnSync('/usr/bin/time', ['-p', '/bin/sh', '-c', script], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' });
    const field = (key) => Number(new RegExp(`^${key}\\s+([\\d.]+)`, 'm').exec(r.stderr)?.[1]);
    return [name, { command: `/usr/bin/time -p /bin/sh -c '${script}'`, starts: N, userSeconds: field('user'), sysSeconds: field('sys'), cpuMsPerStart: Number((((field('user') + field('sys')) * 1000) / N).toFixed(3)) }];
  }));
}

const head = () => ({ date: new Date().toISOString(), main: execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), machine: { cpu: cpus()[0]?.model, cores: cpus().length, macos: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(), node: process.version } });

if (mode === 'inner') {
  const result = subject === 'command-check' ? await innerCommandCheck(arg) : await innerIdle(arg, Number(process.argv[5]) || 3600);
  console.log(JSON.stringify(result));
} else {
  mkdirSync(OUT, { recursive: true });
  if (process.platform !== 'darwin') throw Error('BLOCKED: the child counter reads instructions retired on macOS only');
  if (mode === 'starts' && ['command-check', 'idle-hour'].includes(subject)) console.log(JSON.stringify({ ...head(), ...(await starts(subject, subject === 'idle-hour' ? Number(arg) || 3600 : undefined)) }));
  else if (mode === 'cut' && subject && arg) {
    const result = { ...head(), ...(await cut(subject, arg)) };
    writeFileSync(join(OUT, `cut-${subject}.json`), `${JSON.stringify(result, null, 1)}\n`);
    console.log(JSON.stringify({ id: subject, kept: `out/cut-${subject}.json` }));
  } else if (mode === 'ps') console.log(JSON.stringify({ ...head(), ps: psReadings(), load: loadavg() }));
  else if (mode === 'latency') console.log(JSON.stringify({ ...head(), latency: await latency(Number(subject) || 200) }));
  else throw Error('usage: measure.mjs starts command-check | starts idle-hour [seconds] | latency [forks]');
}
