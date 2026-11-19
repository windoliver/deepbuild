// Test-side tools for #2403 (README). The app's own words are read through the surfaces the README names: the replica
// (`deep-drive`, #124) launched with `locale`, from a fixture file that is the record a real hub made, so a launch is the
// same in every build; `ui_check` in that replica; the real `deep-app` read from outside its process through the
// accessibility tree; and the table (crates/deep-app/copy/) and the lint (scripts/app-copy-lint.mjs) as files and a
// script. Everything new is loaded lazily, by running a binary or a script or reading a file, so the base fails at
// assertions, never at imports.
//
// Reused by import, unchanged: #16's homes, hub, connections, events and PID cleanup; #26's seeding; #1463's `quiet`;
// #1461's `needBuilds`; #1458's source copy, plant and runner; #1808's real-app driver; #1462's probe.swift (the status
// item, compiled here because #1462's own helper also asks for Screen Recording, which reading the tree doesn't need).
//
// Safety: HOME is a temp folder for every process started; a process is stopped only by the PID it was started with;
// nothing touches the real ~/.deepbuild, ~/.claude, ~/Library, or the system's languages (the real app's languages are
// set for its one process, by the arguments it starts with); no network, no model.
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { askSources } from '../../../packages/asks/src/index.ts';
import { allEvents, childEnv, cleanup as cleanup16, control, DAY, makeHome, newSession, own, REPO, sha256, sleep, startHub, tempDir, type Hub } from '../16/helpers.ts';
import { askData, cleanup as cleanup26, seed, ulid } from '../26/helpers.ts';
import { quiet } from '../1463/helpers.ts';
import { needBuilds } from '../1461/helpers.ts';
import { cleanup as cleanup1458, plant, run, sourceCopy, type Ran } from '../1458/helpers.ts';

export { plant, REPO, sha256, sleep, sourceCopy, tempDir, type Ran };
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const MIN = 60_000;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export async function cleanup(): Promise<void> {
  for (const d of drives.splice(0)) await d.stop();
  await cleanup16();
  await cleanup26();
  await cleanup1458();
}
const said = (v: unknown, n = 300): string => (JSON.stringify(v) ?? String(v)).slice(0, n);
type Line = Record<string, any>;

/** The criteria, by `#2403.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  words: '#2403.f805f24b',
  lint: '#2403.940d60a6',
  layout: '#2403.5f7fc02a',
  counts: '#2403.d67d213a',
  asks: '#2403.83c0c375',
  stale: '#2403.7d32942a',
  shown: '#2403.a13ac61c',
} as const;

/** AC3's planted wrong program (README, Surface 9), read through `plain::planted` in an env-plants build only. */
export const PLANT = { twiceAsLong: 'zh-twice-as-long' } as const;

/** The replica's reference window, in points (crates/deep-replica/src/lib.rs, WINDOW), and AC3's narrow width. */
export const REFERENCE = { width: 1512, height: 982 } as const;
export const NARROW = 360;
/** The clock a fixture launch reads (crates/deep-replica/src/lib.rs, NOW): 2027-01-15 08:00 UTC. */
export const NOW = 1_800_000_000_000;
/** The replica's clock in flicks a second (crates/deep-replica/src/drive/mod.rs). */
const FLICKS = 705_600_000;

/** The shipped views as `see.snapshot.views` names them, and the ones the replica's main window can draw (README, Readings 2). */
export const SHIPPED = ['deepbuild/sidebar', 'deepbuild/home', 'deepbuild/needs-you', 'deepbuild/session', 'deepbuild/line', 'deepbuild/welcome', 'deepbuild/agents', 'deepbuild/rules'] as const;
export const IN_WINDOW = ['deepbuild/sidebar', 'deepbuild/home', 'deepbuild/session', 'deepbuild/welcome', 'deepbuild/agents', 'deepbuild/rules'] as const;
/** Words that stay as written in every language (Scope): the five verdict words, and the product's and the agents' names. */
export const AS_WRITTEN = ['PASS', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'FAIL', 'DeepBuild', 'Claude Code', 'Codex', 'pi'];
/** The literals the issue names in the app's source, each of which the table must hold. */
export const NAMED = ['Needs you', 'Nothing needs you', 'Set up'] as const;
/** The count's sentence at the merge base (crates/deep-app/src/views.rs, asks_need_you), which en-US keeps byte for byte. */
export const BASE_COUNT = (n: number): string => (n === 0 ? 'Nothing needs you' : n === 1 ? '1 ask needs you' : `${n} asks need you`);

