import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const metrics = ['p50Ms', 'p95Ms', 'peakBytes'];

export function summarize(samples) {
  if (!samples.length || samples.some(({ ms, peakBytes }) => !Number.isFinite(ms) || ms < 0 || !Number.isSafeInteger(peakBytes) || peakBytes <= 0))
    throw Error('Invalid or missing benchmark samples');
  const times = samples.map(({ ms }) => ms).sort((a, b) => a - b);
  return { p50Ms: times[Math.ceil(times.length * 0.5) - 1], p95Ms: times[Math.ceil(times.length * 0.95) - 1], peakBytes: Math.max(...samples.map(({ peakBytes }) => peakBytes)) };
}

export function parsePeakRss(output, platform) {
  const pattern = platform === 'darwin' ? /^\s*(\d+)\s+maximum resident set size\s*$/m : /^peak_rss_kb=(\d+)$/m;
  const bytes = Number(output.match(pattern)?.[1]) * (platform === 'darwin' ? 1 : 1024);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw Error('Missing or invalid native peak RSS');
  return bytes;
}

// User plus system CPU seconds of the command and every child it waited for, in ms.
export function parseCpuMs(output, platform) {
  const match = platform === 'darwin' ? output.match(/^\s*[\d.]+ real\s+([\d.]+) user\s+([\d.]+) sys\s*$/m) : output.match(/^cpu_s=([\d.]+) ([\d.]+)$/m);
  const ms = Math.round((Number(match?.[1]) + Number(match?.[2])) * 1000);
  if (!Number.isSafeInteger(ms) || ms < 0) throw Error('Missing or invalid CPU time');
  return ms;
}

// Instructions retired by the one process /usr/bin/time waited for, or null where the report has no
// counter, as GNU time's hasn't: a missing count is never 0. macOS adds no child's count to its
// parent's, so this is not the whole of a command that starts children; countChildren is. Unlike time,
// the count doesn't move with machine load.
export function parseInstructions(report, platform) {
  const count = platform === 'darwin' ? Number(report.match(/^\s*(\d+)\s+instructions retired\s*$/m)?.[1]) : NaN;
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

// The two builds of count-children.c, or null where it can't be built, as off macOS: a host with no
// counter. They live past any one run, since a daemon a run leaves behind still loads the library.
let counter;
function counterBuild() {
  if (counter !== undefined) return counter;
  counter = null;
  if (process.platform !== 'darwin') return counter;
  try {
    const source = fileURLToPath(new URL('count-children.c', import.meta.url));
    const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), 'Library/Caches'), 'deepbuild-perf');
    const directory = join(cache, `counter-${createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 16)}`);
    const build = { run: join(directory, 'run'), library: join(directory, 'count.dylib') };
    if (!existsSync(build.run)) {
      mkdirSync(cache, { recursive: true, mode: 0o700 });
      const building = mkdtempSync(`${directory}-`);
      try {
        for (const [output, flags] of [['count.dylib', ['-dynamiclib']], ['run', ['-DRUNNER']]]) execFileSync('cc', ['-O2', '-Wall', '-Werror', ...flags, '-o', join(building, output), source], { stdio: 'ignore' });
        renameSync(building, directory);
      } catch (error) {
        // Another run built the same source first.
        if (!existsSync(build.run)) throw error;
      } finally {
        rmSync(building, { recursive: true, force: true });
      }
    }
    counter = build;
  } catch {
    // Without a compiler the counts stay missing, and a missing count is never a pass.
  }
  return counter;
}

// Tools benches read a process with. Their counts can't all be read (ps is setuid; lsof's forked helper
// and a tailed log are out of the library's reach), and none of our code runs in them.
const observers = new Set(['/bin/ps', '/usr/sbin/lsof', '/usr/bin/log']);

