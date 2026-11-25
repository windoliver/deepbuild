// One child under a deadline and a memory limit, for the #1857 acceptance tests (README: What bounds each child).
//
//   node bounded.mjs <spec.json> <result.json>
//
// The spec: { command, args, cwd, lines: [{ text, deadlineMs }], exitMs, limitBytes, sampleMs }. The child is started
// once. Each line is written to its stdin in turn and one line of its stdout is awaited as that line's answer, for at
// most the line's deadline; after the last answer its stdin is closed and it has exitMs to end. All the while its
// resident memory is read by PID (`ps -o rss=`) every sampleMs, and a reading over limitBytes stops it. A child that
// passes a deadline or the limit is stopped by PID (SIGKILL to it and to each process under it, never by name), and
// the result says that it had to be. On macOS the child runs under `/usr/bin/time -l`, whose report gives the kernel's
// own peak for it (maximum resident set size), killed or not; elsewhere the peak is null, never 0.
//
// The result: { spawned, error?, timed, answers: [{ text | null, ms }], stopped: null | { why: 'memory' | 'deadline' |
// 'exit', line, bytes?, afterMs? }, exit: { code, signal } | null, peakBytes, footprintBytes, sampledPeakBytes,
// samples, stderrTail, wallMs }. `ms` is how long a line's answer took from the moment the line was written.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [specFile, resultFile] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specFile, 'utf8'));
const TIME = '/usr/bin/time';
const timed = process.platform === 'darwin' && existsSync(TIME);
const began = performance.now();

const result = {
  spawned: false, timed, answers: [], stopped: null, exit: null, peakBytes: null, footprintBytes: null,
  sampledPeakBytes: 0, samples: 0, stderrTail: '', wallMs: 0,
};
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  result.wallMs = performance.now() - began;
  writeFileSync(resultFile, JSON.stringify(result));
  process.exit(0);
}

const child = spawn(timed ? TIME : spec.command, timed ? ['-l', spec.command, ...spec.args] : spec.args, { cwd: spec.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', () => undefined);

/** Every process under `root`, deepest first, from one `ps` listing. */
function under(root) {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  const rows = (ps.stdout ?? '').split('\n').map((line) => line.trim().split(/\s+/).map(Number)).filter(([pid, ppid]) => Number.isInteger(pid) && Number.isInteger(ppid));
  const found = [];
  const walk = (parent) => { for (const [pid, ppid] of rows) if (ppid === parent && pid !== ps.pid) { walk(pid); found.push(pid); } };
  walk(root);
  return found;
}
/** The process the limits are for: the child itself, or under `time` the one process it started. */
let target = timed ? null : child.pid ?? null;
const findTarget = () => { if (target === null && child.pid) target = under(child.pid).at(-1) ?? null; return target; };

let ended = false;
function stop(why, line, extra = {}) {
  if (result.stopped || ended) return;
  result.stopped = { why, line, ...extra };
  // By PID only: each process under the child, then the child itself when nothing stands between.
  for (const pid of child.pid ? under(child.pid) : []) try { process.kill(pid, 'SIGKILL'); } catch { /* it has just ended */ }
  if (!timed && child.pid) try { process.kill(child.pid, 'SIGKILL'); } catch { /* it has just ended */ }
  // deadline: `time` reports once its child is gone; one that hasn't ended 10 s on is killed by its PID too.
  setTimeout(() => { if (!ended && child.pid) try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } }, 10_000).unref();
}

// The memory limit: the child's resident memory, read by PID.
// deadline: the limit's watch; all it can do is stop a child that passed its memory limit.
const watch = setInterval(() => {
  const pid = findTarget();
  if (pid === null || ended) return;
  const kb = Number(spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).stdout?.trim());
  if (!Number.isFinite(kb) || kb <= 0) return;
  result.samples += 1;
  result.sampledPeakBytes = Math.max(result.sampledPeakBytes, kb * 1024);
  if (kb * 1024 > spec.limitBytes) stop('memory', result.answers.length < spec.lines.length ? result.answers.length : null, { bytes: kb * 1024 });
}, spec.sampleMs);

// The child's stdout, one line at a time, to whoever waits for the next.
let pending = '';
const lines = [];
let waiter = null;
const wake = () => { if (waiter) { const w = waiter; waiter = null; w(); } };
child.stdout.setEncoding('utf8').on('data', (chunk) => {
  pending += chunk;
  for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
    lines.push(pending.slice(0, at));
    pending = pending.slice(at + 1);
  }
  wake();
});
let stderr = '';
child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-64 * 1024); });

child.on('error', (error) => { result.error = String(error.message ?? error); ended = true; clearInterval(watch); wake(); finish(); });
child.on('spawn', () => { result.spawned = true; });
child.on('close', (code, signal) => {
  ended = true;
  clearInterval(watch);
  result.exit = { code, signal };
  const read = (name) => { const found = new RegExp(`(\\d+)\\s+${name}`).exec(stderr); return found ? Number(found[1]) : null; };
  if (timed) {
    result.peakBytes = read('maximum resident set size');
    result.footprintBytes = read('peak memory footprint');
  }
  // The child's own words, without the lines of `time`'s report.
  result.stderrTail = stderr.split('\n').filter((line) => !/^\s+\d+(\.\d+)?\s+\S/.test(line)).join('\n').slice(-2000);
  wake();
  // Whatever is still writing or waiting below gives up within a turn of the loop.
  setImmediate(finish);
});

/** The next stdout line, or null once `ms` have passed, the child has ended, or it was stopped. */
function nextLine(ms) {
  return new Promise((done) => {
    let timer = null;
    const look = () => {
      if (lines.length) { clearTimeout(timer); done(lines.shift()); } else if (ended || result.stopped) { clearTimeout(timer); done(null); } else waiter = look;
    };
    // deadline: bounds the wait for one answer; a child still silent then is stopped by PID.
    timer = setTimeout(() => { waiter = null; done(null); }, ms);
    look();
  });
}

for (const [index, line] of spec.lines.entries()) {
  const sent = performance.now();
  child.stdin.write(`${line.text}\n`);
  const text = await nextLine(line.deadlineMs);
  const ms = performance.now() - sent;
  result.answers.push({ text, ms });
  if (text === null) {
    if (!ended && !result.stopped) stop('deadline', index, { afterMs: ms });
    break;
  }
}
if (!ended && !result.stopped) {
  child.stdin.end();
  // deadline: once its input is closed the child has exitMs to end, then it is stopped by PID.
  setTimeout(() => stop('exit', null, { afterMs: spec.exitMs }), spec.exitMs).unref();
}
// deadline: the runner's own last resort, past every deadline it was given: stop the child and report.
setTimeout(() => { stop('deadline', null, { afterMs: performance.now() - began }); setTimeout(finish, 12_000); }, spec.lines.reduce((sum, line) => sum + line.deadlineMs, 0) + spec.exitMs + 30_000).unref();
