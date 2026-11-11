// Test-side tools for #2018 (README). Every fixture is a record a real hub reads: sessions are either played through a
// real hub's hooks (`play`) or seeded with the hub stopped through the real record and asks core (`seed`, #26's), each
// event in the shape its kind's published schema gives it (packages/contracts fixtures); then a real hub
// (`deep hub run` in a temp HOME) builds the list's rows. The readers are the real ones: the built CLI for `deep status`,
// its `--json` and `deep status <session> --why`; the real `deep-drive` (#124) for the app's list, pages, menu bar and
// notifications, launched with `launch.from: "record_copy"` in the world's HOME; and `deep-replica --view-kit
// session.row@1 <dir>` for the kit, as `deep install` runs it. The judges each criterion's failure text comes from are
// here too, and judges.test.ts holds each to a right input and the wrong ones.
//
// Reused by import: #16's homes, hub, socket, hooks, sessions, temp folders and PID cleanup; #26's seeding through the
// real record and asks core.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; no test touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { fixtures, listSchemas } from '../../../packages/contracts/src/index.ts';
import { askSources } from '../../../packages/asks/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import {
  allEvents, childEnv, cleanup as cleanup16, control, deep as deep16, hookRequest, makeHome, newSession, own, REPO, sendHook, sha256, sleep,
  startHub, stopHub, tempDir, ulid, type Ev, type Hub, type Ran, type Session,
} from '../16/helpers.ts';
import { cleanup as cleanup26, seed, type Seeding } from '../26/helpers.ts';

export { allEvents, control, REPO, sleep, stopHub, tempDir, type Ev, type Hub, type Ran };
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const VIEWS = join(SUITE, 'fixtures', 'views');
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const cleanup = async (): Promise<void> => { await cleanup16(); await cleanup26(); };
const said = (v: unknown, most = 200): string => (JSON.stringify(v) ?? String(v)).slice(0, most);
/** Asserts that a judge found nothing wrong; what it found is the assertion's own text, a failure a line. */
export const none = (failures: readonly string[], what: string): void => expect(failures.length, `${what}:\n${failures.join('\n')}\n`).toBe(0);

/** The criteria, by `#2018.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  kit: '#2018.b912741a',
  states: '#2018.2b9628d8',
  counts: '#2018.f054ee4c',
  name: '#2018.c1948faa',
  why: '#2018.63948766',
  rename: '#2018.13e5e71e',
} as const;

/**
 * The one ordered state table, first row first: the fourteen state words of issue #2018's Scope as it reads at
 * updatedAt 2026-11-10T23:36:08Z, in its order, each with the status-map entry the design's States people see table
 * gives that word at the base. A session's state is the first row that matches.
 */
export const TABLE = [
  ['needs you', 'needs_you'], ['stuck', 'blocked'], ['flagged', 'fail'], ['sent back', 'fail'], ['BLOCKED', 'blocked'], ['INVALID', 'invalid'], ['INCONCLUSIVE', 'inconclusive'],
  ['stale', 'stale'], ['says done', 'running'], ['working', 'running'], ['queued', 'idle'], ['PASS', 'pass'], ['finished', 'idle'], ['quiet', 'idle'],
] as const;
export type Word = (typeof TABLE)[number][0];
export const WORDS: readonly string[] = TABLE.map(([word]) => word);
/** The flags (issue #2018, Scope): each shows in a row's right slot beside one of the fourteen state words, and is no state. */
export const FLAGS: readonly string[] = ['retrying', 'repeating', 'interrupted', 'watch-only'];
/** A session's short ID, as the base writes one: its ID's first 8 characters. */
export const shortId = (id: string): string => id.slice(0, 8);
export const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
/** Every form a session's ID is written in: whole, its first 8, its letters and digits, their first 8. */
export function idForms(id: string): string[] {
  return [...new Set([id, id.slice(0, 8), letters(id), letters(id).slice(0, 8)])];
}

// ---- Builds. `deep-replica` for the kit; `deep-drive` plain and with the replica's env-plants feature (the app's
// plants, read from DEEP_HUB_PLANT), each copied out of the target folder under its own name, into a folder of this
// checkout's own, so another worktree's build never stands in. The plain build is the last one made.