// ---- Builds (README, How to run): each binary copied out of the target folder into a folder named for the checkout,
// one build at a time, so a plant's build never stands in for the plain one and another worktree's never for this one.

const uid = userInfo().uid;
const BIN = join(tmpdir(), `dd2403-bin-${uid}-${sha256(REPO).slice(0, 8)}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
function cargo(args: string[], cwd = REPO, target?: string): Promise<void> {
  const env = target ? { ...CARGO_ENV, CARGO_TARGET_DIR: target } : CARGO_ENV;
  return new Promise((resolve, reject) => {
    execFile('cargo', ['build', '--locked', '-q', ...args], { cwd, env, maxBuffer: 64 * 1024 * 1024 }, (error, _out, stderr) => {
      if (!error) return resolve();
      reject(Error(`BLOCKED: cargo build ${args.join(' ')} in ${cwd} failed: ${String(stderr).split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n') || String(stderr).slice(-600)}`));
    });
  });
}
/** Copied beside and renamed into place: a binary rewritten where it lies can be killed at its next start on macOS. */
function keep(from: string, to: string): string {
  mkdirSync(join(to, '..'), { recursive: true });
  const next = `${to}.${process.pid}.new`;
  copyFileSync(from, next);
  renameSync(next, to);
  return to;
}
let queue: Promise<unknown> = Promise.resolve();
const built = new Map<string, Promise<string>>();
function build(pkg: string, bin: string, features: string[], as: string): Promise<string> {
  let made = built.get(as);
  if (!made) {
    const step = queue.then(async () => {
      if (process.platform !== 'darwin') blocked(`the app and the replica draw on macOS only; this is ${process.platform}`);
      await cargo(['-p', pkg, '--bin', bin, ...(features.length ? ['--features', features.join(',')] : [])]);
      return keep(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', bin), join(BIN, as));
    });
    queue = step.catch(() => undefined);
    made = step;
    built.set(as, made);
  }
  return made;
}
/** `deep-drive` with deep-app's `test-confirm`, as #1461's and #1808's suites build it; and with `env-plants` too. */
export const drivePlain = (): Promise<string> => build('deep-replica', 'deep-drive', ['deep-app/test-confirm'], 'deep-drive');
export const drivePlants = (): Promise<string> => build('deep-replica', 'deep-drive', ['env-plants', 'deep-app/test-confirm'], 'deep-drive-plants');
/** The real app as shipped. */
export const appPlain = (): Promise<string> => build('deep-app', 'deep-app', [], 'deep-app');

/** The merge base with origin/main (else main), as #1458's suite finds it. */
export function mergeBase(): string {
  for (const ref of ['origin/main', 'main']) {
    try { return execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: REPO, encoding: 'utf8' }).trim(); } catch { /* the next */ }
  }
  return blocked('no merge base with origin/main or main');
}
let based: Promise<string> | undefined;
/**
 * The merge base's own `deep-drive` (README, AC1): a clean copy of that commit from `git archive`, extracted into a
 * folder named for the commit and built there with its own CARGO_TARGET_DIR and the plain build's features, so it never
 * stands in for the checkout's build. Kept between runs in that folder.
 */
