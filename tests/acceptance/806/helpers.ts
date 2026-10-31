// Test-side tools for the #806 acceptance tests: a real hub (`deep hub run`) in a temporary home with this suite's test-only
// seams (README: Seams), agent stand-ins (fixtures/agent.mjs) that present themselves as a Claude Code session and as a Codex
// session through their hooks and whose `deep mcp` and `deep show` are their children, a `deep mcp` started by hand (no agent
// above it), the app's headless replica of the canvas panel (README: The app), the hub's record through `events.read`, and the
// evidence store read through its public entry. Nothing here stands in for deep_show, the hub's canvas side or the app: the
// stand-in binary `deep-show` is only what the replay (replay.ts) compares the real replies with. Processes are stopped by PID.
//
// What this file reuses by import: #26's helpers (the temporary homes and worktrees, the seeded record, the hub's socket, the
// MCP client), #393's (the document builders, the PNG reader, the checks) and #384's (the shared test board and its calls).

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import * as t26 from '../26/helpers.ts';
import * as t384 from '../384/helpers.ts';
import * as t393 from '../393/helpers.ts';

export type JsonValue = t393.JsonValue;
export type JsonObject = t393.JsonObject;
export type Line = t26.Line;
export { t26, t384, t393 };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const NODE = process.execPath;
export const CLI = t26.CLI;
const AGENT = join(HERE, 'fixtures', 'agent.mjs');
export const sleep = t26.sleep;
export const sha256 = t26.sha256;

/** The app's headless replica of the canvas panel (README: The app): a new bin target of crates/deep-replica. */
export const APP_NAME = 'deep-replica-canvas';
export const APP_BIN = join(REPO, 'target', 'debug', APP_NAME);
/** The stand-in the replay compares with (#393's and #384's `deep-show run`). */
export const SHOW_NAME = t393.SHOW_NAME;
/** deep_show answers within 2 s (Admission and latch; Numbers version 0 has to hold); what scheduling may add on top. */
export const REPLY_BOUND_MS = t393.REPLY_BOUND_MS;
export const SLACK_MS = t393.SLACK_MS;

/** The names of the planted hubs (README: Planted programs), selected with DEEP_HUB_PLANT. */
export const PLANT_WRITER = 'deep-show-writer-from-payload';
export const PLANT_WAITS = 'deep-show-waits-for-app';

// ---------------------------------------------------------------------------------------------------
// Temporary folders (under /tmp/dh806-*, short: a socket path must fit in 104 bytes) and the processes this suite started.

const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh806-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export const own = (pid: number | undefined): void => { if (pid) { owned.add(pid); t26.own(pid); } };
/** Stops every process this suite started, by PID (SIGTERM, then SIGKILL after 3 s), and removes its folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(t26.alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (t26.alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  await t26.cleanup();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export const childEnv = t26.childEnv;

/** A home for one world: <tmp>/h, and the folder the hub's root, socket and evidence live in. */
export function makeHome(): { tmp: string; home: string; root: string } {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home, { recursive: true });
  return { tmp, home, root: t26.rootOf(home) };
}
export const evidenceRoot = (home: string): string => join(t26.rootOf(home), 'evidence');