const BIN = join(tmpdir(), `dd2018-bin-${userInfo().uid}-${sha256(REPO).slice(0, 8)}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
function cargo(args: string[]): void {
  if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
  try {
    execFileSync('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: CARGO_ENV, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const e = error as { stderr?: Buffer; message: string };
    blocked(`cargo build ${args.join(' ')} failed: ${(e.stderr?.toString() ?? e.message).split('\n').filter((l) => /^error/.test(l)).slice(0, 6).join('\n') || e.message.slice(0, 600)}`);
  }
}
const kept = (name: string, as: string): string => { mkdirSync(BIN, { recursive: true }); const out = join(BIN, as); copyFileSync(target(name), out); return out; };
let kit: string | undefined;
/** `deep-replica`, which runs a view's kit as `deep install` does. */
export function kitBinary(): string {
  if (!kit) { cargo(['-p', 'deep-replica', '--bin', 'deep-replica']); kit = kept('deep-replica', 'deep-replica'); }
  return kit;
}
let drives: { plain: string; plants: string } | undefined;
/** The replica: `deep-drive`, plain and with env-plants. */
export function driveBinaries(): { plain: string; plants: string } {
  if (!drives) {
    cargo(['-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants']);
    const plants = kept('deep-drive', 'deep-drive-plants');
    cargo(['-p', 'deep-replica', '--bin', 'deep-drive', '-p', 'deep-hook', '--bin', 'deep-hook']);
    drives = { plain: kept('deep-drive', 'deep-drive-plain'), plants };
  }
  return drives;
}
/** The CLI and deep-hook a hub needs: built, or BLOCKED (never a pass). */
export function needBuilds(): void {
  if (!existsSync(join(REPO, 'packages/cli/dist/main.js'))) blocked('no built CLI at packages/cli/dist/main.js; run npm run build --workspaces first');
  if (!existsSync(target('deep-hook'))) blocked('no deep-hook under target/debug; run cargo build --locked -p deep-hook first');
}

// ---- Events, each in its kind's published shape: the newest schema's first fixture, its fields set here.

type Obj = Record<string, any>;
const newest = new Map<string, string>();
/** A kind's newest schema's fixture (the one `pick` takes, else the first), cloned: its `v` and its `data`. */
export function template(kind: string, pick: (data: Obj) => boolean = () => true): { v: number; data: Obj } {
  if (!newest.size) {
    for (const s of listSchemas() as { name: string }[]) {
      const [k, v] = s.name.split('@') as [string, string];
      if (!newest.has(k) || Number(v) > Number(newest.get(k)!.split('@')[1])) newest.set(k, s.name);
    }
  }
  const name = newest.get(kind) ?? blocked(`the contracts publish no schema for ${kind}`);
  const found = (fixtures(name) as unknown as Obj[]).find((f) => pick(f.data as Obj)) ?? blocked(`${name} publishes no fixture this suite can fill`);
  return { v: found.v as number, data: structuredClone(found.data) as Obj };
}

// ---- The world.

export interface FixtureSession { key: string; id: string; repo: string; cwd: string; title?: string; /** The project its hooks' events carry, for a played session. */ project?: string }
export interface FixtureAsk { handle: string; question: string; session: string; key: string; /** Its default option's ID. */ default: string }
export interface World {
  home: string; root: string; hub: Hub; confirm: string; repos: Record<string, string>;
  sessions: Record<string, FixtureSession>; asks: FixtureAsk[];
  /** When the fixture was made, by the wall clock: every seeded time counts back from it. */
  at: number;
  /** Where each hub's clock starts (DEEP_HUB_TEST_CLOCK), in a world whose clock is held to `at`. */
  clock?: number;
}
export type Outcome = 'PASS' | 'FAIL' | 'BLOCKED' | 'INVALID' | 'INCONCLUSIVE';

/** Seeds one record with the hub stopped, as the hub's hooks and core would have appended it. Times are ms. */
export class Seeder {
  private readonly prompts = new Map<string, number>();
  private readonly turns = new Map<string, number>();
  private calls = 0;
  constructor(private readonly sd: Seeding, private readonly w: Pick<World, 'home' | 'repos' | 'sessions' | 'asks'>) {}
  private s(key: string): FixtureSession { return this.w.sessions[key] ?? blocked(`the fixture has no session ${key}`); }
  private who(key: string): { actor: string; scope: string; session: string; project: string } { const s = this.s(key); return { actor: 'you', scope: 'you', session: s.id, project: s.project ?? s.repo }; }
  private async put(key: string, writer: 'hook' | 'core' | 'app', kind: string, at: number, set: Obj, o: { subject?: string; pick?: (data: Obj) => boolean } = {}): Promise<string> {
    const t = template(kind, o.pick);
    const id = ulid(at);
    this.sd.at(at);
    await this.sd.record.append({ writer, ...this.who(key), ...(writer === 'hook' ? { agent: 'claude-code' } : {}) }, { v: t.v, id, kind, ts: at, ...(o.subject ? { subject: o.subject } : {}), data: { ...t.data, ...set } });
    return id;
  }
  private subject(key: string): string { return `session:${letters(this.s(key).id)}`; }
  /** A session in `repo`'s git folder, started at `at`, its transcript where Claude Code keeps it. */
  async start(key: string, repo: string, at: number): Promise<FixtureSession> {
    const cwd = this.w.repos[repo] ?? blocked(`the fixture has no repo ${repo}`);
    const made = newSession(this.w.home, 'claude-code', cwd);
    const s: FixtureSession = { key, id: made.id, repo, cwd };
    this.w.sessions[key] = s;
    const t = template('session.start');
    this.sd.at(at);
    await this.sd.record.append({ writer: 'hook', ...this.who(key), agent: 'claude-code' }, { v: t.v, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: cwd, branch: null, thread: s.id, loads: [] } });
    return s;
  }
  /** Its task, titled. */
  async task(key: string, title: string, at: number): Promise<void> {
    this.s(key).title = title;
    await this.put(key, 'app', 'task.created', at, { task_ref: `task:${ulid(at)}`, thread: this.s(key).id, owner: 'you', title });
  }
  /** A prompt of yours, as its hook records it. */
  async prompt(key: string, text: string, at: number): Promise<void> {
    const msg = this.prompts.get(key) ?? 0;
    this.prompts.set(key, msg + 1);
    const t = template('user.ask');
    this.sd.at(at);
    await this.sd.record.append({ writer: 'hook', ...this.who(key), agent: 'claude-code' }, { v: t.v, id: ulid(at), kind: 'user.ask', ts: at, data: { msg, text, tasks: [], from: 'unknown' } });
  }
  /** A tool call that started at `at`; its call ID, for `toolEnd`. */
  async toolStart(key: string, at: number, command = 'npm test'): Promise<string> {
    const call = `toolu_2018_${++this.calls}`;
    const t = template('tool.before', (d) => d.kind === 'shell');
    this.sd.at(at);
    await this.sd.record.append({ writer: 'hook', ...this.who(key), agent: 'claude-code' }, { v: t.v, id: ulid(at), kind: 'tool.before', ts: at, data: { kind: 'shell', paths: [], command, call } });
    return call;
  }
  async toolEnd(key: string, call: string, at: number, command = 'npm test'): Promise<void> {
    const t = template('tool.after', (d) => d.outcome === 'ok');
    this.sd.at(at);
    await this.sd.record.append({ writer: 'hook', ...this.who(key), agent: 'claude-code' }, { v: t.v, id: ulid(at), kind: 'tool.after', ts: at, data: { kind: 'shell', paths: [], command, call, outcome: 'ok' } });
  }
  /** A stop, and with `claim` the claim the core makes of it; the claim's handle. The core then says the turn ended. */
  async stop(key: string, at: number, claim = true): Promise<string | undefined> {
    const turn = (this.turns.get(key) ?? 0) + 1;
    this.turns.set(key, turn);
    const t = template('agent.stop');
    this.sd.at(at);
    await this.sd.record.append({ writer: 'hook', ...this.who(key), agent: 'claude-code' }, { v: t.v, id: ulid(at), kind: 'agent.stop', ts: at, subject: this.subject(key), data: { turn, did_work: true, claim, cause: 'unknown', usage: null, outcome: 'finished' } });
    let handle: string | undefined;
    if (claim) {
      const c = template('claim.made');
      const id = ulid(at + 1);
      this.sd.at(at + 1);
      await this.sd.record.append({ writer: 'core', ...this.who(key) }, { v: c.v, id, kind: 'claim.made', ts: at + 1, data: { task_ref: `${this.subject(key)}#${turn - 1}`, attempt: 1, commit: '0'.repeat(40), scope: 'session', predictions: [], hash: sha256(`${this.subject(key)}#${turn - 1}`) } });
      handle = `claim:${id}`;
    }
    await this.put(key, 'core', 'session.attention', at + 2, { state: 'finished' }, { subject: this.subject(key), pick: (d) => d.state === 'working' });
    return handle;
  }
  /** The core's verdict on a claim; its handle. `evidence` is what it says is still missing, in every field that says it. */
  async verdict(key: string, claim: string, outcome: Outcome, at: number, evidence?: string): Promise<string> {
    const t = template('verdict.made', (d) => d.outcome === outcome);
    const id = ulid(at);
    const said = evidence === undefined ? {} : { reasons: [evidence], smallest: evidence, points_to: null, requirements: (t.data.requirements as Obj[]).map((r) => ({ ...r, smallest: evidence, points_to: null })) };
    this.sd.at(at);
    await this.sd.record.append({ writer: 'core', ...this.who(key) }, { v: t.v, id, kind: 'verdict.made', ts: at, subject: claim, data: { ...t.data, ...said, verdict: `verdict:${id}`, claim } });
    return `verdict:${id}`;
  }
  /** The verdict's commit moved. */
  async stale(key: string, verdict: string, at: number): Promise<void> { await this.put(key, 'core', 'verdict.stale', at, { verdict, because: 'commit moved' }); }
  async sentBack(key: string, claim: string, verdict: string, round: number, at: number): Promise<void> { await this.put(key, 'core', 'claim.sent_back', at, { claim, verdict, round, to: this.subject(key) }); }
  /** What a BLOCKED or INCONCLUSIVE claim still needs: its open item, naming the evidence that would close it. */
  async openItem(key: string, text: string, at: number): Promise<void> { await this.put(key, 'core', 'open_item.opened', at, { task_ref: `${this.subject(key)}#0`, text, item: sha256(text), from: 'verdict' }); }
  /** The hub found the session's process gone. */
  async gone(key: string, at: number): Promise<void> { await this.put(key, 'core', 'session.gone', at, {}, { subject: this.subject(key) }); }
  /** An ask the core raises for the session, through the asks core; its handle. */
  async ask(key: string, kind: 'taste' | 'choice' | 'unblock', question: string, at: number, deadline = at + 2 * DAY): Promise<string> {
    const row = askSources().find((r) => r.kind === kind && !/^(asks|request)\./.test(r.source)) ?? blocked(`ask.sources@1 has no row for ${kind}`);
    const data: Obj = { ...(structuredClone(row.fixture.ask) as Obj), question, deadline, key: sha256(`#2018 ${question}`), owner: 'you', fallback: 'you', provisional: false };
    this.sd.at(at);
    const handle = await this.sd.asks.raise({ writer: 'core', ...this.who(key) }, row.source, data);
    this.w.asks.push({ handle, question, session: this.s(key).id, key, default: String(data.default) });
    return handle;
  }
  /** The ask went moot, as the core closes one whose reason is gone. */
  async moot(key: string, handle: string, at: number): Promise<void> { await this.put(key, 'core', 'ask.moot', at, { because: 'window_reset', at }, { subject: handle, pick: (d) => d.because === 'window_reset' }); }
  /** The ask was answered with its default option, from `deep inbox answer`. */
  async answered(key: string, handle: string, at: number): Promise<void> {
    const option = this.w.asks.find((a) => a.handle === handle)?.default ?? blocked(`the fixture raised no ask ${handle}`);
    await this.put(key, 'core', 'ask.answered', at, { answer: option, plan_hash: null, decision: 'none', via: 'inbox' }, { subject: handle });
  }
  /** The asks core's clock reaches `at`: every ask past its deadline takes its default. */
  async tick(at: number): Promise<void> { this.sd.at(at); await this.sd.asks.tick(); }
}

