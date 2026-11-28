// #3544's shared pieces: the issue's numbers, the record every test starts from (47,500 events in a real file, one
// projection's columns planted to differ), a scratch home and a dev hub root in a temp folder, the `deep` CLI of this
// checkout as a child whose lines are kept with the time each came, the hub's socket read as the CLI reads it, hooks
// sent as deep-hook sends them and through deep-hook itself, and the stop of every hub a test started. Nothing here
// waits for time to pass: each wait is for a line a process prints, its exit, or an answer on the socket, and every
// timer is only the bound that turns a hang into a failure.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Connection } from '../../../packages/record/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = { [key: string]: any };

/** The criteria's IDs: `#3544.` and the first eight hex digits of the SHA-256 of each one's text (scripts/proof-change.mjs). */
export const AC = {
  start: '#3544.93bc058e',
  stall: '#3544.efcb2f1f',
  readers: '#3544.916857a5',
  hooks: '#3544.7b62fddb',
  reading: '#3544.99834caf',
  budget: '#3544.37bd1895',
} as const;

// ---- The issue's numbers, and the surfaces README's Defined here names.

/** Events a replay reads at a time: `REPLAY_PAGE` of packages/record/src/index.ts at the base. */
export const PAGE = 5000;
/** The record's events, at log positions 1 to 47,500: nine whole pages and a tenth of 2,500, so its replay is ten pages. */
export const EVENTS = 47_500;
export const PAGES = 10;
/** The projection whose columns the record's file has planted to differ, and the column an older build is planted to have named otherwise. */
export const TABLE = 'commits';
export const PLANTED = 'made';
/** The start's wait the criteria set for the test, and how long the planted fold holds a page. */
export const WAIT_MS = 2000;
export const HOLD_MS = 1000;
/** Where the fold that never returns from its third page leaves the count: two pages' events. */
export const STALL = 2 * PAGE;
/** `deep hub start`'s wait, in ms; only tests set it (README, Defined here). */
export const WAIT = 'DEEP_HUB_TEST_START_WAIT_MS';
/** The planted fold the hub's record replays with; only tests set it (README, Defined here). */
export const FOLD = 'DEEP_HUB_TEST_FOLD';
export const SLOW = 'page-1s';
export const STUCK = 'page-3-never';

/** Every count the replay of this record can read: a whole number of pages, or all of it. */
const COUNTS = new Set([...Array.from({ length: PAGES }, (_, page) => page * PAGE), EVENTS]);
const TIMES = /\b\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\b|\b\d{4}-\d{2}-\d{2}\b/g;
const NUMBER = /(?<![\w.,-])(?:\d{1,3}(?:,\d{3})+|\d+)(?![\w-]|[.,]\d)/g;
/** The numbers that stand alone in a line, in order: digits, plain or with commas between thousands; none from a clock time, a date, a version or a name. */
export const numbersIn = (line: string): number[] => [...line.replace(TIMES, ' ').matchAll(NUMBER)].map((m) => Number(m[0].replaceAll(',', '')));
/**
 * What a line says of the replay, read loosely (README, Defined here): it holds `rebuild` in any letter case, the
 * events replayed so far, the first of its numbers that the replay of this record can read, and after it the events in
 * the log, 47,500. Undefined for a line that doesn't hold all three.
 */
export function countsOf(line: string): { replayed: number; events: number } | undefined {
  if (!/rebuild/i.test(line)) return undefined;
  const numbers = numbersIn(line);
  const at = numbers.findIndex((n) => COUNTS.has(n));
  return at >= 0 && numbers.slice(at + 1).includes(EVENTS) ? { replayed: numbers[at]!, events: EVENTS } : undefined;
}
/** `rebuilding` of a hub.health result, when it holds the two fields as whole numbers. */
export function rebuildingOf(health: unknown): { replayed: number; events: number } | undefined {
  const r = (health as Obj | null | undefined)?.rebuilding as Obj | null | undefined;
  return r && typeof r === 'object' && Number.isInteger(r.replayed) && Number.isInteger(r.events) ? { replayed: r.replayed as number, events: r.events as number } : undefined;
}
/** A count of asks in a command's output (README, Defined here): `0 asks need you`, `3 open asks`, `Nothing needs you`, or a JSON key of asks holding a number. */
const ASKS = [/(?<![\w.,-])\d[\d,]*\s+(?:open\s+)?asks?\b/i, /\bnothing needs you\b/i, /"(?:[a-z]+_)*asks?(?:_[a-z]+)*"\s*:\s*-?\d/i];
export function asksCounted(text: string): string | undefined {
  for (const pattern of ASKS) {
    const found = pattern.exec(text);
    if (found) return found[0];
  }
  return undefined;
}

