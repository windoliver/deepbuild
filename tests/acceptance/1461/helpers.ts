// Test-side tools for #1461 (README). Every fixture is a record a real hub made: sessions, titles, states and asks are
// seeded through the record and asks core with the hub stopped (#26's `seed`), and a real hub (`deep hub run`) then
// builds the list's rows (`row.set`) the way it builds them for anyone. The app is read two ways: the real `deep-drive`
// (#124), launched with `launch.from: "record_copy"` in the world's HOME so it copies that hub's record, driven over its
// stdin on its virtual clock; and, where a criterion names the real app, the real `deep-app` read from outside its
// process with #1459's and #1454's probes. Events fed to a running replica are the ones the hub writes for the change,
// each `row.set` placed by the hub's own `orderOf` (packages/hub/dist/rows.js).
//
// Reused by import: #16's homes, hub, hooks, connections, temp folders and PID cleanup; #26's seeding; #1463's
// `deep`, `deep status --json` and `quiet`; #1459's probe (tree with identifiers); #1454's real-app driver and pictures;
// #1551's reference-Mac gate.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; no test touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { askSources } from '../../../packages/asks/src/index.ts';
import { childEnv, cleanup as cleanup16, makeHome, newSession, own, REPO, sleep, startHub, tempDir, type Hub, type Session } from '../16/helpers.ts';
import { askData, cleanup as cleanup26, seed, sha256, ulid } from '../26/helpers.ts';
import { deep, jsonRows, quiet, type Row } from '../1463/helpers.ts';

export { deep, jsonRows, REPO, sleep, tempDir, type Hub, type Row, type Session };
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const FIXTURES = join(SUITE, 'fixtures');
export const cleanup = async (): Promise<void> => { await cleanup16(); await cleanup26(); };
export const MIN = 60_000;
export const SECOND = 1000;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

/** The criteria, by `#1461.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  realApp: '#1461.0fe5469a',
  twice: '#1461.f6f74e03',
  opensOn: '#1461.a76b84c6',
  answerNext: '#1461.c3edd46c',
  unreadClears: '#1461.2a4294f3',
  names: '#1461.2829325f',
  needsYouKit: '#1461.a07a4336',
  areas: '#1461.f52d256a',
  budget: '#1461.6d2351eb',
  rowSlots: '#1461.52fe1d2f',
  lane: '#1461.60e6f710',
  firstSighting: '#1461.3783feb3',
  leaveWaits: '#1461.88d0792f',
  oneLine: '#1461.5656e667',
  hiccup: '#1461.59067fcc',
  oneField: '#1461.7b00f436',
  presence: '#1461.120f6702',
  pressDropped: '#1461.c16105e5',
  waitKinds: '#1461.d5aa2f05',
  empties: '#1461.ca4ce66c',
  afterSetUp: '#1461.140dcfed',
  firstLaunch: '#1461.4d23f757',
  sayNo: '#1461.731bc2c6',
  focusKeeps: '#1461.fc59e373',
  pressLands: '#1461.97cc6522',
  boxGrows: '#1461.a732cea0',
  askWords: '#1461.a024b727',
  shown: '#1461.b6f49051',
  sidebarArea: '#1461.c706a4a7',
} as const;

/** The replica's clock ticks in flicks, 705,600,000 a second (crates/deep-replica/src/drive/mod.rs); a frame is a 60th. */
export const FLICKS = 705_600_000;
export const FRAME = FLICKS / 60;
export const flicks = (ms: number): number => Math.round((ms * FLICKS) / 1000);
/** The reference window and the window the app opens at, in points; pictures and bounds are at 2×. */
export const REFERENCE = { width: 1512, height: 982 } as const;
export const SMALL = { width: 960, height: 640 } as const;
export const SCALE = 2;
/** Points to device pixels. */
export const px = (pt: number): number => pt * SCALE;

// ---- Builds (README, How to run). #1172's build environment, each binary copied out of the target folder under its own
// name, so a plant's build never stands in for the plain one; the plain build of each package is the last one made.