/** One played session's hooks: each goes through the real hub's socket from a stand-in process of the session's own. */
export class Player {
  private readonly made = new Map<string, { s: Session; pid: number }>();
  constructor(private readonly hub: Hub, private readonly w: Pick<World, 'home' | 'repos' | 'sessions'>) {}
  /** A session of `agent` (Claude Code, unless said) in `repo`'s git folder; `prompt` is also its transcript's first message. */
  session(key: string, repo: string, prompt: string, agent: Session['agent'] = 'claude-code'): FixtureSession {
    const cwd = this.w.repos[repo] ?? blocked(`the fixture has no repo ${repo}`);
    const s = newSession(this.w.home, agent, cwd);
    writeFileSync(s.transcript, `${JSON.stringify({ type: 'user', sessionId: s.id, cwd, message: { role: 'user', content: prompt } })}\n`);
    const standIn = spawn('/bin/sleep', ['7200'], { stdio: 'ignore' });
    own(standIn.pid);
    this.made.set(key, { s, pid: standIn.pid! });
    return (this.w.sessions[key] = { key, id: s.id, repo, cwd });
  }
  async hook(key: string, event: string, extra: Obj = {}): Promise<void> {
    const m = this.made.get(key) ?? blocked(`no played session ${key}`);
    const r = await sendHook(this.hub.socket, { ...hookRequest(m.s, event, extra), pid: m.pid, ppid: m.pid }, 30_000);
    if (!r.ack) blocked(`the hub didn't acknowledge ${event} for ${key}: ${said(r, 600)}`);
  }
}

// ---- The fixture most criteria read (README, The fixture): eight sessions in three repos. One is played through a
// real hub's hooks, a Codex turn you interrupted; the rest are seeded a moment before the hub starts again, every time
// counted back from then.

/** What the BLOCKED claim's open item says would close it. */
export const EVIDENCE = 'a run of publish-check.sh';
/** Who owns that block: the unblock task's owner, and the verdict's next step's. */
export const OWNER = 'you';
export const STALE_ASK = 'Keep the cart on SQLite or plain files?';
export const DOCS_ASK = 'Which accent colour for the API guide?';
export const MOOT_ASK = 'Which header colour on the login page?';
export const UNBLOCK = 'Create a registry token for the publish check?';
export const TITLES = { needs: 'Cart totals', moot: 'Checkout page', working: 'Search box', blocked: 'Publish check', saysdone: 'Release notes', ask2: 'API guide', interrupted: 'tune the ranking' } as const;
export const MAIN_REPOS = ['shop', 'docs', 'search'] as const;
/** Steps with their times, played oldest first, so the record is appended in the order a hub would have appended it. */
export class Script {
  private readonly steps: { at: number; run: () => Promise<unknown> }[] = [];
  on(at: number, run: () => Promise<unknown>): void { this.steps.push({ at, run }); }
  async play(): Promise<void> {
    const order = this.steps.map((step, i) => ({ step, i })).sort((x, y) => x.step.at - y.step.at || x.i - y.i);
    for (const { step } of order) await step.run();
  }
}
/**
 * interrupted: a Codex session's turn (its start, a prompt, a shell call begun) that you interrupted, as Codex's own
 * Interrupt hook says it (#39): no stop and no claim. The hub's clock stands half an hour back while it plays. No task
 * is seeded for it: its name is its prompt, which is also the title of the task the base's hub makes of a Codex prompt.
 */
export async function playMain(p: Player): Promise<void> {
  p.session('interrupted', 'search', TITLES.interrupted, 'codex');
  await p.hook('interrupted', 'SessionStart');
  await p.hook('interrupted', 'UserPromptSubmit', { prompt: TITLES.interrupted });
  await p.hook('interrupted', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'call_2018_interrupted', tool_input: { command: 'npm test' } });
  await p.hook('interrupted', 'Interrupt');
}
export async function seedMain(s: Seeder, T: number): Promise<void> {
  const sc = new Script();
  /** A session's start, its task and its first prompt, a second apart. */
  const begin = (key: keyof typeof TITLES, repo: string, at: number, prompt: string): void => {
    sc.on(at, () => s.start(key, repo, at));
    sc.on(at + 1000, () => s.task(key, TITLES[key], at + 1000));
    sc.on(at + 2000, () => s.prompt(key, prompt, at + 2000));
  };
  // quiet: a session that started three days ago, with nothing since: no task, no prompt, no turn, no stop. A turn that
  // stopped with no claim is the table's finished row, which comes before quiet, so the fixture holds no turn at all.
  sc.on(T - 3 * DAY, () => s.start('quiet', 'search', T - 3 * DAY));
  // needs: a stop, its claim, PASS, the verdict gone stale, and an open ask.
  begin('needs', 'shop', T - 3 * HOUR, 'sum the cart');
  let claimed = '';
  let passed = '';
  sc.on(T - 42.5 * MIN, async () => { claimed = (await s.stop('needs', T - 42.5 * MIN))!; });
  sc.on(T - 40 * MIN, async () => { passed = await s.verdict('needs', claimed, 'PASS', T - 40 * MIN); });
  sc.on(T - 32.5 * MIN, () => s.stale('needs', passed, T - 32.5 * MIN));
  sc.on(T - 12.5 * MIN, () => s.ask('needs', 'choice', STALE_ASK, T - 12.5 * MIN));
  // blocked: a stop, its claim, BLOCKED, its open item, and its unblock task, which took its default.
  begin('blocked', 'docs', T - 2 * HOUR, 'publish the docs');
  let held = '';
  sc.on(T - 62.5 * MIN, async () => { held = (await s.stop('blocked', T - 62.5 * MIN))!; });
  sc.on(T - 60 * MIN, () => s.verdict('blocked', held, 'BLOCKED', T - 60 * MIN, EVIDENCE));
  sc.on(T - 60 * MIN + 1000, () => s.openItem('blocked', EVIDENCE, T - 60 * MIN + 1000));
  sc.on(T - 57.5 * MIN, () => s.ask('blocked', 'unblock', UNBLOCK, T - 57.5 * MIN, T - 27.5 * MIN));
  sc.on(T - 27 * MIN, () => s.tick(T - 27 * MIN));
  // moot: an ask that went moot, and a tool call still running.
  begin('moot', 'shop', T - 100 * MIN, 'restyle the checkout');
  let moot = '';
  sc.on(T - 52.5 * MIN, async () => { moot = await s.ask('moot', 'taste', MOOT_ASK, T - 52.5 * MIN); });
  sc.on(T - 47.5 * MIN, () => s.moot('moot', moot, T - 47.5 * MIN));
  sc.on(T - 7.5 * MIN + 6000, () => s.toolStart('moot', T - 7.5 * MIN + 6000));
  // says done: a stop that claims done, with no verdict yet.
  begin('saysdone', 'docs', T - 50 * MIN, 'write the release notes');
  let wrote = '';
  sc.on(T - 22.5 * MIN, async () => { wrote = await s.toolStart('saysdone', T - 22.5 * MIN); });
  sc.on(T - 22.5 * MIN + 9000, () => s.toolEnd('saysdone', wrote, T - 22.5 * MIN + 9000));
  sc.on(T - 17.5 * MIN, () => s.stop('saysdone', T - 17.5 * MIN));
  // ask2: an open ask in a second project.
  begin('ask2', 'docs', T - 45 * MIN, 'draft the API guide');
  sc.on(T - 7.5 * MIN, () => s.ask('ask2', 'taste', DOCS_ASK, T - 7.5 * MIN));
  // working: a tool call that started and hasn't ended.
  begin('working', 'shop', T - 30 * MIN, 'add a search box');
  sc.on(T - 2.5 * MIN, () => s.toolStart('working', T - 2.5 * MIN));
  await sc.play();
}
export const mainWorld = (): Promise<World> => makeWorld({ repos: MAIN_REPOS, play: playMain, seed: seedMain });

// ---- The generator's alphabet (AC2): each session a walk over the events a record holds of one. A step the walk
// can't take where it stands (a verdict with no claim to judge, an answer with no ask open) is passed over, so every
// walk is a record.

