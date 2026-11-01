// The hub across churn (issue #824): node benchmarks/hub-churn.mjs [--cycles n] [--home dir] [--merge-base].
// A hub on a temp home runs fixed cycles: a session starts, ten tool calls with their hooks, an ask created and answered,
// a check run, a promise armed and woken, an extension reloaded (installed again, so its running copy stops and the new
// one loads) and the session ending. After a warm-up of 100 cycles, its retained heap after a full collection, all its
// threads together, and its resident memory are read every 100 cycles. The readings come through the hub's inspector,
// so the hub needs no method of its own and the merge base's hub is measured just as this one is. It prints the readings
// as one JSON line, then PASS, FAIL or BLOCKED, and stops the hub it started by PID.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WARMUP = 100;
const EVERY = 100;
/** The issue's limits over 5,000 cycles, per 1,000 cycles, so a shorter run scales. 1 MB is 10^6 bytes. */
const HEAP_PER_1000 = 200_000;
const RSS_PER_1000 = 2_000_000;
const STEP_MS = 60_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mb = (bytes) => `${(bytes / 1e6).toFixed(3)} MB`;
/** A reading that can't be had, or a cycle that can't finish: BLOCKED, never PASS. */
class Blocked extends Error {}
/** What a signal must stop or remove on the way out, as a lane killed partway does. */
const leaving = new Set();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const leave of leaving) leave(); process.exit(1); });

function flag(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}

