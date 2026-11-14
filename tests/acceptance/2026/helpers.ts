// Test-side tools for #2026 (README). Every reading comes from a real component: a real hub (`deep hub run`) on a temp
// HOME, its record seeded with the hub stopped through the real record and asks core (#26's `seed`); the real `deep`
// CLI for `deep inbox`; the real deep-hook binary for a Claude Code permission request it spools while the hub is down;
// `deep-replica --first-screen` for the app's first screen over that hub, with the menu bar's title (#1002); and
// `deep-live --view needs-you --watch` for the real app window on that hub, read through the app's own record reader
// and tick, one line per frame it draws (#1546). The oracle (the record's open asks, by the design's close rule) and
// every judge are this suite's own; none is taken from the implementation.
//
// Reused by import: #16's homes, hub, socket, hook wire, sessions and PID cleanup; #26's seeding through the real
// record and asks core, its ask data and its heavy month; #1551's reference-Mac and load gate.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; nothing touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { askSources } from '../../../packages/asks/src/index.ts';
import {
  allEvents, cleanup as cleanup16, Conn, control, DEEP_HOOK, hookRequest, newSession, own, payload, REPO, run, sendHook, sleep, startHub, stopHub,
  type Ev, type Hub, type Line, type Ran, type Session,
} from '../16/helpers.ts';
import { askData, childEnv, cleanup as cleanup26, PROJECT, seed, seedMonth, sha256, ulid, type Seeding } from '../26/helpers.ts';
import { inconclusive, timingProblem } from '../1551/helpers.ts';

export { inconclusive, REPO, sleep, stopHub, timingProblem, type Ev, type Hub, type Seeding, type Session };

// Every clock time the app writes is in your time zone: this suite's has a half-hour offset, so neither UTC nor a
// whole-hour slip can pass for it (#1463's choice). Children inherit it through #16's and #26's environments.
export const ZONE = 'Asia/Kolkata';
process.env.TZ = ZONE;

/** The criteria, by `#2026.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  load: '#2026.2baf6583',
  count: '#2026.e51f5486',
  replay: '#2026.8e76ad64',
  oneNumber: '#2026.44fb65f8',
  outage: '#2026.3529e9fd',
} as const;

/** The planted wrong programs this suite selects with DEEP_HUB_PLANT in an `env-plants` build of the app (README, Pinned). */
export const PLANT = {
  /** AC3: the app's one record reader keeps its place by the newest event ID it applied, not by `log_pos`. */
  byId: 'reader-keeps-place-by-id',
  /** AC4: Home's count (the list's Needs you heading) leaves out a decision's close: an ask `decision.applied` closed counts as open. */
  skipsDecision: 'home-skips-decision-close',
  /** AC4: the menu bar's count counts sessions, not asks. */
  countsSessions: 'menu-bar-counts-sessions',
  /** AC5: with the hub not answering, the list's Needs you section shows "Nothing needs you" and no rows. */
  downNothing: 'hub-down-nothing-needs-you',
  /** AC5: with the hub not answering, the menu bar keeps the last count it showed, as if it were live. */
  downKeepsCount: 'hub-down-keeps-count',
} as const;

export const SECOND = 1000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

// ---- Temp folders and cleanup. Short paths under /tmp: a socket path must fit in 104 bytes on macOS.

const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/da2026-'));
  made.push(dir);
  return dir;
}
export async function cleanup(): Promise<void> {
  await cleanup16();
  await cleanup26();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A HOME whose setup finished, so the app shows its list and not Set up; its hub's root is <home>/.deepbuild. */
export function makeHome(): string {
  const home = join(tempDir(), 'h');
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), JSON.stringify({ version }));
  return home;
}
export const rootOf = (home: string): string => join(home, '.deepbuild');

// ---- Builds (README, How to run): #1172's build environment, each binary copied out of the target folder under its own
// name, so a plant's build never stands in for the plain one; the plain build is made last, so target/debug holds it.