// ---- What must be built before any test runs: BLOCKED, never a pass, without it.

/** deep-hook as this run has it: the proof run's own (DEEP_BIN_DIR), else this checkout's newer build. */
export function deepHook(): string | undefined {
  const supplied = process.env.DEEP_BIN_DIR;
  const target = process.env.CARGO_TARGET_DIR ?? join(REPO, 'target');
  const found = [...(supplied ? [join(supplied, 'deep-hook')] : []), ...['release', 'debug'].map((profile) => join(target, profile, 'deep-hook'))].filter((file) => existsSync(file));
  return supplied && found[0]?.startsWith(supplied) ? found[0] : found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
/** The hub's core stops at its start without a built deep-hook, and every test runs this checkout's built CLI. */
export function requireBuilt(): void {
  if (!existsSync(CLI)) throw Error('BLOCKED: no built CLI at packages/cli/dist/main.js; run npm run build --workspaces first');
  if (!deepHook()) throw Error('BLOCKED: no deep-hook is built under target/; run cargo build --locked -p deep-hook first');
}

// ---- IDs and stamps.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
/** A fresh ULID at `ms`, its random part from the OS. */
export const ulid = (ms = Date.now()): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
let stamped = 0n;
/** A hook's seq: nanoseconds since the epoch as a decimal string, never the same twice in this process. */
export const nextSeq = (ms = Date.now()): string => (BigInt(ms) * 1_000_000n + (stamped = (stamped + 1n) % 1_000_000n)).toString();
const letters = (count: number): string => [...randomBytes(count)].map((byte) => String.fromCharCode(97 + (byte % 26))).join('');

// ---- Temp folders: short paths under /tmp, since a socket's path must fit in 104 bytes, named in letters only, so
// no path a command prints holds a number.

function tempDir(): string {
  for (;;) {
    const dir = join(realpathSync('/tmp'), `dhr-${letters(8)}`);
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    return dir;
  }
}

// ---- The record: 47,500 events appended through the record's own `openRecord`, in one run, so their log positions
// are 1 to 47,500 and a count of events replayed is also the position the replay has reached; then, in the closed
// file, one projection's columns made to differ, as a table an older build made would.

let fixture: Promise<string> | undefined;
let fixtureDir: string | undefined;
/** The planted record's file, built once for the test file that asks; every test copies it. */
export function plantedRecord(): Promise<string> {
  return (fixture ??= (async () => {
    requireBuilt();
    // Loaded only now: the record's source reads its package's build, which an unbuilt checkout doesn't have.
    const { openRecord } = await import('../../../packages/record/src/index.ts');
    const path = join((fixtureDir = tempDir()), 'ledger.db');
    const t0 = Date.UTC(2026, 10, 20, 9, 0, 0);
    let at = t0;
    const record = await openRecord({ path, now: () => at });
    // A commit recorded for a session, as the core appends one: no session's turn is walked and one row is written, so
    // a page of the replay folds in a small part of the second the planted fold holds it.
    const core: Connection = { writer: 'core', actor: 'you', scope: 'you' };
    const session = `session:${ulid(t0)}`;
    for (let from = 0; from < EVENTS; from += 500) {
      await Promise.all(Array.from({ length: Math.min(500, EVENTS - from) }, (_, i) => {
        at = t0 + from + i + 1;
        return record.append(core, { v: 1, id: ulid(at), kind: 'commit.made', ts: at, subject: session, data: { sha: (from + i + 1).toString(16).padStart(40, '0'), worktree: '/work/app', branch: 'main' } });
      }));
    }
    await record.close();
    const db = new Database(path);
    try {
      const log = db.prepare('SELECT count(*) AS n, min(log_pos) AS first, max(log_pos) AS last FROM events').get() as { n: number; first: number; last: number };
      if (log.n !== EVENTS || log.first !== 1 || log.last !== EVENTS) throw Error(`BLOCKED: the record holds ${log.n} events at log positions ${log.first} to ${log.last}, not ${EVENTS} at 1 to ${EVENTS}, so a count of events and a log position would differ`);
      const rows = (db.prepare(`SELECT count(*) AS n FROM ${TABLE}`).get() as { n: number }).n;
      if (rows !== EVENTS) throw Error(`BLOCKED: the record's ${TABLE} projection holds ${rows} rows for ${EVENTS} commits`);
      // The planted difference: the table as a build that named this column otherwise would have left it.
      db.exec(`ALTER TABLE ${TABLE} RENAME COLUMN created TO ${PLANTED}`);
      db.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
    return path;
  })());
}
/** The names of a table's columns as the record's file holds them now, read beside the hub: only what is committed. */
export function columnsOf(ledger: string, table: string): string[] {
  const db = new Database(ledger, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[]).map((column) => column.name);
  } finally {
    db.close();
  }
}
export interface Logged { id: string; log_pos: number; kind: string; command: string | null }
/** Every event after a log position in a record's file, in log order, read beside the hub. */
export function eventsAfter(ledger: string, after: number): Logged[] {
  const db = new Database(ledger, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT id, log_pos, kind, json_extract(data, '$.command') AS command FROM events WHERE log_pos > ? ORDER BY log_pos").all(after) as Logged[];
  } finally {
    db.close();
  }
}

// ---- A world: a scratch home, a dev hub's root holding a copy of the planted record, and a working folder outside
// any repo, all in one temp folder. `deep doctor`, `deep` and deep-hook find the hub through the home's one address
// setting, ~/.deepbuild/config.json, as they would a hub behind a forwarded socket.

export interface World { dir: string; home: string; root: string; work: string; ledger: string }
const worlds: World[] = [];
/** The guard entry the fourth criterion's one call matches: fail-closed, in block mode, with words of its own. */
export const GUARD = {
  name: 'no-fixture-apply',
  command: 'dhrfixture apply now',
  entry: { match: 'run:dhrfixture apply', scope: 'all_repos', mode: 'block', reason: 'This call stands in for one only a person may run, in a test of the hub while it rebuilds.', next_step: 'Ask the person to run it.', fail_closed: true },
} as const;
export async function world(o: { guard?: boolean } = {}): Promise<World> {
  requireBuilt();
  const record = await plantedRecord();
  const dir = tempDir();
  const w: World = { dir, home: join(dir, 'h'), root: join(dir, 'r'), work: join(dir, 'w'), ledger: join(dir, 'r', 'ledger.db') };
  for (const folder of [w.home, w.root, w.work, join(w.home, '.deepbuild')]) mkdirSync(folder, { mode: 0o700 });
  copyFileSync(record, w.ledger);
  writeFileSync(join(w.home, '.deepbuild', 'config.json'), `${JSON.stringify({ hub: { address: `unix:${join(w.root, 'hub.sock')}` } })}\n`);
  if (o.guard) {
    // deep-hook reads the home's rules.json and the hub its root's: the same entries in both.
    const rules = `${JSON.stringify({ v: 1, entries: { [GUARD.name]: GUARD.entry } }, null, 2)}\n`;
    for (const folder of [join(w.home, '.deepbuild'), w.root]) writeFileSync(join(folder, 'rules.json'), rules);
  }
  worlds.push(w);
  return w;
}
/** A text with this checkout's and a world's folders written as placeholders: a failure's message names no path of this machine. */
export function tidy(text: string, w?: World): string {
  let out = text.split(REPO.replace(/\/$/, '')).join('<checkout>');
  for (const [folder, name] of w ? [[w.home, '~'], [w.root, '<root>'], [w.work, '<work>'], [w.dir, '<tmp>']] as const : []) {
    out = out.split(folder).join(name).split(folder.replace(/^\/private/, '')).join(name);
  }
  return out;
}

/** The environment a child gets: this machine's, with HOME the world's, no DEEP_ or XDG_ setting but those given, and no agent on PATH. */
export function childEnv(w: World, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|VITEST)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: w.home, XDG_CONFIG_HOME: join(w.home, '.config'), XDG_CACHE_HOME: join(w.home, '.cache'), PATH: `${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, LC_ALL: 'C', ...extra };
}

// ---- A child process whose lines are kept with the time each came.

export interface Said { at: number; text: string; err: boolean }
export interface Ended { code: number | null; signal: NodeJS.Signals | null; at: number }
const running = new Set<Running>();
export class Running {
  readonly began = Date.now();
  readonly lines: Said[] = [];
  /** Set once the process has ended and its output is read to the end. */
  done: Ended | undefined;
  private readonly child: ChildProcess;
  private readonly watchers = new Set<() => void>();
  constructor(command: string, args: readonly string[], o: { cwd: string; env: NodeJS.ProcessEnv; input?: string }) {
    this.child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    running.add(this);
    let exited: number | undefined;
    const take = (stream: NodeJS.ReadableStream, err: boolean): void => {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        const at = Date.now();
        rest += chunk;
        for (let i = rest.indexOf('\n'); i >= 0; i = rest.indexOf('\n')) {
          this.lines.push({ at, text: rest.slice(0, i), err });
          rest = rest.slice(i + 1);
        }
        this.wake();
      });
      stream.on('end', () => {
        if (rest) this.lines.push({ at: Date.now(), text: rest, err });
        rest = '';
      });
    };
    take(this.child.stdout!, false);
    take(this.child.stderr!, true);
    this.child.on('exit', () => { exited = Date.now(); });
    this.child.on('error', (error) => {
      this.lines.push({ at: Date.now(), text: `(the command couldn't run: ${error.message})`, err: true });
      this.done ??= { code: null, signal: null, at: Date.now() };
      this.wake();
    });
    this.child.on('close', (code, signal) => {
      this.done ??= { code, signal, at: exited ?? Date.now() };
      running.delete(this);
      this.wake();
    });
    this.child.stdin!.on('error', () => undefined);
    this.child.stdin!.end(o.input ?? '');
  }
  private wake(): void { for (const watcher of [...this.watchers]) watcher(); }
  private wait<T>(ready: () => T | undefined, ms: number): Promise<T | undefined> {
    return new Promise((resolve) => {
      const finish = (value: T | undefined): void => {
        clearTimeout(timer);
        this.watchers.delete(check);
        resolve(value);
      };
      const check = (): void => {
        const value = ready();
        if (value !== undefined) finish(value);
        else if (this.done) finish(undefined);
      };
      // deadline: a command that never prints what is waited for, and never ends, ends the wait as the caller's failure
      const timer = setTimeout(() => finish(undefined), ms);
      this.watchers.add(check);
      check();
    });
  }
  /** The first line that matches, as soon as it is printed; undefined once the process ended without one, or at the bound. */
  until(match: (line: Said) => boolean, ms: number): Promise<Said | undefined> {
    let seen = 0;
    return this.wait(() => {
      for (; seen < this.lines.length; seen++) if (match(this.lines[seen]!)) return this.lines[seen++];
      return undefined;
    }, ms);
  }
  /** The process's end, or undefined while it still runs at the bound. */
  ended(ms: number): Promise<Ended | undefined> {
    return this.wait(() => this.done, ms);
  }
  /** Ends the process, one this suite started, through its own handle. */
  end(): void {
    if (!this.done && this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
  }
  /** Everything it printed, in the order it came, its last lines when `last` is given. */
  text(last?: number): string {
    const lines = this.lines.map((line) => line.text);
    return (last === undefined ? lines : lines.slice(-last)).join('\n');
  }
}
/** `deep <args>` from this checkout's built CLI, in the world's home and working folder. */
export const deep = (w: World, args: readonly string[], extra: Record<string, string> = {}): Running => new Running(NODE, [CLI, ...args], { cwd: w.work, env: childEnv(w, extra) });
/** `deep hub start --root <the world's root>`, the hub it starts inheriting `extra`. */
export const startHub = (w: World, extra: Record<string, string> = {}): Running => deep(w, ['hub', 'start', '--root', w.root], extra);
export interface Sentence { at: number; replayed: number; text: string }
/** Each rebuild sentence a command printed, in the order they came, with the count of events replayed each names. */
export const sentences = (ran: Running): Sentence[] => ran.lines.flatMap((line) => {
  const counts = countsOf(line.text);
  return counts ? [{ at: line.at, replayed: counts.replayed, text: line.text }] : [];
});
/** How a command ended, or that it hadn't, for a failure's message. */
export const exitOf = (ran: Running, ended: Ended | undefined): string =>
  (ended ? `exited ${ended.code ?? ended.signal} ${ended.at - ran.began} ms after it started` : `was still running ${Date.now() - ran.began} ms after it started`);

