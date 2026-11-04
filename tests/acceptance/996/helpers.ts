// Test-side tools for the #996 acceptance tests: temp folders and homes, the hub as a process (`deep hub run --root`),
// its line protocol, the test VFS's points file, the run journal (`runs.json`) and the terminals index
// (`extensions/terminals.json`) as files under the hub root, the record read through `events.read`, and, for AC2's
// seed and its view of the terminals, the record, supervisor and extension host the hub itself opens, through their
// public entries. Parts are adapted from tests/acceptance/236/helpers.ts, 315/helpers.ts and 104/helpers.ts (same
// repo, same license); this suite keeps its own copy so a redraft of theirs never moves these tests. Nothing here
// stands in for the hub, its journal, the supervisor or the extension host.
//
// Safety: every folder is under /tmp/dh996-* (real paths, short enough for a socket path); HOME is a temp folder for
// this process and every child; the agent's own CLAUDE_*, DEEP_* and billing variables are removed first. A process
// is only ever stopped by PID: one this suite spawned, one a seeded terminal noted in its folder, or one the
// supervisor recorded as process.tracked in a record this suite made, each only while it still has the start time
// first seen for it. Never by name or port.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import type { ExtensionHost, Installed } from '../../../packages/extension-host/src/index.ts';
import { openRecord, type Connection, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const COMMIT = '33eaad3b33eaad3b33eaad3b33eaad3b33eaad3b';
const DAY = 86_400_000;
const HOST_ENTRY = '../../../packages/extension-host/src/index.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const message = (e: unknown): string => String((e as Error)?.message ?? e);

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT' || BILLING.includes(key)) delete process.env[key];
const HOME = realpathSync(mkdtempSync('/tmp/dh996-home-'));
process.env.HOME = HOME;

// ---- Temp folders, all removed after the file.
const made: string[] = [HOME];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh996-'));
  made.push(dir);
  return dir;
}
export function sub(dir: string, ...names: string[]): string {
  const path = join(dir, ...names);
  mkdirSync(path, { recursive: true });
  return path;
}

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export const ulid = (ms = Date.now()): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);

// ---- Processes, read with ps. A process counts as running only while its start time is the one first seen and it
// isn't a zombie; every PID this suite saw is remembered so the file can stop it by PID.
const seen = new Map<number, string>();
function look(pid: number): { start: string; zombie: boolean } | null {
  const r = spawnSync('/bin/ps', ['-o', 'pid=,stat=,lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  const line = (r.stdout ?? '').split('\n').find((l) => l.trim());
  if (!line) return null;
  const m = /^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
  return m ? { start: m[3]!, zombie: m[2]!.startsWith('Z') } : null;
}
/** Remembers the PID with the start time it has now, so the file can stop it later. */
export function own(pid: number | undefined): void {
  if (!pid || seen.has(pid)) return;
  const now = look(pid);
  if (now) seen.set(pid, now.start);
}
/** The PID still runs with the start time first seen for it. */
export function alive(pid: number): boolean {
  const now = look(pid);
  if (!now || now.zombie) return false;
  const first = seen.get(pid);
  return first === undefined || first === now.start;
}
function stopSeen(): void {
  for (const [pid, start] of seen) {
    const now = look(pid);
    if (now && !now.zombie && now.start === start) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  seen.clear();
}

// ---- The environment a child gets: this one with HOME moved and no DEEP_ settings of its own.
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.PATH = `${dirname(NODE)}:/usr/bin:/bin`;
  env.LC_ALL = 'C';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

// ---- The hub as a process: `deep hub run --root <root>` (#16), with its own temp HOME.
export interface HubProc { pid: number; root: string; child: ChildProcess; stdout(): string; stderr(): string; ready: Promise<Line | undefined>; exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }
export interface Hub extends HubProc { socket: string }
export interface HubOptions { vfs?: { points?: string; cutAfter?: number }; env?: Record<string, string | undefined> }
export function spawnHub(root: string, o: HubOptions = {}): HubProc {
  const home = sub(dirname(root), 'hub-home');
  const env = childEnv(home, { DEEP_HUB_TEST_VFS: o.vfs && JSON.stringify(o.vfs), ...o.env });
  const child = spawn(NODE, [CLI, 'hub', 'run', '--root', root], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise<Line | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) {
        try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); }
      }
    });
    void exit.then(() => resolve(undefined));
  });
  return { pid: child.pid!, root, child, stdout: () => out, stderr: () => err, ready, exit };
}
/** The hub started on `root` and ready; or, when it exits or says nothing within the time, why, as `failed`. */
export async function tryHub(root: string, o: HubOptions = {}, timeoutMs = 30_000): Promise<{ hub?: Hub; failed?: string }> {
  const proc = spawnHub(root, o);
  const line = await Promise.race([proc.ready, sleep(timeoutMs).then(() => undefined)]);
  if (line?.ready && typeof line.socket === 'string') return { hub: { ...proc, socket: line.socket } };
  const ended = await Promise.race([proc.exit, sleep(200).then(() => undefined)]);
  if (!ended) await stopHub(proc, 'SIGKILL');
  return { failed: `${ended ? `it exited (${ended.code ?? ended.signal})` : `it said nothing ready within ${timeoutMs} ms`}; stderr: ${proc.stderr().trim().slice(0, 1500) || '(none)'}` };
}
export async function startHub(root: string, o: HubOptions = {}): Promise<Hub> {
  const { hub, failed } = await tryHub(root, o);
  if (!hub) throw Error(`BLOCKED: the hub didn't start (deep hub run --root ${root}): ${failed}`);
  return hub;
}
/** kill -9, as a crash: no clean stop. */
export async function crashHub(hub: HubProc): Promise<void> {
  try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}
