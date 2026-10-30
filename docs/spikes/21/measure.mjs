// Issue #21's recorded numbers, each printed as one JSON object with the date, the machine and the method. Run from the
// repo root, on a quiet reference Mac on mains power, with hyperfine, node, bun, python3 and cargo on PATH:
//   node docs/spikes/21/measure.mjs            process start for a native no-op binary, Node, Bun and Python, each a
//                                              no-op, measured with hyperfine, warm-up runs first and no shell (-N),
//                                              with each program's version: record.json's `processStart`, which the
//                                              design's Hook overhead row cites
//   node docs/spikes/21/measure.mjs budgets    the perf lane's #21 benches (benchmarks/deep-hook.mjs day-*) run five times
//                                              each, after one warm-up run: record.json's `budgets`, the run that
//                                              set hook overhead and fail-open over 1,000 real tool calls
// The native no-op is /usr/bin/true, a Mach-O binary every Mac has, so the recorded command runs anywhere the
// readings are read; a `fn main() {}` built by rustc at opt-level 3, the floor deep-hook's own budgets use, is timed
// beside it as `rust`, since deep-hook is a Rust binary.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WARMUP = 20;
const RUNS = 200;
const { fingerprint } = await import(fileURLToPath(new URL('../../../scripts/benchmark.mjs', import.meta.url)));

const read = (command, ...args) => {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw Error(`${command} ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
  return `${r.stdout}${r.stderr}`.trim();
};
const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => { const s = sorted(xs); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const p95 = (xs) => sorted(xs)[Math.ceil(xs.length * 0.95) - 1];

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

if (process.argv[2] === 'budgets') {
  const REPO = fileURLToPath(new URL('../../../', import.meta.url));
  const tasks = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')).tasks.filter((t) => /#21\b/.test(t.initialReason));
  const bench = (task) => {
    const r = spawnSync(task.command[0] === 'node' ? process.execPath : task.command[0], task.command.slice(1), { cwd: REPO, encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0) throw Error(`${task.command.join(' ')} exited ${r.status}: ${r.stderr.slice(-2000)}`);
    return JSON.parse(r.stdout.trim().split('\n').at(-1));
  };
  const runs = { overheadP95Ms: [], failOpenP95Ms: [] };
  // The load averages as each run ended, so a slow run can be read against what else the machine was doing.
  const loads = {};
  let calls = Infinity;
  for (const task of tasks) {
    bench(task); // warm-up
    loads[task.id] = [];
    for (let i = 0; i < 5; i++) {
      const line = bench(task);
      loads[task.id].push(read('sysctl', '-n', 'vm.loadavg'));
      calls = Math.min(calls, line.calls);
      for (const key of Object.keys(runs)) if (Number.isFinite(line[key])) runs[key].push(line[key]);
    }
  }
  console.log(JSON.stringify({
    date: today(),
    machine: fingerprint(),
    method: 'each #21 perf task (benchmarks/deep-hook.mjs day-overhead and day-fail-open) run from the repo root once untimed to warm up and then five times, one after another, the load averages as each run ended recorded beside the readings; each run replays 1,000 of the fixture corpus\'s recorded Claude Code tool calls through the release deep-hook to a real hub, the calls the hub holds left out, and prints its own p95: overhead with the hub up as the hooks\' p95 (spawn to exit) minus a native no-op\'s p95, fail-open as the hooks\' p95 (spawn to exit) with the hub SIGSTOPped in stretches of 50 calls (100 hooks, under the socket\'s listen queue of 128) and the hooks run four calls at a time, every hook shown to have waited the hub out by its spooled line marked late or its note that the spool write ran out of time',
    calls,
    commands: tasks.map((t) => t.command),
    load: read('sysctl', '-n', 'vm.loadavg'),
    loads,
    ...runs,
  }, null, 1));
  process.exit(0);
}

// Under /tmp, not the per-user temp folder, so the recorded command names no path that identifies the machine.
const dir = mkdtempSync('/tmp/deep-process-start-');
try {
  const rust = join(dir, 'noop');
  writeFileSync(`${rust}.rs`, 'fn main() {}\n');
  execFileSync('rustc', ['-C', 'opt-level=3', '-o', rust, `${rust}.rs`]);
  // Each program's no-op, as hyperfine runs it with no shell, and the version the program names for itself.
  const programs = {
    native: { command: '/usr/bin/true', version: `macOS ${read('sw_vers', '-productVersion')} /usr/bin/true` },
    rust: { command: rust, version: read('rustc', '--version') },
    node: { command: 'node -e 0', version: read('node', '--version') },
    bun: { command: 'bun -e 0', version: read('bun', '--version') },
    python: { command: 'python3 -c pass', version: read('python3', '--version') },
  };
  const out = join(dir, 'hyperfine.json');
  const argv = ['-N', '--warmup', String(WARMUP), '--runs', String(RUNS), '--export-json', out, ...Object.values(programs).map((p) => p.command)];
  execFileSync('hyperfine', argv, { stdio: ['ignore', 'ignore', 'inherit'] });
  const { results } = JSON.parse(readFileSync(out, 'utf8'));
  // hyperfine 2 exports measurements in place of times.
  if (!results.every((r) => Array.isArray(r.times))) throw Error('BLOCKED: hyperfine exported no times; install hyperfine 1.x');
  for (const p of Object.values(programs)) {
    const timesMs = results.find((r) => r.command === p.command).times.map((t) => Math.round(t * 1e6) / 1e3);
    Object.assign(p, { runs: timesMs.length, medianMs: median(timesMs), p95Ms: p95(timesMs), timesMs });
  }
  console.log(JSON.stringify({
    date: today(),
    machine: fingerprint(),
    method: `hyperfine with no shell (-N), ${WARMUP} warm-up runs first and then ${RUNS} timed runs of each no-op, all five in one hyperfine run, the load averages at its end recorded beside the readings; each program's own --version is recorded beside its times, and the median and p95 are over the timed runs`,
    hyperfine: { version: read('hyperfine', '--version'), argv: [argv] },
    load: read('sysctl', '-n', 'vm.loadavg'),
    programs,
  }, null, 1));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
