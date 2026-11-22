// Shared by the #2332 redraft checks. It reaches the code only through what the issue names: `deep hub run`
// (packages/cli/dist/main.js) with its stdout ready line and its socket, the hook protocol of the design
// (#interfaces), benchmarks/hub.mjs idle, and the exports of scripts/benchmark.mjs (judgeInstructions,
// fingerprint, judgeLimit). The change is this checkout; main is the built checkout DEEP_2332_BASE names.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const here = fileURLToPath(new URL('.', import.meta.url));
export const change = realpathSync(process.env.DEEP_2332_CHANGE ?? fileURLToPath(new URL('../../../../', import.meta.url)));
export const base = process.env.DEEP_2332_BASE ? realpathSync(process.env.DEEP_2332_BASE) : null;
export const evidenceDir = process.env.DEEP_2332_EVIDENCE ?? '/private/tmp/deepbuild-2332.tQD2Ik/evidence/closure/redraft';
export const ROUNDS = 20;
export const SEED = 2332;
// A hub is quiet when its own count grows by at most this over each of three 200 ms windows in a row.
export const QUIET = Number(process.env.DEEP_2332_QUIET ?? 1_000_000);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const cliOf = (side) => join(side, 'packages/cli/dist/main.js');
export const median = (values) => { const v = [...values].sort((a, b) => a - b); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };

export async function benchmark() {
  return import(pathToFileURL(join(change, 'scripts/benchmark.mjs')).href);
}

// The one counter: a built read-instructions.c, the same proc_pid_rusage as scripts/count-children.c, for both sides.
let reader;
export function readerBuild() {
  if (reader) return reader;
  const directory = mkdtempSync(join(tmpdir(), 'deep-2332-reader-'));
  reader = join(directory, 'read-instructions');
  execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', reader, join(here, 'read-instructions.c')], { stdio: 'pipe' });
  return reader;
}
/** The process's own instructions retired so far, or null: never 0 for a read that failed. */
export function instructionsOf(pid) {
  const result = spawnSync(readerBuild(), [String(pid)], { encoding: 'utf8' });
  const count = Number(result.stdout);
  return result.status === 0 && Number.isSafeInteger(count) && count > 0 ? count : null;
}

/** Waits until the process's count grows by at most `quiet` over three 200 ms windows in a row, or `limitMs` passes. */
export async function settle(pid, { quiet = QUIET, limitMs = 20_000 } = {}) {
  const t0 = Date.now();
  let last = instructionsOf(pid);
  let calm = 0;
  while (last !== null && Date.now() - t0 < limitMs) {
    await sleep(200);
    const now = instructionsOf(pid);
    if (now === null) return { count: null, settled: false, ms: Date.now() - t0 };
    calm = now - last <= quiet ? calm + 1 : 0;
    last = now;
    if (calm >= 3) return { count: now, settled: true, ms: Date.now() - t0 };
  }
  return { count: last, settled: false, ms: Date.now() - t0 };
}

/**
 * Judges a change against main on paired counts at `threshold` (change / base), with the design's two seeded
 * one-sided sign-flip tests, at p under 0.01. Pairs are { change, base }. FAIL: the change is above the
 * threshold. PASS: "at least the threshold" is rejected. Anything else, a missing or zero count and a pair
 * count other than 20 included, is INCONCLUSIVE. judgeInstructions tests against 2%, so base is scaled by
 * threshold / 1.02, which moves its line to the threshold and nothing else.
 */
export async function judgeAt(pairs, threshold) {
  const { judgeInstructions } = await benchmark();
  const whole = (value) => Number.isSafeInteger(value) && value > 0;
  const scaled = pairs.map((pair) => ({ current: pair?.change, base: whole(pair?.base) ? Math.round((pair.base * threshold) / 1.02) : pair?.base }));
  const verdict = judgeInstructions(scaled, [], SEED);
  const ratios = pairs.every((pair) => whole(pair?.change) && whole(pair?.base)) ? pairs.map((pair) => pair.change / pair.base) : null;
  const out = { status: verdict.status, threshold, pairs: pairs.length, medianRatio: ratios ? median(ratios) : null, pAbove: verdict.pAbove, pBelow: verdict.pBelow, seed: SEED, counts: pairs, reason: verdict.reason };
  if (pairs.length !== ROUNDS) return { ...out, status: 'INCONCLUSIVE', reason: `${ROUNDS} alternated pairs are judged, got ${pairs.length}` };
  if (out.status === 'PASS' && !(out.medianRatio <= threshold)) return { ...out, status: 'INCONCLUSIVE', reason: 'the median ratio is not within the threshold' };
  return out;
}