/** A fixed, valid-looking UUID for a label: the session IDs the stand-ins use, the same in every run. */
export function uuidOf(label: string): string {
  const h = createHash('sha256').update(`dh806:${label}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------------------------------
// Environment gates

/** Fails with an INCONCLUSIVE message off macOS: the app's replica draws with GPUI's offscreen Metal renderer. */
export function requireMacos(): void {
  expect(process.platform, "INCONCLUSIVE: the app's replica draws with GPUI's offscreen Metal renderer, macOS only; this is not a pass").toBe('darwin');
}
/** The live tests spend plan usage: without this variable they fail INCONCLUSIVE, never pass. */
export const LIVE_VARIABLE = 'DEEP_SHOW_LIVE';
export const LIVE = process.env[LIVE_VARIABLE] === '1';

// ---------------------------------------------------------------------------------------------------
// The world file the hub reads (README: Seams, DEEP_HUB_TEST_SHOW)

export interface WorldFile {
  /** The name a session's outline shows, by session ID; or by agent (`claude-code`, `codex`) for any session of it. */
  names?: Record<string, string>;
  panels?: JsonObject;
  /** The documents the hub minted (Document envelope): their panel, and, to start from, the document stored at revision 0. */
  docs?: JsonObject;
  /** Claims and the documents their definitions name as deliverables, by claim handle. */
  claims?: JsonObject;
  window?: JsonValue;
  card?: JsonValue;
  fault?: JsonValue;
}
/** The world file: written before the hub starts, rewritten between calls (the hub reads it again when it changes). */
export class World {
  private data: WorldFile;
  constructor(readonly path: string, initial: WorldFile) { this.data = initial; this.write(); }
  private write(): void { writeFileSync(this.path, `${JSON.stringify(this.data)}\n`); }
  set(patch: WorldFile): void { this.data = { ...this.data, ...patch }; this.write(); }
}

// ---------------------------------------------------------------------------------------------------
// The hub

export interface HubOptions {
  /** DEEP_HUB_PLANT: a planted wrong program (README: Planted programs). */
  plant?: string | undefined;
  /** DEEP_HUB_TEST_SHOW: the world file. */
  world?: string | undefined;
  /** DEEP_HUB_TEST_PID_REUSE: a file listing PIDs that now belong to another process, with another start time. */
  reuse?: string | undefined;
}
/** `deep hub run` with HOME the test's home, so its root is <home>/.deepbuild; BLOCKED when it doesn't start. */
export async function startHub(home: string, o: HubOptions = {}): Promise<t26.Hub> {
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const env = childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_PLANT: o.plant, DEEP_HUB_TEST_SHOW: o.world, DEEP_HUB_TEST_PID_REUSE: o.reuse });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); try { resolve((JSON.parse(first.split('\n')[0]!) as Line).ready === true); } catch { resolve(false); } }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(t26.rootOf(home), 'hub.sock'), child, output: () => out };
}

/** One method call on a `cli` connection with the control token, as `deep` makes it; throws with the hub's refusal. */
export async function hubCall(hub: t26.Hub, method: string, params: Line = {}): Promise<Line> {
  const conn = await t26.control(hub);
  try {
    const reply = await conn.call(method, params);
    if ('error' in reply) throw Error(`the hub refused ${method}: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  } finally {
    conn.close();
  }
}

// ---------------------------------------------------------------------------------------------------
// Agent stand-ins: a Claude Code session and a Codex session, as the hub sees them through their hooks

