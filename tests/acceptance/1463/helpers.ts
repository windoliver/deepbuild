// Test-side tools for #1463 (README). One fixture record, made the way the hub makes one: a real hub (`deep hub run` in
// a temp HOME) takes each session's hooks over its socket, then the record and asks core seed titles and asks with the
// hub stopped, and a real hub starts on it again. Every reader is the real one: the CLI (`node packages/cli/dist/main.js`)
// for `deep`, `deep status` and `deep inbox`, and the real `deep-drive` (#124) for the app's list, launched with
// `launch.from: "record_copy"` so it reads the same hub's record. The judges each criterion's failure message comes from
// are here too, and judges.test.ts holds each one to a right input and the wrong ones.
//
// Reused by import: #16's hub, socket, hooks, sessions, temp folders and PID cleanup; #26's record seeding through the
// real record and asks core; #1551's reference-Mac and load gate.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; no test touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  allEvents, childEnv, cleanup as cleanup16, control, deep as deep16, hookRequest, makeHome, newSession, own, REPO, sendHook, sleep,
  startHub, stopHub, tempDir, type Ev, type Hub, type Ran, type Session,
} from '../16/helpers.ts';
import { cleanup as cleanup26, seed, sha256, ulid } from '../26/helpers.ts';

// Every clock time a reader prints is in your time zone: this suite's is one with a half-hour offset, so neither UTC
// nor a whole-hour slip can pass for it. Children inherit it through #16's and #26's environments.
export const ZONE = 'Asia/Kolkata';
process.env.TZ = ZONE;

export { REPO, sleep, stopHub, tempDir, type Ev, type Hub, type Ran };
/** Every event in the world's hub's record, through `events.read`. */
export async function allEventsOf(w: { hub: Hub }): Promise<Ev[]> {
  const conn = await control(w.hub);
  try { return await allEvents(conn); } finally { conn.close(); }
}
export const SUITE = fileURLToPath(new URL('./', import.meta.url));

/** The criteria, by `#1463.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  list: '#1463.f9ab70a8',
  deep: '#1463.824c8001',
  down: '#1463.59289fca',
  inbox: '#1463.91324b7e',
  scope: '#1463.31fc1678',
  words: '#1463.cc5d1e3f',
  budget: '#1463.0c303476',
  defaults: '#1463.8ad45787',
  detail: '#1463.03f69be1',
  undo: '#1463.dacb7e33',
  notification: '#1463.bfbc08f9',
  unread: '#1463.17f151eb',
} as const;

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const cleanup = async (): Promise<void> => { await cleanup16(); await cleanup26(); };

// ---- Clock times, in ZONE.

const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** `ms` as a person reads a clock in ZONE: 16:40. */
export const clockOf = (ms: number): string => new Date(ms).toLocaleTimeString('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
/** Today at `hh:mm` in ZONE, in ms. */
export function todayAt(hh: number, mm: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0).getTime();
}
/** The hub's clock in the worlds that need "today at 16:40" ahead of it: noon today, in ZONE (DEEP_HUB_TEST_CLOCK). */
export const NOON = todayAt(12, 0);
/** Every clock time between `from` and `to`, a minute either side, as clockOf writes them. */
export function clocksBetween(from: number, to: number): string[] {
  const out: string[] = [];
  for (let t = from - MINUTE; t <= to + MINUTE; t += MINUTE) out.push(clockOf(t));
  return out;
}

// ---- Builds. deep-drive plain and with the replica's env-plants feature (the app's plants, read from DEEP_HUB_PLANT),
// each copied out of the target folder under its own name; the plain one is built last, so target/debug holds it.