/** The hub's inspector over its WebSocket: its main thread, and each worker thread through NodeWorker. */
async function inspect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Blocked(`the inspector at ${url} refused the connection, so a full collection can't be forced`));
  });
  let n = 0;
  const waiting = new Map();
  const workers = new Map();
  const send = (method, params, session) => new Promise((resolve, reject) => {
    const id = ++n;
    // A worker gone between the call and its answer never answers.
    const timer = setTimeout(() => { waiting.delete(id); reject(new Blocked(`${method}: the inspector gave no answer`)); }, 5 * STEP_MS);
    waiting.set(id, { resolve, reject, method, timer });
    const text = JSON.stringify({ id, method, params });
    socket.send(session ? JSON.stringify({ id: ++n, method: 'NodeWorker.sendMessageToWorker', params: { sessionId: session, message: text } }) : text);
  });
  const settle = (message) => {
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Blocked(`${pending.method}: ${message.error.message}`));
    else pending.resolve(message.result);
  };
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'NodeWorker.attachedToWorker') workers.set(message.params.sessionId, message.params.workerInfo.title);
    else if (message.method === 'NodeWorker.detachedFromWorker') workers.delete(message.params.sessionId);
    else if (message.method === 'NodeWorker.receivedMessageFromWorker') settle(JSON.parse(message.params.message));
    else settle(message);
  };
  socket.onclose = () => { for (const { reject, method, timer } of waiting.values()) { clearTimeout(timer); reject(new Blocked(`${method}: the inspector closed`)); } waiting.clear(); };
  await send('NodeWorker.enable', { waitForDebuggerOnStart: false });
  await sleep(50);
  const threads = () => [undefined, ...workers.keys()];
  const value = async (expression, session) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, includeCommandLineAPI: true }, session);
    if (exceptionDetails) throw new Blocked(`${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  };
  return {
    close: () => socket.close(),
    /** The retained heap of every thread after a full collection, and the process's resident memory. */
    async memory() {
      let heapBytes = 0;
      for (const session of threads()) {
        await send('HeapProfiler.collectGarbage', {}, session);
        await send('HeapProfiler.collectGarbage', {}, session);
        heapBytes += await value('process.memoryUsage().heapUsed', session);
      }
      const rssBytes = await value('process.memoryUsage().rss', undefined);
      if (!Number.isSafeInteger(heapBytes) || heapBytes <= 0) throw new Blocked(`the retained heap read ${heapBytes}`);
      if (!Number.isSafeInteger(rssBytes) || rssBytes <= 0) throw new Blocked(`resident memory read ${rssBytes}`);
      return { heapBytes, rssBytes };
    },
    /** Timers not yet finished, across its threads. The hub's are unref'd, so only the heap can count them. */
    async timers() {
      let count = 0;
      for (const session of threads()) {
        const { result: proto } = await send('Runtime.evaluate', { expression: '(() => { const t = setTimeout(() => {}, 0); clearTimeout(t); return Object.getPrototypeOf(t); })()' }, session);
        const { objects } = await send('Runtime.queryObjects', { prototypeObjectId: proto.objectId, objectGroup: 'churn' }, session);
        const { result } = await send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.filter((t) => !t._destroyed && t._idleTimeout >= 0).length; }', returnByValue: true }, session);
        count += result.value;
        await send('Runtime.releaseObjectGroup', { objectGroup: 'churn' }, session);
      }
      return count;
    },
  };
}

/** The sockets the process holds and the processes under it, from the OS. */
function fromOs(pid) {
  const lsof = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof';
  const inet = spawnSync(lsof, ['-n', '-P', '-a', '-p', String(pid), '-i', '-F', 'f'], { encoding: 'utf8' });
  const unix = spawnSync(lsof, ['-n', '-P', '-a', '-p', String(pid), '-U', '-F', 'f'], { encoding: 'utf8' });
  if (inet.error || unix.error) throw new Blocked(`lsof can't count the hub's sockets: ${(inet.error ?? unix.error).message}`);
  const count = (out) => out.split('\n').filter((line) => line.startsWith('f')).length;
  const table = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  if (table.error || table.status) throw new Blocked(`ps can't count the hub's children: ${table.error?.message ?? table.stderr}`);
  const kids = new Map();
  for (const row of table.stdout.split('\n')) {
    const [child, parent] = row.trim().split(/\s+/);
    if (parent) kids.set(parent, [...(kids.get(parent) ?? []), child]);
  }
  let children = 0;
  const under = (parent) => { for (const child of kids.get(parent) ?? []) { children++; under(child); } };
  under(String(pid));
  const sockets = count(inet.stdout) + count(unix.stdout);
  // The hub holds its own listening socket, so none read means no reading.
  if (sockets < 1) throw new Blocked('lsof counted no sockets on the hub, which listens on one');
  return { sockets, children };
}
/**
 * The least of each count over ten seconds. A reload's old process or a tick's helper comes and goes, so one reading can
 * hold one more than the hub keeps; what it left behind stays in every reading.
 */
async function openCounts(pid, inspector) {
  let least = fromOs(pid);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const next = fromOs(pid);
    least = { sockets: Math.min(least.sockets, next.sockets), children: Math.min(least.children, next.children) };
  }
  return { ...least, timers: await inspector.timers() };
}

/** One request and its reply on a connection of its own, as deep-hook makes them. */
function hook(socket, request) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    sock.setEncoding('utf8');
    sock.on('error', reject);
    // Closed before it named a role, or refused: the caller tries again until the hub's own time is up.
    sock.on('close', () => reject(Error('the hub closed the connection')));
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify(request)}\n`);
        else if ('exit' in line || 'error' in line) { sock.destroy(); resolve(line); }
      }
    });
  });
}
/** A connection under one role: `call` resolves with a reply, `onFrame` gets each stream frame. */
function connect(socket, hello) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    const waiting = new Map();
    let buffer = '';
    let n = 0;
    const conn = {
      onFrame: () => undefined,
      call: (method, params) => within(new Promise((done) => {
        const id = `c${++n}`;
        waiting.set(id, done);
        sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
      }), method),
      close: () => sock.destroy(),
    };
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify({ v: 1, ...hello })}\n`);
        else if (line.role) { conn.role = line.role; resolve(conn); }
        else if (line.error && !line.id) reject(Error(JSON.stringify(line.error)));
        else if (line.event) conn.onFrame(line.event);
        else if (waiting.has(line.id)) { waiting.get(line.id)(line); waiting.delete(line.id); }
      }
    });
  });
}
const within = (promise, what) => {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Blocked(`${what}: nothing within ${STEP_MS / 1000} s`)), STEP_MS).unref(); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
/** A ULID now, with a counter for its random part: unique and ordered. */
function ulid() {
  let s = '';
  let value = (BigInt(Date.now()) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}

/** The package each cycle installs again: it does nothing but load, in a process of its own. */
async function churnPackage(cli, home) {
  const { packageDigest } = await import(new URL('../../extension-host/dist/index.js', `file://${cli}`).href);
  const dir = join(home, 'churn-package');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.ts'), 'export default function (): void {}\n');
  const manifest = { id: 'bench/churn', version: '1.0.0', digest: `d1:${'0'.repeat(64)}`, checks: [] };
  writeFileSync(join(dir, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), JSON.stringify(manifest));
  return dir;
}