// A run's count from count-children.c's log: the instructions retired of the command and every child
// it waited for, however deep, and of a child nothing waited for that exited by itself in time. A process
// that started a child and has no count for it leaves the count null, with its name in uncounted: a child
// still running has no line of its end, and a parent the library couldn't enter, or a wait it didn't see,
// leaves the parent's child time above what the log accounts for.
function countChildren(log, command) {
  const rows = log.split('\n').filter(Boolean).map((line) => line.split(' '));
  const select = (wanted) => rows.filter(([kind]) => kind === wanted).map(([, ...fields]) => fields);
  const unread = select('unread').map(([parent, child, time]) => ({ parent, child, time: Number(time) }));
  const reaped = select('reap').map(([parent, child, instructions, elapsed, childElapsed]) => ({ parent, child, instructions: Number(instructions), childElapsed: Number(childElapsed), time: Number(elapsed) + Number(childElapsed) }));
  const waited = new Set([...reaped, ...unread].map(({ child }) => child));
  const left = select('exit').filter(([child]) => !waited.has(child)).map(([child, instructions, childElapsed]) => ({ child, instructions: Number(instructions), childElapsed: Number(childElapsed) }));
  const starts = select('start').map(([, child, ...path]) => ({ child, path: path.join(' ') }));
  const nameOf = (pid) => starts.find(({ child }) => child === pid)?.path ?? command[0];
  const accounted = new Map();
  for (const { parent, time } of [...reaped, ...unread]) accounted.set(parent, (accounted.get(parent) ?? 0) + time);
  const counts = [...reaped, ...left];
  const ended = new Set([...waited, ...left.map(({ child }) => child)]);
  const uncounted = [...new Set([
    ...starts.filter(({ child }) => !ended.has(child)).map(({ path }) => path),
    ...unread.map(({ child }) => nameOf(child)),
    ...counts.filter(({ child, childElapsed }) => (accounted.get(child) ?? 0) !== childElapsed).map(({ child }) => nameOf(child)).map((name) => (observers.has(name) ? name : `a child of ${name}`)),
  ])].filter((name) => !observers.has(name));
  return { instructions: !reaped.length || uncounted.length ? null : counts.reduce((sum, { instructions }) => sum + instructions, 0), uncounted };
}