const BIN = join(tmpdir(), `dd1461-bin-${userInfo().uid}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const built = new Map<string, Promise<string>>();
function cargo(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: CARGO_ENV, maxBuffer: 64 * 1024 * 1024 }, (error, _out, stderr) => {
      if (!error) return resolve();
      reject(Error(`BLOCKED: cargo build ${args.join(' ')} failed: ${String(stderr).split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n') || String(stderr).slice(-600)}`));
    });
  });
}
function binary(pkg: string, name: string, features: string[], key: string): Promise<string> {
  let made = built.get(key);
  if (!made) {
    made = (async () => {
      if (process.platform !== 'darwin') blocked(`the replica and the app draw on macOS only; this is ${process.platform}`);
      mkdirSync(BIN, { recursive: true });
      await cargo(['-p', pkg, '--bin', name, ...(features.length ? ['--features', features.join(',')] : [])]);
      const out = join(BIN, key);
      copyFileSync(target(name), out);
      return out;
    })();
    built.set(key, made);
  }
  return made;
}
/**
 * The replica: `deep-drive` with deep-app's `test-confirm` (a file stands in for the OS confirming you, as #1454's app
 * has it), and with `env-plants` too when `planted`, so `DEEP_HUB_PLANT` selects a wrong program (README, Pinned 8).
 */
export async function replicaBin(planted = false): Promise<string> {
  const plain = binary('deep-replica', 'deep-drive', ['deep-app/test-confirm'], 'deep-drive-plain');
  if (!planted) return plain;
  await plain;
  return binary('deep-replica', 'deep-drive', ['env-plants', 'deep-app/test-confirm'], 'deep-drive-plants');
}
/** The real app: plain, with `env-plants`, or with `test-confirm` (the recording answers asks through the card). */
export function appBin(kind: 'plain' | 'plants' | 'confirm'): Promise<string> {
  const features = { plain: [], plants: ['env-plants'], confirm: ['test-confirm'] }[kind];
  return binary('deep-app', 'deep-app', features, `deep-app-${kind}`);
}
/** The CLI and deep-hook a hub needs: built, or BLOCKED (never a pass). */
export function needBuilds(): void {
  if (!existsSync(join(REPO, 'packages/cli/dist/main.js'))) blocked('no built CLI at packages/cli/dist/main.js; run npm run build --workspaces first');
  if (!existsSync(join(REPO, 'packages/hub/dist/rows.js'))) blocked('no built hub at packages/hub/dist/rows.js; run npm run build --workspaces first');
  if (!existsSync(target('deep-hook'))) {
    try { execFileSync('cargo', ['build', '--locked', '-q', '-p', 'deep-hook', '--bin', 'deep-hook'], { cwd: REPO, env: CARGO_ENV, stdio: 'ignore' }); } catch { blocked('cargo build -p deep-hook failed'); }
  }
}

// ---- The world (README, The fixtures): sessions seeded in git folders named for their projects, then a real hub.

export interface AskSpec { kind: 'authority' | 'taste' | 'choice'; question: string; plan?: { does: string; changes: string[] } }
export interface SessionSpec { key: string; project: string; title: string; state?: 'working' | 'finished' | 'failed'; asks?: AskSpec[]; archived?: true }
export interface WorldSession { key: string; id: string; project: string; title: string; session: Session }
export interface WorldAsk { handle: string; question: string; kind: AskSpec['kind']; session: string; key: string; options: { id: string; label: string; decision: string }[] }
export interface World { home: string; root: string; hub: Hub; sessions: WorldSession[]; asks: WorldAsk[]; seededAt: number }
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const sourceOf = (kind: string): string => askSources().find((r) => r.kind === kind && !/^(asks|request)\./.test(r.source))?.source ?? blocked(`ask.sources@1 has no row for ${kind}`);

/**
 * Seeds `specs` in order, a minute apart, the last a minute before now: each session's start in `<base>/<project>` (a git
 * folder, so the hub names its project by the folder), its task's title, its state (`session.attention`, as the core
 * says a turn ended), its asks raised by the core, and an archive where asked. Then `setup-finished.json`, and a real hub,
 * whose first build of the list is the backfill of every row.
 */
