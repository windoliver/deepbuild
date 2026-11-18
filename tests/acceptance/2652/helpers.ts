// Shared test-side tools for issue #2652's acceptance tests (README): a hub home under /tmp/dh2652-*, the hub run with
// Node's inspector (`node --inspect=127.0.0.1:0 <deep cli> hub run`, as benchmarks/hub-churn.mjs runs it for #824), its
// readings through that inspector (every thread's heap after a full collection, and a heap snapshot of the core's
// thread with the retained size of one object in it), command checks started through the hub's socket (`run.start`, the
// cli role), and a record of kept runs written while the hub is stopped. Nothing here stands in for DeepBuild: every
// reading comes from the real hub, its record and its threads. Processes are stopped by PID only.
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;

/** Each criterion's tag: `#2652.` and the first 8 hex of SHA-256 of its text, trimmed, white space collapsed (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #2652.8e8af2a5';
export const AC2 = 'AC2 #2652.71abd7a1';
export const AC3 = 'AC3 #2652.a3e2a15d';
export const AC4 = 'AC4 #2652.e46eede4';
export const AC5 = 'AC5 #2652.669feed5';

/** The planted wrong programs (README, Planted programs), selected with DEEP_HUB_PLANT. */
export const PLANTS = { head: 'keeps-output-head', sharedRead: 'shares-read-across-runs' } as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
/** Bytes as the issue writes them: 1 MB is 10^6 bytes, 1 KB 10^3. */
export const shownBytes = (n: number): string => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${(n / 1e3).toFixed(1)} KB`);

// ---- Temp folders, under /tmp/dh2652-*: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh2652-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started: stopped by PID only, never by name or port.
const owned = new Set<number>();
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Stops every hub this file started (SIGTERM, then SIGKILL after 30 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 30_000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** The environment a hub gets: HOME the test's, and none of this process's DEEP_, GIT_, XDG_, CLAUDE or CODEX settings, NODE_OPTIONS or billing keys. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|GIT_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_TOKEN|GITHUB_TOKEN|NODE_OPTIONS|VITEST)/.test(key)) continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

// ---- A hub home: the shipped default guards as rules.json, your ask settings, the OS-confirmation stub.
export interface Home { tmp: string; home: string; root: string; confirm: string }
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  return { tmp, home, root, confirm };
}

// ---- The hub, run with its inspector. V8's optimizing tiers and its bytecode flushing are off, as #824's benchmark
// turns the tiers off, so the heap holds what the hub keeps and not what the compiler does after warm-up.
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; exit: Promise<void>; inspector: string | undefined; plant: string | undefined; stderr(): string }
export async function startHub(h: Home, o: { plant?: string; inspect?: boolean } = {}): Promise<Hub> {
  const flags = o.inspect ? ['--inspect=127.0.0.1:0', '--no-opt', '--no-maglev', '--no-sparkplug', '--no-flush-bytecode'] : [];
  const env = childEnv(h.home, { DEEP_HUB_TEST_CONFIRM: h.confirm, DEEP_HUB_PLANT: o.plant });
  const child = spawn(NODE, [...flags, CLI, 'hub', 'run'], { cwd: h.tmp, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-20_000); });
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) { try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); } }
      });
    }),
    exit.then(() => undefined),
    sleep(300_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${o.plant ? ` with the plant DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${err.slice(-1500)}`);
  const inspector = /ws:\/\/\S+/.exec(err)?.[0];
  if (o.inspect && !inspector) throw Error(`BLOCKED: the hub offers no inspector, so no full collection can be forced and no heap read: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), root: h.root, child, exit, inspector, plant: o.plant, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 60_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(100);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}

