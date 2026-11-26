import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, homedir, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readApprovals } from './proof-approvals.mjs';
import { named, watchTree } from './proof-stop.mjs';

const metrics = ['p50Ms', 'p95Ms', 'peakBytes'];
// What a budget runs and builds is bare by this module's own setting, never by the machine's: an empty RUSTC_WRAPPER is no
// wrapper over any cargo config, so a machine's compile cache never reaches a budget (docs/parallel-proof.md, section 4).
// Read at each start, so a caller's CARGO_TARGET_DIR set just before reaches the child.
const bare = () => ({ ...process.env, RUSTC_WRAPPER: '' });

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
// parent's, so this is not the whole of a command that starts children; countChildren is.
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
  if (process.platform === 'linux') return (counter = linuxCounter());
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

// On Linux the runner alone counts, through the kernel's counter, which follows every child (#2960): no library.
function linuxCounter() {
  try {
    const source = fileURLToPath(new URL('count-linux.c', import.meta.url));
    const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'deepbuild-perf');
    const directory = join(cache, `counter-linux-${createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 16)}`);
    const build = { run: join(directory, 'run'), library: null };
    if (!existsSync(build.run)) {
      mkdirSync(cache, { recursive: true, mode: 0o700 });
      const building = mkdtempSync(`${directory}-`);
      try {
        execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', join(building, 'run'), source], { stdio: 'ignore' });
        renameSync(building, directory);
      } catch (error) {
        if (!existsSync(build.run)) throw error;
      } finally {
        rmSync(building, { recursive: true, force: true });
      }
    }
    return build;
  } catch {
    return null;
  }
}

// count-linux.c's log: the run's whole count, or null with why. A counter the kernel refused is BLOCKED, naming
// the setting that refused it, or that the host has none; a counter that wasn't on the command all the time it ran,
// and a process the command left running, which never joined the count, leave it null. The count is user space only,
// so it compares with a Linux count; an instructions ceiling set from macOS counts doesn't hold for it (none is set).
function countLinux(log) {
  const lines = log.split('\n').filter(Boolean).map((line) => line.split(' '));
  const blocked = lines.find(([kind]) => kind === 'blocked');
  if (blocked && ['1', '13'].includes(blocked[1])) throw Error(`BLOCKED: the kernel refused an instruction counter (errno ${blocked[1]}): kernel.perf_event_paranoid is ${blocked[2]}, and a process not run as root may count its own instructions only at 2 or less. Its owner can lower it (sysctl kernel.perf_event_paranoid=2)`);
  if (blocked) throw Error(`BLOCKED: this host has no instruction counter for the command (perf_event_open errno ${blocked[1]}; kernel.perf_event_paranoid is ${blocked[2]}), as a virtual machine without a PMU has none`);
  const partial = lines.find(([kind]) => kind === 'partial');
  if (partial) return { instructions: null, uncounted: [`the time the counter wasn't on the command (${partial[1]} of ${partial[2]} ns counted)`], qos: null };
  if (lines.some(([kind]) => kind === 'left')) return { instructions: null, uncounted: ['a process the command left running'], qos: null };
  const total = Number(lines.find(([kind]) => kind === 'total')?.[1]);
  return { instructions: Number.isSafeInteger(total) && total > 0 ? total : null, uncounted: [], qos: null };
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
  const reaped = select('reap').map(([parent, child, instructions, elapsed, childElapsed, ...qos]) => ({ parent, child, instructions: Number(instructions), childElapsed: Number(childElapsed), time: Number(elapsed) + Number(childElapsed), qos: qos.map(Number) }));
  const waited = new Set([...reaped, ...unread].map(({ child }) => child));
  const left = select('exit').filter(([child]) => !waited.has(child)).map(([child, instructions, childElapsed, ...qos]) => ({ child, instructions: Number(instructions), childElapsed: Number(childElapsed), qos: qos.map(Number) }));
  // A process that exec'd is named by what it became (#2960): the program it runs now, such as an observer.
  // A child whose count was denied is named as it started: it may have done our work before it exec'd one.
  const became = becameOf(rows);
  const starts = select('start').map(([, child, ...path]) => ({ child, started: path.join(' '), path: became.get(child)?.path ?? path.join(' ') }));
  const nameOf = (pid) => starts.find(({ child }) => child === pid)?.path ?? command[0];
  const startedAs = (pid) => starts.find(({ child }) => child === pid)?.started ?? command[0];
  const accounted = new Map();
  for (const { parent, time } of [...reaped, ...unread]) accounted.set(parent, (accounted.get(parent) ?? 0) + time);
  const ended = new Set([...waited, ...left.map(({ child }) => child)]);
  // One that became an observer and has no end counts what it did before it exec'd: ours, and the observer's isn't.
  // One that became anything else and has no end is uncounted.
  const unended = [...became.values()].filter(({ count }) => !ended.has(count.child));
  const counts = [...reaped, ...left, ...unended.filter(({ path }) => observers.has(path)).map(({ count }) => count)];
  const uncounted = [...new Set([
    ...starts.filter(({ child }) => !ended.has(child)).map(({ path }) => path),
    ...unended.map(({ path }) => path),
    ...unread.map(({ child }) => startedAs(child)),
    // An observer's children aren't followed, so its child time past what was reaped is forgiven; but not what a
    // process that became one hadn't accounted for when it exec'd, which was ours.
    ...counts.filter(({ child, childElapsed }) => (accounted.get(child) ?? 0) !== childElapsed).map(({ child }) => {
      const before = became.get(child)?.count.childElapsed;
      return before !== undefined && (accounted.get(child) ?? 0) !== before ? startedAs(child) : nameOf(child);
    }).map((name) => (observers.has(name) ? name : `a child of ${name}`)),
  ])].filter((name) => !observers.has(name));
  return { instructions: !reaped.length || uncounted.length ? null : counts.reduce((sum, { instructions }) => sum + instructions, 0), uncounted, qos: sumQos(counts.map(({ qos }) => qos)) };
}