// ---- The hub's socket, read as the CLI reads it: its hello, the CLI's hello with the control token, then calls.

class Wire {
  readonly lines: Obj[] = [];
  ended = false;
  why = '';
  private rest = '';
  private taken = 0;
  private readonly watchers = new Set<() => void>();
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.rest += chunk;
      for (let i = this.rest.indexOf('\n'); i >= 0; i = this.rest.indexOf('\n')) {
        try { this.lines.push(JSON.parse(this.rest.slice(0, i)) as Obj); } catch { this.lines.push({ unparsed: this.rest.slice(0, i).slice(0, 300) }); }
        this.rest = this.rest.slice(i + 1);
      }
      this.wake();
    });
    sock.on('error', (error: NodeJS.ErrnoException) => { this.why ||= error.code ?? error.message; });
    sock.on('close', () => { this.ended = true; this.why ||= 'the hub closed the connection'; this.wake(); });
  }
  private wake(): void { for (const watcher of [...this.watchers]) watcher(); }
  private wait<T>(ready: () => T | undefined, ms: number, atEnd: () => T | undefined = () => undefined): Promise<T | undefined> {
    return new Promise((resolve) => {
      const finish = (value: T | undefined): void => {
        clearTimeout(timer);
        this.watchers.delete(check);
        resolve(value);
      };
      const check = (): void => {
        const value = ready();
        if (value !== undefined) finish(value);
        else if (this.ended) finish(atEnd());
      };
      // deadline: a hub that never answers ends the wait as the caller's failure
      const timer = setTimeout(() => { this.why ||= `no answer within ${ms} ms`; finish(undefined); }, ms);
      this.watchers.add(check);
      check();
    });
  }
  /** A connection that has the hub's hello; else why there is none. */
  static async open(path: string, ms: number): Promise<Wire | string> {
    const wire = new Wire(net.connect(path));
    const hello = await wire.next(() => true, ms);
    if (hello) return wire;
    wire.end();
    return wire.why || 'no hello from the hub';
  }
  send(line: object): void { this.sock.write(`${JSON.stringify(line)}\n`); }
  /** The next line not yet taken that matches; undefined once the connection closed without one, or at the bound. */
  next(match: (line: Obj) => boolean, ms: number): Promise<Obj | undefined> {
    return this.wait(() => {
      while (this.taken < this.lines.length) {
        const line = this.lines[this.taken++]!;
        if (match(line)) return line;
      }
      return undefined;
    }, ms);
  }
  /** Whether the hub closed the connection within the bound. */
  async closes(ms: number): Promise<boolean> {
    return (await this.wait(() => (this.ended ? true : undefined), ms, () => true)) === true;
  }
  end(): void { this.sock.destroy(); }
}
const tokenOf = (root: string): string | undefined => { try { return readFileSync(join(root, 'control.token'), 'utf8').trim(); } catch { return undefined; } };
/** A connection that said hello as the CLI; else why not. */
async function asCli(root: string, ms: number): Promise<Wire | string> {
  const token = tokenOf(root);
  if (token === undefined) return 'the hub wrote no control token';
  const wire = await Wire.open(join(root, 'hub.sock'), ms);
  if (typeof wire === 'string') return wire;
  wire.send({ v: 1, hello: 'cli', token });
  const hello = await wire.next(() => true, ms);
  if (hello && !hello.error) return wire;
  wire.end();
  return hello ? `the hub refused the CLI's hello: ${JSON.stringify(hello.error)}` : wire.why;
}