export async function stopHub(hub: HubProc, signal: NodeJS.Signals = 'SIGTERM', timeoutMs = 15_000): Promise<void> {
  try { process.kill(hub.pid, signal); } catch { return; }
  const done = await Promise.race([hub.exit.then(() => true), sleep(timeoutMs).then(() => false)]);
  if (!done) {
    try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
    await hub.exit;
  }
}

// ---- The line protocol (#16): a cli connection with the control token.
export class Client {
  private buffer = '';
  private lines: Line[] = [];
  private ids = 0;
  ended = false;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        try { this.lines.push(JSON.parse(this.buffer.slice(0, i)) as Line); } catch { /* not a line of ours */ }
        this.buffer = this.buffer.slice(i + 1);
      }
    });
    sock.on('error', () => { this.ended = true; });
    sock.on('close', () => { this.ended = true; });
  }
  static async open(hub: { socket: string; root: string }): Promise<Client> {
    const sock = net.connect(hub.socket);
    await new Promise<void>((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); });
    const c = new Client(sock);
    await waitFor(() => c.lines.length > 0, 5000, 'the hub\'s hello');
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`);
    await waitFor(() => c.lines.some((l) => l.role === 'cli'), 5000, 'the cli role');
    return c;
  }
  /** The call's result; throws on a refusal, a closed connection or no reply in time. */
  async call(method: string, params: unknown = {}, timeoutMs = 15_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const until = Date.now() + timeoutMs;
    for (;;) {
      const reply = this.lines.find((l) => l.id === id);
      if (reply) {
        if (reply.error) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
        return reply.result as Line;
      }
      if (this.ended) throw Error(`the connection closed before ${method} was answered`);
      if (Date.now() > until) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
      await sleep(10);
    }
  }
  /** Every event in the log, paged by log_pos through events.read. */
  async events(): Promise<Line[]> {
    const out: Line[] = [];
    for (let after = 0; ;) {
      const page = (await this.call('events.read', { after, limit: 1000 })).events as Line[];
      if (!page.length) return out;
      out.push(...page);
      after = page[page.length - 1]!.log_pos as number;
    }
  }
  close(): void { this.sock.destroy(); }
}

export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(50);
  }
}

// ---- The test VFS's points file (#16): one JSON line per durable write point, {n, kind, ...}.
export interface Point { n: number; kind: string; mode?: string; ids?: string[] }
export const pointsIn = (file: string): Point[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Point) : []);
/** A point made by a write of the run journal: its kind names the journal or runs.json (README, The points). */
export const journalPoint = (p: Point): boolean => /journal|runs/i.test(p.kind);
export const terminalsPoint = (p: Point): boolean => /terminal/i.test(p.kind);

// ---- The run journal: <root>/runs.json, a JSON object of the runs in flight (README, The journal).
export interface RunSpec { check: string; claim: string; deadline_ms: number; argv: string[]; cwd: string }
/**
 * The three runs AC1 starts: each its own check, claim (its owner) and deadline (20, 30 and 40 minutes). Each sleeps
 * 90 s: long past any one pass (a restart relaunches what it recovers, so a pass needs its runs for seconds), and
 * short enough that a run whose process.tracked a cut lost, which no restart can reap, ends on its own soon after.
 */
export function threeRuns(cwd: string): RunSpec[] {
  return ['alpha', 'bravo', 'charlie'].map((name, k) => ({ check: `deadline-${name}`, claim: `claim:${ulid()}`, deadline_ms: (20 + 10 * k) * 60_000, argv: ['/bin/sleep', '90'], cwd }));
}
export const startParams = (r: RunSpec): Line => ({ check: r.check, claim: r.claim, commit: COMMIT, argv: r.argv, cwd: r.cwd, deadline_ms: r.deadline_ms });
/** runs.json as the journal holds it: its entries, or why it can't be read. */
export function journalOf(root: string): { entries: Line[]; problem?: string } {
  const file = join(root, 'runs.json');
  if (!existsSync(file)) return { entries: [], problem: `${file} doesn't exist` };
  const text = readFileSync(file, 'utf8');
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== 'object' || value === null) return { entries: [], problem: `${file} holds ${text.slice(0, 80)}, not an object of runs` };
    return { entries: (Array.isArray(value) ? value : Object.values(value)).filter((e): e is Line => typeof e === 'object' && e !== null) };
  } catch (e) {
    return { entries: [], problem: `${file} can't be read as JSON (${message(e)}; ${text.length} bytes)` };
  }
}
/**
 * A journal entry keeps the run's deadline: `deadline` as run.start gave it, in ms, as main writes it; or a field
 * named for the deadline holding the time it falls due, within two minutes of the run's start plus its deadline.
 */