// What each process exec'd into last, in log order, with its count as it exec'd; an exec that failed is undone,
// back to what the process was before it.
function becameOf(rows) {
  const execs = new Map();
  for (const [kind, child, instructions, childElapsed, ...rest] of rows) {
    if (kind === 'exec') execs.set(child, [...(execs.get(child) ?? []), { path: rest.slice(QOS_CLASSES.length).join(' '), count: { child, instructions: Number(instructions), childElapsed: Number(childElapsed), qos: rest.slice(0, QOS_CLASSES.length).map(Number) } }]);
    if (kind === 'unexec') execs.set(child, (execs.get(child) ?? []).slice(0, -1));
  }
  return new Map([...execs].filter(([, all]) => all.length).map(([child, all]) => [child, all.at(-1)]));
}

// A process dyld stopped because the counting library can't load into it, as an x86_64 binary under Rosetta
// can't take the arm64 library, is BLOCKED, named by its program, never a count of the run it cut short (#2960).
function refusedLibrary(output, log, command) {
  const pid = output.match(/dyld\[(\d+)\]: terminating because inserted dylib '[^']*' could not be loaded/)?.[1];
  if (!pid) return;
  const why = output.match(new RegExp(`dyld\\[${pid}\\]:[^\\n]*?(incompatible architecture \\([^)]*\\))`))?.[1];
  const rows = log.split('\n').map((line) => line.split(' '));
  const start = rows.find(([kind, , child]) => kind === 'start' && child === pid);
  const program = becameOf(rows).get(pid)?.path ?? (start ? start.slice(3).join(' ') : command[0]);
  throw Error(`BLOCKED: ${program} (process ${pid}) couldn't take the counting library${why ? `: ${why}` : ''}, so dyld stopped it and the run has no count. An x86_64 program, or a universal one started from a shell under Rosetta, runs translated: put a native arm64 build of it first on PATH (rustup's x86_64 ~/.cargo/bin/cargo: the arm64 toolchain's bin), or start the run from a native shell (arch -arm64)`);
}

// The CPU time at each QoS class count-children.c logs, summed, or null when any is missing.
const QOS_CLASSES = ['default', 'maintenance', 'background', 'utility', 'legacy', 'user-initiated', 'user-interactive'];
function sumQos(readings) {
  if (!readings.length || readings.some((qos) => qos?.length !== QOS_CLASSES.length || qos.some((time) => !Number.isSafeInteger(time) || time < 0))) return null;
  return QOS_CLASSES.map((_, index) => readings.reduce((sum, qos) => sum + qos[index], 0));
}