export type AgentKind = 'claude-code' | 'codex';
export class Stand implements t26.Mcp {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private seq = BigInt(Date.now()) * 1_000_000n;
  private transcript: string | null = null;
  private constructor(private readonly child: ChildProcess, readonly kind: AgentKind, readonly id: string, readonly home: string, readonly cwd: string) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the agent stand-in exited' }); });
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Line | undefined;
        try { line = JSON.parse(buffer.slice(0, i)) as Line; } catch { line = undefined; }
        buffer = buffer.slice(i + 1);
        if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
      }
    });
  }
  get pid(): number { return this.child.pid!; }
  /** An agent process in `cwd`, whose session will be `id`; `env` goes into its environment and so into its deep mcp's. */
  static start(home: string, cwd: string, kind: AgentKind, id: string, env: Record<string, string | undefined> = {}): Stand {
    const child = spawn(NODE, [AGENT], { cwd, env: childEnv(home, env), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Stand(child, kind, id, home, cwd);
  }
  private send(command: Line, timeoutMs = 150_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the agent stand-in gave no answer to ${String(command.op)} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the agent stand-in failed ${String(command.op)}: ${String(line.failed)}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  private payload(event: string, extra: Line): Line {
    const common: Line = { session_id: this.id, cwd: this.cwd, hook_event_name: event, permission_mode: 'default' };
    if (this.kind === 'claude-code') {
      if (!this.transcript) {
        this.transcript = join(this.home, '.claude/projects', this.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
        mkdirSync(dirname(this.transcript), { recursive: true });
        writeFileSync(this.transcript, `${JSON.stringify({ type: 'user', sessionId: this.id, cwd: this.cwd, message: { role: 'user', content: 'start' } })}\n`);
      }
      Object.assign(common, { transcript_path: this.transcript });
      if (event === 'SessionStart') Object.assign(common, { source: 'startup', model: 'claude-haiku-5-5' });
      if (event === 'UserPromptSubmit') Object.assign(common, { prompt: 'draw the release figure', prompt_id: `p-${randomBytes(6).toString('hex')}` });
      if (event === 'PreToolUse') Object.assign(common, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomBytes(8).toString('hex')}` });
      if (event === 'SessionEnd') Object.assign(common, { reason: 'other' });
    } else {
      // Codex's hook payloads (adapters/codex.facts.json, events): `model` on every event, `turn_id` on the turn's, no transcript here.
      Object.assign(common, { transcript_path: null, model: 'gpt-reserve' });
      if (event === 'SessionStart') Object.assign(common, { source: 'startup' });
      if (event === 'UserPromptSubmit') Object.assign(common, { prompt: 'draw the release figure', turn_id: 'turn-1' });
      if (event === 'PreToolUse') Object.assign(common, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `call_${randomBytes(8).toString('hex')}`, turn_id: 'turn-1' });
    }
    return Object.assign(common, extra);
  }
  /** One hook, from a child of this agent (deep-hook's wire); throws BLOCKED unless the hub acknowledged it. */
  async hook(hub: t26.Hub, event: string, extra: Line = {}): Promise<Line> {
    const request = { v: 1, agent: this.kind, event, seq: String(this.seq += 1000n), id: t26.ulid(), matched: [], payload: this.payload(event, extra) };
    const r = await this.send({ op: 'hook', socket: hub.socket, request, cwd: this.cwd });
    if (!((r.lines as string[] | undefined) ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for ${this.kind} session ${this.id}: ${JSON.stringify(r)}`);
    return r;
  }
  /** Its SessionStart, its prompt and a first tool call, each from a hook process it started, so the hub knows its process. */
  async establish(hub: t26.Hub): Promise<void> {
    await this.hook(hub, 'SessionStart');
    await this.hook(hub, 'UserPromptSubmit');
    await this.hook(hub, 'PreToolUse');
  }
  /** One JSON-RPC request to this agent's own `deep mcp`, which the agent starts on first use. */
  async request(method: string, params: Line = {}, timeoutMs = 120_000): Promise<t26.Exchange> {
    const line = { jsonrpc: '2.0', id: t26.nextId(method), method, params };
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return { reply: r.reply as Line, ms: r.ms as number, pid: r.pid as number };
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', method, params } });
  }
  /** A command run the way the agent runs a tool: its child's child. */
  async exec(argv: string[], timeoutMs = 120_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const r = await this.send({ op: 'exec', argv, cwd: this.cwd, env: childEnv(this.home), timeoutMs }, timeoutMs + 5000);
    return { code: r.code as number | null, stdout: String(r.stdout), stderr: String(r.stderr) };
  }
}

/** The thread a session writes as (Writer connection), as the hub recorded it in the session's session.start. */
export async function threadOf(hub: t26.Hub, session: string): Promise<string> {
  const start = await t26.eventMatching(hub, (e) => e.kind === 'session.start' && e.session === session, 10_000);
  const thread = start?.data?.thread;
  if (typeof thread !== 'string') throw Error(`BLOCKED: the record holds no session.start with a thread for session ${session}`);
  return thread;
}

// ---------------------------------------------------------------------------------------------------
// deep_show through `deep mcp`, and `deep show`

/** The deep_show call's input, from the stand-in's call (README: The tool's input): its fields minus the session and the time. */
const SHOW_FIELDS = ['doc', 'document', 'patch', 'undo', 'removes', 't', 'size', 'include', 'rev'] as const;
const typed = (schema: Line | undefined, key: string): string[] => {
  const type = (schema?.properties as Line | undefined)?.[key]?.type;
  return Array.isArray(type) ? (type as string[]) : type === undefined ? [] : [String(type)];
};
/**
 * The arguments for `call`: a field left out reads as null (#26's strict schemas), and an object-valued field goes as its JSON
 * text when the tool's schema types it as a string (a strict schema can't type an open object; README: Readings).
 */
export function showArgs(call: Line, schema: Line | undefined): Line {
  const args: Line = {};
  for (const key of SHOW_FIELDS) {
    const value = call[key];
    if (value === undefined) continue;
    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
    args[key] = isObject && typed(schema, key).includes('string') && !typed(schema, key).includes('object') ? JSON.stringify(value) : value;
  }
  return args;
}
const schemas = new WeakMap<object, Line | undefined>();
/** The deep_show tool's input schema as `deep mcp` lists it, if it does. */
export async function showSchema(m: t26.Mcp): Promise<Line | undefined> {
  if (!schemas.has(m)) schemas.set(m, (await t26.listTools(m)).find((t) => t.name === 'deep_show')?.inputSchema);
  return schemas.get(m);
}
export interface Shown { reply: JsonObject; ms: number; isError: boolean }
/** `deep_show` through `m`'s `deep mcp`: a refusal is a reply (#393's), never a JSON-RPC error; the reply's value as #393 gives it. */
export async function deepShow(m: t26.Mcp, call: Line, what = 'deep_show'): Promise<Shown> {
  const schema = await showSchema(m);
  const o = await t26.callTool(m, 'deep_show', showArgs(call, schema));
  expect(o.protocolError, `${what}: deep mcp has no tool deep_show (it must list it beside the other deep_* tools): ${JSON.stringify(o.reply).slice(0, 600)}`).toBe(false);
  expect(typeof o.value === 'object' && o.value !== null, `${what}: the call returns #393's reply as a value, got ${JSON.stringify(o.value)?.slice(0, 600)}`).toBe(true);
  return { reply: o.value as JsonObject, ms: o.ms, isError: o.isError };
}

/** `deep show` with #393's fields as options (README: The CLI), run in `agent`'s process tree, or by you when there is none. */
export async function deepShowCli(home: string, tmp: string, agent: Stand | undefined, call: Line): Promise<{ reply: JsonObject; code: number | null; ms: number }> {
  const file = join(tmp, `document-${randomBytes(4).toString('hex')}.json`);
  writeFileSync(file, JSON.stringify(call['document'] ?? {}));
  const argv = [NODE, CLI, 'show', '--doc', String(call['doc']), '--document', file, '--json'];
  if (Array.isArray(call['removes'])) argv.push('--removes', (call['removes'] as string[]).join(','));
  if (typeof call['t'] === 'string') argv.push('--t', call['t']);
  if (Array.isArray(call['size'])) argv.push('--size', (call['size'] as number[]).join('x'));
  if (Array.isArray(call['include'])) argv.push('--include', (call['include'] as string[]).join(','));
  if (call['check'] === true) argv.push('--check');
  if (typeof call['claim'] === 'string') argv.push('--claim', call['claim']);
  const t0 = performance.now();
  const ran = agent ? await agent.exec(argv) : await t26.run(NODE, argv.slice(1), { env: childEnv(home) });
  const ms = performance.now() - t0;
  const last = ran.stdout.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
  if (!last) throw Error(`deep show printed no JSON reply (exit ${ran.code}); stdout: ${ran.stdout.slice(0, 400)}; stderr: ${ran.stderr.slice(0, 600)}`);
  return { reply: JSON.parse(last) as JsonObject, code: ran.code, ms };
}

// ---------------------------------------------------------------------------------------------------
// The hub's record and evidence

export const events = t26.events;
/** Events about a document: those whose data names it (`doc`, as `doc:<id>` or the bare ID). */
export const aboutDoc = (all: readonly t26.Ev[], doc: string): t26.Ev[] => all.filter((e) => String(e.data?.doc ?? '').toLowerCase().endsWith(doc.toLowerCase()));

/** The bytes of one piece of evidence in a hub's store, by its hash, through the store's public entry, read only. */
export async function readEvidence(home: string, sha: string): Promise<Buffer> {
  const store = await openEvidenceStore({ root: evidenceRoot(home), readOnly: true });
  return Buffer.from(await store.read(sha));
}
/** The decoded pixels' hash of a snapshot read back by its hash (#384's pixelHash). */
export async function pixelHashOf(home: string, sha: string): Promise<string> {
  return t384.pixelHash(await readEvidence(home, sha));
}
/** A PNG put into a store (before a hub opens it) as you would drop one in; its hash. */
export const putPng = t393.putPng;

// ---------------------------------------------------------------------------------------------------
// The six-item figure the agents draw

export const FIGURE = t393.board('Release readiness', [320, 200], [
  t393.rect('back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
  t393.rect('bar-build', 'Build bar', [16, 60, 240, 16], 'a1'),
  t393.rect('bar-tests', 'Tests bar', [16, 90, 180, 16], 'a2'),
  t393.rect('bar-docs', 'Docs bar', [16, 120, 120, 16], 'a3'),
  t393.label('title', 'Title', 'Release readiness', [16, 20], 'a4'),
  t393.label('caption', 'Caption', 'Ready for review', [16, 160], 'a5'),
]);
export const FIGURE_ITEMS = t393.sorted(Object.keys(FIGURE['items'] as JsonObject));
export const FIGURE_SIZE: [number, number] = [320, 200];

// ---------------------------------------------------------------------------------------------------
// What the app drew (README: The app)

export interface Row { layer: JsonValue; owner: { kind: string; id: string }; band: string; outline: boolean; name: string | null; items: string[] }
export interface Drawn { doc: string; rev: number; layers: Row[] }

/** The headless replica of the app's canvas panel, connected to the hub as the `app` role. */
export class App {
  private readonly lines: string[] = [];
  private readonly wakers = new Set<() => void>();
  private ended = false;
  private constructor(private readonly child: ChildProcess, readonly out: string) {
    createInterface({ input: child.stdout! }).on('line', (l) => { this.lines.push(l); for (const w of [...this.wakers]) w(); });
    child.on('close', () => { this.ended = true; for (const w of [...this.wakers]) w(); });
  }
  get pid(): number { return this.child.pid!; }
  /** Starts the replica with HOME the test's home, so it reaches that hub as the app does; INCONCLUSIVE off macOS, BLOCKED when it can't connect. */
  static async start(home: string, out: string): Promise<App> {
    requireMacos();
    mkdirSync(out, { recursive: true });
    const child = spawn(APP_BIN, ['--out', out], { cwd: REPO, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    const app = new App(child, out);
    const first = await app.next(120_000);
    if (!first || (JSON.parse(first) as Line).ready !== true) throw Error(`BLOCKED: the app's replica never said ready (${APP_NAME}): ${first ?? 'no output'}`);
    return app;
  }
  private next(timeoutMs: number): Promise<string | undefined> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.lines.length > 0) { clearTimeout(timer); this.wakers.delete(check); resolve(this.lines.shift()); } else if (this.ended) { clearTimeout(timer); this.wakers.delete(check); resolve(undefined); }
      };
      const timer = setTimeout(() => { this.wakers.delete(check); resolve(undefined); }, timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  /** One user-side call (README: The app, stdin), answered with one line. */
  async call(call: Line, timeoutMs = 120_000): Promise<JsonObject> {
    this.child.stdin!.write(`${JSON.stringify(call)}\n`);
    const line = await this.next(timeoutMs);
    if (line === undefined) throw Error(`the app's replica gave no answer to ${String(call.call)} in ${timeoutMs} ms`);
    return JSON.parse(line) as JsonObject;
  }
  /** Waits until the app has drawn every revision the hub has presented so far; the revision each document is at. */
  async sync(): Promise<Record<string, number>> {
    const reply = await this.call({ call: 'sync' });
    return (reply['drawn'] ?? {}) as Record<string, number>;
  }
  /** What it drew, in order: one entry for each presented revision. */
  drawn(): Drawn[] {
    const file = join(this.out, 'drawn.jsonl');
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Drawn);
  }
  /** Closes the app: SIGTERM to its PID, and waits for it to end. */
  async stop(): Promise<void> {
    try { process.kill(this.pid, 'SIGTERM'); } catch { return; }
    const deadline = Date.now() + 10_000;
    while (!this.ended && Date.now() < deadline) await sleep(20);
    if (!this.ended) try { process.kill(this.pid, 'SIGKILL'); } catch { /* gone */ }
  }
}

// ---------------------------------------------------------------------------------------------------
// The checks the criteria's wrong programs must fail. Each returns its failures as sentences; an empty list is a pass.

/** The layer rows an app drew for a document's revision. */
export function rowsOf(drawn: readonly Drawn[], doc: string, rev: number): Row[] {
  return drawn.filter((d) => d.doc.toLowerCase().endsWith(doc.toLowerCase()) && d.rev === rev).flatMap((d) => d.layers).filter((r) => r.band !== 'card');
}
/**
 * Criterion 2: the app's panel draws the figure in the calling agent's layer, outlined with the session's name. Each failure
 * names the layer.
 */
export function layerFailures(drawn: readonly Drawn[], doc: string, rev: number, caller: { thread: string; name: string }, items: readonly string[]): string[] {
  const rows = rowsOf(drawn, doc, rev).filter((r) => r.items.length > 0);
  if (rows.length === 0) return [`the app drew no layer for the figure at revision ${rev} (expected ${caller.thread}'s layer)`];
  const failures: string[] = [];
  for (const row of rows) {
    if (row.owner.kind !== 'agent' || row.owner.id !== caller.thread) failures.push(`the figure is drawn in layer ${JSON.stringify(row.layer)} owned by ${row.owner.kind} ${row.owner.id}, not in the layer of the session that called, ${caller.thread}`);
  }
  const mine = rows.filter((r) => r.owner.kind === 'agent' && r.owner.id === caller.thread);
  if (mine.length !== 1) { failures.push(`${mine.length} layers of ${caller.thread} hold the figure, not one`); return failures; }
  const row = mine[0]!;
  if (row.band !== 'agent') failures.push(`layer ${JSON.stringify(row.layer)} is in band ${row.band}, not the agent band`);
  if (row.outline !== true) failures.push(`layer ${JSON.stringify(row.layer)} of ${caller.thread} is not outlined`);
  if (row.name !== caller.name) failures.push(`layer ${JSON.stringify(row.layer)} of ${caller.thread} is outlined with ${JSON.stringify(row.name)}, not the session's name ${JSON.stringify(caller.name)}`);
  if (JSON.stringify(t393.sorted(row.items)) !== JSON.stringify(t393.sorted(items))) failures.push(`layer ${JSON.stringify(row.layer)} of ${caller.thread} holds ${JSON.stringify(t393.sorted(row.items))}, not the figure's six items ${JSON.stringify(t393.sorted(items))}`);
  return failures;
}
/** Anything of `doc` drawn in a layer of `other`, a session that did not call. */
export function drawnAs(drawn: readonly Drawn[], doc: string, other: string): Row[] {
  return drawn.filter((d) => d.doc.toLowerCase().endsWith(doc.toLowerCase())).flatMap((d) => d.layers).filter((r) => r.owner.kind === 'agent' && r.owner.id === other && r.items.length > 0);
}

export interface Snap { sha256: string; w: number; h: number }
export function snapsOf(reply: JsonObject): Snap[] {
  return t393.arr(reply['snapshots'] ?? [], 'the reply\'s snapshots').map((v, i) => {
    const o = t393.obj(v, `snapshots[${i}]`);
    return { sha256: t393.str(o['sha256'], 'sha256'), w: t393.num(o['w'], 'w'), h: t393.num(o['h'], 'h') };
  });
}

export interface Taken { reply: JsonObject; ms: number }
/**
 * Criterion 4: with the app closed, deep_show of the figure returns presented with a snapshot from the headless worker, equal by
 * pixel hash to the one taken with the app open, within 2 s. Each failure names the call.
 */
export async function closedFailures(home: string, open: Taken, closed: Taken): Promise<string[]> {
  const failures: string[] = [];
  const out = String(closed.reply['outcome']);
  if (out !== 'presented') failures.push(`deep_show with the app closed answered ${out}${closed.reply['reason'] ? ` (${String(closed.reply['reason'])})` : ''} after ${Math.round(closed.ms)} ms, not presented: it waited for the app instead of rendering in the headless worker`);
  if (closed.ms > REPLY_BOUND_MS + SLACK_MS) failures.push(`deep_show with the app closed took ${Math.round(closed.ms)} ms, over the 2 s it answers within`);
  const was = snapsOf(open.reply);
  const now = snapsOf(closed.reply);
  if (now.length !== 1) { failures.push(`deep_show with the app closed returned ${now.length} snapshots, not one`); return failures; }
  if (was.length !== 1) { failures.push(`deep_show with the app open returned ${was.length} snapshots, not one`); return failures; }
  const [a, b] = [await pixelHashOf(home, was[0]!.sha256), await pixelHashOf(home, now[0]!.sha256)];
  if (a !== b) failures.push(`deep_show with the app closed returned a snapshot of pixel hash ${b}, not the app-open one's ${a}`);
  return failures;
}

/** A closed claim handle's args, for the deep_claim an agent files before it shows its figure. */
export const claimArgs = t26.claimArgs;

/** Builds the app's replica once per file (macOS only); returns the check that fails a test, naming the build, when it didn't build. */
export function useApp(): () => void {
  let error = 'not built';
  beforeAll(() => { error = process.platform === 'darwin' ? t393.buildBinary(APP_NAME) : ''; }, 3_600_000);
  return () => expect(error, `the app's replica builds: cargo build --locked --bin ${APP_NAME}`).toBe('');
}