const BIN = join(tmpdir(), `da2026-bin-${userInfo().uid}`);
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const builds = new Map<string, Promise<void>>();
function cargo(args: string[]): Promise<void> {
  const key = args.join(' ');
  let build = builds.get(key);
  if (!build) {
    build = run('cargo', ['build', '--locked', '-q', ...args], { env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' }, timeoutMs: 120 * MINUTE }).then((r) => {
      if (r.code !== 0) blocked(`cargo build ${key} failed: ${r.stderr.slice(-3000)}`);
    });
    builds.set(key, build);
  }
  return build;
}
/** deep-hook, under the checkout's target, where the hub and #16's helpers look for it. */
export const deepHook = (): Promise<void> => cargo(['-p', 'deep-hook', '--bin', 'deep-hook']);
export interface AppBins { replica: string; live: string }
let bins: Promise<{ plain: AppBins; plants: AppBins }> | undefined;
/** `deep-replica` and `deep-live`, built plain and with `env-plants`, through which DEEP_HUB_PLANT selects a planted app. */
export function appBins(): Promise<{ plain: AppBins; plants: AppBins }> {
  if (process.platform !== 'darwin') return Promise.resolve(blocked(`the app draws on macOS only; this is ${process.platform}`));
  bins ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    const copy = (kind: string): AppBins => {
      const out = { replica: join(BIN, `deep-replica-${kind}`), live: join(BIN, `deep-live-${kind}`) };
      copyFileSync(target('deep-replica'), out.replica);
      copyFileSync(target('deep-live'), out.live);
      return out;
    };
    const named = ['--bin', 'deep-replica', '--bin', 'deep-live'];
    await cargo(['-p', 'deep-replica', '--features', 'env-plants', ...named]);
    const plants = copy('plants');
    await cargo(['-p', 'deep-replica', ...named]);
    return { plain: copy('plain'), plants };
  })();
  return bins;
}
/** The workspaces' built CLI and hub, which every hub and `deep` command here runs. */
export function needCli(): void {
  if (!existsSync(join(REPO, 'packages/cli/dist/main.js'))) blocked('the CLI isn\'t built: run npm ci and npm run build --workspaces');
}

// ---- The hub (#16's `deep hub run`), and reads of its record as the cli.

/** Starts the hub of `home`: under load a start over a month of history takes a while. */
export const hubOf = (home: string): Promise<Hub> => startHub({ home }, 10 * MINUTE);
export async function eventsOf(hub: Hub): Promise<Ev[]> {
  const conn = await control(hub);
  try { return await allEvents(conn); } finally { conn.close(); }
}
/** The `log_pos` the hub's reads reflect now. */
export async function logPos(hub: Hub): Promise<number> {
  const conn = await control(hub);
  try {
    const reply = await conn.call('inbox.read', {}, 60_000);
    if ('error' in reply) blocked(`inbox.read refused: ${JSON.stringify(reply.error)}`);
    return Number((reply.result as Line).log_pos);
  } finally {
    conn.close();
  }
}

// ---- The record, seeded with the hub stopped through the real record and asks core, as the hub's core would write it.

const WHO = { actor: 'you', scope: 'you' };
const as = (writer: string, session: string) => ({ writer, ...WHO, session, project: PROJECT, ...(writer === 'hook' ? { agent: 'claude-code' } : {}) });
const sourceOf = (kind: string): string => askSources().find((row) => row.kind === kind && !/^(asks|request)\./.test(row.source))!.source;
/** The options a choice ask offers, #26's: `sqlite` (its default) and `files`. */
const CLOSE_DATA = { answer: 'sqlite', plan_hash: null, decision: 'none' };

/** Each way the issue names an ask closing, and two that must not close one. */
export type Close = 'decision' | 'answered' | 'defaulted' | 'escalated' | 'cancelled' | 'superseded' | 'moot' | 'agent-cancel' | 'undone-default';
/**
 * Raises a choice ask in `session`, then closes it `how` (or leaves it open with `undefined`); its handle. A decision's
 * close is applied from a decision saved from another ask, answered first; a supersede raises a newer ask on the same
 * key, which stays open; an agent's cancel (a hook's) and a default undone leave it open.
 */