export function baseDrive(): Promise<string> {
  based ??= (async () => {
    if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
    const sha = mergeBase();
    const dir = join(tmpdir(), `dd2403-base-${uid}-${sha.slice(0, 12)}`);
    const out = join(dir, 'deep-drive');
    if (existsSync(out)) return out;
    const src = join(dir, 'src');
    if (!existsSync(join(src, 'Cargo.toml'))) {
      mkdirSync(src, { recursive: true });
      const tar = join(dir, 'base.tar');
      execFileSync('git', ['archive', '-o', tar, sha], { cwd: REPO });
      execFileSync('tar', ['-x', '-f', tar, '-C', src]);
    }
    const target = join(dir, 'target');
    await cargo(['-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'deep-app/test-confirm'], src, target);
    return keep(join(target, 'debug', 'deep-drive'), out);
  })();
  return based;
}

// ---- The replica, driven: one `deep-drive --out <dir>` of a given build, JSON lines in and out (#124's protocol), in
// a temp HOME of its own, in UTC, so the same calls on the same fixture draw the same in every build.

const drives: Drive[] = [];
export interface Seen { snapshot: Snapshot; sha256: string; address: string | null }
export interface SNode { role: string; name: string | null; value: unknown; id?: string | null; bounds: number[]; children: SNode[] }
export interface Run { text: string; bounds: number[]; cut?: boolean }
export interface Snapshot { tree: SNode; runs?: Run[]; views?: { name: string; bounds: number[] }[]; menu_bar?: { title?: string; items?: string[] } }
export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private err = '';
  /** The replica's clock at its last reply, in flicks since launch. */
  t = 0;
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let parsed: Line;
        try { parsed = JSON.parse(line) as Line; } catch { parsed = { unparsed: line }; }
        this.waiting.shift()?.(parsed);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); });
  }
  /** `bin` started in a temp HOME; `plant` its DEEP_HUB_PLANT. */
  static async start(bin: string, plant?: string): Promise<Drive> {
    const dir = tempDir();
    const home = join(dir, 'h');
    const out = join(dir, 'out');
    mkdirSync(home, { recursive: true });
    mkdirSync(out, { recursive: true });
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(home, { TZ: 'UTC', DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const d = new Drive(child);
    drives.push(d);
    const ready = await d.next(300_000);
    if (ready.ready !== true) blocked(`deep-drive (${bin}) didn't say {"ready": true}: ${said(ready)} ${d.err.slice(-600)}`);
    return d;
  }
  /** A replica of `bin` launched with `launch`: one launch a process, since a second in one process panics at the base. */
  static async launched(bin: string, launch: Line, plant?: string): Promise<Drive> {
    const d = await Drive.start(bin, plant);
    await d.launch(launch);
    return d;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call and its reply; BLOCKED when the binary gives none. */
  async call(args: Line, ms = 900_000): Promise<Line> {
    const reply = this.next(ms);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${said(got)} ${this.err.slice(-600)}`);
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }
  /** One call that must answer ok; else a failure naming `what` and the replica's own error. */
  async must(what: string, args: Line): Promise<Line> {
    const reply = await this.call(args);
    if (reply.ok !== true) throw Error(`${what}: ${said(reply.error ?? reply, 500)}`);
    return reply;
  }
  launch(launch: Line): Promise<Line> { return this.must(`launching the replica with ${said(launch)}`, { call: 'launch', launch }); }
  async see(): Promise<Seen> {
    const r = await this.must('see', { call: 'see' });
    return { snapshot: r.snapshot as Snapshot, sha256: String(r.sha256), address: (r.address ?? null) as string | null };
  }
  /** Lets `ms` of the replica's clock pass with no input. */
  async wait(ms: number): Promise<void> {
    await this.must(`waiting ${ms} ms`, { call: 'wait_for', wait_for: { t: this.t + Math.round((ms * FLICKS) / 1000) }, timeout: ms + 2000 });
  }
  open(address: string): Promise<Line> { return this.must(`deep_drive's open of ${address}`, { call: 'open', open: { address } }); }
  /** Closes the replica; its trace (#124), with the notifications it posted. */
  async close(): Promise<Line> {
    const closed = await this.must('close', { call: 'close' });
    return JSON.parse(readFileSync(String(closed.trace.path), 'utf8')) as Line;
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

// ---- Worlds (README, The fixtures): sessions seeded through the record and asks core with the hub stopped (#26's
// `seed`), each session's worktree a git folder named for its project, then a real hub, whose first backfill builds
// every row (#1461, #1808). A fixture world is seeded and served on a clock just before the replica's NOW and written to
// a fixture file; a live world is on the wall clock, for the real app.

export interface Option { id: string; label: string; decision: 'allow' | 'deny' | 'none' }
export interface AskSpec { kind: 'authority' | 'taste' | 'choice'; question: string; options?: Option[]; recommended?: string | null; default?: string; steps?: string[] }
export interface SessionSpec { key: string; project: string; title: string; state?: 'working' | 'finished' | 'failed'; asks?: AskSpec[] }
export interface WorldSession { key: string; id: string; project: string; title: string; worktree: string }
export interface WorldAsk { handle: string; question: string; key: string; session: string; options: Option[] }
/** A world, and its own words: what its agents and you wrote, its paths, names and handles, which stay as written. */
export interface World { home: string; hub: Hub; sessions: WorldSession[]; asks: WorldAsk[]; words: string[] }
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const sourceOf = (kind: string): string => askSources().find((r) => r.kind === kind && !/^(asks|request)\./.test(r.source))?.source ?? blocked(`ask.sources@1 has no row for ${kind}`);

export async function makeWorld(specs: readonly SessionSpec[], at: 'fixture' | 'live'): Promise<World> {
  needBuilds();
  const home = makeHome();
  const base = tempDir();
  const dirs = new Map<string, string>();
  for (const project of new Set(specs.map((s) => s.project))) {
    const dir = join(base, project);
    mkdirSync(dir, { recursive: true });
    await new Promise<void>((resolve, reject) => execFile('git', ['init', '-q'], { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: dir } }, (e) => (e ? reject(e) : resolve())));
    dirs.set(project, dir);
  }
  const sessions: WorldSession[] = specs.map((spec) => ({ key: spec.key, id: newSession(home, 'claude-code', dirs.get(spec.project)!).id, project: spec.project, title: spec.title, worktree: dirs.get(spec.project)! }));
  const asks: WorldAsk[] = [];
  const now = at === 'fixture' ? NOW - 20 * MIN : Date.now();
  const first = now - (specs.length + 1) * MIN;
  const deadline = (at === 'fixture' ? NOW : now) + 2 * DAY;
  await seed(home, async (s) => {
    for (const [i, spec] of specs.entries()) {
      const t = first + i * MIN;
      const { id } = sessions[i]!;
      s.at(t);
      await s.start(id, dirs.get(spec.project)!);
      const who = { actor: 'you', scope: 'you', session: id, project: spec.project };
      await s.record.append({ writer: 'app', ...who }, { v: 1, id: ulid(t), kind: 'task.created', ts: t, data: { task_ref: `task:${ulid(t)}`, thread: id, owner: 'you', title: spec.title } } as never);
      if (spec.state && spec.state !== 'working') {
        s.at(t + 1000);
        await s.record.append({ writer: 'core', ...who }, { v: 2, id: ulid(t + 1000), kind: 'session.attention', ts: t + 1000, subject: `session:${letters(id)}`, data: { state: spec.state } } as never);
      }
      for (const [k, a] of (spec.asks ?? []).entries()) {
        s.at(t + 2000 + k * 1000);
        const data = {
          ...askData(a.kind, a.question, s.now(), deadline),
          ...(a.options ? { options: a.options } : {}),
          ...(a.recommended !== undefined ? { recommended: a.recommended } : {}),
          ...(a.default ? { default: a.default } : {}),
        };
        const plan = a.steps
          ? { steps: a.steps.map((does) => ({ does, changes: [does], undo: 'git revert the commit', public: true, cost: 0 })), diff: sha256(a.question) }
          : undefined;
        const handle = await (s.asks.raise as (...args: unknown[]) => Promise<string>)({ writer: 'core', ...who }, sourceOf(a.kind), data, plan);
        asks.push({ handle, question: a.question, key: spec.key, session: id, options: data.options as Option[] });
      }
    }
  }, first);
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), JSON.stringify({ version }));
  const hub = await startHub({ home, ...(at === 'fixture' ? { clock: now } : {}) });
  await quiet(hub);
  // #26's seed stamps the repo `shop` on each session's start, and each plan step's undo is the agent's words too.
  const words = [
    home, base, 'shop', 'git revert the commit',
    ...specs.flatMap((s) => [s.title, s.project, ...(s.asks ?? []).flatMap((a) => [a.question, ...(a.steps ?? [])])]),
    ...sessions.flatMap((s) => [s.id, s.worktree]), ...asks.flatMap((a) => [a.handle, a.handle.replace(/^ask:/, ''), ...a.options.map((o) => o.label)]),
  ];
  return { home, hub, sessions, asks, words: [...new Set(words)].filter((w) => w.length > 1) };
}
export const sessionOf = (w: World, key: string): WorldSession => w.sessions.find((s) => s.key === key) ?? blocked(`the world has no session ${key}`);
export const askOf = (w: World, key: string): WorldAsk => w.asks.find((a) => a.key === key) ?? blocked(`the world has no ask on ${key}`);

/** The world's record, as the hub serves it to the app (`events.read`), written as a replica fixture file; its path. */
export async function fixtureOf(w: World): Promise<string> {
  const conn = await control(w.hub, 'app');
  try {
    const events = await allEvents(conn);
    const path = join(tempDir(), 'world.events.jsonl');
    writeFileSync(path, events.map((e) => JSON.stringify({ session_id: e.session ?? '', event: e })).join('\n') + '\n');
    return path;
  } finally {
    conn.close();
  }
}

/** AC1's, AC3's and AC5's world: an approval with its plan (the oldest ask, so the window opens on it), a choice, a taste call. */
export const PUSH: AskSpec = {
  kind: 'authority', question: 'Push the ledger branch to origin/main?', steps: ['Push 3 commits to origin/main'],
  options: [{ id: 'ship', label: 'Ship the ledger branch', decision: 'allow' }, { id: 'audit', label: 'Wait for the audit', decision: 'deny' }],
  recommended: null, default: 'audit',
};
export const TILES: AskSpec = {
  kind: 'choice', question: 'Store coastline tiles as PNG or WebP?',
  options: [{ id: 'png', label: 'PNG tiles', decision: 'none' }, { id: 'webp', label: 'WebP tiles', decision: 'none' }],
  recommended: 'png', default: 'png',
};
export const TINT: AskSpec = { kind: 'taste', question: 'Which header tint reads better on the atlas?' };
export const RICH: SessionSpec[] = [
  { key: 'push', project: 'ledger', title: 'Reconcile ledger exports across regions', state: 'working', asks: [PUSH] },
  { key: 'tidy', project: 'ledger', title: 'Tidy the parquet importers', state: 'finished' },
  { key: 'tiles', project: 'atlas', title: 'Draw coastline tiles for the atlas', state: 'failed', asks: [TILES] },
  { key: 'tint', project: 'atlas', title: 'Choose a header tint for the atlas', state: 'working', asks: [TINT] },
];
/** AC4's worlds: `n` open asks, one a session (one session and none for 0), so no ask folds into another. */
export const counted = (n: number): SessionSpec[] => Array.from({ length: Math.max(n, 1) }, (_, i): SessionSpec => ({
  key: `s${i + 1}`, project: 'ledger', title: `Reconcile ledger batch ${i + 1}`, state: 'working',
  asks: i < n ? [{ ...TILES, question: `Store ledger batch ${i + 1} as Parquet or CSV?`, options: [{ id: 'parquet', label: 'Parquet files', decision: 'none' }, { id: 'csv', label: 'CSV files', decision: 'none' }], recommended: 'parquet', default: 'parquet' }] : [],
}));

// ---- The table (README, Surface 1-4): crates/deep-app/copy/en.json, the source, and one file per language beside it.

export const COPY = 'crates/deep-app/copy';
export type Entry = string | Record<string, string>;
export interface Tables { en: Record<string, Entry>; zh: Record<string, { text: Entry; source: string }> }
const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));
/** The English table and the zh-Hans table under `root`, or why they can't be read. */
export function tables(root = REPO): Tables | string {
  const en = join(root, COPY, 'en.json');
  const zh = join(root, COPY, 'zh-Hans.json');
  if (!existsSync(en)) return `there is no table at ${COPY}/en.json`;
  if (!existsSync(zh)) return `there is no zh-Hans table at ${COPY}/zh-Hans.json`;
  try { return { en: readJson(en), zh: readJson(zh) }; } catch (e) { return `the table doesn't parse: ${(e as Error).message}`; }
}
/** Every string an entry holds: the string, or each plural form. */
export const strings = (e: Entry | undefined): string[] => (e === undefined ? [] : typeof e === 'string' ? [e] : Object.values(e).filter((s): s is string => typeof s === 'string'));
/** The keys whose English holds `text`, as a string or one plural form. */
export const keysOf = (t: Tables, text: string): string[] => Object.keys(t.en).filter((k) => strings(t.en[k]).includes(text));
/** CLDR's cardinal category at the pinned release for a whole number (cldr-1129998233: zh has only other; en, one for 1). */
const category = (lang: 'en' | 'zh', n: number): string => (lang === 'en' && n === 1 ? 'one' : 'other');
/** An entry's string for the count `n` (README, Surface 4): `zero` for 0 when it has one, else the category's, else other. */
export function form(e: Entry | undefined, lang: 'en' | 'zh', n: number): string | undefined {
  if (e === undefined) return undefined;
  if (typeof e === 'string') return e.replaceAll('{0}', String(n));
  const pick = (n === 0 && e.zero !== undefined ? e.zero : e[category(lang, n)] ?? e.other);
  return pick?.replaceAll('{0}', String(n));
}
/** The hash a translation records of the English it was written from (README, Surface 3). */
export function sourceHash(e: Entry): string {
  if (typeof e === 'string') return sha256(e);
  return sha256(JSON.stringify(Object.fromEntries(Object.entries(e).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))));
}
/** The count's sentence: the English plural entry that reads "1 ask needs you" for 1 and "11 asks need you" for 11. */
export function countKey(t: Tables): string | undefined {
  return Object.keys(t.en).find((k) => typeof t.en[k] === 'object' && form(t.en[k], 'en', 1) === BASE_COUNT(1) && form(t.en[k], 'en', 11) === BASE_COUNT(11));
}
/** Han characters, which every Simplified Chinese sentence of the app's holds. */
export const HAN = /[㐀-䶿一-鿿]/;