const BIN = join(tmpdir(), `dh1463-bin-${userInfo().uid}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
function cargo(args: string[]): void {
  try {
    execFileSync('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: CARGO_ENV, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const e = error as { stderr?: Buffer; message: string };
    blocked(`cargo build ${args.join(' ')} failed: ${(e.stderr?.toString() ?? e.message).split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n') || e.message}`);
  }
}
let drives: { plain: string; plants: string } | undefined;
/** The replica: `deep-drive`, plain and with env-plants. */
export function driveBinaries(): { plain: string; plants: string } {
  if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
  if (!drives) {
    mkdirSync(BIN, { recursive: true });
    cargo(['-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants']);
    const plants = join(BIN, 'deep-drive-plants');
    copyFileSync(target('deep-drive'), plants);
    cargo(['-p', 'deep-replica', '--bin', 'deep-drive', '-p', 'deep-hook', '--bin', 'deep-hook']);
    const plain = join(BIN, 'deep-drive-plain');
    copyFileSync(target('deep-drive'), plain);
    drives = { plain, plants };
  }
  return drives;
}
/** The CLI and deep-hook must be built: a test that can't run them is BLOCKED, never a pass. */
export function needBuilds(): void {
  if (!existsSync(join(REPO, 'packages/cli/dist/main.js'))) blocked('no built CLI at packages/cli/dist/main.js; run npm run build --workspaces first');
  if (!existsSync(target('deep-hook'))) blocked('no deep-hook under target/debug; run cargo build --locked -p deep-hook first');
}

// ---- The fixture (README, The fixture): sessions in repos, played through the hub's hooks, then titled and asked.

export interface AskSpec { kind: 'taste' | 'choice'; question: string; options: [string, string][]; default: string; deadline: (at: number) => number; defaulted?: true }
export interface SessionSpec { key: string; repo: string; title?: string; calls: number; failed?: number; stop: boolean; asks?: AskSpec[] }
export interface FixtureAsk { handle: string; question: string; session: string; key: string; label: string; deadline: number; defaulted: boolean }
export interface FixtureSession { key: string; id: string; repo: string; title: string | undefined; cwd: string }
export interface World { home: string; root: string; hub: Hub; confirm: string; repos: Record<string, string>; sessions: FixtureSession[]; asks: FixtureAsk[]; clock: number | undefined; startedAt: number }

/** The next 16:40 in ZONE after `at`. */
export const next1640 = (at: number): number => { const t = new Date(at); const d = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 16, 40).getTime(); return d > at ? d : d + DAY; };
/** The fixture most criteria read: five sessions in three repos, three open asks in two sessions and one ask taken by its default. */
export const MAIN: SessionSpec[] = [
  { key: 'cart', repo: 'shop', title: 'Cart totals', calls: 2, stop: true, asks: [
    { kind: 'taste', question: 'Which header colour on the login page?', options: [['blue', 'Blue header'], ['green', 'Green header']], default: 'blue', deadline: (at) => at + 2 * DAY },
    { kind: 'choice', question: 'Ship the cart page today?', options: [['yes', 'Yes'], ['no', 'No']], default: 'no', deadline: next1640 },
  ] },
  { key: 'notes', repo: 'docs', title: 'Release notes', calls: 1, stop: true, asks: [
    { kind: 'choice', question: 'Keep the changelog as a list or as prose?', options: [['list', 'A list'], ['prose', 'Prose']], default: 'list', deadline: (at) => at + DAY },
  ] },
  { key: 'search', repo: 'search', title: 'Search index', calls: 3, failed: 1, stop: true },
  { key: 'untitled', repo: 'shop', calls: 1, stop: false },
  { key: 'refresh', repo: 'docs', title: 'Docs refresh', calls: 1, stop: true, asks: [
    { kind: 'choice', question: 'Keep the cart on SQLite or plain files?', options: [['sqlite', 'SQLite'], ['files', 'Plain files']], default: 'sqlite', deadline: (at) => at + MINUTE, defaulted: true },
  ] },
];
export const THE_1640_ASK = 'Ship the cart page today?';
export const DEFAULTED_ASK = 'Keep the cart on SQLite or plain files?';

/** Waits until the hub's log stops growing for `quietMs`; its last log_pos. */
export async function quiet(hub: Hub, quietMs = 1500, timeoutMs = 30_000): Promise<number> {
  const conn = await control(hub);
  try {
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    let since = Date.now();
    for (;;) {
      const page = (await conn.call('events.read', { after: Math.max(last, 0), limit: 1000 })).result as { events: Ev[] } | undefined;
      const pos = page?.events.at(-1)?.log_pos ?? last;
      if (pos !== last) { last = pos; since = Date.now(); }
      if (Date.now() - since >= quietMs) return last;
      if (Date.now() > deadline) return last;
      await sleep(200);
    }
  } finally {
    conn.close();
  }
}