// Where two sides' CPU time ran, when more than half of it ran at different QoS classes (half the summed
// differences of their shares), or null when it didn't or can't be read.
function qosApart(current, base) {
  const shares = (qos) => {
    const total = qos?.reduce((sum, time) => sum + time, 0);
    return total ? qos.map((time) => time / total) : null;
  };
  const [now, then] = [shares(current), shares(base)];
  if (!now || !then || now.reduce((sum, share, index) => sum + Math.abs(share - then[index]), 0) / 2 <= 0.5) return null;
  const top = (side) => side.indexOf(Math.max(...side));
  return `the change ran ${(now[top(now)] * 100).toFixed(0)}% at ${QOS_CLASSES[top(now)]} QoS and the merge base ${(then[top(then)] * 100).toFixed(0)}% at ${QOS_CLASSES[top(then)]}`;
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
  // A captured run's stop reaches every process it started, a detached one too, and names them (#3433). The watcher
  // lists the run's tree twice a second while it runs.
  const watch = stream ? null : watchTree();
  try {
    watch?.arm();
    if (build) writeFileSync(counted, '');
    const argv = build ? [build.run, follow && build.library ? build.library : '-', ...command] : command;
    const env = build ? { ...bare(), DEEP_COUNT_LOG: counted } : bare();
    const loadStart = loadavg()[0];
    const started = performance.now();
    // A captured run leads its own process group: spawnSync stops only /usr/bin/time at the timeout or
    // maxBuffer, so the group is stopped with it, or the measured command and its children run on (#1322).
    const result = spawnSync('/usr/bin/time', [...flags, '-o', timing, ...argv], stream
      ? { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] }
      : { cwd, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, detached: true });
    const elapsedMs = performance.now() - started;
    const loadEnd = loadavg()[0];
    if (result.error) {
      // Planted (#3433.bf4b249a): the stop ends only the lead, by its group, and names it.
      const stopped = { stopped: [{ pid: result.pid, command: ['/usr/bin/time', ...argv].join(' ') }] };
      try {
        if (!stream && result.pid > 0) process.kill(-result.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      if (stopped) result.error.message += `; ${named(stopped)}`;
      throw result.error;
    }
    const report = readFileSync(timing, 'utf8');
    if (build && !stream) refusedLibrary(`${result.stdout}${result.stderr}`, readFileSync(counted, 'utf8'), command);
    const peakBytes = parsePeakRss(report, process.platform);
    const own = parseInstructions(report, process.platform);
    const { instructions, uncounted, qos } = build && !build.library ? countLinux(readFileSync(counted, 'utf8'))
      : !follow ? { instructions: own, uncounted: [], qos: null } : build && own !== null ? countChildren(readFileSync(counted, 'utf8'), command) : { instructions: null, uncounted: [], qos: null };
    return { elapsedMs, loadStart, loadEnd, cpuMs: parseCpuMs(report, process.platform), peakBytes, instructions, uncounted, qos, status: result.status, output: stream ? '' : result.stdout + result.stderr, stdout: stream ? '' : result.stdout };
  } finally {
    watch?.disarm();
    rmSync(directory, { recursive: true, force: true });
  }
}

// Alternates current and merge-base runs so both see the same machine load, and swaps which side runs first each
// round, so a cache one run leaves warm favors neither: one warmup round, then 20 rounds.
// Returns [current] or [current, base], each with its sample count, its instructions retired per round, in round order,
// the one-minute load at each round's start and end, what started a child no count covers, and its CPU time at each QoS
// class over its rounds.
export function measure(command, cwd, base) {
  const sides = base ? [[command, cwd], [base.command, base.cwd]] : [[command, cwd]];
  const samples = sides.map(() => []);
  for (let round = 0; round <= 20; round++) {
    const order = round % 2 ? [...sides.keys()].reverse() : [...sides.keys()];
    for (const side of order) {
      const [argv, directory] = sides[side];
      const result = measureOnce(argv, directory);
      if (result.status !== 0) throw Error(`${argv[0]} exited ${result.status}: ${result.output}`);
      if (round) samples[side].push({ ms: result.elapsedMs, peakBytes: result.peakBytes, instructions: result.instructions, load: { start: result.loadStart, end: result.loadEnd }, uncounted: result.uncounted, qos: result.qos });
    }
  }
  return samples.map((side) => ({ ...summarize(side), samples: side.length, instructions: side.map(({ instructions }) => instructions), loads: side.map(({ load }) => load), uncounted: [...new Set(side.flatMap(({ uncounted }) => uncounted))], qos: sumQos(side.map(({ qos }) => qos)) }));
}

// A rise in instructions retired is judged against 2%, by 10,000 sign flips decided at p under 0.01.
const FLOOR = 0.02, ALPHA = 0.01, FLIPS = 10_000, SEED = 1405;

// A seed's stream of 32-bit words: a Weyl sequence through murmur3's 32-bit finalizer.
function words(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    const h = Math.imul(state ^ (state >>> 16), 0x85ebca6b);
    const k = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (k ^ (k >>> 16)) >>> 0;
  };
}