/** The fixed cycles against a hub, read through its inspector, and the hub stopped by PID. */
async function run({ cli, home, cycles }) {
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const work = join(home, 'work');
  const transcripts = join(home, '.claude', 'projects', 'work');
  mkdirSync(work, { recursive: true });
  mkdirSync(transcripts, { recursive: true });
  const confirm = join(home, 'confirm');
  writeFileSync(confirm, 'confirmed');
  // As `deep setup` does: an ask's deadline comes from these settings.
  const { draftAskSettings } = await import(new URL('../../asks/dist/index.js', `file://${cli}`).href);
  await draftAskSettings(root);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key === 'DEEP_HUB_PLANT' || !/^(DEEP_|CLAUDE|ANTHROPIC|OPENAI|CODEX|GH_TOKEN|GITHUB_TOKEN|NODE_OPTIONS)/.test(key)));
  // V8's optimizing tiers keep compiling long after warm-up: about 0.7 MB over 500 cycles, as much as the leaks this looks for.
  const hub = spawn(process.execPath, ['--inspect=127.0.0.1:0', '--no-opt', '--no-maglev', '--no-sparkplug', cli, 'hub', 'run'], { cwd: work, env: { ...env, HOME: home, DEEP_HUB_TEST_CONFIRM: confirm }, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise((resolve) => hub.on('exit', resolve));
  leaving.add(() => hub.kill('SIGTERM'));
  let stderr = '';
  hub.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  let inspector;
  const conns = [];
  try {
    const socket = join(root, 'hub.sock');
    const t0 = performance.now();
    let cliConn, app;
    for (;;) {
      try {
        const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
        app = await connect(socket, { hello: 'app', token });
        cliConn = await connect(socket, { hello: 'cli', token });
        break;
      } catch {
        if (hub.exitCode !== null) throw new Blocked(`the hub exited ${hub.exitCode}: ${stderr}`);
        if (performance.now() - t0 > STEP_MS) throw new Blocked(`the hub did not answer: ${stderr}`);
        await sleep(20);
      }
    }
    conns.push(app, cliConn);
    const url = /ws:\/\/\S+/.exec(stderr)?.[0];
    if (!url) throw new Blocked(`the hub offers no inspector, so a full collection can't be forced: ${stderr}`);
    inspector = await inspect(url);
    // A platform that can't take the reading is BLOCKED before any cycle is spent on it.
    await inspector.memory();

    let end = 0;
    for (;;) {
      const { result } = await app.call('events.read', { after: end, limit: 10_000 });
      if (!result.events.length) break;
      end = result.log_pos;
    }
    await app.call('stream.subscribe', { after: end });
    const seen = [];
    const wanted = [];
    app.onFrame = (event) => {
      const at = wanted.findIndex(({ test }) => test(event));
      if (at >= 0) wanted.splice(at, 1)[0].done(event);
      else seen.push(event);
    };
    const frame = (what, test) => {
      const at = seen.findIndex(test);
      if (at >= 0) return Promise.resolve(seen.splice(at, 1)[0]);
      return within(new Promise((done) => wanted.push({ test, done })), what);
    };
    const parent = { pid: process.pid, start: execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim() };
    const pkg = await churnPackage(cli, home);
    let seq = BigInt(Date.now()) * 1_000_000n;

    const cycle = async (n) => {
      const session = randomUUID();
      const transcript = join(transcripts, `${session}.jsonl`);
      writeFileSync(transcript, '');
      const fire = async (event, extra = {}) => {
        const reply = await within(hook(socket, {
          v: 1, agent: 'claude-code', event, seq: String(seq += 1000n), id: ulid(), pid: process.pid, ppid: process.pid, matched: [],
          payload: { session_id: session, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra },
        }), `cycle ${n}: ${event}`);
        if (reply.error) throw new Blocked(`cycle ${n}: ${event}: ${JSON.stringify(reply.error)}`);
      };
      const of = (kind) => (event) => event.kind === kind && (event.session_id ?? event.session) === session;
      seen.length = 0;
      await fire('SessionStart', { source: 'startup' });
      await fire('UserPromptSubmit', { prompt: 'what does the deploy say?' });
      for (let i = 0; i < 10; i++) {
        const call = { tool_name: 'Bash', tool_input: { command: `ls src/${i}` }, tool_use_id: `toolu_${n}_${i}` };
        await fire('PreToolUse', call);
        await fire('PostToolUse', { ...call, tool_response: { stdout: '', stderr: '', exit_code: 0 } });
      }

      const mcp = await within(connect(socket, { hello: 'mcp', parent, cwd: work }), `cycle ${n}: the MCP hello`);
      if (mcp.role !== `mcp:${session}`) throw new Blocked(`cycle ${n}: the MCP connection didn't bind to its session: it is ${mcp.role}`);
      const asked = mcp.call('mcp.call', { tool: 'deep_ask', arguments: { kind: 'choice', question: `Which header for screen ${n}?`, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommended: 'a', steps: null, where: null, why: null, check: null, subject: null } });
      const refused = asked.then((reply) => { if (reply.error) throw new Blocked(`cycle ${n}: deep_ask: ${JSON.stringify(reply.error)}`); return new Promise(() => undefined); });
      const created = await Promise.race([frame(`cycle ${n}: ask.created`, of('ask.created')), refused]);
      const answer = await within(cliConn.call('ask.answer', { ask: `ask:${created.id}`, option: 'a' }), `cycle ${n}: ask.answer`);
      if (answer.error) throw new Blocked(`cycle ${n}: ask.answer: ${JSON.stringify(answer.error)}`);
      await within(asked, `cycle ${n}: deep_ask`);
      mcp.close();

      const started = await within(app.call('run.start', { check: 'churn', claim: `claim:${ulid()}`, commit: '0'.repeat(40), argv: ['/usr/bin/true'], cwd: work }), `cycle ${n}: run.start`);
      if (started.error) throw new Blocked(`cycle ${n}: run.start: ${JSON.stringify(started.error)}`);
      await frame(`cycle ${n}: run.finished`, (event) => event.kind === 'run.finished' && event.subject === started.result.run);

      await fire('Stop', { last_assistant_message: "I'll check the deploy again in half a second." });
      await frame(`cycle ${n}: promise.set`, of('promise.set'));
      await frame(`cycle ${n}: promise.due`, of('promise.due'));
      await fire('UserPromptSubmit', { prompt: 'and now?' });
      await frame(`cycle ${n}: promise.woken`, of('promise.woken'));

      const installed = await within(cliConn.call('extension.install', { from: pkg }), `cycle ${n}: extension.install`);
      if (installed.error || installed.result?.status !== 'installed' || installed.result.not_loaded) throw new Blocked(`cycle ${n}: the extension didn't reload: ${JSON.stringify(installed.error ?? installed.result)}`);

      await fire('SessionEnd', { reason: 'other' });
      await frame(`cycle ${n}: session.end`, of('session.end'));
      rmSync(transcript, { force: true });
    };

    for (let n = 0; n < WARMUP; n++) await cycle(n);
    const readings = [{ cycle: 0, ...(await inspector.memory()) }];
    const afterWarmup = await openCounts(hub.pid, inspector);
    for (let n = 1; n <= cycles; n++) {
      await cycle(WARMUP + n);
      if (n % EVERY === 0) readings.push({ cycle: n, ...(await inspector.memory()) });
    }
    if (cycles % EVERY !== 0) readings.push({ cycle: cycles, ...(await inspector.memory()) });
    const afterLast = await openCounts(hub.pid, inspector);
    const [first, last] = [readings[0], readings.at(-1)];
    const heapGrowthBytes = last.heapBytes - first.heapBytes;
    const rssGrowthBytes = last.rssBytes - first.rssBytes;
    return {
      bench: 'hub-churn', cycles, warmup: WARMUP, every: EVERY, readings, heapGrowthBytes, rssGrowthBytes,
      heapGrowthPer1000Bytes: Math.round((heapGrowthBytes * 1000) / cycles), rssGrowthPer1000Bytes: Math.round((rssGrowthBytes * 1000) / cycles),
      open: { afterWarmup, afterLast },
    };
  } finally {
    inspector?.close();
    for (const conn of conns) conn.close();
    hub.kill('SIGTERM');
    const killing = setTimeout(() => hub.kill('SIGKILL'), 30_000);
    await exited;
    clearTimeout(killing);
  }
}
/** The merge base's hub through these same cycles, side by side with this one; without it there is no comparison, so BLOCKED. */
async function mergeBaseSide() {
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const commit = git('merge-base', 'HEAD', 'origin/main');
  const copy = realpathSync(mkdtempSync('/tmp/deep-churn-base-'));
  const done = (fields) => { rmSync(copy, { recursive: true, force: true }); return { commit, ...fields }; };
  try {
    const archive = spawnSync('/usr/bin/git', ['archive', commit], { cwd: ROOT, maxBuffer: 2 ** 31 });
    execFileSync('tar', ['-xf', '-', '-C', copy], { input: archive.stdout, maxBuffer: 2 ** 31 });
    execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: copy, stdio: 'ignore' });
    // A first build can fail on declaration order; the second passes.
    if (spawnSync('npm', ['run', 'build', '--workspaces'], { cwd: copy, stdio: 'ignore' }).status) execFileSync('npm', ['run', 'build', '--workspaces'], { cwd: copy, stdio: 'ignore' });
    return { copy, commit, done };
  } catch (error) {
    done({});
    throw new Blocked(`the merge base ${commit} can't be built here: ${error.message}`);
  }
}
function runBase(side, cycles) {
  // Beside the copy, never in it: a package's sandbox can't read the copy's package.json, which node looks for above it.
  const scratch = realpathSync(mkdtempSync('/tmp/deep-churn-base-home-'));
  const home = join(scratch, 'h');
  mkdirSync(home);
  const { DEEP_HUB_PLANT: _plant, ...env } = process.env;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--cli', join(side.copy, 'packages/cli/dist/main.js'), '--cycles', String(cycles), '--home', home], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    side.stop = () => child.kill('SIGTERM');
    leaving.add(() => { child.kill('SIGTERM'); rmSync(side.copy, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); });
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { out += chunk; });
    child.on('close', () => {
      rmSync(scratch, { recursive: true, force: true });
      const line = out.split('\n').find((text) => text.startsWith('{"bench"'));
      if (!line) return resolve(side.done({ blocked: `the merge base ${side.commit} can't run the cycles: ${out.split('\n').find((text) => text.startsWith('BLOCKED')) ?? 'it printed no readings'}` }));
      const { readings, heapGrowthBytes, rssGrowthBytes, heapGrowthPer1000Bytes, rssGrowthPer1000Bytes, open } = JSON.parse(line);
      resolve(side.done({ readings, heapGrowthBytes, rssGrowthBytes, heapGrowthPer1000Bytes, rssGrowthPer1000Bytes, open }));
    });
  });
}