export type Answer = { kind: 'answer'; result: Obj } | { kind: 'refusal'; error: Obj } | { kind: 'none'; why: string };
/** One control call on the root's socket as the cli role: its answer, its refusal, or why there was neither within the bound. */
export async function call(root: string, method: string, params: Obj = {}, ms = 10_000): Promise<Answer> {
  const wire = await asCli(root, ms);
  if (typeof wire === 'string') return { kind: 'none', why: wire };
  try {
    wire.send({ v: 1, id: 'call', method, params });
    const reply = await wire.next((line) => line.id === 'call', ms);
    if (!reply) return { kind: 'none', why: wire.why };
    return reply.error ? { kind: 'refusal', error: reply.error as Obj } : { kind: 'answer', result: (reply.result ?? {}) as Obj };
  } finally {
    wire.end();
  }
}
/** The hub's health as one read of the socket gives it, or undefined with why in `said`. */
export async function healthOf(root: string, ms = 10_000): Promise<{ health: Obj | undefined; said: string }> {
  const answer = await call(root, 'hub.health', {}, ms);
  return answer.kind === 'answer' ? { health: answer.result, said: JSON.stringify(answer.result).slice(0, 600) } : { health: undefined, said: answer.kind === 'refusal' ? `refused: ${JSON.stringify(answer.error)}` : `no answer: ${answer.why}` };
}
/**
 * Waits until the hub's stream carries the event with this ID: every event after `after`, in log order, then each one
 * as it is appended (stream.subscribe, as the app follows the log). Undefined once it came, else why it didn't.
 */