/**
 * A world on `specs`: each repo a git folder under one temp folder; each session's hooks through a hub whose process is a
 * stand-in of its own (a `sleep`, so no command a test runs is inside an agent's tree); then, with that hub stopped, each
 * title (task.created) and ask raised through the record and asks core, an ask marked `defaulted` taken by its default;
 * then a real hub again, with the OS confirmation stubbed `confirmed` (#24's DEEP_HUB_TEST_CONFIRM). `clock` sets the
 * hub's clock where it starts (DEEP_HUB_TEST_CLOCK); it moves with real time from there.
 */
export async function makeWorld(specs: readonly SessionSpec[], o: { clock?: number } = {}): Promise<World> {
  needBuilds();
  const home = makeHome();
  const root = join(home, '.deepbuild');
  const base = tempDir();
  const confirm = join(base, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const env = { DEEP_HUB_TEST_CONFIRM: confirm };
  const repos: Record<string, string> = {};
  for (const name of new Set(specs.map((s) => s.repo))) {
    const dir = join(base, name);
    mkdirSync(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: dir } });
    repos[name] = dir;
  }
  const clock = o.clock;
  const played: { spec: SessionSpec; s: Session }[] = specs.map((spec) => ({ spec, s: newSession(home, 'claude-code', repos[spec.repo]) }));
  let hub = await startHub({ home, env, ...(clock === undefined ? {} : { clock }) });
  for (const { spec, s } of played) {
    const agent = spawn('/bin/sleep', ['7200'], { stdio: 'ignore' });
    own(agent.pid);
    const send = async (event: string, extra: Record<string, unknown> = {}): Promise<void> => {
      const r = await sendHook(hub.socket, { ...hookRequest(s, event, extra), pid: agent.pid!, ppid: agent.pid! }, 15_000);
      if (!r.ack) blocked(`the hub didn't acknowledge ${event} for ${spec.key}: ${JSON.stringify(r).slice(0, 600)}`);
    };
    await send('SessionStart');
    await send('UserPromptSubmit', { prompt: `work on ${spec.title ?? spec.key}` });
    for (let c = 0; c < spec.calls; c++) {
      const call = { tool_name: 'Bash', tool_use_id: `toolu_${spec.key}_${c}`, tool_input: { command: `npm run step-${c}` } };
      await send('PreToolUse', call);
      if (c < (spec.failed ?? 0)) await send('PostToolUseFailure', { ...call, error: 'Exit code 1' });
      else await send('PostToolUse', { ...call, tool_response: { stdout: 'ok', stderr: '', interrupted: false } });
    }
    if (spec.stop) await send('Stop');
  }
  await quiet(hub);
  const conn = await control(hub);
  const events = await allEvents(conn);
  conn.close();
  await stopHub(hub);
  const projectOf = (id: string): string | undefined => (events.find((e) => e.kind === 'session.start' && e.session === id) as (Ev & { project?: string }) | undefined)?.project;
  const sessions: FixtureSession[] = played.map(({ spec, s }) => ({ key: spec.key, id: s.id, repo: spec.repo, title: spec.title, cwd: s.cwd }));
  const asks: FixtureAsk[] = [];
  const at = (clock ?? Date.now()) + 10 * MINUTE;
  await seed(home, async (sd) => {
    sd.at(at);
    for (const { spec, s } of played) {
      const who = { actor: 'you', scope: 'you', session: s.id, ...(projectOf(s.id) ? { project: projectOf(s.id)! } : {}) };
      if (spec.title) await sd.record.append({ writer: 'app', ...who }, { v: 1, id: ulid(at), kind: 'task.created', ts: at, data: { task_ref: `task:${ulid(at)}`, thread: s.id, owner: 'you', title: spec.title } });
      for (const a of spec.asks ?? []) {
        const deadline = a.deadline(at);
        const handle = await sd.asks.raise({ writer: 'core', ...who }, `deep_ask.${a.kind}`, {
          kind: a.kind, question: a.question, options: a.options.map(([id, label]) => ({ id, label, decision: 'none' })), recommended: a.default, deadline,
          fallback: 'you', default: a.default, provisional: false, owner: 'you', key: sha256(`#1463 ${a.question}`), pinned_to: { kind: 'evidence', ref: sha256(a.question) },
        });
        asks.push({ handle, question: a.question, session: s.id, key: spec.key, label: a.options.find(([id]) => id === a.default)![1], deadline, defaulted: a.defaulted === true });
      }
    }
    if (asks.some((a) => a.defaulted)) {
      sd.at(at + 2 * MINUTE);
      await sd.asks.tick();
    }
  }, at);
  // Setup finished in this home, so no `deep` command here runs it (#1002's marker, as #1172's world writes it).
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(root, 'setup-finished.json'), JSON.stringify({ version }));
  const startedAt = Date.now();
  hub = await startHub({ home, env, ...(clock === undefined ? {} : { clock: clock + 20 * MINUTE }) });
  await quiet(hub);
  return { home, root, hub, confirm, repos, sessions, asks, clock, startedAt };
}