export const STEPS = ['task', 'prompt', 'toolStart', 'toolEnd', 'stop', 'claim', 'PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'stale', 'sentBack', 'ask', 'answer', 'moot', 'gone'] as const;
export type Step = (typeof STEPS)[number];
/** One session's walk; `old` puts it three days back. */
export interface Plan { old: boolean; steps: Step[] }
const VERDICTS: readonly Step[] = ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'];
/** What a walk leaves: which steps took, by index, and where it stands at its end. */
export interface Walk {
  took: boolean[];
  /** Asks open at the end. */
  asks: number;
  /** A tool call begun and not ended. */
  call: boolean;
  claim: boolean;
  /** The newest claim's verdict, when it has one. */
  verdict?: { outcome: Outcome; stale: boolean; sentBack: boolean };
  /** The steps that took after the newest claim. */
  after: Step[];
}
/** The one reading of which steps a walk can take; `seedPlans` appends exactly those. */
export function walk(steps: readonly Step[]): Walk {
  const w: Walk = { took: [], asks: 0, call: false, claim: false, after: [] };
  let tasked = false;
  for (const step of steps) {
    let took = true;
    if (step === 'task') { took = !tasked; tasked = true; }
    else if (step === 'toolStart') { took = !w.call; w.call = true; }
    else if (step === 'toolEnd') { took = w.call; w.call = false; }
    else if (step === 'claim') { w.claim = true; delete w.verdict; w.after = []; w.took.push(true); continue; }
    else if (VERDICTS.includes(step)) { took = w.claim && !w.verdict; if (took) w.verdict = { outcome: step as Outcome, stale: false, sentBack: false }; }
    else if (step === 'stale') { took = !!w.verdict && !w.verdict.stale; if (took) w.verdict!.stale = true; }
    else if (step === 'sentBack') { took = w.verdict?.outcome === 'FAIL'; if (took) w.verdict!.sentBack = true; }
    else if (step === 'ask') w.asks++;
    else if (step === 'answer' || step === 'moot') { took = w.asks > 0; if (took) w.asks--; }
    w.took.push(took);
    if (took && w.claim) w.after.push(step);
  }
  return w;
}
/** How many events of each kind a walk appends for its session, its start aside. */
export function walkEvents(steps: readonly Step[]): Record<string, number> {
  const took = walk(steps).took;
  const n = (...of: Step[]): number => steps.filter((s, i) => took[i] && of.includes(s)).length;
  return {
    'task.created': n('task'), 'user.ask': n('prompt'), 'tool.before': n('toolStart'), 'tool.after': n('toolEnd'), 'agent.stop': n('stop', 'claim'), 'claim.made': n('claim'),
    'verdict.made': n(...VERDICTS), 'verdict.stale': n('stale'), 'claim.sent_back': n('sentBack'), 'ask.created': n('ask'), 'ask.answered': n('answer'), 'ask.moot': n('moot'),
    'ask.defaulted': 0, 'session.gone': n('gone'),
  };
}
/** After a claim, the steps that leave the claim's row standing: its verdict, the verdict going stale, a send-back, and asks. */
const SETTLED: readonly Step[] = [...VERDICTS, 'stale', 'sentBack', 'ask', 'moot'];
/**
 * The first row of the one table a walk's record facts match, where the issue and the design leave no room (README,
 * Pinned 2). An open ask is needs you, the first row, whatever else the record holds. With no ask open, no answer
 * left to deliver, no process gone, no call left running, and nothing after the newest claim but its verdict, the
 * verdict going stale, a send-back and asks since gone moot, the row is the claim's: says done with no verdict yet;
 * BLOCKED, INVALID or INCONCLUSIVE for that verdict; PASS; stale for a PASS whose commit moved; sent back for a FAIL
 * that was sent back. Every other walk is left to the implementation: undefined.
 */
export function expected(steps: readonly Step[]): Word | undefined {
  const w = walk(steps);
  if (w.asks > 0) return 'needs you';
  const tookAny = (step: Step): boolean => steps.some((s, i) => s === step && w.took[i]);
  if (!w.claim || w.call || tookAny('gone') || tookAny('answer') || w.after.some((s) => !SETTLED.includes(s))) return undefined;
  const v = w.verdict;
  if (!v) return 'says done';
  if (v.outcome === 'PASS') return v.stale ? 'stale' : 'PASS';
  if (v.stale) return undefined;
  if (v.outcome === 'FAIL') return v.sentBack ? 'sent back' : undefined;
  return v.outcome;
}
/**
 * Each planned session's word against `expected`, for the sessions whose record holds exactly the events its walk
 * appended (`events`, the record's): a hub that wrote a verdict, an ask or a stop of its own to a session has given it
 * facts the walk doesn't know, and that session is left out. The failures, each naming the session and its row, and
 * how many sessions were judged.
 */
export function tableFailures(rows: readonly Row[], plans: readonly Plan[], ids: readonly string[], events: readonly { kind: string; session?: string }[], who: string): { failures: string[]; judged: number } {
  const failures: string[] = [];
  let judged = 0;
  plans.forEach((p, i) => {
    const id = ids[i]!;
    const want = expected(p.steps);
    const wrote = walkEvents(p.steps);
    if (!want || Object.entries(wrote).some(([kind, n]) => events.filter((e) => e.session === id && e.kind === kind).length !== n)) return;
    judged++;
    const got = rowOf(rows, id)?.word;
    if (got !== want) failures.push(`session ${id} (row session:${id}) reads ${said(got ?? 'no row')} in ${who}; the first row of the one state table its record facts match is "${want}"`);
  });
  return { failures, judged };
}
/**
 * Seeds the plans as sessions `s0`, `s1`, … over `repos` in turn, each session's newest event 11.5 min before `T` plus
 * 5 min a session, or three days more for an old one, its earlier events 7 s apart before that. A hub whose clock
 * starts at `T` so reads each event, while that hub is under 2 min old, at an age between 1.5 and 3.5 min past a whole
 * multiple of 5 min: no read sits on an age threshold. Every ask's deadline is two days after `T`.
 */
export async function seedPlans(s: Seeder, T: number, plans: readonly Plan[], repos: readonly string[]): Promise<void> {
  const sc = new Script();
  plans.forEach((p, i) => {
    const key = `s${i}`;
    const last = T - (11.5 + 5 * i) * MIN - (p.old ? 3 * DAY : 0);
    const at = (n: number): number => last - (p.steps.length - n) * 7000;
    const took = walk(p.steps).took;
    // The handles the steps that took left: the call running, the newest claim, its verdict, the open asks, the round.
    const state = { call: '', claim: '', verdict: '', asks: [] as string[], rounds: 0 };
    sc.on(at(0), () => s.start(key, repos[i % repos.length]!, at(0)));
    p.steps.forEach((step, n) => sc.on(at(n + 1), async () => {
      const t = at(n + 1);
      if (!took[n]) return;
      if (step === 'task') await s.task(key, `Task ${i}`, t);
      else if (step === 'prompt') await s.prompt(key, `step ${n} of session ${i}`, t);
      else if (step === 'toolStart') state.call = await s.toolStart(key, t);
      else if (step === 'toolEnd') await s.toolEnd(key, state.call, t);
      else if (step === 'stop') await s.stop(key, t, false);
      else if (step === 'claim') state.claim = (await s.stop(key, t, true))!;
      else if (VERDICTS.includes(step)) state.verdict = await s.verdict(key, state.claim, step as Outcome, t);
      else if (step === 'stale') await s.stale(key, state.verdict, t);
      else if (step === 'sentBack') await s.sentBack(key, state.claim, state.verdict, ++state.rounds, t);
      else if (step === 'ask') state.asks.push(await s.ask(key, n % 2 ? 'taste' : 'choice', `Question ${n} of session ${i}?`, t, T + 2 * DAY));
      else if (step === 'answer') await s.answered(key, state.asks.shift()!, t);
      else if (step === 'moot') await s.moot(key, state.asks.shift()!, t);
      else if (step === 'gone') await s.gone(key, t);
    }));
  });
  await sc.play();
}

/** Waits until the hub's log stops growing for `quietMs`; its last log_pos. */
export async function quiet(hub: Hub, quietMs = 1500, timeoutMs = 60_000): Promise<number> {
  const conn = await control(hub);
  try {
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    let since = Date.now();
    for (;;) {
      const page = (await conn.call('events.read', { after: Math.max(last, 0), limit: 1000 }, 30_000)).result as { events: Ev[] } | undefined;
      const pos = page?.events.at(-1)?.log_pos ?? last;
      if (pos !== last) { last = pos; since = Date.now(); }
      if (Date.now() - since >= quietMs || Date.now() > deadline) return last;
      await sleep(200);
    }
  } finally {
    conn.close();
  }
}
const HUB_START_MS = 120_000;
const hubOf = (w: Pick<World, 'home' | 'confirm'>, clock?: number): Promise<Hub> => startHub({ home: w.home, env: { DEEP_HUB_TEST_CONFIRM: w.confirm }, ...(clock === undefined ? {} : { clock }) }, HUB_START_MS);

type Made = Pick<World, 'home' | 'root' | 'confirm' | 'repos' | 'sessions' | 'asks' | 'at'>;
interface Making { repos: readonly string[]; play?: (p: Player) => Promise<void>; seed?: (s: Seeder, at: number) => Promise<void> }
/**
 * A record with no hub on it yet: each repo a git folder under one temp folder; `play`'s hooks through a real hub
 * whose clock started half an hour back; then, with that hub stopped, `seed`'s events through the record and asks
 * core; and `setup-finished.json`.
 */
export async function seedRecord(o: Making): Promise<Made> {
  const home = makeHome();
  const root = join(home, '.deepbuild');
  const base = tempDir();
  const confirm = join(base, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repos: Record<string, string> = {};
  for (const name of o.repos) {
    const dir = join(base, name);
    mkdirSync(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: dir } });
    repos[name] = dir;
  }
  const w = { home, root, confirm, repos, sessions: {} as Record<string, FixtureSession>, asks: [] as FixtureAsk[] };
  if (o.play) {
    // The played hooks are stamped half an hour back, so what is seeded after them, minutes back, comes after them.
    const first = await hubOf(w, Date.now() - 30 * MIN);
    await o.play(new Player(first, w));
    await quiet(first);
    // Each played session's project, as its own hooks' events carry it: what the core would raise its asks under.
    const conn = await control(first);
    const events = await allEvents(conn).finally(() => conn.close());
    for (const s of Object.values(w.sessions)) {
      const project = (events.find((e) => e.kind === 'session.start' && e.session === s.id) as (Ev & { project?: string }) | undefined)?.project;
      if (project) s.project = project;
    }
    await stopHub(first);
  }
  const at = Date.now();
  if (o.seed) await seed(home, (sd) => o.seed!(new Seeder(sd, w), at), at);
  mkdirSync(root, { recursive: true });
  // Setup finished in this home, so no `deep` command here runs it (#1002's marker, as #1172's world writes it).
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(root, 'setup-finished.json'), JSON.stringify({ version }));
  return { ...w, at };
}
/** Every event a stopped record holds, read through the record core. */
export async function recorded(w: { root: string }): Promise<{ kind: string; session?: string; data: unknown }[]> {
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: () => Date.now() });
  try { return await record.read({ after: 0, limit: 100_000 }); } finally { await record.close(); }
}
/**
 * A world: `seedRecord`'s record, and a real hub on it, with the OS confirmation stubbed `confirmed` (#24's
 * DEEP_HUB_TEST_CONFIRM). `frozen` starts that hub's clock, and each restart's, at the moment the fixture was made
 * (DEEP_HUB_TEST_CLOCK); it moves with real time from there, so every read of a frozen world is within its hub's short
 * life of that moment.
 */
