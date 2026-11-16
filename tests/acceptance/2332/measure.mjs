// #2332 acceptance measurements, external to the code under test: node tests/acceptance/2332/measure.mjs --main <main checkout> [--change <checkout>] [--rounds 20] [--idle-rounds 5] [--out file]
// Each round, for each side in turn (the side that goes first swaps every round, after one untimed warm-up round):
// a fresh isolated home holding the shipped guard entries (crates/deep-hook/default-rules.json, as benchmarks/deep-hook.mjs
// seeds them), `deep hub run` started on it, and the hub process's own instructions retired (proc_pid_rusage, the counter the
// perf lane's scripts/count-children.c reads; children apart) read the moment its `ready` line arrives on stdout, which the
// hub writes once its core has started, not when its socket answers. Then, with no wait in between, the first SessionStart,
// UserPromptSubmit and PreToolUse as deep-hook sends them; each one's cost is the hub's instructions from the reading before it
// to 300 ms after its reply (so work moved to just after ready lands on the first request, not nowhere).
// Idle memory is `node benchmarks/hub.mjs idle` of each checkout, alternated.
// A count that can't be read is missing, and every verdict then is BLOCKED or INCONCLUSIVE, never PASS.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const REQUESTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse'];
const SESSION = '6f1c2b9e-1111-4222-8333-444455559999';

/** The compiled rusage reader, or { blocked } saying why there is none. */
export function counter() {
  if (process.platform !== 'darwin') return { blocked: `BLOCKED: no instruction counter on ${process.platform}; the perf lane counts on macOS only` };
  const source = join(HERE, 'rusage.c');
  const dir = join(process.env.XDG_CACHE_HOME || join(homedir(), 'Library/Caches'), 'deepbuild-perf', `rusage-${createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 16)}`);
  const bin = join(dir, 'rusage');
  if (!existsSync(bin)) {
    const building = mkdtempSync(`${dir}-`);
    try {
      mkdirSync(join(dir, '..'), { recursive: true });
      execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', join(building, 'rusage'), source], { stdio: 'pipe' });
      renameSync(building, dir);
    } catch (error) {
      if (!existsSync(bin)) return { blocked: `BLOCKED: cc could not build rusage.c: ${String(error.stderr ?? error.message).slice(0, 300)}` };
    } finally {
      rmSync(building, { recursive: true, force: true });
    }
  }
  return { bin };
}
/** Instructions retired by a live process, or null when unreadable. */
function read(bin, pid) {
  const r = spawnSync(bin, [String(pid)], { encoding: 'utf8' });
  const n = Number(r.stdout.trim());
  return r.status === 0 && Number.isSafeInteger(n) && n > 0 ? n : null;
}