/** Whether the OS reads a reference Mac, on mains, Low Power Mode off and thermal state nominal, by the code's own judgeLimit. */
export async function machineReading() {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const read = judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: machine, loads: Array.from({ length: 5 }, () => ({ start: 0, end: 0 })) });
  return { machine, ok: read.status === 'PASS', reason: read.reason ?? null };
}

// ---- the hook protocol, over the hub's socket ----
const ULID = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
  let time = Date.now();
  let head = '';
  for (let i = 0; i < 10; i++, time = Math.floor(time / 32)) head = ULID[time % 32] + head;
  return head + [...randomBytes(16)].map((byte) => ULID[byte % 32]).join('');
}
function hookRequest(home, event, extra, tool) {
  const session = '6f1c2b9e-2332-4222-8333-444455556666';
  const payload = { session_id: session, transcript_path: join(home, '.claude', 'projects', 'work', `${session}.jsonl`), cwd: join(home, 'work'), hook_event_name: event, ...extra };
  return { v: 1, agent: 'claude-code', event, seq: `${BigInt(Date.now()) * 1_000_000n + BigInt(tool)}`, id: ulid(), pid: process.pid, ppid: process.ppid, matched: [], payload };
}
export const hooks = (home) => [
  hookRequest(home, 'SessionStart', { source: 'startup' }, 1),
  hookRequest(home, 'UserPromptSubmit', { prompt: 'make the auth middleware reject expired tokens in the login handler' }, 2),
  hookRequest(home, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls src' }, tool_use_id: 'call_1' }, 3),
];

/** One request on its own connection, as deep-hook makes it: hello, the request, its acknowledgement, then its reply. */
export function exchange(socket, request, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`INVALID: no reply to ${request.event} within ${timeoutMs} ms`)); }, timeoutMs);
    let buffer = '';
    let acked = false;
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify(request)}\n`);
        else if ('ack' in line) acked = line.ack === request.id;
        else if ('exit' in line || 'error' in line) {
          clearTimeout(timer);
          sock.destroy();
          if (!acked || line.v !== 1 || !Number.isInteger(line.exit) || typeof line.stdout !== 'string') reject(Error(`INVALID: ${request.event} got no acknowledgement of its id or no well-formed reply: ${JSON.stringify(line)}`));
          else resolve(line);
        }
      }
    });
  });
}

/** The ids the record holds, read as the app does, with the control token. */
export function recordedIds(home, socket) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    const ids = new Set();
    let buffer = '';
    let after = 0;
    const ask = () => sock.write(`${JSON.stringify({ v: 1, id: 'r', method: 'events.read', params: { after, limit: 10_000 } })}\n`);
    const timer = setTimeout(() => { sock.destroy(); reject(Error('INVALID: the record could not be read within 15 s')); }, 15_000);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        try {
        if (line.hello) sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: readFileSync(join(home, '.deepbuild', 'control.token'), 'utf8').trim() })}\n`);
        else if (line.role) ask();
        else if (line.id === 'r') {
          if (!line.result) { clearTimeout(timer); sock.destroy(); reject(Error(`INVALID: events.read answered ${JSON.stringify(line)}`)); return; }
          for (const event of line.result.events) ids.add(event.id);
          if (!line.result.events.length) { clearTimeout(timer); sock.destroy(); resolve(ids); return; }
          after = line.result.log_pos;
          ask();
        }
        } catch (error) { clearTimeout(timer); sock.destroy(); reject(Error(`INVALID: the record could not be read: ${error.message}`)); return; }
      }
    });
  });
}

function readyLine(child) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(Error('INVALID: no ready line within 60 s')), 60_000);
    child.on('exit', (code) => { clearTimeout(timer); reject(Error(`INVALID: the hub exited ${code} before its ready line`)); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line;
        try { line = JSON.parse(buffer.slice(0, i)); } catch { line = null; }
        buffer = buffer.slice(i + 1);
        if (line?.ready === true) { clearTimeout(timer); resolve(line); return; }
      }
    });
  });
}

/**
 * One round on one side: a fresh home with that side's shipped guard entries, `deep hub run`, the count at the
 * stdout ready line (the hub is stopped for the read, so nothing after the line leaks into it), the count at
 * quiescence, then the first SessionStart, UserPromptSubmit and PreToolUse, each judged by the growth from one
 * quiet count to the next. The record must then hold all three events. A round that can't show that throws:
 * it is never retried or dropped, so a run with one is INCONCLUSIVE.
 */
