#!/usr/bin/env node
// Issue #2332 acceptance: node hub-ready.mjs --main <main checkout> --candidate <candidate checkout> [--rounds 20] [--out <dir>] [--only all|startup|memory]
// See README.md. Exit 0 only when all three criteria PASS; 1 on a FAIL; 2 when anything is INCONCLUSIVE or invalid.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { childrenOf, judge, judgeMemory, usableReply } from './judge.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const QUIET_WINDOW_MS = 250, QUIET_DELTA = 2_000_000, QUIET_WINDOWS = 3, SETTLE_MS = 20_000, STEP_MS = 30_000;

/** Reads live instruction counts through the one persistent helper. */
function counter(dir) {
  mkdirSync(dir, { recursive: true });
  const source = join(HERE, 'insn.c'), binary = join(dir, `insn-${sha(source).slice(0, 12)}`);
  if (!existsSync(binary)) execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', binary, source], { stdio: 'inherit' });
  const helper = spawn(binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = [];
  let buffer = '';
  helper.stdout.setEncoding('utf8').on('data', (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { waiting.shift()?.(Number(buffer.slice(0, i))); buffer = buffer.slice(i + 1); }
  });
  return {
    read: (pid) => new Promise((done) => { waiting.push(done); helper.stdin.write(`${pid}\n`); }),
    close: () => helper.kill(),
  };
}

/** One request on one connection as deep-hook makes it: the hub's hello, the request, the reply line with `exit`. */
function exchange(socket, request) {
  return new Promise((done, fail) => {
    const sock = net.connect(socket);
    const timer = setTimeout(() => { sock.destroy(); fail(Error(`no reply within ${STEP_MS} ms`)); }, STEP_MS);
    let buffer = '';
    sock.setEncoding('utf8').on('error', (e) => { clearTimeout(timer); fail(e); });
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify(request)}\n`);
        else if ('exit' in line || 'error' in line) { clearTimeout(timer); sock.destroy(); done(line); }
      }
    });
  });
}
const SESSION = '6f1c2b9e-1111-4222-8333-444455556666';
function request(home, event, payload, n) {
  const cwd = join(home, 'work');
  const base = { session_id: SESSION, transcript_path: join(home, '.claude', 'projects', 'work', `${SESSION}.jsonl`), cwd, hook_event_name: event };
  return { v: 1, agent: 'claude-code', event, seq: `${1_760_013_451_000_000_000n + BigInt(n)}`, id: `01K74FKZVK8Q2X5R7M${String(n).padStart(8, '0')}`, pid: process.pid, ppid: process.ppid, matched: [], payload: { ...base, ...payload } };
}
const CALLS = {
  sessionStart: (home) => request(home, 'SessionStart', { source: 'startup' }, 1),
  prompt: (home) => request(home, 'UserPromptSubmit', { prompt: 'make the auth middleware reject expired tokens in the handler' }, 2),
  preToolUse: (home) => request(home, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls src' }, tool_use_id: 'call_3' }, 3),
  // Positive control after the measured calls: a shipped guard must deny it.
  denied: (home) => request(home, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'pkill -f node' }, tool_use_id: 'call_4' }, 4),
};

/** The count once the hub has done the deferred work its call started: the count at the start of the first
 * of three consecutive quiet windows. A hub that never goes quiet within the bound is an invalid run. */
async function settled(live, pid) {
  const end = Date.now() + SETTLE_MS;
  let previous = await live.read(pid), mark = previous, quiet = 0;
  while (Date.now() < end) {
    await sleep(QUIET_WINDOW_MS);
    const now = await live.read(pid);
    if (!now) throw Error('the counter gave no reading');
    if (now - previous < QUIET_DELTA) {
      if (!quiet) mark = previous;
      if (++quiet === QUIET_WINDOWS) return mark;
    } else quiet = 0;
    previous = now;
  }
  throw Error(`the hub kept working for ${SETTLE_MS} ms after its reply`);
}

/** One fresh isolated home, one `deep hub run` with the checkout's shipped guards: start to ready, then the first
 * three held-hook calls, counted in the hub's own process. Children are logged apart by the perf lane's library. */
async function oneRun(side, tools, fingerprint) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2332-')));
  const run = { side: side.name, fingerprint, ok: false };
  let hub;
  try {
    mkdirSync(join(home, '.deepbuild'), { recursive: true });
    mkdirSync(join(home, 'work'));
    copyFileSync(join(side.dir, 'crates/deep-hook/default-rules.json'), join(home, '.deepbuild', 'rules.json'));
    const log = join(home, 'count.log');
    writeFileSync(log, '');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('DYLD_')));
    Object.assign(env, { HOME: home, DEEP_COUNT_LOG: log, DYLD_INSERT_LIBRARIES: tools.library });
    hub = spawn(process.execPath, [join(side.dir, 'packages/cli/dist/main.js'), 'hub', 'run'], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    hub.stderr.on('data', (c) => { stderr += c; });
    const exited = new Promise((done) => hub.once('exit', (code, signal) => done({ code, signal })));
    // Core-ready is the hub's own stdout line, not the early socket hello.
    const ready = await new Promise((done, fail) => {
      const timer = setTimeout(() => fail(Error('no ready line within 30 s')), 30_000);
      let text = '';
      hub.stdout.setEncoding('utf8').on('data', async (chunk) => {
        text += chunk;
        const line = text.split('\n').find((l) => l.includes('"ready"'));
        if (!line) return;
        hub.stdout.removeAllListeners('data');
        clearTimeout(timer);
        done({ line: JSON.parse(line), count: await tools.live.read(hub.pid) });
      });
      void exited.then(() => fail(Error(`the hub exited before ready: ${stderr.slice(0, 300)}`)));
    });
    if (ready.line.ready !== true || ready.line.pid !== hub.pid) throw Error(`ready line is not this hub's: ${JSON.stringify(ready.line)}`);
    if (!ready.count) throw Error('no instruction count at ready');
    run.ready = ready.count;
    // No settling between ready and SessionStart: work the hub moved to after the ready line is charged here.
    let before = ready.count;
    for (const phase of ['sessionStart', 'prompt', 'preToolUse']) {
      const reply = await exchange(ready.line.socket, CALLS[phase](home));
      const bad = usableReply(reply, { exit: 0 });
      if (bad) throw Error(`${phase}: ${bad}: ${JSON.stringify(reply).slice(0, 200)}`);
      const after = await settled(tools.live, hub.pid);
      run[phase] = after - before;
      before = after;
    }
    const denied = await exchange(ready.line.socket, CALLS.denied(home));
    const bad = usableReply(denied, { exit: 2, stderr: 'DeepBuild blocked' });
    if (bad) throw Error(`the shipped guard did not deny pkill by name: ${bad}`);
    const ledger = join(home, '.deepbuild', 'ledger.db');
    if (!existsSync(ledger) || statSync(ledger).size === 0) throw Error('the record has no ledger.db: the calls were not recorded');
    hub.kill('SIGTERM');
    const end = await Promise.race([exited, sleep(15_000).then(() => 'late')]);
    if (end === 'late') throw Error('the hub did not stop within 15 s of SIGTERM');
    await sleep(200);
    run.children = childrenOf(readFileSync(log, 'utf8'), hub.pid);
    run.ok = true;
  } catch (error) {
    run.error = error.message;
  } finally {
    if (hub && hub.exitCode === null && hub.signalCode === null) hub.kill('SIGKILL');
    rmSync(home, { recursive: true, force: true });
  }
  return run;
}

/** `benchmarks/hub.mjs idle`, from main's copy of the file for both sides (identical tooling), run against each
 * checkout's own packages through a symlink. */
function idleRun(side, tooling) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-2332-idle-'));
  try {
    mkdirSync(join(dir, 'benchmarks'));
    copyFileSync(tooling, join(dir, 'benchmarks', 'hub.mjs'));
    symlinkSync(join(side.dir, 'packages'), join(dir, 'packages'));
    symlinkSync(join(side.dir, 'node_modules'), join(dir, 'node_modules'));
    const out = execFileSync(process.execPath, [join(dir, 'benchmarks', 'hub.mjs'), 'idle'], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
    const reading = JSON.parse(out.trim().split('\n').pop());
    if (!Number.isSafeInteger(reading.rssBytes) || reading.rssBytes <= 0) throw Error(`no rssBytes: ${out}`);
    return { rssBytes: reading.rssBytes };
  } catch (error) {
    return { error: String(error.message).slice(0, 300) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function args() {
  const given = process.argv.slice(2), get = (name, fallback) => (given.includes(name) ? given[given.indexOf(name) + 1] : fallback);
  const main = get('--main'), candidate = get('--candidate');
  if (!main || !candidate) throw Error('usage: hub-ready.mjs --main <dir> --candidate <dir> [--rounds 20] [--out <dir>] [--only all|startup|memory]');
  return { sides: { main: { name: 'main', dir: resolve(main) }, candidate: { name: 'candidate', dir: resolve(candidate) } }, rounds: Number(get('--rounds', '20')), out: resolve(get('--out', join(tmpdir(), `deep-2332-${Date.now()}`))), only: get('--only', 'all') };
}

async function main() {
  const { sides, rounds, out, only } = args();
  mkdirSync(out, { recursive: true });
  const jsonl = join(out, 'runs.jsonl');
  const record = (row) => appendFileSync(jsonl, `${JSON.stringify(row)}\n`);
  const prerequisites = [];
  for (const { name, dir } of Object.values(sides)) {
    for (const file of ['packages/cli/dist/main.js', 'crates/deep-hook/default-rules.json', 'scripts/benchmark.mjs', 'scripts/count-children.c', 'node_modules']) if (!existsSync(join(dir, file))) prerequisites.push(`${name}: ${file} is missing (build the checkout first)`);
  }
  if (process.platform !== 'darwin') prerequisites.push('macOS is required: the instruction counter is the perf lane\'s macOS one');
  const done = { out, rounds, prerequisites, startedAt: new Date().toISOString(), main: sides.main.dir, candidate: sides.candidate.dir };
  const finish = (verdicts, extra = {}) => {
    const result = { ...done, ...extra, verdicts };
    writeFileSync(join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    for (const [name, v] of Object.entries(verdicts)) console.log(`${name.padEnd(14)} ${v.status}  n=${v.pairs ?? 0}  median ${v.medianDelta === null || v.medianDelta === undefined ? 'n/a' : `${(v.medianDelta * 100).toFixed(2)}%`}  pAbove=${v.pAbove?.toPrecision?.(3) ?? 'n/a'} pWithin=${v.pBelow?.toPrecision?.(3) ?? 'n/a'}  ${v.reason ?? ''}`);
    const statuses = Object.values(verdicts).map(({ status }) => status);
    process.exitCode = statuses.every((s) => s === 'PASS') ? 0 : statuses.includes('FAIL') ? 1 : 2;
    console.log(`result ${join(out, 'result.json')}`);
  };
  const unrun = (why) => ({ status: 'INCONCLUSIVE', pairs: 0, reason: why });
  if (prerequisites.length) return finish({ startToReady: unrun(prerequisites.join('; ')), sessionStart: unrun('unmet prerequisites'), prompt: unrun('unmet prerequisites'), preToolUse: unrun('unmet prerequisites'), idleMemory: unrun('unmet prerequisites') });

  const { fingerprint } = await import(pathToFileURL(join(sides.main.dir, 'scripts/benchmark.mjs')));
  const cache = join(out, 'tools');
  mkdirSync(cache, { recursive: true });
  const library = join(cache, `count-${sha(join(sides.main.dir, 'scripts/count-children.c')).slice(0, 12)}.dylib`);
  if (!existsSync(library)) execFileSync('cc', ['-O2', '-Wall', '-Werror', '-dynamiclib', '-o', library, join(sides.main.dir, 'scripts/count-children.c')], { stdio: 'inherit' });
  const live = counter(cache);
  const tools = { live, library };
  let interrupted = false;
  process.on('SIGINT', () => { interrupted = true; });
  const order = (round) => (round % 2 ? [sides.candidate, sides.main] : [sides.main, sides.candidate]);
  const pairsOf = (key, rows) => rows.filter((r) => r.main?.ok && r.candidate?.ok).map((r) => ({ current: r.candidate[key], base: r.main[key] }));
  const verdicts = {};
  try {
    const rows = [], fingerprints = [];
    if (only !== 'memory') {
      for (let round = 0; round < rounds && !interrupted; round++) {
        const row = { round };
        for (const side of order(round)) row[side.name] = await oneRun(side, tools, fingerprint());
        rows.push(row);
        record({ kind: 'hub', ...row });
      }
      for (const [name, key, limit] of [['startToReady', 'ready', 0.75], ['sessionStart', 'sessionStart', 1], ['prompt', 'prompt', 1], ['preToolUse', 'preToolUse', 1]]) {
        const pairs = pairsOf(key, rows), invalid = rows.length - pairs.length;
        verdicts[name] = { ...judge(pairs, limit), ...(invalid ? { status: 'INCONCLUSIVE', reason: `${invalid} of ${rows.length} rounds invalid: ${rows.flatMap((r) => [r.main?.error, r.candidate?.error]).filter(Boolean)[0]}` } : {}), interrupted };
        verdicts[name].children = { main: rows.map((r) => r.main?.children).filter(Boolean), candidate: rows.map((r) => r.candidate?.children).filter(Boolean) };
      }
    } else for (const name of ['startToReady', 'sessionStart', 'prompt', 'preToolUse']) verdicts[name] = unrun('not run (--only memory)');
    if (only !== 'startup') {
      const tooling = join(sides.main.dir, 'benchmarks/hub.mjs');
      const idle = [];
      for (let round = 0; round < rounds && !interrupted; round++) {
        const row = { round };
        for (const side of order(round)) { const fp = fingerprint(); fingerprints.push(fp); row[side.name] = { ...idleRun(side, tooling), fingerprint: fp }; }
        idle.push(row);
        record({ kind: 'idle', ...row });
      }
      const pairs = idle.filter((r) => r.main.rssBytes && r.candidate.rssBytes).map((r) => ({ current: r.candidate.rssBytes, base: r.main.rssBytes }));
      const bad = idle.length - pairs.length;
      verdicts.idleMemory = { ...judgeMemory(pairs, fingerprints), ...(bad ? { status: 'INCONCLUSIVE', reason: `${bad} idle rounds failed` } : {}), interrupted, toolingSha256: sha(tooling) };
    } else verdicts.idleMemory = unrun('not run (--only startup)');
    if (interrupted) for (const v of Object.values(verdicts)) if (v.status === 'PASS') { v.status = 'INCONCLUSIVE'; v.reason = `interrupted: ${v.reason}`; }
    finish(verdicts, { fingerprintOfFirstRun: rows[0]?.main?.fingerprint ?? fingerprints[0] ?? null });
  } finally {
    live.close();
  }
}
main().catch((error) => { console.error(error.stack); process.exitCode = 2; });