export async function askAndClose(s: Seeding, session: string, question: string, how?: Close): Promise<{ ask: string; also: string[] }> {
  const ask = await s.raise(session, 'choice', question);
  const append = (writer: string, kind: string, v: number, data: Line, subject: string | undefined = ask) =>
    s.record.append(as(writer, session) as never, { v, id: ulid(s.now()), kind, ts: s.now(), ...(subject ? { subject } : {}), data } as never);
  const also: string[] = [];
  switch (how) {
    case undefined: break;
    case 'answered': await s.asks.answer(as('cli', session) as never, ask, { option: 'files' }); break;
    case 'decision': {
      const from = await s.raise(session, 'choice', `${question} (asked before)`);
      await s.asks.answer(as('cli', session) as never, from, { option: 'files' });
      also.push(from);
      const decision = ulid(s.now());
      await s.record.append(as('core', session) as never, { v: 1, id: decision, kind: 'decision.created', ts: s.now(), data: { key: sha256(`choice:${question}`), scope: `repo:${PROJECT}`, answer: 'files', ask: from } } as never);
      await append('core', 'decision.applied', 1, { decision: `decision:${decision}`, ask }, undefined);
      break;
    }
    case 'defaulted': await append('core', 'ask.defaulted', 1, CLOSE_DATA); break;
    case 'undone-default':
      await append('core', 'ask.defaulted', 1, CLOSE_DATA);
      await s.asks.undo(as('cli', session) as never, ask);
      break;
    case 'escalated': await append('core', 'ask.escalated', 1, CLOSE_DATA); break;
    case 'cancelled': await append('core', 'ask.cancelled', 1, CLOSE_DATA); break;
    case 'agent-cancel': await append('hook', 'ask.cancelled', 1, CLOSE_DATA); break;
    case 'moot': await append('core', 'ask.moot', 2, { because: 'attempt_replaced', session: `session:${session.replace(/[^0-9A-Za-z]/g, '')}x` }); break;
    case 'superseded': {
      // A newer ask on the same subject in the same thread: the core supersedes the older one.
      also.push(await s.asks.raise(as('core', session) as never, sourceOf('choice'), { ...askData('choice', `${question} Asked again with what changed?`, s.now()), key: sha256(`choice:${question}`) }));
      break;
    }
  }
  return { ask, also };
}
/** Puts `ask` off with Later, on the trusted path, until an hour before its deadline. */
export const later = (s: Seeding, session: string, ask: string): Promise<void> => s.asks.later(as('cli', session) as never, ask, s.now() + HOUR);
/** A message you typed in `session` that its agent hasn't read yet: an ask its turn raises next is held for it. */
export const typed = (s: Seeding, session: string, text: string): Promise<unknown> =>
  s.record.append(as('hook', session) as never, { v: 2, id: ulid(s.now()), kind: 'user.ask', ts: s.now(), data: { msg: 1, text, tasks: [], from: 'person' } } as never);

/**
 * AC4's fixture (README, The fixtures): one session closes an ask each way the issue names (applied by a decision,
 * answered, defaulted, escalated, cancelled, superseded, moot) and leaves the superseding ask and an ask a hook tried to
 * cancel open; one folds (five asks, then the exception and the ask it holds); one has an ask put off with Later; one
 * an ask held for a message its agent hasn't read. Eleven open asks in four sessions.
 */
export async function closeKinds(home: string): Promise<void> {
  await seed(home, async (s) => {
    await s.start('closes');
    for (const how of ['decision', 'answered', 'defaulted', 'escalated', 'cancelled', 'superseded', 'moot', 'agent-cancel'] as const) {
      await askAndClose(s, 'closes', `Closed by ${how}: keep the cache on SQLite or plain files?`, how);
    }
    await s.start('folds');
    for (let n = 1; n <= 6; n++) await askAndClose(s, 'folds', `Fold ${n}: keep the queue on SQLite or plain files?`);
    await s.start('later');
    const put = await askAndClose(s, 'later', 'Put off: keep the index on SQLite or plain files?');
    await later(s, 'later', put.ask);
    await s.start('held');
    await typed(s, 'held', 'wait, use the blue header');
    await askAndClose(s, 'held', 'Held: keep the logs on SQLite or plain files?');
  });
}
export const FIXTURE_SESSIONS = 4;

// ---- The oracle: the record's open asks, by the design's close rule (An ask, and your answer getting back: every ask
// ends; each closing event names one outcome; the first close decides; no agent closes an ask; a default undone by the
// core opens it again). Read from the hub's log, so it is the record's, never a reader's projection of it.