// Judges a task against its merge base on the instructions retired of each alternated round. Each pair's
// log ratio, ln(current / base), is taken less ln(1.02), so a pair within one instruction of 2% sits at 0.
// Two seeded one-sided sign-flip tests read the sum of those against the same 10,000 flips of their
// signs: it FAILs when the flips reach the pairs' own sum at p under 0.01 (above 2%), and PASSes when they
// fall to it at p under 0.01 ("at least 2%" rejected); anything else is INCONCLUSIVE. One outlier pair
// moves the sum by its own size, never a margin for the rest. A count from code that waits by spinning or
// on a lock counts its waiting, so it moves with the schedule and the machine's load, and its pairs often
// can't tell. change is the median of current / base - 1, for the reason. A missing count makes it
// INCONCLUSIVE; uncounted says what started a child with no count.
export function judgeInstructions(pairs, uncounted = [], seed = SEED) {
  const count = (value) => Number.isSafeInteger(value) && value > 0;
  const missing = pairs.filter((pair) => !count(pair?.current) || !count(pair?.base)).length;
  if (!pairs.length || missing) {
    return { status: 'INCONCLUSIVE', pairs, change: null, seed, pAbove: null, pBelow: null, uncounted,
      reason: `instructions retired are missing in ${pairs.length ? `${missing} of ${pairs.length} pairs` : 'every pair: none were measured'}; ${uncounted.length ? `no count covers ${uncounted.join(', ')}` : "this host's /usr/bin/time reports no counter, or cc can't build the child counter"}` };
  }
  const differences = pairs.map(({ current, base }) => current / base - 1).sort((a, b) => a - b);
  const middle = differences.length / 2;
  const change = differences.length % 2 ? differences[Math.floor(middle)] : (differences[middle - 1] + differences[middle]) / 2;
  const shifted = pairs.map(({ current, base }) => (Math.abs(current - base * (1 + FLOOR)) <= 1 ? 0 : Math.log(current / base) - Math.log1p(FLOOR)));
  const observed = shifted.reduce((sum, value) => sum + value, 0);
  // Flips that reorder the same values may round apart.
  const tolerance = 1e-9 * shifted.reduce((sum, value) => sum + Math.abs(value), 0);
  const next = words(seed);
  let above = 1, below = 1;
  for (let flip = 0; flip < FLIPS; flip++) {
    let total = 0, bits = 0;
    for (let index = 0; index < shifted.length; index++) {
      if (index % 32 === 0) bits = next();
      total += (bits >>> (index % 32)) & 1 ? shifted[index] : -shifted[index];
    }
    if (total >= observed - tolerance) above++;
    if (total <= observed + tolerance) below++;
  }
  const pAbove = above / (FLIPS + 1), pBelow = below / (FLIPS + 1);
  const rose = `instructions retired changed ${(change * 100).toFixed(2)}% over the merge base (median of ${pairs.length} pairs)`;
  const read = `p ${pAbove.toPrecision(2)} that it's above 2%, p ${pBelow.toPrecision(2)} that it's under, seed ${seed}`;
  if (pAbove < ALPHA) return { status: 'FAIL', pairs, change, seed, pAbove, pBelow, reason: `${rose}: above 2% at ${read}` };
  if (pBelow < ALPHA) return { status: 'PASS', pairs, change, seed, pAbove, pBelow };
  return { status: 'INCONCLUSIVE', pairs, change, seed, pAbove, pBelow, uncounted, reason: `${rose}, and the pairs can't tell it from 2% at p under 0.01: ${read}` };
}

// Builds unmeasured, so a checkout and its merge base are both timed warm. The check lanes run
// the same builds and report their errors, so a failure here is left for them.
export function warm(cwd) {
  // Clippy keeps its own check artifacts, so the lint lane's exact command is warmed too (#594).
  const steps = [['npm', 'run', 'build'], ['cargo', 'test', '--workspace', '--locked', '--no-run'], ['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings']];
  // The #56 spike keeps its dependencies apart from the root's, and its benches are perf tasks.
  if (existsSync(join(cwd, 'spikes/hub-core/package-lock.json'))) steps.unshift(['npm', 'ci', '--prefix', 'spikes/hub-core', '--no-audit', '--no-fund']);
  for (const [command, ...args] of steps) spawnSync(command, args, { cwd, stdio: 'ignore', env: bare() });
}