// ---- The hub's socket, as the CLI reaches it: the cli role with the control token.
export function control(hub: Hub, method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`BLOCKED: no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i)) as Line;
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && line.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; data: Line }
/** The record's events after `after`, read through events.read. */
export async function eventsAfter(hub: Hub, after = 0): Promise<Ev[]> {
  const out: Ev[] = [];
  for (;;) {
    const read = await control(hub, 'events.read', { after, limit: 1000 });
    const events = (typeof read.events === 'string' ? JSON.parse(read.events) : read.events) as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}

/**
 * One command check started through the hub's socket (`run.start` with a `command`, which the command check kind runs
 * in `cwd`, as a claim's check runs), and its run.finished once it lands.
 */
export async function commandCheck(hub: Hub, cwd: string, command: string, timeoutMs = 300_000): Promise<{ run: string; finished: Ev }> {
  const before = (await eventsAfter(hub)).at(-1)?.log_pos ?? 0;
  const claim = `claim:${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const started = await control(hub, 'run.start', { check: 'print', claim, commit: '0'.repeat(40), argv: ['node'], cwd, command });
  const run = String(started.run);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const finished = (await eventsAfter(hub, before)).find((e) => e.kind === 'run.finished' && e.data.run === run);
    if (finished) return { run, finished };
    if (Date.now() > deadline) throw Error(`BLOCKED: ${run} (\`${command}\`) did not finish within ${timeoutMs / 1000} s`);
    await sleep(200);
  }
}

// ---- Kept runs in the record (#1018): run.finished events whose data names their key, which a starting hub reads.
/**
 * Appends `runs` kept runs of `check` to the hub's record at `<root>/ledger.db` while the hub is stopped, through the
 * record's public entry, as #1018's budget suite keeps its keys: each a run.started and a run.finished@2 that passed,
 * with a whole (`plain`) record and its key. Every run is on one key, whose paths are `paths`, as runs of one check on
 * one tree are; each comes from a claim of its own, over ten sessions. Returns the run handles, oldest first.
 */
export async function keepRuns(root: string, check: string, runs: number, paths: readonly string[]): Promise<string[]> {
  const { openRecord, ulid } = await import('../../../packages/record/src/index.ts');
  const record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now });
  const core = { writer: 'core', actor: 'you', scope: 'you' };
  const key = { id: sha256(`key of ${check}`), stem: sha256(`stem of ${check}`) };
  const handles: string[] = [];
  try {
    for (let n = 0; n < runs; n++) {
      const ts = Date.now();
      const run = `run:${ulid(ts)}`;
      const claim = `claim:${ulid(ts)}`;
      handles.push(run);
      await record.append(core, { v: 1, id: ulid(ts), kind: 'run.started', ts, subject: run, data: { run, check, claim, commit: sha256(`commit ${n}`).slice(0, 40) } });
      await record.append(core, {
        v: 2, id: ulid(ts), kind: 'run.finished', ts, subject: run,
        data: {
          run, outcome: 'passed', tests_run: 1, passed: 1, runs: 1, evidence: [], check, assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: `${process.platform}-${process.arch}`,
          key: { ...key, paths: [...paths], claim, session: `session:kept${n % 10}`, base: false, withheld: false, plain: true },
        },
      });
    }
  } finally {
    await record.close();
  }
  return handles;
}