export function keepsDeadline(entry: Line, r: RunSpec, startedAt: number): boolean {
  return Object.entries(entry).some(([key, value]) => /deadline|due/i.test(key) && typeof value === 'number'
    && (value === r.deadline_ms || Math.abs(value - (startedAt + r.deadline_ms)) <= 120_000));
}
/** Each of `runs` the journal doesn't hold with its owner (its claim) and its deadline, named. */
export function missingRuns(entries: Line[], runs: RunSpec[], startedAt: number): string[] {
  return runs.flatMap((r) => {
    const mine = entries.filter((e) => e.check === r.check && e.claim === r.claim);
    if (!mine.length) return [`${r.check} (owner ${r.claim}, deadline ${r.deadline_ms} ms) is not in the journal`];
    if (!mine.some((e) => keepsDeadline(e, r, startedAt))) return [`${r.check} (owner ${r.claim}) is in the journal without its deadline of ${r.deadline_ms} ms: ${JSON.stringify(mine[0]).slice(0, 300)}`];
    return [];
  });
}

// ---- A state file kept aside: in the same folder, named for the file and the time (README, Kept aside).
const TIME = /\d{4}-?\d{2}-?\d{2}|\d{10,}/;
export function keptAside(folder: string, name: string, bytes: Buffer): { found?: string; problem?: string } {
  const others = existsSync(folder) ? readdirSync(folder).filter((f) => f !== name && f.startsWith(name) && !f.endsWith('.tmp')) : [];
  const timed = others.filter((f) => TIME.test(f.slice(name.length)));
  const same = timed.find((f) => readFileSync(join(folder, f)).equals(bytes));
  if (same) return { found: same };
  return { problem: `no file beside ${name} in ${folder}, named for it and a time, holds the damaged ${bytes.length} bytes as they were; beside it: ${JSON.stringify(others)}${timed.length ? `, of which named with a time: ${JSON.stringify(timed)} (${timed.map((f) => `${readFileSync(join(folder, f)).length} bytes`).join(', ')})` : ''}` };
}
/** The readings among `events` that name `file` (README, The reading). */
export const readingsNaming = (events: Line[], file: string): Line[] => events.filter((e) => /reading/i.test(String(e.kind)) && JSON.stringify(e.data ?? {}).includes(file));