// A copy of a tree made ready to run in: the checks and benches read git, so it gets its own throwaway repository,
// committed without the user's hooks or signing. Its origin/main is that commit, as on main itself, so checks that
// compare with main (repo-rules' size) do the same work on both sides instead of skipping it in the copy. Then its
// packages and warm builds, kept in CARGO_TARGET_DIR.
export function prepareCopy(directory) {
  const run = (command, args, options = {}) => execFileSync(command, args, { cwd: directory, encoding: 'utf8', timeout: 120_000, maxBuffer: 128 * 1024 * 1024, env: bare(), ...options });
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
// on each. The agent harness and the canvas cost writer import this list, and deep-show's copy is held to it (#1831).
export const references = [
  { name: 'Mac15,7 (M3 Pro, 36 GB)', model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, cores: 12 },
  { name: 'Mac15,12 (M3, 16 GB)', model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30, cores: 8 },
  { name: 'Mac17,10 (M5 Max, 64 GB)', model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 64 * 2 ** 30, cores: 18 },
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
// the reference Macs, is INCONCLUSIVE with the five runs attached. So is any run whose one-minute load average, read
// at its start or its end, is above the core count or can't be read: a loaded run counts neither way (design: How we
// know version 0 works). loads is one { start, end } per run.
export function judgeLimit({ limit, runs, fingerprint: machine, loads }) {
  if (!Array.isArray(runs) || runs.length !== 5 || runs.some((run) => !Number.isFinite(run) || run < 0))
    return { status: 'BLOCKED', limit, runs, reason: `a limit is judged on five readings taken after warm-up, got ${JSON.stringify(runs)}` };
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  const off = references.some((reference) => hardware.every((key) => machine?.[key] === reference[key])) ? []
    : [`${hardware.map((key) => `${key} is ${JSON.stringify(machine?.[key] ?? null)}`).join(', ')}: none of ${referenceNames}`];
  off.push(...conditions.filter(([key, value]) => machine?.[key] !== value).map(([key, value, label]) => `${label} is ${JSON.stringify(machine?.[key] ?? null)}, not ${JSON.stringify(value)}`));
  if (!machine?.macosBuild) off.push('the macOS build is missing');
  const cores = availableParallelism();
  const readings = Array.isArray(loads) && loads.length === runs.length ? loads.flatMap((load) => [load?.start, load?.end]) : null;
  if (!readings || readings.some((load) => !Number.isFinite(load) || load < 0)) off.push(`the load at each run's start and end can't be read: ${JSON.stringify(loads ?? null)}`);
  else if (readings.some((load) => load > cores)) off.push(`load ${Math.max(...readings)} at a run's start or end is above the ${cores} cores`);
  if (off.length) return { status: 'INCONCLUSIVE', limit, runs, margin, reason: `a reading, not a budget result: off the reference Macs (${referenceNames}; mains power, Low Power Mode off, thermal state nominal): ${off.join('; ')}` };
  if (runs.every((run) => run <= limit)) return { status: 'PASS', limit, runs, margin };
  if (runs.every((run) => run > limit * (1 + margin))) return { status: 'FAIL', limit, runs, margin, reason: `all five runs are over ${limit} by more than the ${(margin * 100).toFixed(1)}% margin` };
  return { status: 'INCONCLUSIVE', limit, runs, margin, reason: `the five runs are neither all within ${limit} nor all over it by more than the ${(margin * 100).toFixed(1)}% margin` };
}

// A budget is frozen once main has it, but where its value is an estimate, a measurement made before the change it
// judges may move it once, with the reason recorded (#12): only its limits change, and it gains the changeReason its
// merge base's entry doesn't have yet. A second move, or one with no reason, is refused like any other change.
const numbers = ({ limits, changeReason, ...rest } = {}) => rest;
const movedOnce = (current, established) => typeof current?.changeReason === 'string' && current.changeReason.trim() !== ''
  && !('changeReason' in established) && isDeepStrictEqual(numbers(current), numbers(established));
const frozen = (current, established) => isDeepStrictEqual(current, established) || movedOnce(current, established);
// A task's criteria say what it proves, not how it is judged: the budget window reads them as the merge base has them.
const definition = ({ criteria, ...task } = {}) => task;

// A count a task's run gives, which a ceiling in its limits may hold on any machine (#2665): `instructions`, the
// instructions retired of the command and every child it waits for, as measure counts them, or `report.<name>`, the
// number <name> in its report, the command's last stdout line that is a JSON object.
const isCount = (metric) => metric === 'instructions' || /^report\.\w+$/.test(metric);

// An approved proposal's item for one loosening of a task (#2665): the manifest, the task, the field, and its value at
// the merge base and in the change, as JavaScript prints a number, `none` for a limit removed, a command as JSON.
const shown = (value) => (value === undefined ? 'none' : Array.isArray(value) ? JSON.stringify(value) : String(value));
const proposal = (id, { field, before, after }) => `benchmarks/budgets.json › ${id} › ${field} ${shown(before)} → ${shown(after)}`;

/**
 * What a change does to a task main holds (#2665): each limit it lowers, as `{metric, old, new}`, and each loosening,
 * a limit raised or removed, a wider margin or a changed command, as `{field, before, after}`. A limit added or a margin
 * narrowed only tightens. `other` is any other field it changes; its criteria are free.
 */
function changesOf(current, established) {
  const lowered = [], loosened = [];
  for (const [metric, before] of Object.entries(established.limits)) {
    const after = current.limits?.[metric];
    if (after === undefined || after > before) loosened.push({ field: metric, before, after });
    else if (after < before) lowered.push({ metric, old: before, new: after });
  }
  if (current.margin > established.margin) loosened.push({ field: 'margin', before: established.margin, after: current.margin });
  if (!isDeepStrictEqual(current.command, established.command)) loosened.push({ field: 'command', before: established.command, after: current.command });
  const rest = ({ margin, command, limits, ...task }) => task;
  return { lowered, loosened, other: !isDeepStrictEqual(rest(definition(current)), rest(definition(established))) };
}

/** Why `run` isn't a measured full preflight on a reference Mac at a load below its cores (#3137); null when it is one. */
function unmeasured(run) {
  const mac = references.find(({ model }) => model === run?.machine);
  if (typeof run?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(run.date) || Number.isNaN(Date.parse(run.date))) return `its date ${shown(run?.date)} isn't a day, YYYY-MM-DD`;
  if (!mac) return `its machine ${shown(run.machine)} is none of the reference Macs' models (${references.map(({ model }) => model).join(', ')})`;
  if (!Number.isFinite(run.load) || run.load < 0 || run.load >= mac.cores) return `its load ${shown(run.load)} isn't below the ${mac.cores} cores of ${mac.name}`;
  if (!Number.isFinite(run.elapsedMs) || run.elapsedMs <= 0) return `its elapsedMs ${shown(run.elapsedMs)} isn't a time`;
  return null;
}

/**
 * The preflight's budget past its one move (#3137): it moves again only by an approved proposal, as a task's loosening
 * does (#2665), one item for each limit that changes, and records the measured full run it moves for as `measured`
 * ({date, machine, load, elapsedMs}), a run no earlier move recorded, with a changeReason of its own. Nothing else of
 * it changes. Throws, naming what's missing.
 */
function movePreflight(current, established, approved) {
  const rest = ({ limits, changeReason, measured, ...other } = {}) => other;
  const moves = current && Object.keys({ ...established.limits, ...current.limits }).filter((field) => current.limits?.[field] !== established.limits[field]).map((field) => ({ field, before: established.limits[field], after: current.limits?.[field] }));
  if (!moves?.length || !isDeepStrictEqual(rest(current), rest(established))) throw Error('Budget preflight changed or disappeared; restore its frozen definition');
  const refused = moves.filter((move) => !approved.includes(proposal('preflight', move)));
  if (refused.length) throw Error(`Budget preflight: ${refused.map(({ field, before, after }) => `its ${field} limit ${before === undefined ? `added at ${after}` : after === undefined ? `${before} removed` : `moved from ${before} to ${after}`}`).join('; ')}. It moves only by an approved proposal: restore it, or have the maintainer approve the commit with a signed tag under deep/approved/ holding ${refused.map((move) => `Approves: ${proposal('preflight', move)}`).join(', ')}`);
  const why = unmeasured(current.measured) ?? (isDeepStrictEqual(current.measured, established.measured) ? 'it is the run an earlier move recorded' : null);
  if (why) throw Error(`Budget preflight: a move records the measured full run it moves for as measured: {date, machine, load, elapsedMs}, and ${why}`);
  if (typeof current.changeReason !== 'string' || !current.changeReason.trim() || current.changeReason === established.changeReason) throw Error('Budget preflight: a move gives a reason of its own as changeReason, naming the measured run');
}

/**
 * Checks a manifest against its merge base's, and returns each limit the change lowers, `{id, metric, old, new}`.
 * Ceilings only move down (#2665): a task main holds may lower a limit or narrow its margin, and a raised or removed
 * limit, a wider margin or a changed command is refused, naming the task and the field, unless `approved`, the items of
 * the approvals on the change's commits, holds that loosening's proposal. Any other change to such a task is refused.
 */
export function validateBudgets(current, base, approved = []) {
  if (!Array.isArray(current?.tasks)) throw Error('Missing budget tasks');
  if (base?.preflight && !frozen(current.preflight, base.preflight)) movePreflight(current.preflight, base.preflight, approved);
  if (base?.harness && !frozen(current.harness, base.harness)) throw Error('Budget harness changed or disappeared; restore its frozen definition');
  const lowered = [], refused = [];
  for (const established of base?.tasks ?? []) {
    const task = current.tasks.find(({ id }) => id === established.id);
    if (task && frozen(definition(task), definition(established))) continue;
    const change = task && changesOf(task, established);
    if (!change || change.other) throw Error(`Budget ${established.id} changed or disappeared; restore its frozen definition`);
    refused.push(...change.loosened.filter((loosening) => !approved.includes(proposal(established.id, loosening))).map((loosening) => ({ id: established.id, ...loosening })));
    lowered.push(...change.lowered.map((lowering) => ({ id: established.id, ...lowering })));
  }
  if (refused.length) {
    const said = ({ id, field, before, after }) => `Budget ${id}: ${field === 'command' ? `its command changed from ${shown(before)} to ${shown(after)}`
      : field === 'margin' ? `its margin widened from ${before} to ${after}`
      : after === undefined ? `its ${field} limit ${before} removed` : `its ${field} limit raised from ${before} to ${after}`}`;
    const items = refused.map((loosening) => `Approves: ${proposal(loosening.id, loosening)}`).join(', ');
    throw Error(`${refused.map(said).join('; ')}. A ceiling only moves down: restore ${refused.length === 1 ? 'it' : 'them'}, or have the maintainer approve the commit with a signed tag under deep/approved/ holding ${items}`);
  }
  const ids = new Set();
  for (const task of [...current.tasks, ...(current.preflight ? [{ id: 'preflight', ...current.preflight }] : [])]) {
    if (!task.id || ids.has(task.id)) throw Error('Missing or duplicate budget id');
    ids.add(task.id);
    if (task.id !== 'preflight' && (!Array.isArray(task.command) || !task.command.length || task.command.some((part) => typeof part !== 'string' || !part))) throw Error(`${task.id}: invalid command`);
    if (!Number.isFinite(task.margin) || task.margin < 0) throw Error(`${task.id}: invalid margin`);
    if (typeof task.initialReason !== 'string' || !task.initialReason.trim()) throw Error(`${task.id}: first measurement requires a reason`);
    const allowed = (key) => (task.id === 'preflight' ? ['elapsedMs', 'peakBytes'].includes(key) : metrics.includes(key) || isCount(key));
    if (!task.limits || Object.entries(task.limits).some(([key, value]) => !allowed(key) || !Number.isFinite(value) || value <= 0)) throw Error(`${task.id}: invalid limits`);
  }
  if (!ids.size) throw Error('No budget task was measured');
  return lowered;
}

/** The items of the approvals on the commits from `base` to `head` (#1326), which may hold a budget's proposal. */
export function approvedItems(root, base, head) {
  const commits = execFileSync('git', ['rev-list', `${base}..${head}`], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean).map((sha) => ({ sha }));
  return [...readApprovals(root, { base, commits }, null).values()].flat();
}

// p95 has only absolute caps: between identical binaries on a shared machine, the tail of 20
// interleaved samples still moves past a 50% margin in a few runs out of a hundred, and p50 does not.
// time prints user and system CPU seconds each truncated to 10 ms, so a short run reads 0 CPU, and any
// reading may be up to 20 ms short: the base's counts as up to that much more (#1421).
export function compare(budget, current, base, keys = metrics) {
  const missing = (reading, metric) => !Number.isFinite(reading) || reading < 0 || (reading === 0 && metric !== 'cpuMs');
  for (const metric of keys) {
    if (missing(current[metric], metric)) throw Error(`${budget.id}: missing ${metric}`);
    if (budget.limits[metric] !== undefined && current[metric] >= budget.limits[metric]) throw Error(`${budget.id}: ${metric} ${current[metric]} reached cap ${budget.limits[metric]}`);
    if (base && missing(base[metric], metric)) throw Error(`${budget.id}: missing base ${metric}`);
    if (base && metric !== 'p95Ms' && current[metric] > (base[metric] + (metric === 'cpuMs' ? 20 : 0)) * (1 + budget.margin)) throw Error(`${budget.id}: ${metric} ${current[metric]} regressed beyond base ${base[metric]} + ${budget.margin * 100}%${metric === 'cpuMs' ? ", allowing 20 ms for time's truncation" : ''}`);
  }
  return base ? { status: 'PASS' } : { status: 'INITIAL', reason: budget.initialReason };
}

// A count's ceiling, judged on any machine (#2665): FAIL when every reading is over it, PASS when every one is within it,
// and INCONCLUSIVE when they straddle it or any reading is missing, null, which is never read as 0.
export function judgeCount({ limit, runs }) {
  const missing = runs.filter((reading) => !Number.isFinite(reading)).length;
  if (!runs.length || missing) return { status: 'INCONCLUSIVE', limit, runs, reason: `the count can't be read in ${missing} of ${runs.length} runs, and a count that can't be read is missing, never 0` };
  if (runs.every((reading) => reading > limit)) return { status: 'FAIL', limit, runs, reason: `every reading is over ${limit}: ${runs.join(', ')}` };
  if (runs.every((reading) => reading <= limit)) return { status: 'PASS', limit, runs };
  return { status: 'INCONCLUSIVE', limit, runs, reason: `the readings straddle ${limit}: ${runs.join(', ')}` };
}

/** The number `name` in a run's report, its last stdout line that is a JSON object; null when it can't be read. */
function reported(stdout, name) {
  try {
    const value = JSON.parse(stdout.trim().split('\n').filter((line) => line.trim().startsWith('{')).at(-1))[name];
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

// One task judged against its merge base, as perf and the budget window judge it: 20 alternated rounds a side, its
// limits on five runs after one untimed warm-up run, an instructions ceiling on the rounds' counts (every child
// counted), instructions retired where both sides ran, and the merge-base regression, whose message is `regression`.
// Each limit's verdict holds its value and readings. The limits and margin judged are the merge base's, since a change
// never moves its own budget (#2665), except an estimate moved once with its reason (#12). A command that won't run throws.
// The machine is read after the runs through `machineOf`, the caller's own fingerprint(), so a lane whose benchmark.mjs
// answers for the machine is judged on that answer (#1838).
export function judgeTask(budget, established, cwd, baseCwd, machineOf = fingerprint) {
  const held = established && !movedOnce(definition(budget), definition(established)) ? established : budget;
  const [now, then = null] = measure(budget.command, cwd, established && { command: established.command, cwd: baseCwd });
  const once = () => {
    const result = measureOnce(budget.command, cwd, false, undefined, false);
    if (result.status !== 0) throw Error(`${budget.command[0]} exited ${result.status}: ${result.output}`);
    return result;
  };
  const runs = Object.keys(held.limits).some((metric) => metric !== 'instructions') ? (once(), Array.from({ length: 5 }, once)) : [];
  const machine = machineOf();
  const loads = runs.map(({ loadStart, loadEnd }) => ({ start: loadStart, end: loadEnd }));
  const limits = Object.fromEntries(Object.entries(held.limits).map(([metric, limit]) => [metric, metric === 'instructions' ? judgeCount({ limit, runs: now.instructions })
    : isCount(metric) ? judgeCount({ limit, runs: runs.map(({ stdout }) => reported(stdout, metric.slice('report.'.length))) })
    : judgeLimit({ limit, runs: runs.map((run) => (metric === 'peakBytes' ? run.peakBytes : run.elapsedMs)), fingerprint: machine, loads })]));
  // Judged off the reference Macs too, where the limits are only readings; it never changes a limit's verdict. Sides that
  // ran at different QoS don't compare: what waits counts its waiting, so a count moves with how the side was scheduled.
  const judged = then && judgeInstructions(now.instructions.map((current, round) => ({ current, base: then.instructions[round] })), [...new Set([...now.uncounted, ...then.uncounted])]);
  const apart = judged?.change != null && qosApart(now.qos, then.qos);
  const instructions = apart ? { ...judged, status: 'INCONCLUSIVE', uncounted: judged.uncounted ?? [], reason: `${apart}, so their instructions retired don't compare; the counts alone read ${judged.status}${judged.reason ? `: ${judged.reason}` : ''}` } : judged;
  let outcome, regression = null;
  try {
    // compare holds only the merge-base regression here; the limits are judged above.
    outcome = compare({ ...budget, margin: held.margin, limits: {} }, now, then);
  } catch (error) {
    regression = error.message;
  }
  return { now, then, machine, loads, limits, instructions, outcome, regression };
}

// A task's report is its command's last stdout line; `<bench> judge` reads it on stdin and prints its verdict.
export function judgeTargets(budget, cwd) {
  const last = (out) => JSON.parse(out.trim().split('\n').at(-1));
  const ran = spawnSync(budget.command[0], budget.command.slice(1), { cwd, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 512 * 1024 * 1024, env: bare() });
  if (ran.status !== 0) return { status: 'BLOCKED', reason: `${budget.command.join(' ')} exited ${ran.status}: ${ran.stderr.slice(-1000)}` };
  const judged = spawnSync(budget.command[0], [budget.command[1], 'judge'], { cwd, encoding: 'utf8', input: JSON.stringify({ current: last(ran.stdout), base: null }), env: bare() });
  if (judged.status !== 0) return { status: 'BLOCKED', reason: `the judge exited ${judged.status}: ${judged.stderr.slice(-1000)}` };
  return last(judged.stdout);
}