const cycles = Number(flag('cycles') ?? 5000);
if (!Number.isSafeInteger(cycles) || cycles < 1) throw Error(`--cycles takes a whole number of cycles, not ${flag('cycles')}`);
const given = flag('home');
const home = given ?? join(realpathSync(mkdtempSync('/tmp/deep-churn-')), 'h');
mkdirSync(home, { recursive: true });
if (!given) leaving.add(() => rmSync(join(home, '..'), { recursive: true, force: true }));
let base, beside;
try {
  base = process.argv.includes('--merge-base') ? await mergeBaseSide() : undefined;
  beside = base && runBase(base, cycles);
  const line = await run({ cli: flag('cli') ?? join(ROOT, 'packages/cli/dist/main.js'), home: realpathSync(home), cycles });
  if (beside) line.mergeBase = await beside;
  if (line.mergeBase?.blocked) throw new Blocked(line.mergeBase.blocked);
  console.log(JSON.stringify(line));
  const failures = [];
  const heapLimit = (HEAP_PER_1000 * cycles) / 1000;
  const rssLimit = (RSS_PER_1000 * cycles) / 1000;
  // What it left first: a leftover is the likelier cause of the growth below it.
  const { afterWarmup, afterLast } = line.open;
  for (const [key, word] of [['sockets', 'socket'], ['timers', 'timer'], ['children', 'child process']]) {
    if (afterLast[key] !== afterWarmup[key]) failures.push(`the hub holds ${afterLast[key]} of ${word} after ${cycles} cycles, against ${afterWarmup[key]} after warm-up: ${word} left behind`);
  }
  if (line.heapGrowthBytes >= heapLimit) failures.push(`the hub's retained heap grew ${mb(line.heapGrowthBytes)} over ${cycles} cycles, ${mb(line.heapGrowthPer1000Bytes)} per 1,000; the limit is under ${mb(heapLimit)}`);
  if (line.rssGrowthBytes >= rssLimit) failures.push(`the hub's resident memory grew ${mb(line.rssGrowthBytes)} over ${cycles} cycles, ${mb(line.rssGrowthPer1000Bytes)} per 1,000; the limit is under ${mb(rssLimit)}`);
  for (const failure of failures) console.log(`FAIL hub churn: ${failure}\n  Fix: Find what keeps growing per cycle and release it when its session, ask or extension ends.`);
  if (failures.length) process.exitCode = 1;
  else console.log(`PASS hub churn: over ${cycles} cycles the retained heap grew ${mb(line.heapGrowthBytes)} and resident memory ${mb(line.rssGrowthBytes)}`);
} catch (error) {
  if (!(error instanceof Blocked)) throw error;
  console.log(`BLOCKED hub churn: ${error.message}\n  Fix: Run it where Node's inspector can force a full collection and read resident memory, and the hub answers.`);
  process.exitCode = 1;
} finally {
  // A run that stopped early stops the merge base's beside it, and waits while that removes its copy.
  base?.stop?.();
  await beside;
  if (!given) rmSync(join(home, '..'), { recursive: true, force: true });
}