function request(home, kind) {
  const cwd = join(home, 'work');
  const base = { session_id: SESSION, transcript_path: join(home, '.claude', 'projects', 'work', `${SESSION}.jsonl`), cwd, hook_event_name: kind };
  const payload = kind === 'SessionStart' ? { ...base, source: 'startup' }
    : kind === 'UserPromptSubmit' ? { ...base, prompt: 'make the auth middleware reject expired tokens in the handler' }
      : { ...base, tool_name: 'Bash', tool_input: { command: 'ls src' }, tool_use_id: 'call_2332' };
  const at = REQUESTS.indexOf(kind) + 1;
  return { v: 1, agent: 'claude-code', event: kind, seq: `${1_760_013_460_000_000_000n + BigInt(at)}`, id: `01K74FKZVK8Q2X5R7R${String(at).padStart(8, '0')}`, pid: process.pid, ppid: process.ppid, matched: [], payload };
}
/** One connection as deep-hook makes it: hello, the request, the reply line. */
function exchange(socket, req) {
  return new Promise((done, fail) => {
    const sock = net.connect(socket);
    let buffer = '';
    const timer = setTimeout(() => { sock.destroy(); fail(Error(`no reply to ${req.event} within 30 s`)); }, 30_000);
    sock.setEncoding('utf8');
    sock.on('error', fail);
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify(req)}\n`);
        else if ('exit' in line || 'error' in line) { clearTimeout(timer); sock.destroy(); done(line); }
      }
    });
  });
}

/** One hub on a fresh home of `checkout`: { ready: instructions at its ready line, costs: { SessionStart, ... } } or { problem }. */
export async function oneRun(checkout, bin) {
  const cli = join(checkout, 'packages/cli/dist/main.js');
  const rules = join(checkout, 'crates/deep-hook/default-rules.json');
  if (!existsSync(cli)) return { problem: `BLOCKED: ${cli} is not built (npm ci && npm run build in ${checkout})` };
  if (!existsSync(rules)) return { problem: `BLOCKED: ${rules} is missing` };
  const home = realpathSync(mkdtempSync('/tmp/deep-2332-'));
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  mkdirSync(join(home, 'work'));
  writeFileSync(join(home, '.deepbuild', 'rules.json'), readFileSync(rules));
  const hub = spawn(process.execPath, [cli, 'hub', 'run'], { env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  let pid = null;
  try {
    const stderr = [];
    hub.stderr.on('data', (c) => stderr.push(c));
    const ready = await new Promise((done, fail) => {
      let buffer = '';
      const timer = setTimeout(() => fail(Error('the hub printed no ready line within 60 s')), 60_000);
      hub.stdout.on('data', (chunk) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const text = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          try {
            const line = JSON.parse(text);
            if (line.ready === true) { clearTimeout(timer); done(line); return; }
          } catch { /* not the ready line */ }
        }
      });
      hub.on('exit', (code) => { clearTimeout(timer); fail(Error(`the hub exited ${code} before ready: ${Buffer.concat(stderr).toString().slice(0, 300)}`)); });
    });
    pid = ready.pid;
    let last = read(bin, pid);
    if (last === null) return { problem: `INCONCLUSIVE: the instruction count of hub pid ${pid} is missing at ready` };
    const atReady = last;
    const costs = {};
    for (const kind of REQUESTS) {
      const reply = await exchange(ready.socket, request(home, kind));
      if ('error' in reply) return { problem: `BLOCKED: the hub refused the first ${kind}: ${JSON.stringify(reply).slice(0, 200)}` };
      await sleep(300);
      const now = read(bin, pid);
      if (now === null) return { problem: `INCONCLUSIVE: the instruction count of hub pid ${pid} is missing after ${kind}` };
      costs[kind] = now - last;
      last = now;
    }
    return { ready: atReady, costs };
  } catch (error) {
    return { problem: `BLOCKED: ${error.message}` };
  } finally {
    for (const p of new Set([hub.pid, pid])) { try { if (p) process.kill(p, 'SIGTERM'); } catch { /* gone */ } }
    if (hub.exitCode === null && hub.signalCode === null) await new Promise((done) => { hub.on('exit', done); setTimeout(done, 5000); });
    rmSync(home, { recursive: true, force: true });
  }
}

/** `rounds` alternated paired rounds after one untimed warm-up; { pairs: [{ main, change }], problem }. */
export async function pairedRuns(main, change, rounds) {
  const c = counter();
  if (c.blocked) return { problem: c.blocked, pairs: [] };
  const sides = { main, change };
  const pairs = [];
  for (let round = 0; round <= rounds; round++) {
    const order = round % 2 ? ['change', 'main'] : ['main', 'change'];
    const got = {};
    for (const side of order) {
      got[side] = await oneRun(sides[side], c.bin);
      if (got[side].problem) return { problem: `${side}: ${got[side].problem}`, pairs };
    }
    if (round) pairs.push(got);
  }
  return { pairs };
}

// --- judgement ---
const median = (values) => { const s = [...values].sort((a, b) => a - b); const m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; };
function words(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    const h = Math.imul(state ^ (state >>> 16), 0x85ebca6b);
    const k = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (k ^ (k >>> 16)) >>> 0;
  };
}
/** Seeded one-sided sign-flip tests of sum(ln(change / (target * main))): pAbove small = over the target, pBelow small = under it. */
export function flips(pairs, target, seed = 2332) {
  const shifted = pairs.map(({ main, change }) => Math.log(change / (main * target)));
  const observed = shifted.reduce((a, b) => a + b, 0);
  const tolerance = 1e-9 * shifted.reduce((a, b) => a + Math.abs(b), 0);
  const next = words(seed);
  let above = 1, below = 1;
  for (let f = 0; f < 10_000; f++) {
    let total = 0, bits = 0;
    for (let i = 0; i < shifted.length; i++) {
      if (i % 32 === 0) bits = next();
      total += (bits >>> (i % 32)) & 1 ? shifted[i] : -shifted[i];
    }
    if (total >= observed - tolerance) above++;
    if (total <= observed + tolerance) below++;
  }
  return { pAbove: above / 10_001, pBelow: below / 10_001, seed };
}
const valid = (n) => Number.isSafeInteger(n) && n > 0;
/** AC1: the change's start-to-ready instructions at least 25% under main's, over `rounds` (20 required) alternated pairs. */
export function judgeReady(runs, rounds = 20) {
  const pairs = runs.pairs.map(({ main, change }) => ({ main: main.ready, change: change.ready }));
  if (runs.problem) return { status: runs.problem.startsWith('BLOCKED') ? 'BLOCKED' : 'INCONCLUSIVE', reason: runs.problem, pairs };
  if (!pairs.length || pairs.some((p) => !valid(p.main) || !valid(p.change))) return { status: 'INCONCLUSIVE', reason: 'instructions at ready are missing', pairs };
  const change = median(pairs.map((p) => p.change / p.main - 1));
  const t = flips(pairs, 0.75);
  const out = { change, ...t, pairs };
  if (change > -0.25) return { status: 'FAIL', reason: `hub instructions at ready changed ${(change * 100).toFixed(2)}% (median of ${pairs.length} pairs); at least -25% is required`, ...out };
  if (t.pBelow >= 0.01) return { status: 'INCONCLUSIVE', reason: `median ${(change * 100).toFixed(2)}% but the pairs can't tell it from -25% at p under 0.01 (p ${t.pBelow.toPrecision(2)})`, ...out };
  if (pairs.length < rounds) return { status: 'INCONCLUSIVE', reason: `${pairs.length} rounds, 20 required`, ...out };
  return { status: 'PASS', ...out };
}
/** AC2: the first request of `kind` retires no more instructions in the hub than on main: FAIL when the pairs show it above main at p under 0.01. */
export function judgeFirst(runs, kind, rounds = 20) {
  const pairs = runs.pairs.map(({ main, change }) => ({ main: main.costs[kind], change: change.costs[kind] }));
  if (runs.problem) return { status: runs.problem.startsWith('BLOCKED') ? 'BLOCKED' : 'INCONCLUSIVE', reason: runs.problem, pairs };
  if (!pairs.length || pairs.some((p) => !valid(p.main) || !valid(p.change))) return { status: 'INCONCLUSIVE', reason: `instructions for the first ${kind} are missing or not above 0`, pairs };
  const change = median(pairs.map((p) => p.change / p.main - 1));
  const t = flips(pairs, 1);
  const out = { change, ...t, pairs };
  if (t.pAbove < 0.01) return { status: 'FAIL', reason: `the first ${kind} retires ${(change * 100).toFixed(2)}% more than main (median of ${pairs.length} pairs, p ${t.pAbove.toPrecision(2)} that it is above)`, ...out };
  if (pairs.length < rounds) return { status: 'INCONCLUSIVE', reason: `${pairs.length} rounds, 20 required`, ...out };
  return { status: 'PASS', ...out };
}

/** AC3: benchmarks/hub.mjs idle of each checkout, alternated; the change's median resident bytes no more than main's. */
export function idleRuns(main, change, rounds) {
  const rss = { main: [], change: [] };
  for (let round = 0; round <= rounds; round++) {
    for (const side of round % 2 ? ['change', 'main'] : ['main', 'change']) {
      const dir = side === 'main' ? main : change;
      const r = spawnSync(process.execPath, [join(dir, 'benchmarks/hub.mjs'), 'idle'], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
      let bytes = NaN;
      try { bytes = JSON.parse(r.stdout.trim().split('\n').pop()).rssBytes; } catch { /* missing */ }
      if (r.status !== 0 || !valid(bytes)) return { problem: `BLOCKED: ${side}'s benchmarks/hub.mjs idle gave no rssBytes (exit ${r.status}): ${(r.stderr || r.stdout).slice(0, 300)}`, rss };
      if (round) rss[side].push(bytes);
    }
  }
  return { rss };
}
export function judgeIdle({ rss, problem }, rounds = 5) {
  if (problem) return { status: 'BLOCKED', reason: problem, rss };
  const [m, c] = [median(rss.main), median(rss.change)];
  if (c > m) return { status: 'FAIL', reason: `idle resident memory median ${c} B on the change, ${m} B on main`, rss, main: m, change: c };
  if (rss.main.length < rounds) return { status: 'INCONCLUSIVE', reason: `${rss.main.length} rounds, ${rounds} required`, rss, main: m, change: c };
  return { status: 'PASS', rss, main: m, change: c };
}

/** The budget task for hub start to ready: present, valid against main's budgets, from main's first reading, and its command runs and reads a hub instruction count. */
export function judgeBudget(main, change) {
  const read = (dir) => JSON.parse(readFileSync(join(dir, 'benchmarks/budgets.json'), 'utf8'));
  const [then, now] = [read(main), read(change)];
  const task = now.tasks.find((t) => /ready/i.test(t.id) && t.command.join(' ').includes('benchmarks/hub.mjs'));
  if (!task) return { status: 'FAIL', reason: 'benchmarks/budgets.json has no hub start-to-ready task (an id with "ready" whose command runs benchmarks/hub.mjs)' };
  const why = [];
  if (!/#2332/.test(task.initialReason ?? '')) why.push('its initialReason does not name #2332');
  if (!/\b(main|merge base)\b/i.test(task.initialReason ?? '')) why.push('its initialReason does not say the first reading is from main');
  if (!/instruction/i.test(task.initialReason ?? '')) why.push('its initialReason does not say it counts instructions');
  if (then.tasks.some((t) => t.id === task.id)) why.push('main already has a task of this id, so it is not a first reading');
  return { status: why.length ? 'FAIL' : 'PASS', reason: why.join('; ') || undefined, task: task.id, command: task.command };
}
/** The task's own command, run on `dir` as the perf lane runs it: exits 0 and prints JSON with a positive instruction count of the hub. */
export function runBudgetCommand(dir, command) {
  const r = spawnSync(command[0] === 'node' ? process.execPath : command[0], command.slice(1), { cwd: dir, encoding: 'utf8', timeout: 300_000 });
  if (r.status !== 0) return { status: 'BLOCKED', reason: `${command.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout).slice(0, 300)}` };
  let out;
  try { out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return { status: 'FAIL', reason: 'its last output line is not JSON' }; }
  const key = Object.keys(out).find((k) => /instruction/i.test(k));
  return key && valid(out[key]) ? { status: 'PASS', key, value: out[key] } : { status: 'INCONCLUSIVE', reason: `its reading has no positive instruction count: ${JSON.stringify(out).slice(0, 200)}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
  const main = arg('main');
  const change = arg('change', resolve(HERE, '../../..'));
  if (!main) { console.error('usage: measure.mjs --main <main checkout> [--change <checkout>] [--rounds 20] [--idle-rounds 5] [--out file]'); process.exit(2); }
  const rounds = Number(arg('rounds', 20)), idleRounds = Number(arg('idle-rounds', 5));
  const runs = await pairedRuns(main, change, rounds);
  const report = { main, change, rounds, 'AC1 start to ready': judgeReady(runs, 20) };
  for (const kind of REQUESTS) report[`AC2 first ${kind}`] = judgeFirst(runs, kind, 20);
  report['AC3 idle rss'] = judgeIdle(idleRuns(main, change, idleRounds), 5);
  report['Proof budget task'] = judgeBudget(main, change);
  const text = JSON.stringify(report, null, 1);
  if (arg('out')) writeFileSync(arg('out'), text);
  for (const [k, v] of Object.entries(report)) if (v?.status) console.log(`${v.status} ${k}${v.reason ? `: ${v.reason}` : ''}`);
  process.exit(Object.values(report).every((v) => !v?.status || v.status === 'PASS') ? 0 : 1);
}