export async function makeWorld(specs: readonly SessionSpec[]): Promise<World> {
  needBuilds();
  const home = makeHome();
  const root = join(home, '.deepbuild');
  const base = tempDir();
  const dirs = new Map<string, string>();
  for (const project of new Set(specs.map((s) => s.project))) {
    const dir = join(base, project);
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: dir } });
    dirs.set(project, dir);
  }
  const sessions: WorldSession[] = specs.map((spec) => {
    const session = newSession(home, 'claude-code', dirs.get(spec.project)!);
    return { key: spec.key, id: session.id, project: spec.project, title: spec.title, session };
  });
  const asks: WorldAsk[] = [];
  const first = Date.now() - (specs.length + 1) * MIN;
  await seed(home, async (s) => {
    for (const [i, spec] of specs.entries()) {
      const at = first + i * MIN;
      const { id } = sessions[i]!;
      s.at(at);
      await s.start(id, dirs.get(spec.project)!);
      const who = { actor: 'you', scope: 'you', session: id, project: spec.project };
      await s.record.append({ writer: 'app', ...who }, { v: 1, id: ulid(at), kind: 'task.created', ts: at, data: { task_ref: `task:${ulid(at)}`, thread: id, owner: 'you', title: spec.title } });
      if (spec.state && spec.state !== 'working') {
        s.at(at + 1000);
        await s.record.append({ writer: 'core', ...who }, { v: 2, id: ulid(at + 1000), kind: 'session.attention', ts: at + 1000, subject: `session:${letters(id)}`, data: { state: spec.state } });
      }
      for (const [k, a] of (spec.asks ?? []).entries()) {
        s.at(at + 2000 + k * 1000);
        const data = askData(a.kind, a.question, s.now(), s.now() + 2 * 86_400_000);
        const plan = a.plan ? { steps: [{ does: a.plan.does, changes: a.plan.changes, undo: 'git push --force-with-lease to the old tip', public: true, cost: 0 }], diff: sha256(a.plan.does) } : undefined;
        const handle = plan
          ? await s.asks.raise({ writer: 'core', ...who }, sourceOf(a.kind), data, plan)
          : await s.raise(id, a.kind, a.question, s.now() + 2 * 86_400_000);
        asks.push({ handle, question: a.question, kind: a.kind, session: id, key: spec.key, options: data.options as WorldAsk['options'] });
      }
      if (spec.archived) {
        s.at(at + 30_000);
        await s.record.append({ writer: 'core', ...who }, { v: 1, id: ulid(at + 30_000), kind: 'session.archived', ts: at + 30_000, subject: `session:${letters(id)}`, data: { transcript: sessions[i]!.session.transcript } });
      }
    }
  }, first);
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(root, 'setup-finished.json'), JSON.stringify({ version }));
  const confirm = join(base, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const hub = await startHub({ home, env: { DEEP_HUB_TEST_CONFIRM: confirm } });
  await quiet(hub);
  return { home, root, hub, sessions, asks, seededAt: first };
}
export const sessionOf = (w: World, key: string): WorldSession => w.sessions.find((s) => s.key === key) ?? blocked(`the world has no session ${key}`);
export const askOf = (w: World, question: string): WorldAsk => w.asks.find((a) => a.question === question) ?? blocked(`the world has no ask "${question}"`);

/** The fixture AC1 and AC2 name: ten sessions in three projects, two of them with an open ask each. */
export const TEN: SessionSpec[] = [
  { key: 's1', project: 'shop', title: 'Cart totals', state: 'finished', asks: [{ kind: 'taste', question: 'Which header colour on the login page?' }] },
  { key: 's2', project: 'shop', title: 'Checkout page', state: 'finished' },
  { key: 's3', project: 'shop', title: 'Billing page' },
  { key: 's4', project: 'shop', title: 'Login flow', state: 'finished' },
  { key: 's5', project: 'docs', title: 'Release notes', state: 'finished', asks: [{ kind: 'choice', question: 'Keep the cart on SQLite or plain files?' }] },
  { key: 's6', project: 'docs', title: 'Docs refresh' },
  { key: 's7', project: 'docs', title: 'API guide', state: 'finished' },
  { key: 's8', project: 'search', title: 'Search index' },
  { key: 's9', project: 'search', title: 'Ranking tweaks', state: 'finished' },
  { key: 's10', project: 'search', title: 'Synonyms', state: 'finished' },
];

// ---- The replica, driven: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

export interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds: number[]; children: SNode[] }
export interface Run { text: string; bounds: number[]; size?: number; face?: string; cut?: boolean; weight?: number }
export interface Snapshot { window: { size: number[]; scale: number }; tree: SNode; items: unknown[]; runs?: Run[]; views?: { name: string; bounds: number[] }[]; focus?: unknown; menus?: unknown }
export interface Seen { snapshot: Snapshot; rows: Row[]; log_pos: number; address: string | null; menus: Menu[] }
export interface Menu { title: string; items: { title: string; enabled?: boolean }[] }
export interface HubCall { t: number; method: string; params: Record<string, unknown> }
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
const said = (v: unknown): string => (JSON.stringify(v) ?? String(v)).slice(0, 160);

export class Replica {
  private buffer = '';
  private readonly waiting: ((line: Record<string, any>) => void)[] = [];
  private exited = false;
  private err = '';
  /** The replica's clock at its last reply, in flicks since launch. */
  t = 0;
  /** The wall clock at launch: what the record's clock read when the replica copied it. */
  launchedAt = 0;
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
  /** A replica in `home` (the world's, so `record_copy` reads its hub), `plant` its DEEP_HUB_PLANT in the planted build. */
  static async start(o: { home?: string; plant?: string } = {}): Promise<Replica> {
    const bin = await replicaBin(o.plant !== undefined);
    const dir = tempDir();
    const out = join(dir, 'out');
    mkdirSync(out, { recursive: true });
    const home = o.home ?? join(dir, 'h');
    mkdirSync(home, { recursive: true });
    const confirm = join(dir, 'confirm');
    writeFileSync(confirm, 'confirmed\n');
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(home, { DEEP_HUB_PLANT: o.plant, DEEP_APP_TEST_CONFIRM: confirm }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const r = new Replica(child);
    const ready = await r.next(300_000);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)} ${r.err.slice(-600)}`);
    return r;
  }
  private next(ms: number): Promise<Record<string, any>> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call and its reply; BLOCKED when the binary gives none. */
  async call(args: Record<string, unknown>): Promise<Record<string, any>> {
    const reply = this.next(300_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${said(got)} ${this.err.slice(-600)}`);
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }
  /** One call that must answer ok; else a failure naming `what` and the replica's own error. */
  async must(what: string, args: Record<string, unknown>): Promise<Record<string, any>> {
    const reply = await this.call(args);
    if (reply.ok !== true) throw Error(`${what}: ${said(reply.error ?? reply)}`);
    return reply;
  }
  async launch(launch: Record<string, unknown>): Promise<Record<string, any>> {
    const reply = await this.must(`launching the replica with ${said(launch)}`, { call: 'launch', launch });
    this.launchedAt = Date.now();
    return reply;
  }
  async see(): Promise<Seen> {
    const r = await this.must('see', { call: 'see' });
    return { snapshot: r.snapshot as Snapshot, rows: (r.rows ?? []) as Row[], log_pos: r.log_pos as number, address: (r.address ?? null) as string | null, menus: (r.menus ?? []) as Menu[] };
  }
  /** Lets the replica's clock run `ms` of virtual time with no input. */
  wait(ms: number): Promise<Record<string, any>> {
    return this.must(`waiting ${ms} ms`, { call: 'wait_for', wait_for: { t: this.t + flicks(ms) }, timeout: ms + 1000 });
  }
  /** Waits until `id`'s node holds `value`, up to `ms` of virtual time. */
  waitValue(id: string, value: string, ms = 10_000): Promise<Record<string, any>> {
    return this.must(`waiting for {id: "${id}"} to hold the value ${value}`, { call: 'wait_for', locator: { id }, wait_for: { state: 'value', value }, timeout: ms });
  }
  click(locator: Record<string, unknown>, what = `a click on ${said(locator)}`): Promise<Record<string, any>> { return this.must(what, { call: 'act', locator, act: { kind: 'click' } }); }
  hover(locator: Record<string, unknown>): Promise<Record<string, any>> { return this.must(`the pointer on ${said(locator)}`, { call: 'act', locator, act: { kind: 'hover' } }); }
  /** A press where the pointer is, at a point in device pixels, with no locator and no wait (README, Pinned 4). */
  clickAt(point: number[]): Promise<Record<string, any>> { return this.must(`a press at ${said(point)}`, { call: 'act', act: { kind: 'click', point } }); }
  type(locator: Record<string, unknown> | null, text: string): Promise<Record<string, any>> { return this.must(`typing "${text.slice(0, 40)}"`, { call: 'act', ...(locator ? { locator } : {}), act: { kind: 'type', text } }); }
  press(keys: string): Promise<Record<string, any>> { return this.must(`pressing ${keys}`, { call: 'act', act: { kind: 'press', keys } }); }
  /** Picks a menu bar item, as a click on it would (README, Pinned 4). */
  menu(path: string[]): Promise<Record<string, any>> { return this.must(`the menu item ${path.join(' › ')}`, { call: 'act', act: { kind: 'menu', path } }); }
  open(address: string): Promise<Record<string, any>> { return this.must(`deep_drive's open of ${address}`, { call: 'open', open: { address } }); }
  feed(session: string, event: Record<string, unknown>): Promise<Record<string, any>> { return this.must(`feeding ${String(event.kind)}`, { call: 'feed', feed: { session, event } }); }
  /** How the hub the app reads answers from now on (README, Pinned 4). */
  hub(state: 'answering' | 'stopped' | 'slow'): Promise<Record<string, any>> { return this.must(`the hub ${state}`, { call: 'hub', hub: { state } }); }
  /** The record's clock now, as the replica's views read it. */
  now(): number { return this.launchedAt + Math.round((this.t * 1000) / FLICKS); }
  /** Closes the replica; its trace, with every hub call the app made (README, Pinned 5). */
  async close(): Promise<{ hub: HubCall[] | undefined; trace: Record<string, any> }> {
    const closed = await this.must('close', { call: 'close' });
    const trace = JSON.parse(readFileSync(String(closed.trace.path), 'utf8')) as Record<string, any>;
    return { hub: Array.isArray(trace.hub) ? (trace.hub as HubCall[]) : undefined, trace };
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

/** A replica of the world's record, launched as the app opens it unless `launch` says more. */
export async function replicaOf(w: { home: string } | null, launch: Record<string, unknown> = {}, plant?: string): Promise<Replica> {
  const r = await Replica.start({ ...(w ? { home: w.home } : {}), ...(plant ? { plant } : {}) });
  await r.launch({ from: w ? 'record_copy' : 'empty', ...launch });
  return r;
}

// ---- What the hub writes for a change, fed to a running replica (README, The fixtures).

let order: ((row: Row) => string) | undefined;
async function orderOf(row: Row): Promise<string> {
  order ??= ((await import(pathToFileURL(join(REPO, 'packages/hub/dist/rows.js')).href)) as { orderOf: (row: Row) => string }).orderOf;
  return order(row);
}
const core = { writer: 'core', actor: 'you', scope: 'you' } as const;
/** `row.set` for `row` as the core appends it: listed, placed by the hub's order. */
export async function rowSet(row: Row): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = { ...row };
  delete data.listed;
  delete data.order;
  return { v: 1, id: ulid(), kind: 'row.set', ...core, data: { listed: true, order: await orderOf(data as Row), ...data } };
}
const ENTRY: Record<string, string> = { 'needs you': 'needs_you', stuck: 'blocked', flagged: 'fail', working: 'running', finished: 'idle', quiet: 'idle', PASS: 'pass' };
/** A session's row moved to a new state at `at`: unread, as the core writes a row whose state changed. */
export async function feedState(r: Replica, row: Row, word: string, at = r.now()): Promise<void> {
  const session = String(row.session ?? row.id.replace(/^session:/, ''));
  await r.feed(session, await rowSet({ ...row, word, entry: ENTRY[word] ?? 'idle', since: at, unread: true }));
}
/** A new ask on `session`, raised now: its `ask.created`, then its row as the core builds it. Its handle. */
export async function feedAsk(r: Replica, session: Row, question: string, kind: 'taste' | 'choice' | 'authority' = 'choice'): Promise<string> {
  const id = ulid();
  const raised = r.now();
  const data = askData(kind, question, raised, raised + 86_400_000);
  const s = String(session.session);
  const fed = await r.feed(s, { v: 1, id, kind: 'ask.created', ...core, data });
  const ts = typeof fed.ts === 'number' ? fed.ts : raised;
  const options = (data.options as { id: string; label: string }[]).map((o) => ({ answer: o.id, label: o.label }));
  await r.feed(s, await rowSet({
    id: `ask:${id}`, address: `ask/${id}`, title: question, project: session.project ?? null, session: s, agent: session.agent ?? null,
    entry: 'needs_you', word: 'needs you', why: kind === 'authority' ? 'an approval' : kind === 'taste' ? 'a taste call' : 'a choice', waits_on: 'you',
    since: ts, actions: options, unread: false, default: options.find((o) => o.answer === data.default)?.label, default_at: data.deadline,
  } as unknown as Row));
  return `ask:${id}`;
}
/** An ask answered elsewhere (`via` the CLI, as `deep inbox answer` does): `ask.answered`, then the row leaving the list. */
export async function feedAnswered(r: Replica, ask: { handle: string; session: string; option: string }): Promise<void> {
  await r.feed(ask.session, { v: 1, id: ulid(), kind: 'ask.answered', ...core, subject: ask.handle, data: { answer: ask.option, plan_hash: null, decision: 'none', via: 'cli' } });
  await r.feed(ask.session, { v: 1, id: ulid(), kind: 'row.set', ...core, data: { id: ask.handle, listed: false } });
}