const CLOSES = new Set(['decision.applied', 'ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot']);
const isAgent = (writer: string): boolean => writer === 'hook' || writer.startsWith('mcp:');
const bare = (handle: unknown): string => String(handle ?? '').replace(/^ask:/, '');
export interface OpenAsk { id: string; question: string; session: string }
/** Every open ask in the record, by handle (`ask:<id>`), and how each closed one closed. */
export function openAsks(events: readonly Ev[]): { open: Map<string, OpenAsk>; closed: Map<string, string> } {
  const asks = new Map<string, OpenAsk>();
  const closed = new Map<string, string>();
  for (const e of [...events].sort((a, b) => a.log_pos - b.log_pos)) {
    if (e.kind === 'ask.created') asks.set(e.id, { id: `ask:${e.id}`, question: String((e.data as Line).question ?? ''), session: e.session ?? '' });
    else if (CLOSES.has(e.kind) && !isAgent(e.writer)) {
      const target = bare(e.kind === 'decision.applied' ? (e.data as Line).ask : e.subject);
      if (asks.has(target) && !closed.has(target)) closed.set(target, e.kind);
    } else if (e.kind === 'default.undone' && e.writer === 'core' && closed.get(bare(e.subject)) === 'ask.defaulted') {
      closed.delete(bare(e.subject));
    }
  }
  const open = new Map<string, OpenAsk>();
  for (const [id, ask] of asks) if (!closed.has(id)) open.set(ask.id, ask);
  return { open, closed: new Map([...closed].map(([id, kind]) => [`ask:${id}`, kind])) };
}

// ---- What the app shows, from its snapshot (the replica's shape: nodes with role, name, value, id and bounds, and the
// menu bar's title). Home's count is the list's Needs you heading (the issue's Reads under #1453); Needs you's rows are
// the list's ask rows, #1461's `ask:<ULID>`; the section is the list's nodes after the heading, up to the next heading.

export interface SNode { role: string; name: string | null; value: unknown; id: string | null; bounds: number[]; children: SNode[] }
export interface Snap { tree: SNode; menu_bar?: { title?: unknown } }
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
const text = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : JSON.stringify(v));
export const HEADING = 'heading:needs-you';
const within = (inner: number[], outer: number[]): boolean => inner.length === 4 && outer.length === 4
  && inner[0]! >= outer[0]! && inner[1]! >= outer[1]! && inner[0]! + inner[2]! <= outer[0]! + outer[2]! && inner[1]! + inner[3]! <= outer[1]! + outer[3]!;

/** What a person reads on the app's three surfaces in one snapshot. */
export interface Surfaces {
  /** The menu bar's title. */
  menuBar: string;
  /** Home's count: the Needs you heading's value, and every string inside it but its title; undefined with no heading. */
  home?: { value: string; words: string[] };
  /** The Needs you section: its rows' handles and every string it holds below the heading. */
  rows: string[];
  section: string[];
}
export function surfaces(s: Snap): Surfaces {
  const all = flat(s.tree);
  const at = all.findIndex((n) => n.id === HEADING);
  const heading = all[at];
  const list = all.find((n) => n.id === 'list');
  const inList = list ? new Set(flat(list)) : undefined;
  // The list's ask rows, each as often as it is drawn: the page beside it shows the card, never a row.
  const rows = all.filter((n) => typeof n.id === 'string' && /^ask:[0-9A-Za-z]+$/.test(n.id) && (!inList || inList.has(n))).map((n) => n.id!);
  const out: Surfaces = { menuBar: text(s.menu_bar?.title).trim(), rows, section: [] };
  if (!heading) return out;
  const inHeading = new Set(flat(heading));
  for (const n of all) if (!inHeading.has(n) && within(n.bounds, heading.bounds)) inHeading.add(n);
  const words = [...inHeading].map((n) => text(n.name).trim()).filter((t) => t && t !== 'Needs you');
  out.home = { value: text(heading.value).trim(), words: [...new Set(words)] };
  const after = all.slice(at + 1).filter((n) => !inHeading.has(n) && (!inList || inList.has(n)));
  const end = after.findIndex((n) => typeof n.id === 'string' && n.id.startsWith('heading:'));
  out.section = [...new Set((end < 0 ? after : after.slice(0, end)).map((n) => text(n.name).trim()).filter(Boolean))];
  return out;
}

/** The number a count's words say: "N asks need you", "1 ask needs you", "Nothing needs you" (0), "No open asks." (0) or a bare number. */
export function numberIn(words: string): number | undefined {
  const t = words.trim();
  if (/^(nothing needs you|no open asks)\b/i.test(t)) return 0;
  const m = /(?<![\d.])(\d+)\s+asks?\s+needs?\s+you\b/i.exec(t) ?? /^(\d+)$/.exec(t);
  return m ? Number(m[1]) : undefined;
}
/** Home's number: its heading's value when that is a number, else what its words say; both, when they disagree. */
export function homeNumbers(home: Surfaces['home']): number[] {
  if (!home) return [];
  const fromValue = /^\d+$/.test(home.value) ? Number(home.value) : undefined;
  const fromWords = home.words.map(numberIn).find((n) => n !== undefined);
  return [...new Set([fromValue, fromWords].filter((n): n is number => n !== undefined))];
}