// stream shows the command's output as it runs instead of capturing it; a captured run is stopped after
// timeoutMs. Every child is counted, which costs the run and each child a few ms to start, so a run judged
// on time passes follow = false: it runs as it would alone, and its count is parseInstructions's.
export function measureOnce(command, cwd, stream = false, timeoutMs = 300_000, follow = true) {
  if (!['darwin', 'linux'].includes(process.platform)) throw Error('BLOCKED: native peak RSS requires macOS or Linux');
  const flags = process.platform === 'darwin' ? ['-l'] : ['-f', 'peak_rss_kb=%M\ncpu_s=%U %S'];
  const directory = mkdtempSync(join(tmpdir(), 'deep-benchmark-time-'));
  const timing = join(directory, 'time');
  const counted = join(directory, 'counted');
  const build = follow ? counterBuild() : null;
  try {
    if (build) writeFileSync(counted, '');
    const argv = build ? [build.run, follow ? build.library : '-', ...command] : command;
    const env = build ? { ...process.env, DEEP_COUNT_LOG: counted } : process.env;
    const started = performance.now();
    // A captured run leads its own process group: spawnSync stops only /usr/bin/time at the timeout or
    // maxBuffer, so the group is stopped with it, or the measured command and its children run on (#1322).
    const result = spawnSync('/usr/bin/time', [...flags, '-o', timing, ...argv], stream
      ? { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] }
      : { cwd, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, detached: true });
    const elapsedMs = performance.now() - started;
    if (result.error) {
      try {
        if (!stream && result.pid > 0) process.kill(-result.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      throw result.error;
    }
    const report = readFileSync(timing, 'utf8');
    const peakBytes = parsePeakRss(report, process.platform);
    const own = parseInstructions(report, process.platform);
    const { instructions, uncounted } = !follow ? { instructions: own, uncounted: [] } : build && own !== null ? countChildren(readFileSync(counted, 'utf8'), command) : { instructions: null, uncounted: [] };
    return { elapsedMs, cpuMs: parseCpuMs(report, process.platform), peakBytes, instructions, uncounted, status: result.status, output: stream ? '' : result.stdout + result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Alternates current and merge-base runs so both see the same machine load: one warmup round, then 20 rounds.
// Returns [current] or [current, base], each with its instructions retired per round, in round order,
// and what started a child no count covers.
export function measure(command, cwd, base) {
  const sides = base ? [[command, cwd], [base.command, base.cwd]] : [[command, cwd]];
  const samples = sides.map(() => []);
  for (let round = 0; round <= 20; round++) {
    sides.forEach(([argv, directory], side) => {
      const result = measureOnce(argv, directory);
      if (result.status !== 0) throw Error(`${argv[0]} exited ${result.status}: ${result.output}`);
      if (round) samples[side].push({ ms: result.elapsedMs, peakBytes: result.peakBytes, instructions: result.instructions, uncounted: result.uncounted });
    });
  }
  return samples.map((side) => ({ ...summarize(side), instructions: side.map(({ instructions }) => instructions), uncounted: [...new Set(side.flatMap(({ uncounted }) => uncounted))] }));
}

// Judges a task against its merge base on the instructions retired of each alternated round, so the
// verdict holds on any machine under any load. A pair's difference is current / base - 1; the change
// is the median difference, and it fails when over the margin, the larger of 2% and the pairs'
// spread. A missing count makes it INCONCLUSIVE; uncounted says what started a child with no count.
export function judgeInstructions(pairs, uncounted = []) {
  const count = (value) => Number.isSafeInteger(value) && value > 0;
  const missing = pairs.filter((pair) => !count(pair?.current) || !count(pair?.base)).length;
  if (!pairs.length || missing) {
    return { status: 'INCONCLUSIVE', pairs, change: null, spread: null, margin: null, uncounted,
      reason: `instructions retired are missing in ${pairs.length ? `${missing} of ${pairs.length} pairs` : 'every pair: none were measured'}; ${uncounted.length ? `no count covers ${uncounted.join(', ')}` : "this host's /usr/bin/time reports no counter, or cc can't build the child counter"}` };
  }
  const differences = pairs.map(({ current, base }) => current / base - 1).sort((a, b) => a - b);
  const middle = differences.length / 2;
  const change = differences.length % 2 ? differences[Math.floor(middle)] : (differences[middle - 1] + differences[middle]) / 2;
  const spread = differences.at(-1) - differences[0];
  const margin = Math.max(0.02, spread);
  if (change > margin) return { status: 'FAIL', pairs, change, spread, margin, reason: `instructions retired rose ${(change * 100).toFixed(2)}% over the merge base, beyond the ${(margin * 100).toFixed(2)}% margin` };
  return { status: 'PASS', pairs, change, spread, margin };
}

// Builds unmeasured, so a checkout and its merge base are both timed warm. The check lanes run
// the same builds and report their errors, so a failure here is left for them.
export function warm(cwd) {
  // Clippy keeps its own check artifacts, so the lint lane's exact command is warmed too (#594).
  const steps = [['npm', 'run', 'build'], ['cargo', 'test', '--workspace', '--locked', '--no-run'], ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings']];
  // The #56 spike keeps its dependencies apart from the root's, and its benches are perf tasks.
  if (existsSync(join(cwd, 'spikes/hub-core/package-lock.json'))) steps.unshift(['npm', 'ci', '--prefix', 'spikes/hub-core', '--no-audit', '--no-fund']);
  for (const [command, ...args] of steps) spawnSync(command, args, { cwd, stdio: 'ignore' });
}

// A copy of a tree made ready to run in: the checks and benches read git, so it gets its own throwaway repository,
// committed without the user's hooks or signing. Its origin/main is that commit, as on main itself, so checks that
// compare with main (repo-rules' size) do the same work on both sides instead of skipping it in the copy. Then its
// packages and warm builds, kept in CARGO_TARGET_DIR.
export function prepareCopy(directory) {
  const run = (command, args, options = {}) => execFileSync(command, args, { cwd: directory, encoding: 'utf8', timeout: 120_000, maxBuffer: 128 * 1024 * 1024, ...options });
  const git = (...args) => run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=DeepBuild perf', '-c', 'user.email=perf@example.invalid', ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'perf copy');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  // target/ links to the kept builds, so ./target/debug binaries stay where the lanes and budgets run
  // them. It is made after the commit: .gitignore's target/ matches a directory, not a link.
  symlinkSync(process.env.CARGO_TARGET_DIR, join(directory, 'target'), 'dir');
  run('npm', ['ci', '--no-audit', '--no-fund']);
  warm(directory);
}

// A timing or memory budget counts only on a reference Mac, on mains power, with Low Power Mode
// off and the thermal state nominal (design: The reference Mac). There are three, and a budget holds
// on each.
const references = [
  { name: 'Mac15,7 (M3 Pro, 36 GB)', model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30 },
  { name: 'Mac15,12 (M3, 16 GB)', model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30 },
  { name: 'Mac17,10 (M5 Max, 64 GB)', model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 64 * 2 ** 30 },
];
const hardware = ['model', 'chip', 'memoryBytes'];
const conditions = [
  ['power', 'ac', 'power (mains)'],
  ['lowPowerMode', false, 'Low Power Mode'],
  ['thermalState', 'nominal', 'thermal state'],
];
const referenceNames = references.map(({ name }) => name).join(' or ');

// The machine a result ran under. A field this machine can't report, as off macOS, is null, so the
// result is a reading.
export function fingerprint() {
  const read = (command, ...args) => {
    try {
      return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
    } catch {
      return null;
    }
  };
  const memory = Number(read('sysctl', '-n', 'hw.memsize'));
  const source = read('pmset', '-g', 'ps');
  // pmset's lowpowermode line; a Mac whose pmset prints none (a Mac17,10 on macOS 26 prints powermode instead) is
  // asked through NSProcessInfo.
  const lowPower = read('pmset', '-g')?.match(/^\s*lowpowermode\s+([01])\s*$/m)?.[1]
    ?? { true: '1', false: '0' }[read('osascript', '-l', 'JavaScript', '-e', 'ObjC.import("Foundation"); $.NSProcessInfo.processInfo.isLowPowerModeEnabled')];
  // NSProcessInfo's thermalState: 0 nominal, 1 fair, 2 serious, 3 critical.
  const thermal = read('osascript', '-l', 'JavaScript', '-e', 'ObjC.import("Foundation"); $.NSProcessInfo.processInfo.thermalState');
  return {
    model: read('sysctl', '-n', 'hw.model') || null,
    chip: read('sysctl', '-n', 'machdep.cpu.brand_string') || null,
    memoryBytes: Number.isSafeInteger(memory) && memory > 0 ? memory : null,
    power: /'AC Power'/.test(source) ? 'ac' : /'Battery Power'/.test(source) ? 'battery' : null,
    lowPowerMode: lowPower === undefined ? null : lowPower === '1',
    thermalState: ['nominal', 'fair', 'serious', 'critical'][thermal] ?? null,
    macosBuild: read('sw_vers', '-buildVersion') || null,
  };
}

// Judges one limit on five runs taken after warm-up. On a reference Mac it passes when all five
// are within the limit and fails when all five are over it by more than the margin, the larger of
// 5% and the five runs' spread, both as fractions of the limit. Anything else, and every result off
// the reference Macs, is INCONCLUSIVE with the five runs attached.
export function judgeLimit({ limit, runs, fingerprint: machine }) {
  if (!Array.isArray(runs) || runs.length !== 5 || runs.some((run) => !Number.isFinite(run) || run < 0))
    return { status: 'BLOCKED', limit, runs, reason: `a limit is judged on five readings taken after warm-up, got ${JSON.stringify(runs)}` };
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  const off = references.some((reference) => hardware.every((key) => machine?.[key] === reference[key])) ? []
    : [`${hardware.map((key) => `${key} is ${JSON.stringify(machine?.[key] ?? null)}`).join(', ')}: none of ${referenceNames}`];
  off.push(...conditions.filter(([key, value]) => machine?.[key] !== value).map(([key, value, label]) => `${label} is ${JSON.stringify(machine?.[key] ?? null)}, not ${JSON.stringify(value)}`));
  if (!machine?.macosBuild) off.push('the macOS build is missing');
  if (off.length) return { status: 'INCONCLUSIVE', limit, runs, margin, reason: `a reading, not a budget result: off the reference Macs (${referenceNames}; mains power, Low Power Mode off, thermal state nominal): ${off.join('; ')}` };
  if (runs.every((run) => run <= limit)) return { status: 'PASS', limit, runs, margin };
  if (runs.every((run) => run > limit * (1 + margin))) return { status: 'FAIL', limit, runs, margin, reason: `all five runs are over ${limit} by more than the ${(margin * 100).toFixed(1)}% margin` };
  return { status: 'INCONCLUSIVE', limit, runs, margin, reason: `the five runs are neither all within ${limit} nor all over it by more than the ${(margin * 100).toFixed(1)}% margin` };
}

export function validateBudgets(current, base) {
  if (!Array.isArray(current?.tasks)) throw Error('Missing budget tasks');
  if (base?.preflight && !isDeepStrictEqual(current.preflight, base.preflight)) throw Error('Budget preflight changed or disappeared; restore its frozen definition');
  if (base?.harness && !isDeepStrictEqual(current.harness, base.harness)) throw Error('Budget harness changed or disappeared; restore its frozen definition');
  for (const established of base?.tasks ?? []) {
    if (!isDeepStrictEqual(current.tasks.find(({ id }) => id === established.id), established))
      throw Error(`Budget ${established.id} changed or disappeared; restore its frozen definition`);
  }
  const ids = new Set();
  for (const task of [...current.tasks, ...(current.preflight ? [{ id: 'preflight', ...current.preflight }] : [])]) {
    if (!task.id || ids.has(task.id)) throw Error('Missing or duplicate budget id');
    ids.add(task.id);
    if (task.id !== 'preflight' && (!Array.isArray(task.command) || !task.command.length || task.command.some((part) => typeof part !== 'string' || !part))) throw Error(`${task.id}: invalid command`);
    if (!Number.isFinite(task.margin) || task.margin < 0) throw Error(`${task.id}: invalid margin`);
    if (typeof task.initialReason !== 'string' || !task.initialReason.trim()) throw Error(`${task.id}: first measurement requires a reason`);
    const allowed = task.id === 'preflight' ? ['elapsedMs', 'peakBytes'] : metrics;
    if (!task.limits || Object.entries(task.limits).some(([key, value]) => !allowed.includes(key) || !Number.isFinite(value) || value <= 0)) throw Error(`${task.id}: invalid limits`);
  }
  if (!ids.size) throw Error('No budget task was measured');
}

// p95 has only absolute caps: between identical binaries on a shared machine, the tail of 20
// interleaved samples still moves past a 50% margin in a few runs out of a hundred, and p50 does not.
export function compare(budget, current, base, keys = metrics) {
  for (const metric of keys) {
    if (!Number.isFinite(current[metric]) || current[metric] <= 0) throw Error(`${budget.id}: missing ${metric}`);
    if (budget.limits[metric] !== undefined && current[metric] >= budget.limits[metric]) throw Error(`${budget.id}: ${metric} ${current[metric]} reached cap ${budget.limits[metric]}`);
    if (base && (!Number.isFinite(base[metric]) || base[metric] <= 0)) throw Error(`${budget.id}: missing base ${metric}`);
    if (base && metric !== 'p95Ms' && current[metric] > base[metric] * (1 + budget.margin)) throw Error(`${budget.id}: ${metric} ${current[metric]} regressed beyond base ${base[metric]} + ${budget.margin * 100}%`);
  }
  return base ? { status: 'PASS' } : { status: 'INITIAL', reason: budget.initialReason };
}

// One task judged against its merge base, as perf and the budget window judge it: 20 alternated rounds a side, its
// limits on five runs after one untimed warm-up run, instructions retired where both sides ran, and the merge-base
// regression, whose message is `regression`. A command that won't run throws.
export function judgeTask(budget, established, cwd, baseCwd) {
  const [now, then = null] = measure(budget.command, cwd, established && { command: established.command, cwd: baseCwd });
  const once = () => {
    const result = measureOnce(budget.command, cwd, false, undefined, false);
    if (result.status !== 0) throw Error(`${budget.command[0]} exited ${result.status}: ${result.output}`);
    return result;
  };
  const runs = Object.keys(budget.limits).length ? (once(), Array.from({ length: 5 }, once)) : [];
  const machine = fingerprint();
  const limits = Object.fromEntries(Object.entries(budget.limits).map(([metric, limit]) => [metric, judgeLimit({ limit, runs: runs.map((run) => (metric === 'peakBytes' ? run.peakBytes : run.elapsedMs)), fingerprint: machine })]));
  // Instructions retired don't move with load, so this comparison holds on any machine; it never
  // changes a limit's verdict.
  const instructions = then && judgeInstructions(now.instructions.map((current, round) => ({ current, base: then.instructions[round] })), [...new Set([...now.uncounted, ...then.uncounted])]);
  let outcome, regression = null;
  try {
    // compare holds only the merge-base regression here; the limits are judged above.
    outcome = compare({ ...budget, limits: {} }, now, then);
  } catch (error) {
    regression = error.message;
  }
  return { now, then, machine, limits, instructions, outcome, regression };
}

// A task's report is its command's last stdout line; `<bench> judge` reads it on stdin and prints its verdict.
export function judgeTargets(budget, cwd) {
  const last = (out) => JSON.parse(out.trim().split('\n').at(-1));
  const ran = spawnSync(budget.command[0], budget.command.slice(1), { cwd, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 512 * 1024 * 1024 });
  if (ran.status !== 0) return { status: 'BLOCKED', reason: `${budget.command.join(' ')} exited ${ran.status}: ${ran.stderr.slice(-1000)}` };
  const judged = spawnSync(budget.command[0], [budget.command[1], 'judge'], { cwd, encoding: 'utf8', input: JSON.stringify({ current: last(ran.stdout), base: null }) });
  if (judged.status !== 0) return { status: 'BLOCKED', reason: `the judge exited ${judged.status}: ${judged.stderr.slice(-1000)}` };
  return last(judged.stdout);
}