export async function recorded(root: string, after: number, id: string, ms: number): Promise<string | undefined> {
  const wire = await asCli(root, ms);
  if (typeof wire === 'string') return wire;
  try {
    wire.send({ v: 1, id: 'stream', method: 'stream.subscribe', params: { after } });
    const frame = await wire.next((line) => line.id === 'stream' && (line.error !== undefined || (line.event as Obj | undefined)?.id === id), ms);
    if (!frame) return wire.why;
    return frame.error ? `stream.subscribe was refused: ${JSON.stringify(frame.error)}` : undefined;
  } finally {
    wire.end();
  }
}

// ---- Hooks: a Claude Code session's calls, sent as deep-hook sends them (the hook protocol's request line on the
// socket, its ID minted here, the hub's acknowledgement read), or through deep-hook itself.

export interface Session { id: string; cwd: string; transcript: string }
export function newSession(w: World): Session {
  const id = randomUUID();
  const transcript = join(w.home, '.claude', 'projects', w.work.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, `${JSON.stringify({ type: 'user', sessionId: id, cwd: w.work, message: { role: 'user', content: 'start' } })}\n`);
  return { id, cwd: w.work, transcript };
}
/** Claude Code's own JSON for a Bash call about to run. */
export const bash = (s: Session, command: string): Obj => ({
  session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: 'PreToolUse', permission_mode: 'default',
  tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_${randomBytes(12).toString('hex')}`,
});
export interface HookRequest { v: 1; agent: string; event: string; seq: string; id: string; pid: number; ppid: number; matched: string[]; payload: Obj }
export const hookRequest = (payload: Obj): HookRequest => ({ v: 1, agent: 'claude-code', event: 'PreToolUse', seq: nextSeq(), id: ulid(), pid: process.pid, ppid: process.ppid, matched: [], payload });
export interface Sent { request: HookRequest; ack: Obj | undefined; reply: Obj | undefined; why: string }
/** One hook exchange on a connection of its own: the hub's hello, the request, its acknowledgement and its reply. */
export async function sendHook(root: string, request: HookRequest, ms = 15_000): Promise<Sent> {
  const wire = await Wire.open(join(root, 'hub.sock'), ms);
  if (typeof wire === 'string') return { request, ack: undefined, reply: undefined, why: wire };
  try {
    wire.send(request);
    const first = await wire.next(() => true, ms);
    if (!first || first.ack !== request.id) return { request, ack: undefined, reply: undefined, why: first ? `the hub's first line back was ${JSON.stringify(first).slice(0, 300)}` : wire.why };
    const reply = await wire.next((line) => 'exit' in line, ms);
    return { request, ack: first, reply, why: reply ? '' : wire.why };
  } finally {
    wire.end();
  }
}
/** `deep-hook claude-code PreToolUse` with the call's JSON on stdin, as a session's hook entry runs it. */
export async function throughDeepHook(w: World, payload: Obj): Promise<{ code: number | null; said: string }> {
  const ran = new Running(deepHook()!, ['claude-code', 'PreToolUse'], { cwd: w.work, env: childEnv(w), input: JSON.stringify(payload) });
  const ended = await ran.ended(30_000);
  ran.end();
  return { code: ended?.code ?? null, said: ran.text() };
}
/** Whether what deep-hook printed and exited with denies the call in the guard entry's own words. */
export const deniedInItsWords = (ran: { code: number | null; said: string }): boolean => ran.code === 2 && ran.said.includes(GUARD.entry.reason) && ran.said.includes(GUARD.entry.next_step);