// ---- `deep inbox`: its count, the last line it prints, and its rows (`--json`).

export interface Inbox { line: string; rows: string[]; log_pos: number }
export async function inbox(home: string): Promise<Inbox> {
  const human = await run(process.execPath, [join(REPO, 'packages/cli/dist/main.js'), 'inbox'], { env: childEnv(home) });
  if (human.code !== 0) blocked(`deep inbox exited ${human.code}: ${human.stderr.slice(-800)}`);
  const json = await run(process.execPath, [join(REPO, 'packages/cli/dist/main.js'), 'inbox', '--json'], { env: childEnv(home) });
  if (json.code !== 0) blocked(`deep inbox --json exited ${json.code}: ${json.stderr.slice(-800)}`);
  const read = JSON.parse(json.stdout) as { log_pos: number; rows: { id: string }[] };
  const lines = human.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  return { line: lines[lines.length - 1] ?? '', rows: read.rows.map((r) => r.id).filter((id) => id.startsWith('ask:')), log_pos: read.log_pos };
}

// ---- One number (AC2, AC4): the menu bar, Home and `deep inbox` against the record's open asks.

export interface Reading { surfaces: Surfaces; inbox: Inbox }
const named = (open: ReadonlyMap<string, OpenAsk>, id: string): string => `${id}${open.get(id) ? ` ("${open.get(id)!.question}")` : ''}`;
/**
 * What's wrong, each naming its surface: the menu bar, Home and `deep inbox` must each say the record's number of open
 * asks; the rows Needs you lists must be those asks, one each, so they add up to it; `deep inbox`'s rows too.
 */
export function oneNumberFailures(r: Reading, record: { open: ReadonlyMap<string, OpenAsk>; closed: ReadonlyMap<string, string> }): string[] {
  const want = record.open.size;
  const out: string[] = [];
  const says = (surface: string, n: number | undefined, shown: string) => {
    if (n === undefined) out.push(`${surface} shows no number of asks: ${shown}`);
    else if (n !== want) out.push(`${surface} reads ${n}, but the record holds ${want} open asks: ${shown}`);
  };
  says('the menu bar', numberIn(r.surfaces.menuBar), JSON.stringify(r.surfaces.menuBar));
  const home = homeNumbers(r.surfaces.home);
  if (!r.surfaces.home) out.push(`Home has no Needs you heading (${HEADING}) to read a count from`);
  else if (home.length > 1) out.push(`Home's count reads ${home.join(' and ')} at once: value ${JSON.stringify(r.surfaces.home.value)}, words ${JSON.stringify(r.surfaces.home.words)}`);
  else says('Home', home[0], `value ${JSON.stringify(r.surfaces.home.value)}, words ${JSON.stringify(r.surfaces.home.words)}`);
  says('deep inbox', numberIn(r.inbox.line), JSON.stringify(r.inbox.line));
  const rows = (surface: string, ids: readonly string[]) => {
    for (const id of record.open.keys()) if (!ids.includes(id)) out.push(`${surface} leaves out the open ask ${named(record.open, id)}`);
    for (const id of ids) if (!record.open.has(id)) out.push(`${surface} lists ${id}, which the record ${record.closed.has(id) ? `closed (${record.closed.get(id)})` : 'doesn\'t hold as an ask'}`);
    if (new Set(ids).size !== ids.length) out.push(`${surface} lists an ask twice: ${JSON.stringify(ids)}`);
  };
  rows('Needs you', r.surfaces.rows);
  if (home.length === 1 && r.surfaces.rows.length !== home[0]) out.push(`the rows Needs you lists (${r.surfaces.rows.length}) don't add up to Home's ${home[0]}`);
  rows('deep inbox', r.inbox.rows);
  return out;
}

// ---- The first screen (#1002's `deep-replica --first-screen`): the app's window over this HOME's hub, drawn once.