// ---- Reading the window (README, Pinned 1-3).

export const ADDRESS = /^(ask|session|project|page)\/\S+$/;
const ROW_ID = /^(ask:|session:|quiet:)/;
export const byId = (s: Snapshot, id: string): SNode | undefined => flat(s.tree).find((n) => n.id === id);
/** The list: the one node whose id is `list`. */
export const listOf = (s: Snapshot): SNode | undefined => byId(s, 'list');
/** The page: the one node whose id is an address (#1460). */
export const pageOf = (s: Snapshot): SNode | undefined => { const pages = flat(s.tree).filter((n) => typeof n.id === 'string' && ADDRESS.test(n.id)); return pages.length === 1 ? pages[0] : undefined; };
/** The list's rows and headings, in reading order. */
export const listRows = (s: Snapshot): SNode[] => { const l = listOf(s); return l ? flat(l).filter((n) => typeof n.id === 'string' && ROW_ID.test(n.id) && !String(n.id).includes(':', String(n.id).indexOf(':') + 1)) : []; };
export const headings = (s: Snapshot): SNode[] => { const l = listOf(s); return l ? flat(l).filter((n) => typeof n.id === 'string' && n.id.startsWith('heading:')) : []; };
export const slot = (s: Snapshot, row: string, part: 'mark' | 'title' | 'word' | 'time'): SNode | undefined => byId(s, `${row}:${part}`);
const inside = (b: number[], box: number[]): boolean => b[0]! >= box[0]! - 1 && b[1]! >= box[1]! - 1 && b[0]! + b[2]! <= box[0]! + box[2]! + 1 && b[1]! + b[3]! <= box[1]! + box[3]! + 1;
const overlaps = (a: number[], b: number[]): boolean => a[0]! < b[0]! + b[2]! && b[0]! < a[0]! + a[2]! && a[1]! < b[1]! + b[3]! && b[1]! < a[1]! + a[3]!;
/** The strings drawn inside a box. */
export const runsIn = (s: Snapshot, box: number[]): Run[] => (s.runs ?? []).filter((r) => overlaps(r.bounds, box) && inside(r.bounds, box));
/** Everything a node holds in words: names and string values of its subtree, and the strings drawn inside it. */
export function wordsOf(s: Snapshot, n: SNode): string {
  const own = flat(n).flatMap((x) => [x.name ?? '', typeof x.value === 'string' ? x.value : '']);
  return [...own, ...runsIn(s, n.bounds).map((r) => r.text)].filter(Boolean).join('\n');
}
/** The weight a row's title is drawn in (README, Pinned 2): its title slot's runs' `weight`; undefined when none says. */
export function titleWeight(s: Snapshot, row: string): number | undefined {
  const title = slot(s, row, 'title');
  if (!title) return undefined;
  const weights = runsIn(s, title.bounds).map((r) => r.weight).filter((w): w is number => typeof w === 'number');
  return weights.length ? Math.max(...weights) : undefined;
}
export const MEDIUM = 500;
export const REGULAR = 400;
/** What's wrong with `row`'s title weight against what it should read: medium (unread) or regular. */
export function weightFailures(s: Snapshot, row: string, want: 'medium' | 'regular', when: string): string[] {
  const w = titleWeight(s, row);
  if (w === undefined) return [`${when}, row ${row} has no title slot (${row}:title) with a run that says its weight (README, Pinned 2)`];
  const ok = want === 'medium' ? w >= MEDIUM : w < MEDIUM;
  return ok ? [] : [`${when}, row ${row}'s title is drawn at weight ${w}, ${want === 'medium' ? 'regular: it reads read, not unread' : 'medium: it still reads unread'}`];
}
export const textInputs = (n: SNode): SNode[] => flat(n).filter((x) => /text_input$/.test(x.role));
/** A count of 0 anywhere the window says a count: a count sentence, a run or a node that is just "0", a heading valued 0. */
export function zeroCounts(s: Snapshot): string[] {
  const out: string[] = [];
  for (const n of flat(s.tree)) {
    const text = `${n.name ?? ''} ${typeof n.value === 'string' ? n.value : ''}`;
    const m = /\b0 (?:asks?|sessions?|rows?|tasks?)\b/.exec(text);
    if (m) out.push(`${n.role} ${said(n.id ?? n.name)} reads "${m[0]}"`);
    if (typeof n.id === 'string' && n.id.startsWith('heading:') && String(n.value ?? '').trim() === '0') out.push(`the heading ${n.id} reads the count 0`);
  }
  for (const r of s.runs ?? []) if (/\b0 (?:asks?|sessions?|rows?|tasks?)\b/.test(r.text) || r.text.trim() === '0') out.push(`the window draws "${r.text}"`);
  return out;
}
/** Clock times HH:MM in `text`. */
export const clockTimes = (text: string): string[] => [...text.matchAll(/\b([01]?\d|2[0-3]):[0-5]\d\b/g)].map((m) => m[0].padStart(5, '0'));
/** Each minute from `from` to `to`, a minute either side, as this process's clock writes them. */
export function clocksBetween(from: number, to: number): string[] {
  const out: string[] = [];
  for (let t = from - MIN; t <= to + MIN; t += MIN) out.push(new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }));
  return out;
}
export const HUB_DOWN = "The hub isn't answering";