// ---- Stopping: each hub a test started is stopped as `deep hub stop --root` stops one, on its token, when its core
// answers; one whose core doesn't (it still replays, or never will end) by the PID its own health names. Then every
// folder is removed. Nothing is stopped by name or port.

/** The hub's log, for a failure's message. */
export const hubLog = (w: World): string => { try { return tidy(readFileSync(join(w.root, 'logs', 'hub.log'), 'utf8').slice(-1500), w); } catch { return '(no hub.log)'; } };
function readyPid(root: string): number | undefined {
  try {
    for (const raw of readFileSync(join(root, 'logs', 'hub.log'), 'utf8').split('\n')) {
      try {
        const line = JSON.parse(raw) as Obj;
        if (line.ready === true && Number.isInteger(line.pid)) return line.pid as number;
      } catch { /* a line of text */ }
    }
  } catch { /* no log */ }
  return undefined;
}
/** Stops the hub on the world's root and resolves once its process has closed its socket. */
export async function stopHub(w: World): Promise<void> {
  if (!existsSync(join(w.root, 'hub.sock'))) return;
  const { health } = await healthOf(w.root, 5000);
  const pid = Number.isInteger(health?.pid) ? (health!.pid as number) : readyPid(w.root);
  const up = health !== undefined && !('rebuilding' in health);
  const wire = await asCli(w.root, 5000);
  // Nothing says hello there: the hub is gone already.
  if (typeof wire === 'string') return;
  try {
    if (up || pid === undefined) {
      // The hub keeps the connection that asked it to stop until its process ends.
      wire.send({ v: 1, id: 'stop', method: 'hub.stop', params: {} });
      if (await wire.closes(30_000)) return;
    }
    if (pid !== undefined) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      await wire.closes(10_000);
    }
  } finally {
    wire.end();
  }
}
/** Ends what a test left: its commands, by their handles; its hub; its folder. */
export async function cleanup(): Promise<void> {
  for (const ran of [...running]) ran.end();
  for (const w of worlds.splice(0)) {
    await stopHub(w);
    rmSync(w.dir, { recursive: true, force: true });
  }
}
/** Removes the planted record too, once the file's tests are done. */
export async function cleanupAll(): Promise<void> {
  await cleanup();
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  fixture = fixtureDir = undefined;
}