export const FIRST_FRAME = 'deep-replica: first frame drawn';
export interface FirstScreen { snapshot: Snap; menuBarTxt: string; firstFrameMs: number }
/** `deep-replica --first-screen` for `home`, timed from its spawn to the line it prints once its first frame is drawn. */
export function firstScreen(replica: string, home: string, plant?: string): Promise<FirstScreen> {
  const out = join(tempDir(), 'out');
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let firstFrameMs: number | undefined;
    let stdout = '';
    let stderr = '';
    const child = spawn(replica, ['--first-screen', '--out', out, '--appearance', 'light'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_PLANT: plant }), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    const timer = setTimeout(() => child.kill('SIGKILL'), 10 * MINUTE);
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      stdout += d;
      if (firstFrameMs === undefined && stdout.includes(FIRST_FRAME)) firstFrameMs = performance.now() - t0;
    });
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr = (stderr + d).slice(-4000)));
    child.on('close', (code) => {
      clearTimeout(timer);
      const file = join(out, 'snapshots/first-screen.json');
      if (code !== 0 || firstFrameMs === undefined || !existsSync(file)) {
        reject(Error(`BLOCKED: deep-replica --first-screen didn't draw (exit ${code}${plant ? `, DEEP_HUB_PLANT=${plant}` : ''}): ${stdout.slice(-600)} ${stderr.slice(-1500)}`));
        return;
      }
      const snapshot = JSON.parse(readFileSync(file, 'utf8')) as Snap;
      const menuBarTxt = existsSync(join(out, 'menu-bar.txt')) ? readFileSync(join(out, 'menu-bar.txt'), 'utf8').trim() : '';
      resolve({ snapshot, menuBarTxt, firstFrameMs });
    });
  });
}

// ---- The real app window on a hub (#1546's `deep-live --view needs-you --watch`), one line per frame it draws.

export interface Frame { frame: number; at: number; log_pos: number; names: string[]; snapshot?: Snap }
export class Watch {
  private offset = 0;
  private partial = '';
  private readonly read: Frame[] = [];
  private ready = false;
  private err = '';
  private constructor(private readonly child: ChildProcess, private readonly file: string) {
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (this.err = (this.err + d).slice(-4000)));
  }
  /** Shows the real window on `home`'s hub, and waits for its ready line: the reader has reached the hub. */
  static async start(live: string, home: string, plant?: string): Promise<Watch> {
    const file = join(tempDir(), 'needs-you.watch.jsonl');
    const child = spawn(live, ['--view', 'needs-you', '--out', file, '--watch'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_PLANT: plant }), stdio: ['ignore', 'ignore', 'pipe'] });
    own(child.pid);
    const watch = new Watch(child, file);
    const by = Date.now() + 2 * MINUTE;
    while (!watch.poll().ready) {
      if (child.exitCode !== null || child.signalCode !== null) blocked(`deep-live --watch exited (${child.exitCode ?? child.signalCode}) before its ready line: ${watch.err.slice(-1500)}`);
      if (Date.now() > by) blocked(`deep-live --watch wrote no ready line in 2 minutes; it needs a shown window on an unlocked display: ${watch.err.slice(-1500)}`);
      await sleep(100);
    }
    return watch;
  }
  /** Reads what the file gained since the last poll. */
  private poll(): { ready: boolean } {
    if (!existsSync(this.file)) return { ready: false };
    const size = statSync(this.file).size;
    if (size > this.offset) {
      const fd = openSync(this.file, 'r');
      try {
        const buffer = Buffer.alloc(size - this.offset);
        readSync(fd, buffer, 0, buffer.length, this.offset);
        this.offset = size;
        const lines = (this.partial + buffer.toString('utf8')).split('\n');
        this.partial = lines.pop() ?? '';
        for (const line of lines.filter(Boolean)) {
          let value: Line;
          try { value = JSON.parse(line) as Line; } catch { continue; }
          if (value.ready === true) this.ready = true;
          if (typeof value.frame === 'number') this.read.push(value as Frame);
        }
      } finally {
        closeSync(fd);
      }
    }
    return { ready: this.ready };
  }
  /** Every frame drawn so far. */
  frames(): Frame[] {
    this.poll();
    return [...this.read];
  }
  /** The first frame from `since` on that `pred` holds for, waiting up to `ms`; undefined if none came. */
  async first(pred: (f: Frame) => boolean, since: number, ms: number): Promise<Frame | undefined> {
    const by = Date.now() + ms;
    for (;;) {
      const found = this.frames().find((f) => f.at >= since && pred(f));
      if (found) return found;
      if (this.child.exitCode !== null || this.child.signalCode !== null) blocked(`deep-live --watch exited (${this.child.exitCode ?? this.child.signalCode}): ${this.err.slice(-1500)}`);
      if (Date.now() > by) return undefined;
      await sleep(50);
    }
  }
  /** The last frame drawn at or before `at`. */
  lastBy(at: number): Frame | undefined { return this.frames().filter((f) => f.at <= at).at(-1); }
  /** The last frame drawn so far. */
  last(): Frame | undefined { return this.frames().at(-1); }
  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill('SIGTERM');
    const by = Date.now() + 5000;
    while (this.child.exitCode === null && this.child.signalCode === null && Date.now() < by) await sleep(50);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
  }
}