// ---- The hub's inspector: its main thread, and each worker thread through NodeWorker (benchmarks/hub-churn.mjs).
export interface Inspector {
  /** Each thread's title, by its inspector session ('main' for the main thread). */
  threads(): Map<string, string>;
  evaluate(expression: string, session?: string): Promise<unknown>;
  /** Two full collections in a thread. */
  collect(session?: string): Promise<void>;
  close(): void;
}
export async function inspect(url: string): Promise<Inspector> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(Error(`BLOCKED: the inspector at ${url} refused the connection`));
  });
  let n = 0;
  const waiting = new Map<number, { resolve: (v: Line) => void; reject: (e: Error) => void; method: string; timer: NodeJS.Timeout }>();
  const workers = new Map<string, string>();
  const send = (method: string, params: Line, session?: string): Promise<Line> => new Promise((resolve, reject) => {
    const id = ++n;
    const timer = setTimeout(() => { waiting.delete(id); reject(Error(`BLOCKED: ${method}: the inspector gave no answer`)); }, 600_000);
    waiting.set(id, { resolve, reject, method, timer });
    const text = JSON.stringify({ id, method, params });
    socket.send(session ? JSON.stringify({ id: ++n, method: 'NodeWorker.sendMessageToWorker', params: { sessionId: session, message: text } }) : text);
  });
  const settle = (message: Line): void => {
    const pending = waiting.get(message.id as number);
    if (!pending) return;
    waiting.delete(message.id as number);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(Error(`BLOCKED: ${pending.method}: ${String(message.error.message)}`));
    else pending.resolve(message.result as Line);
  };
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(String(data)) as Line;
    if (message.method === 'NodeWorker.attachedToWorker') workers.set(String(message.params.sessionId), String(message.params.workerInfo.title));
    else if (message.method === 'NodeWorker.detachedFromWorker') workers.delete(String(message.params.sessionId));
    else if (message.method === 'NodeWorker.receivedMessageFromWorker') settle(JSON.parse(String(message.params.message)) as Line);
    else settle(message);
  };
  await send('NodeWorker.enable', { waitForDebuggerOnStart: false });
  await sleep(200);
  return {
    threads: () => new Map([['main', 'main'], ...workers]),
    async evaluate(expression, session) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true }, session === 'main' ? undefined : session);
      if (exceptionDetails) throw Error(`BLOCKED: ${expression}: ${String(exceptionDetails.exception?.description ?? exceptionDetails.text)}`);
      return (result as Line).value as unknown;
    },
    async collect(session) {
      const s = session === 'main' ? undefined : session;
      await send('HeapProfiler.collectGarbage', {}, s);
      await send('HeapProfiler.collectGarbage', {}, s);
    },
    close: () => socket.close(),
  };
}

/**
 * The hub's retained heap: after a full collection in every thread, the sum over its threads of V8's heap and the text
 * V8 keeps outside it. Node 24 keeps a decoded text of more than about 1 MB as an external string, whose characters
 * sit outside the heap V8 counts as used while a heap object holds them, so a reading of the heap alone would never see
 * a kept 8 MB output. ArrayBuffer backing stores, Node's I/O buffers, are left out (README, Open points).
 */
export interface HeapReading { bytes: number; threads: Record<string, { heapUsed: number; external: number; arrayBuffers: number }> }
const MEMORY = '(() => { const m = process.memoryUsage(); return [m.heapUsed, m.external, m.arrayBuffers]; })()';
export async function retainedHeap(ins: Inspector): Promise<HeapReading> {
  const threads: HeapReading['threads'] = {};
  let bytes = 0;
  for (const [session, title] of ins.threads()) {
    await ins.collect(session);
    const [heapUsed, external, arrayBuffers] = (await ins.evaluate(MEMORY, session)) as [number, number, number];
    if (![heapUsed, external, arrayBuffers].every((v) => Number.isSafeInteger(v) && v >= 0)) throw Error(`BLOCKED: ${title}'s memory read ${JSON.stringify([heapUsed, external, arrayBuffers])}`);
    threads[title] = { heapUsed, external, arrayBuffers };
    bytes += heapUsed + external - arrayBuffers;
  }
  return { bytes, threads };
}
/** The least of three readings in a row: work the hub's timers have in flight at one reading is gone at another. */
export async function settledHeap(ins: Inspector): Promise<HeapReading> {
  let least: HeapReading | undefined;
  for (let i = 0; i < 3; i++) {
    const r = await retainedHeap(ins);
    if (!least || r.bytes < least.bytes) least = r;
  }
  return least!;
}

/** The inspector session of the hub's core thread, the worker the core runs in (core-worker.ts, `workerData.core`). */
export async function coreThread(ins: Inspector): Promise<string> {
  for (const session of ins.threads().keys()) {
    if (session === 'main') continue;
    if (await ins.evaluate("process.getBuiltinModule('node:worker_threads').workerData?.core !== undefined", session)) return session;
  }
  throw Error(`BLOCKED: no thread of the hub is its core's: ${[...ins.threads().values()].join(', ')}`);
}
/** A heap snapshot of one thread, written by that thread to `file` (v8.writeHeapSnapshot). */
export async function snapshot(ins: Inspector, session: string, file: string): Promise<void> {
  await ins.collect(session);
  const written = await ins.evaluate(`process.getBuiltinModule('node:v8').writeHeapSnapshot(${JSON.stringify(file)})`, session);
  if (written !== file) throw Error(`BLOCKED: the heap snapshot was written to ${String(written)}, not ${file}`);
}