export async function hubRound(side, cli = cliOf(side)) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2332-')));
  let hub;
  try {
    mkdirSync(join(home, '.deepbuild'), { mode: 0o700 });
    mkdirSync(join(home, 'work'));
    copyFileSync(join(side, 'crates/deep-hook/default-rules.json'), join(home, '.deepbuild', 'rules.json'));
    hub = spawn(process.execPath, [cli, 'hub', 'run'], { cwd: home, env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'ignore'] });
    const ready = await readyLine(hub);
    if (ready.pid !== hub.pid) throw Error(`INVALID: the ready line names pid ${ready.pid}, not the hub process ${hub.pid}`);
    process.kill(hub.pid, 'SIGSTOP');
    const atReady = instructionsOf(hub.pid);
    process.kill(hub.pid, 'SIGCONT');
    const quiet = await settle(hub.pid);
    const replies = [];
    const steps = [];
    let before = quiet;
    const requests = hooks(home);
    for (const request of requests) {
      replies.push(await exchange(ready.socket, request));
      const after = await settle(hub.pid);
      steps.push({ event: request.event, instructions: before.count !== null && after.count !== null ? after.count - before.count : null, settled: after.settled });
      before = after;
    }
    const held = await recordedIds(home, ready.socket);
    const lost = requests.filter(({ id }) => !held.has(id)).map(({ event }) => event);
    if (!existsSync(join(home, '.deepbuild', 'control.token')) || lost.length) throw Error(`INVALID: the record holds no event with the id of ${lost.join(', ') || 'any hook'}`);
    return { atReady, settledTotal: quiet.count, readySettled: quiet.settled, steps, replies: replies.map(({ exit }) => exit) };
  } finally {
    if (hub?.pid && hub.exitCode === null) {
      const exited = new Promise((resolve) => hub.on('exit', resolve));
      hub.kill('SIGTERM');
      const forced = setTimeout(() => hub.kill('SIGKILL'), 10_000);
      await exited;
      clearTimeout(forced);
    }
    rmSync(home, { recursive: true, force: true });
  }
}

/** `node benchmarks/hub.mjs idle` of one side: its resident bytes, with the machine read from the OS before and after. */
export async function idleRound(side) {
  const before = await machineReading();
  const result = spawnSync(process.execPath, [join(side, 'benchmarks/hub.mjs'), 'idle'], { cwd: side, encoding: 'utf8', timeout: 120_000 });
  const after = await machineReading();
  const rssBytes = Number(result.status === 0 ? JSON.parse(result.stdout.trim().split('\n').pop()).rssBytes : NaN);
  return { rssBytes, before, after, exit: result.status };
}

/** Both sides, 20 rounds, each round swapping which side runs first. */
export async function alternated(run) {
  const rounds = [];
  for (let round = 0; round < ROUNDS; round++) {
    const row = {};
    for (const name of round % 2 ? ['base', 'change'] : ['change', 'base']) row[name] = await run(name === 'base' ? base : change);
    rounds.push(row);
  }
  return rounds;
}

export function save(name, value) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, name), `${JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v), 2)}\n`);
}

const unsettled = (round) => [round.change, round.base].some((side) => !side.readySettled || side.steps.some((step) => !step.settled));
/** The verdicts on 20 hub rounds: start to ready at 0.75, each first hook and the total at quiescence at 1 (0% margin). */
export async function hubVerdicts(rounds) {
  const pick = (get) => rounds.map((round) => ({ change: get(round.change), base: get(round.base) }));
  const verdicts = {
    ready: await judgeAt(pick((side) => side.atReady), 0.75),
    sessionStart: await judgeAt(pick((side) => side.steps[0].instructions), 1),
    prompt: await judgeAt(pick((side) => side.steps[1].instructions), 1),
    preToolUse: await judgeAt(pick((side) => side.steps[2].instructions), 1),
    settledTotal: await judgeAt(pick((side) => side.settledTotal), 1),
  };
  // A count that never settled is a floor of what the step retires, so it can't clear a limit.
  if (rounds.some(unsettled)) for (const [name, verdict] of Object.entries(verdicts)) if (name !== 'ready' && verdict.status === 'PASS') verdicts[name] = { ...verdict, status: 'INCONCLUSIVE', reason: 'a hub did not reach quiescence within 20 s in some round' };
  return verdicts;
}
/** Idle RSS at 1 (never more than main): INCONCLUSIVE unless every run's machine, read before and after it, is a reference Mac as the design says. */
export async function idleVerdict(rounds) {
  const verdict = await judgeAt(rounds.map((round) => ({ change: round.change.rssBytes, base: round.base.rssBytes })), 1);
  const off = rounds.flatMap((round) => [round.change, round.base]).flatMap((run) => [run.before, run.after]).find((reading) => !reading?.ok);
  if (off) return { ...verdict, status: 'INCONCLUSIVE', reason: `not a reference Mac on mains, Low Power Mode off, thermal nominal: ${off.reason ?? 'unreadable'}` };
  return verdict;
}