// ---- The real app (AC1, AC14, AC28): read from outside its process.

export interface AxNode { role: string | null; title: string | null; description: string | null; value: string | null; identifier: string | null; frame: number[]; children: AxNode[] }
export const axFlat = (n: AxNode, into: AxNode[] = []): AxNode[] => { into.push(n); for (const c of n.children) axFlat(c, into); return into; };
/** The process's windows as an assistive client reads them, with identifiers (#1459's probe). */
export async function axTree(pid: number): Promise<{ frame: number[]; tree: AxNode }[]> {
  const { probeBinary, run } = await import('../1459/helpers.ts');
  const r = await run(await probeBinary(), ['tree', String(pid)], undefined, 60_000);
  if (r.code !== 0) blocked(`probe tree failed: ${r.stderr.slice(-300)}`);
  return JSON.parse(r.stdout) as { frame: number[]; tree: AxNode }[];
}
/** Sets the real app's window to `size` in points, as #1454's `App.place` sets the reference one. */
export async function placeAt(pid: number, size: { width: number; height: number }): Promise<void> {
  const { probeBinary } = await import('../1454/helpers.ts');
  const probe = await probeBinary();
  for (let tries = 0; tries < 40; tries++) {
    const frame = await new Promise<number[]>((resolve) => execFile(probe, ['place', String(pid), String(size.width), String(size.height)], (e, out) => resolve(e ? [] : (JSON.parse(out) as number[]))));
    if (Math.abs((frame[2] ?? 0) - size.width) < 1 && Math.abs((frame[3] ?? 0) - size.height) < 1) return;
    await sleep(250);
  }
  blocked(`the real window couldn't be set to ${size.width} × ${size.height}`);
}
/** A copy of one of this suite's fixture folders: gpui-shell writes files beside a panel it loads. */
export function fixtureCopy(name: string): string {
  const dir = join(tempDir(), name);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

// ---- Timing (AC9): #1551's reference-Mac and load gate.
export { inconclusive, timingProblem } from '../1551/helpers.ts';