/**
 * A heap snapshot read back: an object found by its constructor's name and a property path from it, and that object's
 * retained size, as Chrome's DevTools defines it: the self sizes of every node reachable from it that the snapshot's
 * root no longer reaches once it is gone, weak edges left out and shortcut edges kept only at the root.
 */
export interface Retained { constructorCount: number; target: string; bytes: number; nodes: number; strings: Set<string> }
export function retainedIn(file: string, constructor: string, property: string): Retained {
  const snap = JSON.parse(readFileSync(file, 'utf8')) as { snapshot: { meta: Line }; nodes: number[]; edges: number[]; strings: string[] };
  const meta = snap.snapshot.meta;
  const NF = (meta.node_fields as string[]).length;
  const EF = (meta.edge_fields as string[]).length;
  const at = (fields: string[], name: string): number => fields.indexOf(name);
  const [nType, nName, nSize, nEdges] = ['type', 'name', 'self_size', 'edge_count'].map((f) => at(meta.node_fields as string[], f)) as [number, number, number, number];
  const [eType, eName, eTo] = ['type', 'name_or_index', 'to_node'].map((f) => at(meta.edge_fields as string[], f)) as [number, number, number];
  const nodeTypes = (meta.node_types as string[][])[0]!;
  const edgeTypes = (meta.edge_types as string[][])[0]!;
  const { nodes, edges, strings } = snap;
  const N = nodes.length / NF;
  const first = new Float64Array(N + 1);
  for (let i = 0, e = 0; i < N; i++) { first[i] = e; e += nodes[i * NF + nEdges]! * EF; first[i + 1] = e; }
  const WEAK = edgeTypes.indexOf('weak');
  const SHORTCUT = edgeTypes.indexOf('shortcut');
  const PROPERTY = edgeTypes.indexOf('property');
  const typeOf = (i: number): string => nodeTypes[nodes[i * NF + nType]!]!;
  const nameOf = (i: number): string => strings[nodes[i * NF + nName]!]!;
  const reach = (from: number, skip: number): Uint8Array => {
    const seen = new Uint8Array(N);
    const stack = [from];
    seen[from] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      for (let e = first[i]!; e < first[i + 1]!; e += EF) {
        const t = edges[e + eType]!;
        if (t === WEAK || (t === SHORTCUT && i !== 0)) continue;
        const j = edges[e + eTo]! / NF;
        if (j === skip || seen[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    return seen;
  };
  const owners: number[] = [];
  for (let i = 0; i < N; i++) if (typeOf(i) === 'object' && nameOf(i) === constructor) owners.push(i);
  let target = -1;
  for (const o of owners) {
    for (let e = first[o]!; e < first[o + 1]!; e += EF) {
      if (edges[e + eType] === PROPERTY && strings[edges[e + eName]!] === property) target = edges[e + eTo]! / NF;
    }
  }
  if (target < 0) return { constructorCount: owners.length, target: 'none', bytes: 0, nodes: 0, strings: new Set() };
  const fromRoot = reach(0, target);
  const mine = reach(target, -1);
  let bytes = 0;
  let count = 0;
  for (let i = 0; i < N; i++) {
    if (!mine[i] || fromRoot[i]) continue;
    bytes += nodes[i * NF + nSize]!;
    count += 1;
  }
  // The strings a Map's own table holds, its keys among them: which records it keeps.
  const held = new Set<string>();
  for (let e = first[target]!; e < first[target + 1]!; e += EF) {
    const kind = edgeTypes[edges[e + eType]!];
    if ((kind !== 'internal' && kind !== 'property') || strings[edges[e + eName]!] !== 'table') continue;
    const table = edges[e + eTo]! / NF;
    for (let f = first[table]!; f < first[table + 1]!; f += EF) {
      const j = edges[f + eTo]! / NF;
      if (typeOf(j) === 'string' || typeOf(j) === 'concatenated string' || typeOf(j) === 'sliced string') held.add(nameOf(j));
    }
  }
  return { constructorCount: owners.length, target: `${typeOf(target)} ${nameOf(target)}`, bytes, nodes: count, strings: held };
}