// ---- The readers.

/** `deep <args>` as you run it, from the test process (no agent above it); `plant` is DEEP_HUB_PLANT in its process only. */
export function deep(w: { home: string }, args: readonly string[], plant?: string): Promise<Ran> {
  return deep16(w.home, args, { env: { DEEP_HUB_PLANT: plant }, timeoutMs: 120_000 });
}
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(0, 2500))}, stderr ${JSON.stringify(r.stderr.slice(0, 800))}`;

/** The row shape (Pinned 3). */
export const ROW_KEYS = ['id', 'address', 'title', 'entry', 'word', 'why', 'waits_on', 'since', 'actions', 'unread'] as const;
export type Row = Record<(typeof ROW_KEYS)[number], unknown> & { id: string; word: string; title: string; unread: boolean; default?: unknown; default_at?: unknown; [key: string]: unknown };
export interface Rows { log_pos: number; rows: Row[] }

/** `deep status --json` or `deep inbox --json`: one JSON object `{log_pos, rows}` (Pinned 1, 2). */
export async function jsonRows(w: { home: string }, command: 'status' | 'inbox', plant?: string): Promise<Rows> {
  const r = await deep(w, [command, '--json'], plant);
  let parsed: unknown;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = undefined; }
  const p = parsed as Partial<Rows> | undefined;
  expect(r.code === 0 && typeof p?.log_pos === 'number' && Array.isArray(p.rows), `deep ${command} --json must exit 0 and print one JSON object {log_pos, rows}: ${shown(r)}`).toBe(true);
  return p as Rows;
}

// ---- The replica, driven: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

export interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds: number[]; children: SNode[] }
export interface Snapshot { window: { size: number[]; scale: number }; tree: SNode; items: unknown[]; menu_bar?: unknown }
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };

export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Record<string, any>) => void)[] = [];
  private exited = false;
  private err = '';
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let parsed: Record<string, any>;
        try { parsed = JSON.parse(line) as Record<string, any>; } catch { parsed = { unparsed: line }; }
        this.waiting.shift()?.(parsed);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); });
  }
  /** `bin` with HOME the world's, so `record_copy` reads its hub; `plant` is DEEP_HUB_PLANT in its process. */
  static async start(bin: string, home: string, plant?: string): Promise<Drive> {
    const out = join(tempDir(), 'out');
    mkdirSync(out, { recursive: true });
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(home, { DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const drive = new Drive(child);
    const ready = await drive.next(180_000);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${JSON.stringify(ready).slice(0, 300)} ${drive.err.slice(-600)}`);
    return drive;
  }
  private next(ms: number): Promise<Record<string, any>> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call, which must answer ok. */
  async must(args: Record<string, unknown>): Promise<Record<string, any>> {
    const reply = this.next(180_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${JSON.stringify(got).slice(0, 300)} ${this.err.slice(-600)}`);
    expect(got.ok, `deep-drive ${String(args.call)}: ${JSON.stringify(got).slice(0, 800)}`).toBe(true);
    return got;
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

export interface AppList { snapshot: Snapshot; rows: Row[] | undefined; log_pos: number | undefined; count: number[] }
/** The app's list over the world's record: the replica launched on a copy of the hub's record, its `see` (Pinned 5). */
export async function appList(w: World): Promise<AppList> {
  const drive = await Drive.start(driveBinaries().plain, w.home);
  try {
    await drive.must({ call: 'launch', launch: { from: 'record_copy' } });
    const seen = await drive.must({ call: 'see' });
    const snapshot = seen.snapshot as Snapshot;
    return { snapshot, rows: Array.isArray(seen.rows) ? (seen.rows as Row[]) : undefined, log_pos: typeof seen.log_pos === 'number' ? seen.log_pos : undefined, count: countsIn(flat(snapshot.tree).map((n) => n.name ?? '').join('\n')) };
  } finally {
    await drive.stop();
  }
}
/** What the replica posted over the world's record in its first 3 s: each notification `{ask, session, text}`, its title the text's first line. */
export async function notifications(w: World, plant?: string): Promise<{ ask: string | null; session: string; text: string }[]> {
  const bins = driveBinaries();
  const drive = await Drive.start(plant ? bins.plants : bins.plain, w.home, plant);
  try {
    await drive.must({ call: 'launch', launch: { from: 'record_copy' } });
    await drive.must({ call: 'wait_for', wait_for: { t: 3 * 705_600_000 }, timeout: 5000 });
    const closed = await drive.must({ call: 'close' });
    return (JSON.parse(readFileSync(String(closed.trace.path), 'utf8')) as { notifications: { ask: string | null; session: string; text: string }[] }).notifications;
  } finally {
    await drive.stop();
  }
}

/**
 * `deep status --json` and the app's list read at one log_pos: the status read before the replica's copy, or after it,
 * whichever has the copy's log_pos.
 */
export async function atOneLogPos(w: World): Promise<{ app: AppList; status: Rows }> {
  await quiet(w.hub);
  const before = await jsonRows(w, 'status');
  const app = await appList(w);
  if (app.rows === undefined || app.log_pos === undefined) expect.fail(`deep_drive's see must answer the list's rows and their log_pos beside its snapshot (README, Pinned 5); it answered keys ${JSON.stringify(Object.keys(app))} with rows ${String(app.rows)} and log_pos ${String(app.log_pos)}`);
  if (before.log_pos === app.log_pos) return { app, status: before };
  const after = await jsonRows(w, 'status');
  expect(after.log_pos, `deep status --json read log_pos ${before.log_pos} and ${after.log_pos} around the app's copy at ${app.log_pos}: no read at one log_pos`).toBe(app.log_pos);
  return { app, status: after };
}

// ---- states::TABLE, read from its source: the words every surface names a state with, and their status-map entries.

export interface TableRow { word: string; entry: string; never: string[] }
export function stateTable(): TableRow[] {
  const source = readFileSync(join(REPO, 'crates/deep-app/src/states.rs'), 'utf8');
  const block = /pub const TABLE[^=]*=\s*\[([\s\S]*?)\n\];/.exec(source)?.[1] ?? blocked('crates/deep-app/src/states.rs has no `pub const TABLE`');
  const rows = [...block.matchAll(/\(\s*"([^"]+)",\s*"([^"]+)",\s*&\[([^\]]*)\]\s*,?\s*\)/g)].map(([, word, entry, never]) => ({ word: word!, entry: entry!, never: [...never!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!) }));
  if (!rows.length) blocked('states::TABLE parsed to no rows');
  return rows;
}