/** What a frame showed on the three surfaces; BLOCKED when `--watch`'s lines carry no snapshot (README, Pinned 1). */
export function shownIn(f: Frame): Surfaces {
  if (!f.snapshot || typeof f.snapshot !== 'object' || !f.snapshot.tree) blocked(`deep-live --watch's frame lines carry no snapshot of the window (README, Pinned 1): ${JSON.stringify(f).slice(0, 300)}`);
  return surfaces(f.snapshot!);
}

// ---- Hooks: a session's hooks on the hub's wire (#16's `sendHook`, from an agent stand-in's process), and the real
// deep-hook binary as Claude Code runs it, which spools what it can't deliver.

/** A Claude Code session in a fresh folder, with a `sleep` standing in for its agent's process (#1463's way). */
export function agentSession(home: string): { s: Session; pid: number } {
  const s = newSession(home, 'claude-code', join(tempDir(), 'work'));
  const agent = spawn('/bin/sleep', ['7200'], { stdio: 'ignore' });
  own(agent.pid);
  return { s, pid: agent.pid! };
}
/** One live hook of `session` on the hub's socket; BLOCKED unless the hub acknowledged it. */
export async function live(hub: Hub, a: { s: Session; pid: number }, event: string, extra: Line = {}): Promise<string> {
  const request = { ...hookRequest(a.s, event, extra), pid: a.pid, ppid: a.pid };
  const r = await sendHook(hub.socket, request, 30_000);
  if (!r.ack) blocked(`the hub didn't acknowledge ${event} of ${a.s.id}: ${JSON.stringify(r).slice(0, 600)}`);
  return request.id;
}
/** deep-hook as Claude Code's hook entry runs it: `deep-hook claude-code <event>`, the hook's JSON on stdin. */
export const deepHookRun = (home: string, s: Session, event: string, body: Line): Promise<Ran> =>
  run(DEEP_HOOK, ['claude-code', event], { cwd: s.cwd, env: childEnv(home), input: JSON.stringify(body), timeoutMs: MINUTE });
export { payload };

/** A spooled request as deep-hook wrote it. */
export interface Spooled { id: string; seq: string; event: string; session: string; line: string }
const SPOOL = (home: string): string => join(rootOf(home), 'spool', 'spool.jsonl');
/** The requests deep-hook's spool holds. */
export function spooled(home: string): Spooled[] {
  if (!existsSync(SPOOL(home))) return [];
  return readFileSync(SPOOL(home), 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try {
      const r = JSON.parse(line) as Line;
      return [{ id: String(r.id), seq: String(r.seq), event: String(r.event), session: String((r.payload as Line | undefined)?.session_id ?? ''), line }];
    } catch { return []; }
  });
}
/**
 * The spool held aside, byte for byte, so the hub's start doesn't replay it; `back` puts it where deep-hook wrote it,
 * and the hub's own pass for a spool that lands while it runs replays it (README, Disputes 3).
 */
export function holdSpool(home: string): { back(): void } {
  const held = join(tempDir(), 'spool.jsonl');
  renameSync(SPOOL(home), held);
  return { back: () => renameSync(held, SPOOL(home)) };
}

/** A cli connection subscribed to the hub's stream after `after`: each frame with the wall time it arrived. */
export async function stream(hub: Hub, after: number): Promise<{ conn: Conn; frames(): { at: number; event: Ev }[] }> {
  const conn = await control(hub);
  const reply = await conn.call('stream.subscribe', { after }, 60_000);
  if ('error' in reply) blocked(`stream.subscribe refused: ${JSON.stringify(reply.error)}`);
  return {
    conn,
    frames: () => conn.received.filter((r) => r.json && typeof r.json.event === 'object' && r.json.event).map((r) => ({ at: performance.timeOrigin + r.at, event: r.json!.event as Ev })),
  };
}

// ---- The hub not answering (AC5): what a surface must say, and a since-when a person can read.