export async function makeWorld(o: Making & { frozen?: true }): Promise<World> {
  needBuilds();
  const made = await seedRecord(o);
  const hub = await hubOf(made, o.frozen ? made.at : undefined);
  await quiet(hub);
  return { ...made, hub, ...(o.frozen ? { clock: made.at } : {}) };
}
/** Stops the world's hub by its PID and starts one again on the same record. */
export async function restart(w: World): Promise<void> {
  await stopHub(w.hub);
  w.hub = await hubOf(w, w.clock);
  await quiet(w.hub);
}

// ---- The readers.

/** `deep <args>` as you run it, from the test process (no agent above it); `plant` is DEEP_HUB_PLANT in its process only. */
export function deep(w: { home: string }, args: readonly string[], plant?: string): Promise<Ran> {
  return deep16(w.home, args, { env: { DEEP_HUB_PLANT: plant }, timeoutMs: 180_000 });
}
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${said(r.stdout, 1500)}, stderr ${said(r.stderr, 600)}`;

/** A row of the list (#1463's shape); `project`, `session` and `agent` are the base's too. */
export interface Row { id: string; title: string; word: string; entry: string; why: unknown; waits_on: unknown; since: unknown; unread: unknown; project?: unknown; session?: unknown; [key: string]: unknown }
export interface Rows { log_pos: number; rows: Row[] }
/** `deep status --json`: `{log_pos, rows}` (#1463). `down` reads a stopped hub's database, which exits 3. */
export async function statusRows(w: { home: string }, o: { plant?: string; down?: true } = {}): Promise<Rows> {
  const r = await deep(w, ['status', '--json'], o.plant);
  let parsed: unknown;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = undefined; }
  const p = parsed as Partial<Rows> | undefined;
  expect((o.down ? r.code === 0 || r.code === 3 : r.code === 0) && typeof p?.log_pos === 'number' && Array.isArray(p.rows), `deep status --json must print one JSON object {log_pos, rows}${o.down ? ' from the database' : ' and exit 0'}: ${shown(r)}`).toBe(true);
  return p as Rows;
}
export const rowOf = (rows: readonly Row[], session: string): Row | undefined => rows.find((r) => r.id === `session:${session}`);
/** Every line of a reader's text that holds `needle`. */
export const linesWith = (text: string, needle: string): string[] => text.split('\n').filter((l) => l.includes(needle));
/** A row as a reader's text lists it: the first line holding `needle`, and the lines indented under it, its detail. */
export function blockOf(text: string, needle: string): string {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.includes(needle));
  if (at < 0) return '';
  const indent = (l: string): number => l.length - l.trimStart().length;
  const out = [lines[at]!];
  for (const l of lines.slice(at + 1)) { if (!l.trim() || indent(l) <= indent(lines[at]!)) break; out.push(l); }
  return out.join('\n');
}

/** One fact `--why` names: a record event by its kind, its time and its log_pos (README, Pinned 5). */
export interface Fact { kind: string; ts: number; log_pos: number }
export interface Why { log_pos: number; id: string; word: string; why: string; facts: Fact[]; lacked: { row: string; fact: string }[] }
/** `deep status <session> --why --json` (README, Pinned 5). */
export async function whyOf(w: { home: string }, session: string, plant?: string): Promise<Why> {
  const r = await deep(w, ['status', session, '--why', '--json'], plant);
  let parsed: unknown;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = undefined; }
  expect(r.code === 0 && typeof parsed === 'object' && parsed !== null, `deep status <session> --why --json must exit 0 and print one JSON object (README, Pinned 5): ${shown(r)}`).toBe(true);
  return parsed as Why;
}

// ---- The replica, driven: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

export interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds: number[]; children: SNode[] }
export interface Snapshot { window: { size: number[]; scale: number }; tree: SNode; items: unknown[]; runs?: { text: string; bounds: number[] }[]; focus?: unknown; menu_bar?: { title?: string; items?: string[] } }
export interface Menu { title: string; items: { title: string; enabled?: boolean }[] }
export interface HubCall { method: string; params: Obj; error?: unknown }
export interface Seen { snapshot: Snapshot; rows: Row[]; log_pos: number; address: string | null; menus: Menu[]; hub: HubCall[] }
export interface Posted { ask: string | null; session: string; text: string }
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
export const byId = (s: Snapshot, id: string): SNode | undefined => flat(s.tree).find((n) => n.id === id);
const inside = (b: number[], box: number[]): boolean => b[0]! >= box[0]! - 1 && b[1]! >= box[1]! - 1 && b[0]! + b[2]! <= box[0]! + box[2]! + 1 && b[1]! + b[3]! <= box[1]! + box[3]! + 1;
/** Everything a node holds in words: the names and string values of its subtree, and the strings drawn inside it. */
export function wordsOf(s: Snapshot, n: SNode | undefined): string {
  if (!n) return '';
  const own = flat(n).flatMap((x) => [x.name ?? '', typeof x.value === 'string' ? x.value : '']);
  return [...own, ...(s.runs ?? []).filter((r) => inside(r.bounds, n.bounds)).map((r) => r.text)].filter(Boolean).join('\n');
}
/** The replica's clock ticks in flicks, 705,600,000 a second (crates/deep-replica/src/drive/mod.rs). */
const FLICKS = 705_600_000;

export class Replica {
  private buffer = '';
  private readonly waiting: ((line: Obj) => void)[] = [];
  private exited = false;
  private err = '';
  private t = 0;
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let parsed: Obj;
        try { parsed = JSON.parse(line) as Obj; } catch { parsed = { unparsed: line }; }
        this.waiting.shift()?.(parsed);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); });
  }
  /** A replica over a copy of the world's record (`record_copy` reads the hub in its HOME); `plant` is DEEP_HUB_PLANT in the env-plants build. */
  static async of(w: { home: string }, plant?: string, build: 'plain' | 'plants' = plant ? 'plants' : 'plain'): Promise<Replica> {
    const out = join(tempDir(), 'out');
    mkdirSync(out, { recursive: true });
    const child = spawn(driveBinaries()[build], ['--out', out], { cwd: REPO, env: childEnv(w.home, { DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const r = new Replica(child);
    const ready = await r.next(300_000);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready, 300)} ${r.err.slice(-600)}`);
    await r.must('launching the replica on a copy of the record', { call: 'launch', launch: { from: 'record_copy' } });
    return r;
  }
  private next(ms: number): Promise<Obj> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call and its reply; BLOCKED when the binary gives none. */
  async call(args: Obj): Promise<Obj> {
    const reply = this.next(300_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${said(got, 300)} ${this.err.slice(-600)}`);
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }
  /** One call that must answer ok; else a failure naming `what` and the replica's own error. */
  async must(what: string, args: Obj): Promise<Obj> {
    const reply = await this.call(args);
    if (reply.ok !== true) throw Error(`${what}: ${said(reply.error ?? reply, 400)}`);
    return reply;
  }
  async see(): Promise<Seen> {
    const r = await this.must('see', { call: 'see' });
    return { snapshot: r.snapshot as Snapshot, rows: (r.rows ?? []) as Row[], log_pos: r.log_pos as number, address: (r.address ?? null) as string | null, menus: (r.menus ?? []) as Menu[], hub: (r.hub ?? []) as HubCall[] };
  }
  /** Lets the replica's clock run `ms` of virtual time with no input. */
  wait(ms: number): Promise<Obj> { return this.must(`waiting ${ms} ms`, { call: 'wait_for', wait_for: { t: this.t + Math.round((ms * FLICKS) / 1000) }, timeout: ms + 2000 }); }
  open(address: string): Promise<Obj> { return this.must(`deep_drive's open of ${address}`, { call: 'open', open: { address } }); }
  /** Picks a menu bar item, as a click on it would (#1461); its reply, ok or not. */
  menu(path: string[]): Promise<Obj> { return this.call({ call: 'act', act: { kind: 'menu', path } }); }
  /** Types where the caret is: no locator, so nothing is clicked first. */
  type(text: string): Promise<Obj> { return this.must(`typing "${text}"`, { call: 'act', act: { kind: 'type', text } }); }
  press(keys: string): Promise<Obj> { return this.must(`pressing ${keys}`, { call: 'act', act: { kind: 'press', keys } }); }
  /** Closes the replica; what it posted as notifications, from its trace. */
  async close(): Promise<Posted[]> {
    const closed = await this.must('close', { call: 'close' });
    return ((JSON.parse(readFileSync(String(closed.trace.path), 'utf8')) as { notifications?: Posted[] }).notifications ?? []);
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

/**
 * The app's list and `deep status --json` read at one log_pos: the status read before the replica's copy, or after it,
 * whichever has the copy's log_pos. The replica stays open for the caller.
 */
export async function atOneLogPos(w: World, plant?: string): Promise<{ r: Replica; seen: Seen; status: Rows }> {
  await quiet(w.hub);
  const before = await statusRows(w);
  const r = await Replica.of(w, plant);
  try {
    const seen = await r.see();
    if (before.log_pos === seen.log_pos) return { r, seen, status: before };
    const after = await statusRows(w);
    expect(after.log_pos, `deep status --json read log_pos ${before.log_pos} and ${after.log_pos} around the app's copy at ${seen.log_pos}: no read at one log_pos`).toBe(seen.log_pos);
    return { r, seen, status: after };
  } catch (error) {
    await r.stop();
    throw error;
  }
}

// ---- The kit, as `deep install` runs it: `deep-replica --view-kit session.row@1 <dir>` (README, Pinned 1).

export interface KitRun { code: number | null; verdict: { result?: string; names?: string } | null; said: string }
/** Runs `session.row@1` on a copy of the fixture view `name`, its `SKIP` list set to `skip`: the rows it draws right. */
export function viewKit(name: string, skip: readonly string[] = []): KitRun {
  const copy = join(tempDir(), 'view');
  cpSync(join(VIEWS, name), copy, { recursive: true });
  const main = join(copy, 'main.js');
  const source = readFileSync(main, 'utf8');
  if (!source.includes('const SKIP = [];')) blocked(`${name}/main.js has no SKIP list to set`);
  writeFileSync(main, source.replace('const SKIP = [];', `const SKIP = ${JSON.stringify(skip)};`));
  let stdout = '';
  let stderr = '';
  let code: number | null = 0;
  try {
    stdout = execFileSync(kitBinary(), ['--view-kit', 'session.row@1', copy], { cwd: REPO, env: childEnv(makeHome(), {}), stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 }).toString();
  } catch (error) {
    const e = error as { status?: number | null; stdout?: Buffer; stderr?: Buffer };
    code = e.status ?? null;
    stdout = e.stdout?.toString() ?? '';
    stderr = e.stderr?.toString() ?? '';
  }
  let verdict: KitRun['verdict'] = null;
  try { verdict = JSON.parse(stdout.trim().split('\n').pop() ?? '') as KitRun['verdict']; } catch { verdict = null; }
  return { code, verdict, said: `exit ${code}: ${stdout.slice(-300)} ${stderr.slice(-300)}`.trim() };
}
/** The row a failing verdict names: its `names` starts with the row's id, `session:<id>`. */
export const rowNamed = (run: KitRun): string | undefined => /^session:[0-9A-Za-z-]+/.exec(run.verdict?.names ?? '')?.[0];
/**
 * A wrong replacement sidebar against the kit, run again with each row the kit names drawn right, until it passes:
 * the rows the kit named, in order, and what was wrong with a run. A kit that names a row the view drew right names it
 * again once that row is in the skip list, which is a failure here; so each name is a row that was wrong.
 */
export function namedUntilPass(run: (skip: readonly string[]) => KitRun, most = 60): { named: string[]; failures: string[] } {
  const named: string[] = [];
  for (let i = 0; i <= most; i++) {
    const kit = run(named);
    if (kit.verdict === null) return { named, failures: [`the kit gave no verdict line: ${kit.said}`] };
    if (kit.verdict.result === 'pass') return { named, failures: kit.code === 0 ? [] : [`a passing kit exits 0, not ${kit.code}`] };
    const row = rowNamed(kit);
    if (kit.verdict.result !== 'fail' || kit.code !== 1) return { named, failures: [`a failing kit says {"result":"fail"} and exits 1: ${kit.said}`] };
    if (!row) return { named, failures: [`the kit failed naming no row: its names is ${said(kit.verdict.names)}, which starts with no session:<id>`] };
    if (named.includes(row)) return { named, failures: [`the kit names ${row} again after that row was drawn right: it doesn't name the row that is wrong (${said(kit.verdict.names)})`] };
    named.push(row);
  }
  return { named, failures: [`the kit still fails after ${most} rows were drawn right`] };
}

// ---- Judges (judges.test.ts holds each to a right input and the wrong ones). Each returns what's wrong, or nothing.

/** Each session has exactly one row, and its word is a row of the one state table, with that row's entry. */
export function stateFailures(rows: readonly Row[], sessions: readonly string[], who: string): string[] {
  const out: string[] = [];
  for (const id of sessions) {
    const mine = rows.filter((r) => r.id === `session:${id}`);
    if (mine.length !== 1) { out.push(`session ${id} has ${mine.length} rows in ${who}, not exactly one state`); continue; }
    const row = mine[0]!;
    const at = TABLE.find(([word]) => word === row.word);
    if (FLAGS.includes(String(row.word))) out.push(`session ${id} (row ${row.id}) reads ${said(row.word)} as its state in ${who}: a flag beside one of the fourteen state words, not a state`);
    else if (!at) out.push(`session ${id} (row ${row.id}) reads ${said(row.word)} in ${who}, which is no row of the one state table (${WORDS.join(', ')})`);
    else if (row.entry !== at[1]) out.push(`session ${id} (row ${row.id}) reads "${row.word}" with entry ${said(row.entry)} in ${who}; the table gives "${row.word}" the entry ${at[1]}`);
  }
  return out;
}
/** Each session's word in one read against another: the same state. */
export function sameFailures(a: readonly Row[], b: readonly Row[], sessions: readonly string[], whoA: string, whoB: string): string[] {
  return sessions.flatMap((id) => {
    const [x, y] = [rowOf(a, id)?.word, rowOf(b, id)?.word];
    return x === y ? [] : [`session ${id} reads ${said(x ?? 'no row')} ${whoA} and ${said(y ?? 'no row')} ${whoB}`];
  });
}
/** One surface's reading of a session that needs you: it says needs you, and names no other state beside it. */
export function needsYouFailures(surface: string, text: string, session: string, other?: string): string[] {
  if (!/\bneeds you\b/.test(text)) return [`the ${surface} reads ${said(text)} for session ${session}, not needs you`];
  return other && new RegExp(`\\b${other}\\b`, 'i').test(text) ? [`the ${surface} reads ${said(text)} for session ${session}: "${other}" beside needs you, a second state`] : [];
}
/** A BLOCKED row with no open ask reads "BLOCKED · waits for <owner>: <evidence>"; a bare BLOCKED names the row. */
export function blockedFailures(text: string, row: string, owner: string, evidence: string, who: string): string[] {
  const want = `BLOCKED · waits for ${owner}: ${evidence}`;
  if (text.includes(want)) return [];
  if (/\bBLOCKED\b/.test(text)) return [`row ${row} reads a bare BLOCKED in ${who}: ${said(text)} lacks "waits for ${owner}: ${evidence}"`];
  return [`row ${row} doesn't read BLOCKED in ${who}: ${said(text)} lacks "${want}"`];
}
/** What a node of the tree reads as one text: the name or string value in its subtree that holds `needle`, else all of them. */
export function readingOf(n: SNode | undefined, needle: string): string {
  const texts = n ? flat(n).flatMap((x) => [x.name ?? '', typeof x.value === 'string' ? x.value : '']).filter(Boolean) : [];
  return texts.find((t) => t.includes(needle)) ?? texts.join('\n');
}
/** The BLOCKED row in `--json`: its word, whom it waits for, and its open item's evidence somewhere in the row. */
export function blockedRowFailures(row: Row | undefined, id: string, owner: string, evidence: string, who = 'deep status --json'): string[] {
  if (row?.word !== 'BLOCKED') return [`row ${id} doesn't read BLOCKED in ${who}: its word is ${said(row?.word ?? 'no row')}`];
  const lacks = [...(row.waits_on === owner ? [] : [`waits_on is ${said(row.waits_on)}, not "${owner}"`]), ...(JSON.stringify(row).includes(evidence) ? [] : [`no field holds "${evidence}"`])];
  return lacks.length ? [`row ${id} reads a bare BLOCKED in ${who}: ${lacks.join(', and ')}`] : [];
}
/** A heading's count: its value as a whole number, when it shows one. */
export function countOf(n: SNode): number | undefined {
  const v = typeof n.value === 'number' ? String(n.value) : typeof n.value === 'string' ? n.value.trim() : '';
  return /^\d+$/.test(v) ? Number(v) : undefined;
}
/**
 * Every group count the list shows against the list it opens (README, Pinned 3): Needs you's is its ask rows, drawn
 * and in `rows`; a project's is the open asks of that project in `rows`. A failure names the group.
 */
export function groupCountFailures(s: Snapshot, rows: readonly Row[], who = "the app's list"): string[] {
  const out: string[] = [];
  const nodes = flat(s.tree);
  const headings = nodes.filter((n) => typeof n.id === 'string' && n.id.startsWith('heading:'));
  const asks = rows.filter((r) => r.id.startsWith('ask:'));
  let counted = 0;
  for (const h of headings) {
    const n = countOf(h);
    if (n === undefined) continue;
    counted++;
    const group = String(h.id).slice('heading:'.length);
    const mine = group === 'needs-you' ? asks : asks.filter((r) => r.project === group);
    if (n !== mine.length) out.push(`group ${String(h.id)} ("${h.name ?? ''}") shows the count ${n} in ${who}, and the list it opens holds ${mine.length} open ask${mine.length === 1 ? '' : 's'} (${mine.map((r) => r.id).join(', ') || 'none'})`);
    if (group === 'needs-you') {
      const drawn = nodes.filter((x) => typeof x.id === 'string' && /^ask:[0-9A-Za-z]+$/.test(x.id)).length;
      if (n !== drawn) out.push(`group ${String(h.id)} ("${h.name ?? ''}") shows the count ${n} in ${who} over ${drawn} ask row${drawn === 1 ? '' : 's'} drawn under it`);
    }
  }
  if (!counted) out.push(`no group of ${who} shows a count: no heading:<group> node is valued a whole number (README, Pinned 3)`);
  return out;
}
/**
 * One surface's name for a session: it holds `name`; with `own` (a row another would otherwise read the same as) it
 * holds that short ID, else no form of the session's ID and no "Session <ID>"; and never another session's ID.
 */
export function nameFailures(surface: string, text: string, s: { id: string }, name: string, o: { twin?: { id: string } } = {}): string[] {
  const out: string[] = [];
  const held = (id: string): string | undefined => idForms(id).find((f) => text.toLowerCase().includes(f.toLowerCase()));
  if (!text.includes(name)) {
    const untitled = /\bSession\b/.test(text) && held(s.id);
    out.push(`the ${surface} reads ${said(text)} for session ${s.id}, not its name "${name}"${untitled ? `: it shows "Session" and the ID ${untitled}` : ''}`);
  }
  if (o.twin) {
    if (!text.includes(shortId(s.id))) out.push(`the ${surface} reads ${said(text)} for session ${s.id}: two sessions read "${name}" and this one doesn't add its short ID ${shortId(s.id)}`);
    const theirs = held(o.twin.id);
    if (theirs) out.push(`the ${surface} reads ${said(text)} for session ${s.id}, which holds the other session's ID ${theirs}`);
  } else {
    const mine = held(s.id);
    if (mine && text.includes(name)) out.push(`the ${surface} reads ${said(text)} for session ${s.id}: it shows the ID ${mine}, though no other row reads "${name}"`);
  }
  return out;
}
/** A sentence with each length of time in it made a placeholder, so two reads a tick apart compare. */
export const ageless = (text: string): string => text.replace(/\b\d+ ?(?:s|min|h|d)\b/g, '<t>');
/**
 * `--why` against the row it explains and the record (README, Pinned 5): its shape; its word is the row's, the
 * table's; its sentence is the row's `why`; every fact exists at its log_pos with its kind and time; and it names, for
 * each row of the table above its own, in the table's order, the fact that row lacked. A failure names the session and
 * the row.
 */
export function whyFailures(why: Why, row: Row | undefined, events: readonly Pick<Ev, 'kind' | 'ts' | 'log_pos'>[], session: string): string[] {
  const at = `session ${session} (row session:${session})`;
  if (!row) return [`${at} has no row in deep status --json`];
  const out: string[] = [];
  const w = why as Partial<Why> | null;
  if (typeof w?.log_pos !== 'number' || typeof w.word !== 'string' || typeof w.why !== 'string' || !Array.isArray(w.facts) || !Array.isArray(w.lacked)) return [`${at}: --why --json lacks log_pos, word, why, facts or lacked (README, Pinned 5): ${said(why, 400)}`];
  if (w.id !== `session:${session}`) out.push(`${at}: --why --json names the row ${said(w.id)}`);
  if (w.word !== row.word) out.push(`${at}: --why says ${said(w.word)} for a row the table reads as ${said(row.word)}`);
  else if (!WORDS.includes(w.word)) out.push(`${at}: --why says ${said(w.word)}, which is no row of the one state table`);
  if (!w.why.trim() || w.why.includes('\n')) out.push(`${at}: --why's sentence ${said(w.why)} is not one sentence`);
  if (ageless(w.why) !== ageless(String(row.why))) out.push(`${at}: --why's sentence ${said(w.why)} is not the row's why ${said(row.why)}`);
  if (!w.facts.length) out.push(`${at}: --why names no record fact`);
  for (const f of w.facts) {
    const e = events.find((x) => x.log_pos === f?.log_pos);
    if (!e) out.push(`${at}: --why names ${said(f)}, and the record holds no event at log_pos ${said(f?.log_pos)}`);
    else if (e.kind !== f.kind || e.ts !== f.ts) out.push(`${at}: --why names ${said(f)}, and the event at log_pos ${f.log_pos} is ${e.kind} at ${e.ts}`);
  }
  const above = WORDS.slice(0, Math.max(0, WORDS.indexOf(w.word)));
  const lacked = w.lacked.map((l) => l?.row);
  if (WORDS.includes(w.word) && JSON.stringify(lacked) !== JSON.stringify(above)) out.push(`${at}: --why names what these rows lacked: ${said(lacked)}; the rows above "${w.word}" in the table are ${said(above)}`);
  for (const l of w.lacked) if (typeof l?.fact !== 'string' || !l.fact.trim()) out.push(`${at}: --why says nothing of what the row ${said(l?.row)} lacked`);
  return out;
}
/** The state recomputed from only the facts `--why` named against the word it gave. */
export function recomputeFailures(why: Pick<Why, 'word'>, recomputed: string | undefined, session: string): string[] {
  return recomputed === why.word ? [] : [`session ${session} (row session:${session}): the state recomputed from only the facts --why names is ${said(recomputed ?? 'no row')}, not ${said(why.word)}`];
}
/** `--why` as text: the sentence, and each fact by its event kind and its log_pos on one line. */
export function whyTextFailures(text: string, why: Pick<Why, 'why' | 'facts'>, session: string): string[] {
  const out: string[] = [];
  if (!ageless(text).includes(ageless(why.why))) out.push(`session ${session}: deep status --why doesn't print the sentence ${said(why.why)}: ${said(text, 400)}`);
  for (const f of why.facts) if (!text.split('\n').some((l) => l.includes(f.kind) && new RegExp(`\\b${f.log_pos}\\b`).test(l))) out.push(`session ${session}: deep status --why has no line naming the fact ${f.kind} at log_pos ${f.log_pos}`);
  return out;
}

// ---- Rename (README, Pinned 6): the Session menu's item, the caret in the page's title, and what Return saves.

/** The Session menu's Rename item's title, or why there is no way to rename. */
export function renameItem(menus: readonly Menu[]): { title?: string; failures: string[] } {
  const session = menus.find((m) => m.title === 'Session');
  if (!session) return { failures: [`no way to rename: the menu bar has no Session menu (${menus.map((m) => m.title).join(', ')})`] };
  const item = session.items.find((i) => /^Rename\b/.test(i.title));
  if (!item) return { failures: [`no way to rename: the Session menu has no Rename item (${session.items.map((i) => i.title).join(', ')})`] };
  return item.enabled === false ? { failures: [`no way to rename: the Session menu's ${item.title} is disabled with a session's page open`] } : { title: item.title, failures: [] };
}
/** After Rename: the caret is in the page's title, a text field holding the session's name. */
export function caretFailures(s: Snapshot, name: string): string[] {
  const title = byId(s, 'page-title');
  if (!title) return ['no way to rename: the page has no title (no node page-title)'];
  const focus = typeof s.focus === 'string' ? flat(title).find((n) => n.id === s.focus) : undefined;
  if (!focus) return [`no way to rename: Rename put the caret in ${said(s.focus ?? 'nothing')}, not in the page's title`];
  const out: string[] = [];
  if (!/text_input$/.test(focus.role)) out.push(`Rename focused ${said(focus.id)} in the page's title, a ${focus.role}, not a text field with a caret`);
  if (!wordsOf(s, focus).includes(name)) out.push(`the title field Rename opened holds ${said(wordsOf(s, focus))}, not the session's name "${name}"`);
  return out;
}
/** After Return: the session's row and its page's title read the new name, and no longer the old one. */
export function savedFailures(s: Snapshot, session: string, name: string, was: string): string[] {
  const out: string[] = [];
  const row = wordsOf(s, byId(s, `session:${session}`));
  const slot = byId(s, `session:${session}:title`)?.name;
  if (slot !== name) out.push(`row session:${session}'s title reads ${said(slot ?? null)} after Return, not "${name}"`);
  if (row.includes(was)) out.push(`row session:${session} still reads "${was}" after Return: ${said(row)}`);
  const title = wordsOf(s, byId(s, 'page-title'));
  if (!title.includes(name)) out.push(`the page's title reads ${said(title)} after Return, not "${name}"`);
  return out;
}
/** The calls the app sent its hub that name the session and its new name: what a rename saves. */
export function renameCalls(calls: readonly HubCall[], session: string, name: string): { calls: HubCall[]; failures: string[] } {
  const named = calls.filter((c) => { const p = JSON.stringify(c.params ?? null); return (p.includes(session) || p.includes(letters(session))) && p.includes(JSON.stringify(name).slice(1, -1)); });
  if (!named.length) return { calls: [], failures: [`Return sent the hub no call naming session ${session} and "${name}": ${said(calls.map((c) => c.method))}`] };
  return { calls: named, failures: named.filter((c) => c.error !== undefined).map((c) => `the replica's hub refused the app's ${c.method}: ${said(c.error)}`) };
}

/**
 * A fresh record holding only the events at `positions` of the world's record, in log order, each appended as its
 * writer appended it, and a hub on it whose clock starts at `now`: the word it reads for the session.
 */
export async function recompute(w: World, positions: readonly number[], session: string, now: number): Promise<string | undefined> {
  const conn = await control(w.hub);
  const all = await allEvents(conn).finally(() => conn.close());
  const picked = all.filter((e) => positions.includes(e.log_pos)).sort((a, b) => a.log_pos - b.log_pos);
  const home = makeHome();
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // The evidence the facts cite, by hash: the store is content-addressed, so a copy holds no fact of its own.
  if (existsSync(join(w.root, 'evidence'))) cpSync(join(w.root, 'evidence'), join(root, 'evidence'), { recursive: true });
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  try {
    for (const e of picked as (Ev & { v?: number; project?: string; agent?: string })[]) {
      await record.append(
        { writer: e.writer, actor: e.actor, scope: e.scope, ...(e.session ? { session: e.session } : {}), ...(e.project ? { project: e.project } : {}), ...(e.agent ? { agent: e.agent } : {}) },
        { v: e.v ?? 1, id: e.id, kind: e.kind, ts: e.ts, ...(e.subject ? { subject: e.subject } : {}), ...(e.seq ? { seq: String(e.seq) } : {}), data: e.data, evidence: e.evidence ?? [] },
      );
    }
  } finally {
    await record.close();
  }
  writeFileSync(join(root, 'setup-finished.json'), readFileSync(join(w.root, 'setup-finished.json')));
  const hub = await startHub({ home, clock: now, env: { DEEP_HUB_TEST_CONFIRM: w.confirm } }, HUB_START_MS);
  try {
    await quiet(hub);
    return rowOf((await statusRows({ home })).rows, session)?.word;
  } finally {
    await stopHub(hub);
  }
}

/**
 * The log replayed on a copy of a stopped world's record: every projection dropped and rebuilt from the events
 * (`rebuild`, the record's own replay), then read with no hub. Its rows and the log_pos they stand at.
 */
export async function replayed(w: World): Promise<Rows> {
  const home = makeHome();
  // The hub's folder but its socket: a copy takes files, and a stopped hub may have left the socket behind.
  cpSync(w.root, join(home, '.deepbuild'), { recursive: true, filter: (from) => !lstatSync(from).isSocket() });
  const record = await openRecord({ path: join(home, '.deepbuild', 'ledger.db'), now: () => Date.now() });
  try { await record.rebuild(); } finally { await record.close(); }
  return statusRows({ home }, { down: true });
}