// ---- Reading a snapshot for English (README, Readings 1). What a person reads is a node's name, the strings drawn
// (`runs`), and the menu bar's title and lines; a node's value is a code (a state's status-map entry, an ask's status,
// the card's arming state, an empty kind: design, Replica and States people see), never read as words. A place holds a
// string when it holds it at ASCII word boundaries, after the world's own words are taken out (an agent's words,
// titles, paths, handles; a string cut at an ellipsis that starts one of them).

export interface Keyed { key: string; english: string; test: RegExp }
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Each English string the table has a key for, but the words that stay as written and strings with no English word. */
export function keyed(t: Tables): Keyed[] {
  const out: Keyed[] = [];
  for (const [key, entry] of Object.entries(t.en)) {
    for (const english of strings(entry)) {
      const bare = english.replace(/\{\d\}/g, '').trim();
      if (!/[A-Za-z]{2}/.test(bare) || AS_WRITTEN.includes(bare)) continue;
      const body = english.split(/\{\d\}/).map(escape).join('.+?');
      out.push({ key, english, test: new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`) });
    }
  }
  return out.sort((a, b) => b.english.length - a.english.length);
}
export function strip(text: string, words: readonly string[]): string {
  let out = text;
  for (const w of [...words].sort((a, b) => b.length - a.length)) out = out.split(w).join(' ');
  return out.split(/\n/).map((line) => {
    const cut = /^(.*?)(…|\.\.\.)\s*$/.exec(line.trim());
    return cut && cut[1]!.trim().length > 0 && words.some((w) => w.startsWith(cut[1]!.trim())) ? '' : line;
  }).join('\n');
}
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
export const describe = (n: SNode, i: number): string => `node ${i} (${n.role}${n.id ? ` ${n.id}` : ''} ${said(n.name, 80)})`;
/** Every place a snapshot holds words a person reads, in order: its nodes' names (pre-order, numbered as the snapshot's first difference numbers them), what it draws, the menu bar. */
export function places(s: Snapshot): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  flat(s.tree).forEach((n, i) => {
    if (n.name) out.push({ where: describe(n, i), text: n.name });
  });
  for (const [j, r] of (s.runs ?? []).entries()) out.push({ where: `the string drawn ${j} ${said(r.text, 80)}`, text: r.text });
  if (s.menu_bar?.title) out.push({ where: `the menu bar's title ${said(s.menu_bar.title, 80)}`, text: s.menu_bar.title });
  for (const [k, item] of (s.menu_bar?.items ?? []).entries()) out.push({ where: `the menu bar's line ${k} ${said(item, 80)}`, text: item });
  return out;
}
/** The English string the table has a key for that `text` holds, once the world's words are out, named; else undefined. */
export function englishIn(text: string, keys: Keyed[], words: readonly string[]): string | undefined {
  const bare = strip(text, words);
  const hit = keys.find((k) => k.test.test(bare));
  return hit && `"${hit.english}" (key ${hit.key})`;
}
/** The first place in `s` that holds an English string the table has a key for, named. */
export function firstEnglish(s: Snapshot, keys: Keyed[], words: readonly string[]): string | undefined {
  for (const p of places(s)) {
    const hit = englishIn(p.text, keys, words);
    if (hit) return `${p.where} holds ${hit}`;
  }
  return undefined;
}
/** The first node of `s` whose name holds English words of its own, once the world's are taken out. */
export function firstWords(s: Snapshot, words: readonly string[]): string {
  const nodes = flat(s.tree);
  for (const [i, n] of nodes.entries()) if (n.name && /[A-Za-z]{2}/.test(strip(n.name, words))) return describe(n, i);
  return 'no node';
}
export interface Visit { name: string; seen: Seen }
/**
 * AC1's judge (README, Readings 1): each zh-Hans visit draws otherwise than its en-US twin, and holds no English string the
 * table has a key for. Each failure names the visit and the first node.
 */
export function judge(zh: readonly Visit[], en: readonly Visit[], t: Tables | string, words: readonly string[]): string[] {
  const failures: string[] = [];
  for (const [i, z] of zh.entries()) {
    const e = en[i];
    if (e && z.seen.sha256 === e.seen.sha256) failures.push(`${z.name}: the zh-Hans launch draws the same as en-US (snapshot ${z.seen.sha256.slice(0, 12)}); its first node with English words is ${firstWords(z.seen.snapshot, words)}`);
  }
  if (typeof t === 'string') return [...failures, t];
  const keys = keyed(t);
  for (const z of zh) {
    const hit = firstEnglish(z.seen.snapshot, keys, words);
    if (hit) failures.push(`${z.name}: in zh-Hans ${hit}`);
  }
  return failures;
}
/** The first node where two snapshots differ, named (as crates/deep-replica/src/snapshot.rs's first_difference walks them). */
export function firstDifference(a: Snapshot, b: Snapshot): string {
  const x = flat(a.tree);
  const y = flat(b.tree);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const [p, q] = [x[i], y[i]];
    if (!p || !q) return `node ${i}: ${p ? describe(p, i) : 'nothing'} here, ${q ? describe(q, i) : 'nothing'} at the merge base`;
    const shape = (n: SNode) => JSON.stringify({ role: n.role, name: n.name, value: n.value, id: n.id ?? null, bounds: n.bounds, children: n.children.length });
    if (shape(p) !== shape(q)) return `${describe(p, i)} here, ${describe(q, i)} at the merge base`;
  }
  for (const key of ['runs', 'menu_bar', 'views', 'items', 'focus', 'window'] as const) {
    if (JSON.stringify((a as Line)[key]) !== JSON.stringify((b as Line)[key])) return `the snapshot's ${key}: ${said((a as Line)[key], 200)} here, ${said((b as Line)[key], 200)} at the merge base`;
  }
  return 'no node (the snapshots differ in a field this reader doesn\'t name)';
}

// ---- The lint (README, Surface 7): node scripts/app-copy-lint.mjs [--root <dir>] [--release], run from this checkout
// over a copy of the source under /tmp (#1458's way), so the checkout never changes.

export const LINT = 'scripts/app-copy-lint.mjs';
export const lint = (root: string, release = false): Promise<Ran> => run(process.execPath, [join(REPO, LINT), '--root', root, ...(release ? ['--release'] : [])], { timeoutMs: 10 * MIN });
export const fails = (r: Ran): string[] => r.stdout.split('\n').filter((l) => l.startsWith('FAIL'));
export const shown = (r: Ran): string => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}, stdout ${said(r.stdout.slice(-1500), 1600)}, stderr ${said(r.stderr.slice(-800), 900)}`;
/** Whether a FAIL line names `file:line`. */
export const names = (r: Ran, file: string, line: number): boolean => fails(r).some((l) => new RegExp(`${escape(file)}:${line}(?!\\d)`).test(l));
/** The lanes as scripts/lanes.mjs declares them: the per-change checks and the release preflight's own. */
export async function lanes(): Promise<{ checks: { name: string; commands: string[][] }[]; releaseLanes: { name: string; commands: string[][] }[] }> {
  return (await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href)) as never;
}
/** Whether `list`'s lanes run `node <args...>` exactly. */
export const runs = (list: { commands: string[][] }[], args: string[]): boolean => list.some((l) => l.commands.some((c) => c[0] === process.execPath && JSON.stringify(c.slice(1)) === JSON.stringify(args)));

// ---- The real app (AC5, AC7), read from outside its process through the accessibility tree.

/**
 * `bin` started with the system's preferred languages set for its one process, as macOS's argument domain sets them
 * (`-AppleLanguages "(zh-Hans-CN, en-US)"`): a script that execs it, so the process the probe reads keeps its PID.
 */
export function withLanguages(bin: string, languages: readonly string[]): string {
  const script = join(tempDir(), 'deep-app-in');
  writeFileSync(script, `#!/bin/sh\nexec '${bin}' -AppleLanguages '(${languages.join(', ')})' "$@"\n`);
  chmodSync(script, 0o755);
  return script;
}
let probed: Promise<string> | undefined;
/** #1462's probe.swift, unchanged, compiled into this suite's folder for its `status` reading. */
function probe1462(): Promise<string> {
  probed ??= (async () => {
    const source = join(REPO, 'tests/acceptance/1462/probe.swift');
    const out = join(BIN, `probe1462-${sha256(readFileSync(source)).slice(0, 12)}`);
    mkdirSync(BIN, { recursive: true });
    if (!existsSync(out)) {
      const r = await run('swiftc', ['-O', '-module-cache-path', join(BIN, 'swift-cache'), source, '-o', out], { timeoutMs: 10 * MIN });
      if (r.code !== 0) blocked(`#1462's probe.swift didn't compile: ${r.stderr.slice(-400)}`);
    }
    return out;
  })();
  return probed;
}
/** The titles of the status items `pid` put in the menu bar, as an assistive client reads them (#1462's `probe status`). */
export async function statusTitles(pid: number): Promise<(string | null)[]> {
  const r = await run(await probe1462(), ['status', String(pid)], { timeoutMs: 60_000 });
  if (r.code !== 0) blocked(`probe status failed: ${r.stderr.slice(-300)}`);
  return (JSON.parse(r.stdout) as { title: string | null }[]).map((s) => s.title);
}