/** `ms` as the app writes a clock time in ZONE: 16:40. */
export const clockOf = (ms: number): string => new Date(ms).toLocaleTimeString('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
const DOWN = /isn['’]t answering|not answering/i;
/** Whether `words` say the hub isn't answering and since a clock time in `clocks`. */
export function saysDown(words: string, clocks: readonly string[]): boolean {
  if (!DOWN.test(words)) return false;
  const since = /since\D{0,24}?(\d{1,2}):(\d{2})/i.exec(words);
  return !!since && clocks.includes(`${since[1]!.padStart(2, '0')}:${since[2]}`);
}
/** Every clock time from a minute before `from` to a minute after `to`, as clockOf writes them. */
export function clocksBetween(from: number, to: number): string[] {
  const out = new Set<string>();
  for (let t = from - MINUTE; t <= to + MINUTE; t += 15 * SECOND) out.add(clockOf(t));
  return [...out];
}
/**
 * What's wrong with a frame while the hub is down, each naming its surface: the menu bar, Home (the Needs you heading)
 * and Needs you (its section) must each say the hub isn't answering and since when; none may say nothing needs you,
 * read a count as live, or (Home) carry a number as its value.
 */
export function downFailures(f: Surfaces, clocks: readonly string[]): string[] {
  const out: string[] = [];
  const live = (words: string) => numberIn(words) !== undefined;
  const nothing = (words: string) => /nothing needs you/i.test(words);
  const check = (surface: string, words: string[]) => {
    const all = words.join(' | ');
    if (words.some(nothing)) out.push(`${surface} says nothing needs you while the hub isn't answering: ${JSON.stringify(words)}`);
    else if (words.some(live)) out.push(`${surface} keeps a count as live while the hub isn't answering: ${JSON.stringify(words)}`);
    if (!words.some((w) => saysDown(w, clocks))) out.push(`${surface} doesn't say the hub isn't answering and since when (a clock time among ${clocks.join(', ')}): ${JSON.stringify(all)}`);
  };
  check('the menu bar', [f.menuBar]);
  if (!f.home) out.push(`Home has no Needs you heading (${HEADING})`);
  else {
    check('Home', f.home.words);
    if (/^\d+$/.test(f.home.value)) out.push(`Home's count keeps the number ${f.home.value} as its value while the hub isn't answering`);
  }
  check('Needs you', f.section);
  return out;
}
/**
 * What's wrong with a frame once the hub answers again, each naming its surface: the app holds the record at the hub's
 * new `log_pos`, every surface says its number of open asks, Needs you lists exactly them, and none still says the hub
 * isn't answering.
 */
export function backFailures(f: Frame, s: Surfaces, record: { open: ReadonlyMap<string, OpenAsk>; closed: ReadonlyMap<string, string> }, logPosNow: number): string[] {
  const out: string[] = [];
  if (f.log_pos < logPosNow) out.push(`the app holds the record at log_pos ${f.log_pos}, not the hub's new ${logPosNow}`);
  const want = record.open.size;
  const said = (surface: string, numbers: number[], shown: unknown) => {
    if (numbers.length !== 1 || numbers[0] !== want) out.push(`${surface} reads ${numbers.length ? numbers.join(' and ') : 'no number'} once the hub answers again at log_pos ${logPosNow}, where the record holds ${want} open asks: ${JSON.stringify(shown)}`);
  };
  said('the menu bar', [numberIn(s.menuBar)].filter((n): n is number => n !== undefined), s.menuBar);
  said('Home', homeNumbers(s.home), s.home ?? null);
  for (const id of record.open.keys()) if (!s.rows.includes(id)) out.push(`Needs you leaves out the open ask ${named(record.open, id)} once the hub answers again`);
  for (const id of s.rows) if (!record.open.has(id)) out.push(`Needs you still lists ${id}, which the record ${record.closed.has(id) ? `closed (${record.closed.get(id)})` : 'doesn\'t hold'}, once the hub answers again`);
  for (const [surface, words] of [['the menu bar', [s.menuBar]], ['Home', s.home?.words ?? []], ['Needs you', s.section]] as const) {
    if (words.some((w) => DOWN.test(w))) out.push(`${surface} still says the hub isn't answering once it answers again: ${JSON.stringify(words)}`);
  }
  return out;
}
/** With the hub stopped, the core cancels `ask` in the record (#26's seeding): the record moves while the app can't read it. */
export const cancelWhileDown = (home: string, session: string, ask: string): Promise<void> => seed(home, async (s) => {
  await s.record.append(as('core', session) as never, { v: 1, id: ulid(s.now()), kind: 'ask.cancelled', subject: ask, ts: s.now(), data: CLOSE_DATA } as never);
});
export { seed, seedMonth };