// ---- Judges (judges.test.ts holds each to a right input and the wrong ones). Each returns what's wrong, or nothing.

const said = (v: unknown): string => JSON.stringify(v)?.slice(0, 160) ?? String(v);
/** Every row has the row shape's keys, an id, a word and a boolean `unread`. */
export function shapeFailures(rows: readonly Row[], who: string): string[] {
  const out: string[] = [];
  for (const [i, r] of rows.entries()) {
    const missing = ROW_KEYS.filter((k) => !(k in r));
    if (missing.length) out.push(`${who}'s row ${i + 1} (${said(r.id)}) lacks ${missing.join(', ')}`);
    if (typeof r.id !== 'string' || !r.id) out.push(`${who}'s row ${i + 1} has no id: ${said(r)}`);
    if (typeof r.word !== 'string' || !r.word) out.push(`${who}'s row ${r.id} has no word`);
    if (typeof r.unread !== 'boolean') out.push(`${who}'s row ${r.id} carries unread ${said(r.unread)}, not true or false`);
  }
  return out;
}
/** The fields AC1 and AC12 compare, besides order. `why` may carry an age and `actions` what a device offers, so they aren't. */
export const COMPARED = ['title', 'entry', 'word', 'address', 'waits_on', 'since', 'unread'] as const;
/** What differs between the app's rows and another reader's, each naming the row: rows, IDs, order and the compared fields. */
export function rowFailures(app: readonly Row[], other: readonly Row[], who: string): string[] {
  const out: string[] = [];
  const mine = new Map(app.map((r) => [r.id, r]));
  const theirs = new Map(other.map((r) => [r.id, r]));
  for (const r of app) if (!theirs.has(r.id)) out.push(`row ${r.id} ("${r.title}") is in the app's list and not in ${who}`);
  for (const r of other) if (!mine.has(r.id)) out.push(`row ${r.id} ("${r.title}") is in ${who} and not in the app's list`);
  const shared = (rows: readonly Row[], keep: Map<string, Row>) => rows.filter((r) => keep.has(r.id)).map((r) => r.id);
  const [a, b] = [shared(app, theirs), shared(other, mine)];
  const at = a.findIndex((id, i) => id !== b[i]);
  if (at >= 0) out.push(`row ${a[at]} is row ${at + 1} in the app's list and row ${b.indexOf(a[at]!) + 1} in ${who}: a second order (the app's is ${a.join(', ')}; ${who}'s is ${b.join(', ')})`);
  for (const r of app) {
    const o = theirs.get(r.id);
    if (!o) continue;
    for (const k of COMPARED) if (JSON.stringify(r[k]) !== JSON.stringify(o[k])) out.push(`row ${r.id} has ${k} ${said(r[k])} in the app's list and ${said(o[k])} in ${who}`);
  }
  return out;
}
const textOf = (n: SNode): string => [n.name ?? '', typeof n.value === 'string' ? n.value : '', ...(n.children ?? []).map(textOf)].join(' ');
/** The app's list as drawn: each row's node, by its id, in the rows' order, holding the row's title and word. */
export function drawnFailures(s: Snapshot, rows: readonly Row[]): string[] {
  const nodes = flat(s.tree);
  const out: string[] = [];
  let last = -1;
  for (const r of rows) {
    const at = nodes.findIndex((n) => n.id === r.id);
    if (at < 0) { out.push(`row ${r.id} ("${r.title}") is in see's rows but no node of the window carries its id`); continue; }
    if (at < last) out.push(`row ${r.id} ("${r.title}") is drawn above the row before it in see's rows`);
    last = at;
    const text = textOf(nodes[at]!);
    for (const [what, value] of [['title', r.title], ['word', r.word]] as const) if (typeof value === 'string' && !text.includes(value)) out.push(`row ${r.id}'s node reads ${said(text.trim())}, which lacks its ${what} "${value}"`);
  }
  return out;
}
/** The rows in a reader's text: in order, each on a line holding its title and its word. */
export function textRowFailures(text: string, rows: readonly Row[], who: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  let from = 0;
  for (const r of rows) {
    const at = lines.findIndex((l, i) => i >= from && l.includes(r.title) && l.includes(r.word));
    if (at < 0) {
      const anywhere = lines.findIndex((l) => l.includes(r.title) && l.includes(r.word));
      out.push(anywhere < 0 ? `${who} has no line holding row ${r.id}'s title "${r.title}" and its word "${r.word}"` : `${who} lists row ${r.id} ("${r.title}") out of the rows' order`);
      continue;
    }
    from = at + 1;
  }
  return out;
}
/** Each count sentence, as the app writes it (views::asks_need_you): "1 ask needs you", "3 asks need you". */
export const countsIn = (text: string): number[] => [...text.matchAll(/\b(\d+) asks? needs? you\b/g)].map((m) => Number(m[1]));
/** A reader's count sentences against the app's one count. */
export function countFailures(text: string, appCounts: readonly number[], who: string): string[] {
  const app = [...new Set(appCounts)];
  if (app.length !== 1) return [`the app's window holds ${app.length ? `counts ${app.join(' and ')}` : 'no count sentence'}, not one count`];
  const counts = countsIn(text);
  if (!counts.length) return [`${who} prints no count sentence; the app's says ${app[0]}`];
  return counts.filter((n) => n !== app[0]).map((n) => `${who} prints the count "${n} ask${n === 1 ? ' needs' : 's need'} you", a second count: the app's is ${app[0]}`);
}
/** Text after a reader's list: help, plumbing, anything below the last row line and the count. */
export function afterListFailures(text: string, rows: readonly Row[], who: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  if (/^\s*Usage:/m.test(text) || /^\s*deep [a-z]/m.test(text)) out.push(`${who} prints help text: ${said(text.slice(0, 200))}`);
  if (/Reading the hub at/.test(text)) out.push(`${who} prints the plumbing line "Reading the hub at …", which is deep doctor's now`);
  const listed = [...rows.map((r) => lines.findIndex((l) => l.includes(r.title) && l.includes(r.word))), ...lines.map((l, i) => (countsIn(l).length ? i : -1))];
  const end = Math.max(...listed, -1);
  const extra = lines.slice(end + 1).filter((l) => l.trim());
  if (extra.length) out.push(`${who} prints more after its list: ${said(extra.slice(0, 3))}`);
  return out;
}
/** Each row's word is a word of states::TABLE, with its entry. */
export function tableFailures(rows: readonly Row[], table: readonly TableRow[], who: string): string[] {
  return rows.flatMap((r) => {
    const t = table.filter((x) => x.word === r.word);
    if (!t.length) return [`${who}'s row ${r.id} names its state "${r.word}", which is no word of states::TABLE (${table.map((x) => x.word).join(', ')})`];
    return t.some((x) => x.entry === r.entry) ? [] : [`${who}'s row ${r.id} reads "${r.word}" with entry ${said(r.entry)}; states::TABLE gives "${r.word}" the entry ${t.map((x) => x.entry).join(' or ')}`];
  });
}
/** The words that go (Scope): `gone quiet`, a count of states read as `2 need you`, and every multi-word "never call it" of states::TABLE. */
export function retiredFailures(text: string, table: readonly TableRow[], who: string): string[] {
  const retired = [/\bgone quiet\b/, /\b\d+ need you\b/, ...table.flatMap((t) => t.never.filter((w) => w.includes(' ')).map((w) => new RegExp(`\\b${w}\\b`, 'i')))];
  return retired.flatMap((re) => { const m = re.exec(text); return m ? [`${who} prints "${m[0]}", a word no state goes by`] : []; });
}
/** `deep inbox`: each open ask's question, then (for `withDefault`) its default as the notification says it, then its handle, last on its line. */
export function inboxFailures(text: string, asks: readonly FixtureAsk[], withDefault: readonly FixtureAsk[] = []): string[] {
  const out: string[] = [];
  for (const a of asks) {
    const q = text.indexOf(a.question);
    const h = text.indexOf(a.handle);
    if (q < 0 || h < 0) { out.push(`deep inbox lacks ${q < 0 ? `the question of ${a.handle} ("${a.question}")` : `the handle ${a.handle}`}`); continue; }
    if (h < q) { out.push(`deep inbox prints ${a.handle} before its question "${a.question}"`); continue; }
    const rest = text.slice(h + a.handle.length).split('\n')[0]!;
    if (rest.trim()) out.push(`deep inbox prints ${said(rest.trim())} after ${a.handle}: the handle isn't last`);
    if (withDefault.includes(a)) {
      const sentence = `If you don't answer: ${a.label}, at ${clockOf(a.deadline)}`;
      if (!text.slice(q, h).includes(sentence)) out.push(`deep inbox's ask ${a.handle} ("${a.question}") lacks "${sentence}" between its question and its handle: ${said(text.slice(q, h + a.handle.length))}`);
    }
  }
  return out;
}
/** An ask's `--json` row: `default` its option's label and `default_at` the number. */
export function defaultFieldFailures(rows: readonly Row[], a: FixtureAsk): string[] {
  const r = rows.find((x) => x.id === a.handle);
  if (!r) return [`deep inbox --json has no row ${a.handle} ("${a.question}")`];
  return [
    ...(r.default === a.label ? [] : [`deep inbox --json's row ${a.handle} holds default ${said(r.default)}, not "${a.label}"`]),
    ...(r.default_at === a.deadline ? [] : [`deep inbox --json's row ${a.handle} holds default_at ${said(r.default_at)}, not the number ${a.deadline}`]),
  ];
}
/** What a printed time says beside `deadline`: a clock time in ZONE, never a UTC timestamp. */
export function clockFailures(text: string, deadline: number, who: string): string[] {
  const out: string[] = [];
  const utc = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?|\bUTC\b|\bGMT\b/.exec(text);
  if (utc) out.push(`${who} prints "${utc[0]}", a UTC timestamp, not a clock time in your time zone: ${said(text.trim())}`);
  if (!text.includes(clockOf(deadline))) out.push(`${who} doesn't say ${clockOf(deadline)}, when the ask now defaults in your time zone (${ZONE}): ${said(text.trim())}`);
  return out;
}
/** Every form a session's ID is written in: whole, its first 8, its letters and digits, their first 8. */
export function idForms(id: string): string[] {
  const letters = id.replace(/[^0-9A-Za-z]/g, '');
  return [...new Set([id, id.slice(0, 8), letters, letters.slice(0, 8)])];
}
/** An agent's deep_status: bound to its own session, and holding nothing of another session's: its ID, its ask, its question. */
export function leakFailures(value: unknown, own: string, other: { session: string; handle: string; question: string }): string[] {
  const text = JSON.stringify(value) ?? '';
  const out: string[] = [];
  const bound = (value as { session?: unknown } | null)?.session;
  if (typeof bound !== 'string' || bound.replace(/[^0-9A-Za-z]/g, '') !== own.replace(/[^0-9A-Za-z]/g, '')) out.push(`deep_status isn't bound to the agent's own session ${own}: it says session ${said(bound)}`);
  const held = [...idForms(other.session), other.handle, other.handle.slice(4), other.question].filter((f) => text.toLowerCase().includes(f.toLowerCase()));
  if (held.length) out.push(`deep_status for session ${own} holds session ${other.session}'s ${held.map((f) => `"${f}"`).join(', ')}: another session's row leaked`);
  return out;
}
/** Each ask's notification: its title (the text's first line) names its project, and no session's ID. */
export function notificationFailures(posted: readonly { ask: string | null; text: string }[], asks: readonly FixtureAsk[], sessions: readonly FixtureSession[]): string[] {
  const out: string[] = [];
  for (const a of asks) {
    const n = posted.find((p) => p.ask === a.handle);
    if (!n) { out.push(`no notification posted for ${a.handle} ("${a.question}")`); continue; }
    const title = n.text.split('\n')[0]!;
    const s = sessions.find((x) => x.id === a.session)!;
    if (!title.includes(s.repo)) out.push(`${a.handle}'s notification title "${title}" doesn't name its project ${s.repo}`);
    for (const x of sessions) for (const form of idForms(x.id)) if (title.toLowerCase().includes(form.toLowerCase())) out.push(`${a.handle}'s notification title "${title}" holds session ${x.id}'s ID as "${form}"`);
  }
  return out;
}
/** `deep status`'s end: its last line the count sentence, its whole output under `most` lines. */
export function endFailures(text: string, count: number, most: number): string[] {
  const lines = text.replace(/\n$/, '').split('\n');
  const last = [...lines].reverse().find((l) => l.trim()) ?? '';
  const out: string[] = [];
  if (!(countsIn(last).length === 1 && countsIn(last)[0] === count && /^\s*\d+ asks? needs? you\b/.test(last))) out.push(`deep status ends on ${said(last.trim())}, not the count sentence "${count} asks need you"`);
  if (lines.length >= most) out.push(`deep status prints ${lines.length} lines, not under ${most}`);
  return out;
}
/** `deep` with the hub stopped: it says the hub isn't answering, with a clock time in `since`, and no count reads 0. */
export function downFailures(text: string, since: readonly string[]): string[] {
  const out: string[] = [];
  const line = text.split('\n').find((l) => /\bhub (?:isn't|isn’t|is not) answering\b/i.test(l));
  if (!line) out.push(`deep doesn't say the hub isn't answering: ${said(text.slice(0, 400))}`);
  else {
    const times = [...line.matchAll(/\b([01]?\d|2[0-3]):[0-5]\d\b/g)].map((m) => m[0].padStart(5, '0'));
    if (!times.some((t) => since.includes(t))) out.push(`deep says ${said(line.trim())}, with no clock time since when (between ${since[0]} and ${since.at(-1)} in ${ZONE})`);
  }
  const zero = /\b0 (?:asks?|sessions?|rows?|tasks?)\b/.exec(text);
  if (zero) out.push(`deep reads "${zero[0]}" with the hub stopped: a count of 0`);
  return out;
}

// ---- Timing: the reference-Mac gate (#1551's, which lists Mac17,10) and the load reading.
export { inconclusive, timingProblem } from '../1551/helpers.ts';