// ---- AC2's world: the record, supervisor and extension host the hub opens on its root (core.ts's start), opened in
// this process on the same files, with the hub stopped.
export interface World { root: string; record: RecordStore; sup: Supervisor; close(): Promise<void> }
const roots = new Set<string>();
export async function openWorld(root: string): Promise<World> {
  mkdirSync(root, { recursive: true });
  roots.add(root);
  const record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  let closed = false;
  return {
    root, record, sup,
    close: async () => {
      if (closed) return;
      closed = true;
      await sup.close();
      await record.close();
    },
  };
}
/** The extension-host package, loaded lazily. */
export const hostModule = () => import(new URL(HOST_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/extension-host/src/index.ts')>;
/** The extension host as the hub opens it: on the hub's record and supervisor, its home the hub root. */
export async function openHostOn(w: World): Promise<ExtensionHost> {
  const { openExtensionHost, openTrust } = await hostModule();
  const trust = await openTrust({ record: w.record, now: Date.now });
  const h = await openExtensionHost({ record: w.record, supervisor: w.sup, trust, home: w.root, release: [], now: Date.now });
  await h.ready();
  return h;
}
/** You, on the trusted path: the app. */
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };

/** fixtures/hosted-terminals copied with its `.fixture` file renamed, and its digest set to the host's own. */
export async function fixturePackage(): Promise<string> {
  const dir = join(tempDir(), 'hosted-terminals');
  cpSync(join(FIXTURES, 'hosted-terminals'), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const { packageDigest } = await hostModule();
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
export async function installAndLoad(h: ExtensionHost, from: string): Promise<Installed> {
  const p = await h.install({ from, builtBy: null });
  const checked = await h.check(p);
  if (!checked.passed) throw Error(`BLOCKED: ${p.id} failed its conformance: ${checked.reasons.join('; ')}`);
  await h.approve(YOU, p.id, 'run_as_you');
  const load = await h.load(p);
  if (load.status !== 'loaded') throw Error(`BLOCKED: ${p.id} didn't load: ${load.reason}`);
  return p;
}
export async function act(h: ExtensionHost, p: { id: string; version: string }, action: string, input: unknown): Promise<Line> {
  const r = await h.callAction({ action, target: { handle: `ext:${p.id}`, version: p.version }, input, caller: YOU });
  if (r.status !== 'done') throw Error(`${action} didn't run: ${r.reason}`);
  return (r.output ?? {}) as Line;
}

/** One seeded hosted terminal, as the hub's terminals index keeps it (packages/extension-host/src/terminals.ts). */
export interface Seeded { terminal: string; id: string; run: string; pid: number; title: string; kept: true; dir: string }
/**
 * A hosted terminal's host process, as the extension host starts it: a run the supervisor keeps past the hub (keep),
 * run as you, appending what its program writes to `<root>/terminals/<id>/out`. Linux's helper has no pty mode, so the
 * program writes the file itself: a shell printing `beat N` every 0.1 s, noting its PID in `pid`.
 */
export async function seedTerminal(w: World, pkg: string, title: string): Promise<Seeded> {
  const id = ulid();
  const terminal = `term:${id}`;
  const run = `run:${ulid()}`;
  const dir = sub(w.root, 'terminals', id);
  const script = 'echo $$ > pid.tmp && mv pid.tmp pid; i=0; while :; do i=$((i+1)); echo "beat $i" >> out; sleep 0.1; done';
  const started = await w.sup.start({ run, argv: ['/bin/sh', '-c', script], cwd: dir, env: {}, grant: { run_as_you: true }, keep: true });
  if (started.status !== 'started') throw Error(`BLOCKED: the supervisor held ${title}'s host process: ${JSON.stringify(started)}`);
  const pid = await waitFor(() => { const n = existsSync(join(dir, 'pid')) ? Number(readFileSync(join(dir, 'pid'), 'utf8').trim()) : 0; return n > 0 ? n : undefined; }, 10_000, `${title}'s program to note its PID`);
  own(pid);
  return { terminal, id: pkg, run, pid, title, kept: true, dir };
}
/** The index as Terminals.save writes it: an object by terminal ID, two-space JSON. */
export function indexText(terminals: Seeded[]): string {
  return JSON.stringify(Object.fromEntries(terminals.map(({ dir: _dir, ...t }) => [t.terminal, t])), null, 2);
}
/** One bad byte in the third entry: a raw control byte (0x01) in place of the second letter of its title. */
export function damage(text: string, third: Seeded): Buffer {
  const at = text.indexOf(`"title": "${third.title}"`);
  if (at < 0) throw Error(`BLOCKED: the index doesn't hold ${third.title}'s title`);
  const bytes = Buffer.from(text, 'utf8');
  const byte = Buffer.byteLength(text.slice(0, at), 'utf8') + '"title": "'.length + 1;
  bytes[byte] = 0x01;
  return bytes;
}
/** Beats a seeded terminal's program wrote, as numbers. */
export const beats = (text: string): number[] => [...String(text).matchAll(/beat (\d+)/g)].map((m) => Number(m[1]));

/** After the file: every process the supervisor recorded in a record this suite made, still running, is stopped by PID. */
async function reapRoots(): Promise<void> {
  for (const root of roots) {
    if (!existsSync(join(root, 'ledger.db'))) continue;
    const record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now }).catch(() => undefined);
    if (!record) continue;
    try {
      for (let after = 0; ;) {
        const page = await record.read({ after, limit: 1000 });
        for (const e of page) {
          const d = e.data as { pid?: unknown; start?: unknown };
          if (e.kind !== 'process.tracked' || e.writer !== 'core' || typeof d.pid !== 'number' || typeof d.start !== 'string') continue;
          const now = look(d.pid);
          if (now && !now.zombie && now.start === d.start) try { process.kill(d.pid, 'SIGKILL'); } catch { /* gone */ }
        }
        if (page.length < 1000) break;
        after = page[page.length - 1]!.log_pos;
      }
    } finally {
      await record.close();
    }
  }
}
/** Hub roots whose runs.json this suite's hubs wrote: their journals' runs are reaped after the file too. */
export function watchRoot(root: string): void { roots.add(root); }

afterAll(async () => {
  await reapRoots().catch(() => undefined);
  stopSeen();
  roots.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 60_000);
