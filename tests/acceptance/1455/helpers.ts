// Test-side tools for issue #1455's acceptance tests (README). Every string judged here is read from a real
// component: the app's views drawn by `deep-drive` (#124's replica, which since #1454 draws the app's own tree) over
// this suite's fixture record, `deep-replica`'s views and first screen, the real `deep` CLI, and the real app's window
// for the pictures. The judges are this suite's own; none is taken from the implementation.
//
// Safety: every process gets HOME under a temp folder, is stopped only by the PID it was started with, and touches no
// real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents. No network, no model.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const FIXTURES = join(SUITE, 'fixtures');
export const NODE = process.execPath;
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const MINUTES = 60_000;

/** Each criterion's ID: `#1455.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #1455.a9f10334';
export const AC2 = 'AC2 #1455.a4bb90cd';
export const AC3 = 'AC3 #1455.3fc1eb9d';
export const AC4 = 'AC4 #1455.3231786f';
export const AC5 = 'AC5 #1455.214950f1';
export const AC6 = 'AC6 #1455.71693552';
export const AC7 = 'AC7 #1455.89be1755';

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- Temp folders and processes. Short paths under /tmp; only what this file started is stopped, by PID.

const made: string[] = [];
export function tempDir(prefix = 'da1455-'): string {
  const dir = realpathSync(mkdtempSync(join('/tmp', prefix)));
  made.push(dir);
  return dir;
}
const owned = new Set<ChildProcess>();
export async function cleanup(): Promise<void> {
  for (const child of owned) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const deadline = Date.now() + 3000;
  while ([...owned].some((c) => c.exitCode === null && c.signalCode === null) && Date.now() < deadline) await sleep(50);
  for (const child of owned) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    owned.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 10 * MINUTES);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code, signal) => { clearTimeout(timer); owned.delete(child); resolve({ code, signal, stdout, stderr }); });
  });
}
export const shown = (r: Ran): string => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;

/** A child's environment: HOME the test's home, none of this process's DEEP_, CLAUDE*, CODEX* or XDG_ variables, plus `extra`. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|OTEL_)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), LC_ALL: 'C', NO_COLOR: '1' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** A home whose setup finished, so the app opens on its shell and not on Set up; `setUp: false` leaves it empty. */
export function makeHome(o: { setUp?: boolean } = {}): string {
  const home = join(tempDir(), 'h');
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  if (o.setUp !== false) {
    const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
    writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), JSON.stringify({ version }));
  }
  return home;
}

// ---- Builds. Each binary is copied out of the target folder under its own name, so a plant's build never stands in
// for the app; the plain build runs last, so the checkout's target/debug never holds a plant (as #1454's suite does).

const BIN = join(tmpdir(), `da1455-bin-${userInfo().uid}`);
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const builds = new Map<string, Promise<void>>();
function cargo(args: string[]): Promise<void> {
  const key = args.join(' ');
  let build = builds.get(key);
  if (!build) {
    build = run('cargo', ['build', '--locked', '-q', ...args], { env: { ...process.env, CARGO_INCREMENTAL: '0' }, timeoutMs: 60 * MINUTES }).then((r) => {
      if (r.code !== 0) blocked(`cargo build ${key} failed: ${r.stderr.slice(-3000)}`);
    });
    builds.set(key, build);
  }
  return build;
}
export interface Replica { drive: string; replica: string }
let replicas: Promise<{ plain: Replica; plants: Replica }> | undefined;
/**
 * `deep-drive` and `deep-replica`, built plain and with the `env-plants` feature, through which DEEP_HUB_PLANT selects
 * a planted app (README, The contract). A clean run uses the plain build; a plant, the other.
 */
export function replicaBinaries(): Promise<{ plain: Replica; plants: Replica }> {
  if (process.platform !== 'darwin') return Promise.resolve(blocked(`the replica draws on macOS only; this is ${process.platform}`));
  replicas ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    const bins = ['--bin', 'deep-drive', '--bin', 'deep-replica'];
    const copy = (kind: string): Replica => {
      const out = { drive: join(BIN, `deep-drive-${kind}`), replica: join(BIN, `deep-replica-${kind}`) };
      copyFileSync(target('deep-drive'), out.drive);
      copyFileSync(target('deep-replica'), out.replica);
      return out;
    };
    await cargo(['-p', 'deep-replica', '--features', 'env-plants', ...bins]);
    const plants = copy('plants');
    await cargo(['-p', 'deep-replica', ...bins]);
    return { plain: copy('plain'), plants };
  })();
  return replicas;
}
/** deep-hook, which a hub needs built under the checkout's target before it starts. */
export const deepHook = (): Promise<void> => cargo(['-p', 'deep-hook', '--bin', 'deep-hook']);
/** The plain `deep-app`, copied out of the target folder. */
let app: Promise<string> | undefined;
export function appBinary(): Promise<string> {
  app ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    await cargo(['-p', 'deep-app', '--bin', 'deep-app']);
    const out = join(BIN, 'deep-app-plain');
    copyFileSync(target('deep-app'), out);
    return out;
  })();
  return app;
}

// ---- The fixture record (README, The fixture), as deep-drive loads it: one row per event.

export interface Session { id: string; title: string | null; deadlines: number[]; asks: number }
/** The replica's clock for a fixture launch, ms since the epoch (crates/deep-replica, `NOW`). */
export const NOW = 1_800_000_000_000;
export const RECORD = join(FIXTURES, 'run.events.jsonl');
export const HOUR = 3_600_000;
interface Row { session_id: string; event: { kind: string; data: Record<string, unknown> } }
const rows = (): Row[] => readFileSync(RECORD, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);
/** The fixture's sessions, as the record says them: each one's task title, its open asks and their deadlines. */
export function sessions(): Session[] {
  const out = new Map<string, Session>();
  for (const { session_id: id, event } of rows()) {
    const s = out.get(id) ?? { id, title: null, deadlines: [], asks: 0 };
    if (event.kind === 'task.created' && event.data.thread === id) s.title ??= String(event.data.title);
    if (event.kind === 'ask.created') {
      s.asks += 1;
      if (typeof event.data.deadline === 'number') s.deadlines.push(event.data.deadline);
    }
    out.set(id, s);
  }
  return [...out.values()];
}
/** The fixture's open asks: each one's question and whether it is a stalled claim's (split, fund or accept). */
export function asks(): { question: string; stalled: boolean }[] {
  return rows().filter((r) => r.event.kind === 'ask.created').map((r) => {
    const ids = (r.event.data.options as { id: string }[]).map((o) => o.id);
    return { question: String(r.event.data.question), stalled: ['split', 'fund', 'accept'].every((id) => ids.includes(id)) };
  });
}
/** The record with only its last ask, so one ask is open (AC6). */
export function oneAskRecord(): string {
  const all = readFileSync(RECORD, 'utf8').split('\n').filter((l) => l.trim());
  const asked = all.filter((l) => (JSON.parse(l) as Row).event.kind === 'ask.created');
  const file = join(tempDir(), 'one-ask.events.jsonl');
  writeFileSync(file, `${all.filter((l) => !asked.slice(0, -1).includes(l)).join('\n')}\n`);
  return file;
}
/** The record with `session`'s rows first, so a session's page, which draws the record's first session, draws it. */
function recordFor(session: string): string {
  const all = readFileSync(RECORD, 'utf8').split('\n').filter((l) => l.trim());
  const mine = all.filter((l) => (JSON.parse(l) as Row).session_id === session);
  const file = join(tempDir(), 'record.events.jsonl');
  writeFileSync(file, `${[...mine, ...all.filter((l) => !mine.includes(l))].join('\n')}\n`);
  return file;
}

// ---- deep-drive (#124): one replica per process, one JSON call per line on stdin, one reply per line on stdout.

export interface Node { role: string; name: string | null; bounds: number[]; children: Node[] }
export interface Item { id: string; value: unknown }
export interface Seen { width: number; tree: Node; items: Item[] }
type Reply = Record<string, unknown> & { ok?: boolean; error?: { code: string; message: string } };
export class Drive {
  private readonly replies: AsyncIterator<string>;
  private constructor(private readonly child: ChildProcess, private readonly err: () => string) {
    this.replies = createInterface({ input: child.stdout! })[Symbol.asyncIterator]();
  }
  static async start(binary: string, home: string, plant?: string): Promise<Drive> {
    const child = spawn(binary, ['--out', join(tempDir(), 'drive')], { cwd: REPO, env: childEnv(home, { DEEP_HUB_PLANT: plant, DEEP_DRIVE_PLANT: undefined }), stdio: ['pipe', 'pipe', 'pipe'] });
    owned.add(child);
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-4000)));
    const drive = new Drive(child, () => err);
    const ready = await drive.next(120_000);
    if (ready.ready !== true) blocked(`deep-drive didn't start: ${JSON.stringify(ready)} ${err}`);
    return drive;
  }
  private async next(ms: number): Promise<Reply> {
    const line = await Promise.race([this.replies.next(), sleep(ms).then(() => undefined)]);
    if (!line || line.done) return blocked(`deep-drive gave no reply in ${ms} ms: ${this.err()}`);
    return JSON.parse(line.value) as Reply;
  }
  async call(call: Record<string, unknown>, ms = 120_000): Promise<Reply> {
    this.child.stdin!.write(`${JSON.stringify(call)}\n`);
    return this.next(ms);
  }
  /** `call`, which must answer ok. */
  async must(call: Record<string, unknown>): Promise<Reply> {
    const reply = await this.call(call);
    if (reply.ok !== true) blocked(`deep-drive refused ${JSON.stringify(call)}: ${JSON.stringify(reply.error)}`);
    return reply;
  }
  async see(): Promise<Seen> {
    const reply = await this.must({ call: 'see', see: { include: ['roles', 'names', 'bounds', 'items'] } });
    const snapshot = reply.snapshot as { window: { size: number[]; scale: number }; tree: Node; items: Item[] };
    return { width: snapshot.window.size[0]! * snapshot.window.scale, tree: snapshot.tree, items: snapshot.items };
  }
  async stop(): Promise<void> {
    this.child.stdin!.end();
    const deadline = Date.now() + 5000;
    while (this.child.exitCode === null && this.child.signalCode === null && Date.now() < deadline) await sleep(50);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
  }
}
/** One replica launched over `record` on `center`, seen, and stopped; `then` acts on it first. */
async function view(binary: string, o: { home: string; record?: string; center: string; plant?: string | undefined }, then?: (d: Drive, first: Seen) => Promise<Seen>): Promise<{ first: Seen; after?: Seen; drive: Drive }> {
  const drive = await Drive.start(binary, o.home, o.plant);
  try {
    await drive.must({ call: 'launch', launch: { from: 'fixture', fixture: o.record ?? RECORD, center: o.center } });
    const first = await drive.see();
    const after = then ? await then(drive, first) : undefined;
    return { first, ...(after ? { after } : {}), drive };
  } finally {
    await drive.stop();
  }
}

// ---- What a view shows, as strings.

/** A string a person can read, and where: the view, how it reaches them, its node's role and bounds in device pixels. */
export interface Shown { view: string; text: string; how: 'drawn' | 'name' | 'posted' | 'printed'; role: string; bounds: number[]; item?: string }
export const flatten = (n: Node): Node[] => [n, ...n.children.flatMap(flatten)];
/** A node of the list starts in the window's left tenth (at the base its rows start by 3%, the page at 17.7%); the page is past it. */
export const inList = (n: { bounds: number[] }, width: number): boolean => n.bounds[0]! < 0.1 * width;
const DRAWS_ITS_NAME = new Set(['label', 'button', 'heading', 'text_run', 'link', 'static_text']);
/**
 * Every string a snapshot holds: each node's name, and each canvas item's text. A node's name is drawn when the
 * replica found no other text drawn inside it and its role draws its name (a label, a button, a drawn string); else
 * it is only the accessible name, and what is drawn inside it comes as its own `text_run` nodes.
 */
export function strings(viewName: (n: { bounds: number[] }) => string, seen: Seen): Shown[] {
  const out: Shown[] = [];
  for (const n of flatten(seen.tree)) {
    if (!n.name?.trim()) continue;
    const drawnInside = n.children.some((c) => c.role === 'text_run');
    const how = n.role === 'text_run' || (!drawnInside && DRAWS_ITS_NAME.has(n.role)) ? 'drawn' : 'name';
    out.push({ view: viewName(n), text: n.name, how, role: n.role, bounds: n.bounds });
  }
  for (const item of seen.items) {
    const text = (item.value as { text?: unknown } | null)?.text;
    if (typeof text === 'string' && text.trim()) out.push({ view: viewName({ bounds: [Number.MAX_SAFE_INTEGER, 0, 0, 0] }), text, how: 'drawn', role: 'canvas_item', bounds: [], item: item.id });
  }
  return out;
}
const key = (s: Shown): string => `${s.view}\u0000${s.text}\u0000${s.how}`;
const dedupe = (all: Shown[]): Shown[] => [...new Map(all.map((s) => [key(s), s])).values()];

// ---- The fixture run (README, The fixture run): every view the app has, over the fixture record.

export interface Page { session: Session; seen: Seen; strings: Shown[] }
export interface Card { question: string; stalled: boolean; strings: Shown[]; first: Shown | undefined }
export interface FixtureRun { strings: Shown[]; pages: Page[]; cards: Card[]; out: string }

const pageName = (s: Session): string => `session page "${s.title ?? s.id}"`;
const CENTER = { needsYou: 'deepbuild/needs-you', session: 'deepbuild/session', home: 'deepbuild/home', welcome: 'deepbuild/welcome', agents: 'deepbuild/agents' };

/** The fixture run, by the plain build or, with `plant`, the planted one: every view, every card, every session's page. */
export async function fixtureRun(plant?: string): Promise<FixtureRun> {
  const binaries = await replicaBinaries();
  const bin = plant ? binaries.plants : binaries.plain;
  const home = makeHome();
  const all: Shown[] = [];
  const pages: Page[] = [];
  const cards: Card[] = [];
  const split = (page: string) => (width: number) => (n: { bounds: number[] }) => (inList(n, width) ? 'list' : page);

  // Needs you and the list, then the notifications its asks post, on the virtual clock.
  const needs = await Drive.start(bin.drive, home, plant);
  try {
    await needs.must({ call: 'launch', launch: { from: 'fixture', fixture: RECORD, center: CENTER.needsYou } });
    const seen = await needs.see();
    all.push(...strings(split('needs you')(seen.width), seen));
    await needs.must({ call: 'wait_for', wait_for: { t: 3 * 705_600_000 }, timeout: 5000 });
    const closed = await needs.must({ call: 'close' });
    const trace = JSON.parse(readFileSync(String((closed.trace as { path: string }).path), 'utf8')) as { notifications: { text: string }[] };
    for (const n of trace.notifications) for (const line of n.text.split('\n')) all.push({ view: 'notification', text: line, how: 'posted', role: 'notification', bounds: [] });
  } finally {
    await needs.stop();
  }
  // Each ask's card: one click on its row in Needs you; the card is what the click added.
  for (const ask of asks()) {
    let added: Shown[] = [];
    await view(bin.drive, { home, center: CENTER.needsYou, plant }, async (drive, before) => {
      const row = flatten(before.tree).find((n) => !inList(n, before.width) && n.role === 'button' && n.name?.includes(ask.question));
      if (!row) blocked(`Needs you has no row for "${ask.question}" to click: ${JSON.stringify(flatten(before.tree).map((n) => n.name).filter(Boolean))}`);
      await drive.must({ call: 'act', locator: { role: 'button', name: row!.name }, act: { kind: 'click' } });
      const after = await drive.see();
      const was = strings(() => 'card', before).map((s) => s.text);
      for (const s of strings(() => 'card', after)) {
        const at = was.indexOf(s.text);
        if (at >= 0) was.splice(at, 1);
        else added.push(s);
      }
      return after;
    });
    added = added.filter((s) => s.role !== 'canvas_item' || s.text);
    const first = [...added].filter((s) => s.bounds.length).sort((a, b) => a.bounds[1]! - b.bounds[1]! || a.bounds[0]! - b.bounds[0]!)[0];
    cards.push({ question: ask.question, stalled: ask.stalled, strings: added, first });
    all.push(...added);
  }
  // Each session's page: the record with that session first, so the page draws it.
  for (const session of sessions()) {
    const { first } = await view(bin.drive, { home, record: recordFor(session.id), center: CENTER.session, plant });
    const shownHere = strings(split(pageName(session))(first.width), first);
    pages.push({ session, seen: first, strings: shownHere.filter((s) => s.view !== 'list') });
    all.push(...shownHere);
  }
  // Home, the Agents page, and the welcome pane a first launch shows, in a home with nothing set up.
  for (const [center, name, setUp] of [[CENTER.home, 'home', true], [CENTER.agents, 'agents', true], [CENTER.welcome, 'welcome', false]] as const) {
    const { first } = await view(bin.drive, { home: setUp ? home : makeHome({ setUp: false }), center, plant });
    all.push(...strings(split(name)(first.width), first));
  }
  // The bound panel, which the replica draws on a session's page from the runs' bound values (#629).
  all.push(...(await boundPanel(bin.replica, plant)));
  // `deep --help`, what a person runs first.
  const help = await run(NODE, [CLI, '--help'], { env: childEnv(home), cwd: tempDir() });
  if (help.code !== 0) blocked(`deep --help: ${shown(help)}`);
  for (const line of help.stdout.split('\n')) if (line.trim()) all.push({ view: 'deep --help', text: line, how: 'printed', role: 'stdout', bounds: [] });

  const strings_ = dedupe(all);
  const out = process.env.DA1455_OUT ?? tempDir();
  mkdirSync(out, { recursive: true });
  const file = join(out, `strings${plant ? `.${plant}` : ''}.json`);
  writeFileSync(file, `${JSON.stringify(strings_.map(({ view: v, text, how, role }) => ({ view: v, text, how, role })), null, 1)}\n`);
  console.log(`#1455: ${strings_.length} strings the fixture run showed${plant ? ` with ${plant}` : ''}, in ${file}`);
  return { strings: strings_, pages, cards, out: file };
}

/** The report the bound panel's run reads, and its run. */
export const BOUND_RUN = 'run:01PXRTN0000000000000000001';
const BOUND_ASSERTION = 'header height';
async function boundPanel(replica: string, plant?: string): Promise<Shown[]> {
  const dir = tempDir();
  const bind = (select: string) => ({ source: `${BOUND_RUN}#${BOUND_ASSERTION}`, select });
  const input = { runs: [{ run: BOUND_RUN, check: 'header', tool: 'vitest', report: join(FIXTURES, 'vitest-header.json') }], card: [], panel: [{ id: 'expected', bind: bind('expected') }, { id: 'received', bind: bind('received') }] };
  writeFileSync(join(dir, 'bound.in.json'), JSON.stringify(input));
  const r = await run(replica, ['--view', 'session', '--out', join(dir, 'out'), '--appearance', 'light', '--bound', join(dir, 'bound.in.json')], { env: childEnv(makeHome(), { DEEP_HUB_PLANT: plant }), timeoutMs: 10 * MINUTES });
  if (r.code !== 0) blocked(`deep-replica --view session --bound didn't draw: ${shown(r)}`);
  const snapshot = JSON.parse(readFileSync(join(dir, 'out/snapshots/session.json'), 'utf8')) as { window: { size: number[]; scale: number }; tree: Node; items: Item[] };
  const seen: Seen = { width: snapshot.window.size[0]! * snapshot.window.scale, tree: snapshot.tree, items: snapshot.items };
  return strings((n) => (inList(n, seen.width) ? 'list' : 'bound panel'), seen);
}

// ---- AC1: no fixture text, tagline or internal kind name.

/** The welcome pane's tagline at the base: the issue's "tagline in the welcome pane". */
export const TAGLINE = 'Where your agents show, not tell.';
/** Strings no view may show (the issue's AC1), each as a whole phrase in any case. */
export const FORBIDDEN: { phrase: string; why: string }[] = [
  { phrase: 'Cart total', why: 'a fixture word' },
  { phrase: 'Repository skeleton', why: 'filler at the end of deep --help' },
  { phrase: 'returned', why: 'filler on the return line' },
  { phrase: TAGLINE.replace(/\.$/, ''), why: 'the welcome pane\'s tagline' },
  { phrase: 'show, not tell', why: 'the welcome pane\'s tagline' },
  { phrase: 'stalled claim', why: 'an internal kind name' },
  { phrase: 'batched authority', why: 'an internal kind name' },
  { phrase: 'early question about done', why: 'an internal kind name' },
];
/** The card kinds' internal names (the base's `kinds.rs`), none of which is a card's first line. */
export const KIND_NAMES = ['batched authority', 'taste', 'unblock', 'stalled claim', 'choice', 'exception', 'early question about done'];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const holds = (text: string, phrase: string): boolean => new RegExp(`(?<![A-Za-z0-9])${escape(phrase).replace(/ /g, '\\s+')}(?![A-Za-z0-9])`, 'i').test(text);
/** #1348's list's plain words, which a card's first line is one of. */
export function plainWords(): string[] {
  const file = join(REPO, 'contracts/plain-words.json');
  if (!existsSync(file)) blocked(`no word list at ${file} (#1348)`);
  return Object.values((JSON.parse(readFileSync(file, 'utf8')) as { words: Record<string, string> }).words).map((w) => w.toLowerCase());
}
/** The fixtures this suite draws from: none of them holds a forbidden phrase, so whatever a view shows of one is the app's. */
export function fixtureTexts(): { file: string; text: string }[] {
  return [RECORD, join(FIXTURES, 'vitest-header.json'), join(REPO, 'docs/spikes/338/fixtures/needs-you.events.jsonl')].map((file) => ({ file, text: readFileSync(file, 'utf8') }));
}
/** Every forbidden phrase shown, and every card whose first line isn't a plain word, each naming the string and its view. */
export function fixtureWordFailures(run: Pick<FixtureRun, 'strings' | 'cards'>, plain: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of run.strings) {
    for (const f of FORBIDDEN) if (holds(s.text, f.phrase)) out.push(`the ${s.view} shows ${JSON.stringify(s.text)}: "${f.phrase}" is ${f.why}`);
  }
  for (const card of run.cards) {
    const first = card.first?.text.trim() ?? '';
    if (!first) out.push(`the card for "${card.question}" shows nothing new when its row is clicked`);
    else if (KIND_NAMES.includes(first.toLowerCase())) out.push(`the card for "${card.question}" starts ${JSON.stringify(first)}, an internal kind name`);
    else if (!plain.includes(first.toLowerCase())) out.push(`the card for "${card.question}" starts ${JSON.stringify(first)}, which is no plain word of #1348's list (${plain.join(', ')})`);
  }
  return [...new Set(out)];
}

// ---- AC2: the session chart.

export const CHART = { line: 'session-line', caption: 'session-caption', readout: 'session-readout' } as const;
const itemText = (seen: Seen, id: string): string | undefined => {
  const item = seen.items.find((i) => i.id === id);
  if (!item) return undefined;
  const text = (item.value as { text?: unknown } | null)?.text;
  return typeof text === 'string' ? text : '';
};
/** What's wrong with each session page's chart, naming the session, its caption and its readout. */
export function chartFailures(pages: readonly Page[]): string[] {
  const out: string[] = [];
  for (const { session, seen, strings: here } of pages) {
    const name = pageName(session);
    const drawn = Object.values(CHART).filter((id) => seen.items.some((i) => i.id === id));
    if (!session.deadlines.length) {
      if (drawn.length) out.push(`the ${name} has no deadline yet draws ${drawn.join(', ')}`);
      const caption = here.filter((s) => s.how !== 'name' && /deadline/i.test(s.text));
      if (caption.length) out.push(`the ${name} has no deadline yet shows ${caption.map((s) => JSON.stringify(s.text)).join(', ')}`);
      continue;
    }
    const caption = itemText(seen, CHART.caption);
    const readout = itemText(seen, CHART.readout);
    if (!seen.items.some((i) => i.id === CHART.line)) out.push(`the ${name} has deadlines and draws no chart (${CHART.line})`);
    if (!caption?.trim()) { out.push(`the ${name} has deadlines and its chart shows no caption (${CHART.caption})`); continue; }
    if (readout === undefined || !readout.trim()) { out.push(`the ${name}'s chart, captioned ${JSON.stringify(caption)}, shows no readout (${CHART.readout})`); continue; }
    const times = here.filter((s) => s.how !== 'name' && s.text.toLowerCase().includes(caption.toLowerCase())).length;
    if (times !== 1) out.push(`the ${name} shows its caption ${JSON.stringify(caption)} ${times} times, not once`);
    const n = Number(/-?\d+(?:\.\d+)?/.exec(readout)?.[0] ?? NaN);
    const words = `${caption} ${readout}`;
    const hours = session.deadlines.map((d) => (d - NOW) / HOUR);
    if (/hour|\d\s*h\b|\bh\b/i.test(words)) {
      if (!hours.some((h) => Math.abs(h - n) < 1)) out.push(`the ${name}'s readout ${JSON.stringify(readout)} isn't the hours to any of its deadlines (${hours.map((h) => h.toFixed(1)).join(', ')}) that its caption ${JSON.stringify(caption)} says it shows`);
    } else if (/\bask/i.test(words)) {
      if (n !== session.asks) out.push(`the ${name}'s readout ${JSON.stringify(readout)} isn't its ${session.asks} asks, which its caption ${JSON.stringify(caption)} says it counts`);
    } else {
      out.push(`the ${name}'s caption ${JSON.stringify(caption)} says neither hours nor asks, so its readout ${JSON.stringify(readout)} can't be read against it`);
    }
  }
  return out;
}

// ---- AC3: a session page's title.

/** Every piece of the session's ID 8 characters long: what a person would read as its raw ID (the base's short form). */
export const idPieces = (id: string): string[] => Array.from({ length: Math.max(0, id.length - 7) }, (_, i) => id.slice(i, i + 8).toLowerCase());
/**
 * What's wrong with each session page's title, naming the session: no accessible name holding `Session`, a title that
 * isn't the task's, or a visible title that draws any 8 characters of the session's ID.
 */
export function titleFailures(pages: readonly Page[]): string[] {
  const out: string[] = [];
  for (const { session, seen } of pages) {
    const name = `${pageName(session)} (${session.id})`;
    const onPage = flatten(seen.tree).filter((n) => !inList(n, seen.width) && n.bounds.length === 4);
    const titled = onPage.filter((n) => n.role !== 'text_run' && /\bSession\b/.test(n.name ?? '')).sort((a, b) => a.bounds[1]! - b.bounds[1]!);
    const node = session.title ? titled.find((n) => n.name!.includes(session.title!)) : titled[0];
    if (!node) { out.push(`the ${name} has no accessible name holding "Session"${session.title ? ` and its title "${session.title}"` : ''}: its names are ${JSON.stringify(onPage.map((n) => n.name).filter(Boolean).slice(0, 12))}`); continue; }
    const runs = flatten(node).filter((n) => n !== node && n.role === 'text_run' && n.name?.trim()).sort((a, b) => a.bounds[1]! - b.bounds[1]! || a.bounds[0]! - b.bounds[0]!);
    const visible = runs[0]?.name ?? (DRAWS_ITS_NAME.has(node.role) ? node.name! : '');
    if (!visible.trim()) { out.push(`the ${name}'s title node ${JSON.stringify(node.name)} draws nothing`); continue; }
    const piece = idPieces(session.id).find((p) => visible.toLowerCase().includes(p));
    if (piece) out.push(`the ${name}'s visible title ${JSON.stringify(visible)} draws its raw ID (${piece.toUpperCase()})`);
    if (session.title && !visible.includes(session.title)) out.push(`the ${name}'s visible title ${JSON.stringify(visible)} isn't its task's title "${session.title}"`);
  }
  return out;
}

// ---- AC6: the count sentence, on the first screen of a home whose hub holds one open ask.

export const ONE = '1 ask needs you';
/** A count sentence for one that isn't the one sentence: "1 asks", "1 ask need you". */
export const WRONG_ONE = /(?<![\d.])1\s+asks\b|(?<![\d.])1\s+ask\s+need\b(?!s)/i;
export interface Count { surface: 'home' | 'list' | 'menu bar'; texts: string[] }
/** What's wrong with the count on each surface that shows it, naming the surface. */
export function countFailures(counts: readonly Count[]): string[] {
  const out: string[] = [];
  for (const { surface, texts } of counts) {
    const wrong = texts.filter((t) => WRONG_ONE.test(t));
    if (wrong.length) out.push(`the ${surface} reads ${wrong.map((t) => JSON.stringify(t)).join(', ')} for one ask, not "${ONE}"`);
    else if (!texts.some((t) => holds(t, ONE))) out.push(`the ${surface} doesn't read "${ONE}" for one ask: it shows ${JSON.stringify(texts.slice(0, 20))}`);
  }
  return out;
}

// ---- AC4: `deep doctor`'s human output, read against its own `--json` items.

export interface DoctorItem { item?: string; agent?: string; code: string; level: string; evidence: string; fix: string }
/**
 * What's wrong with `deep doctor`'s output: a `Fix:` line under a healthy item (level ok), naming the item, and not
 * exactly one summary line at its end. An item's lines start at the line holding `<item>:`, as the base prints it; a
 * summary line is a line at no indent that names no item.
 */
export function doctorFailures(human: string, items: readonly DoctorItem[]): string[] {
  const out: string[] = [];
  const lines = human.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const names = items.map((i) => i.item).filter((n): n is string => !!n);
  const heading = (line: string): string | undefined => names.filter((n) => line.includes(`${n}:`) || line.includes(`${n} `) || line.endsWith(n)).sort((a, b) => b.length - a.length)[0];
  let current: string | undefined;
  const summaries: number[] = [];
  lines.forEach((line, at) => {
    const named = /^\S/.test(line) ? heading(line) : undefined;
    if (named) current = named;
    else if (/^\s*Fix:/.test(line)) {
      const item = items.find((i) => i.item === current);
      if (item?.level === 'ok') out.push(`deep doctor prints a fix under the healthy item ${current}: ${JSON.stringify(line.trim())}`);
      if (!current) out.push(`deep doctor prints a fix under no item: ${JSON.stringify(line.trim())}`);
    } else if (/^\S/.test(line)) summaries.push(at);
  });
  if (summaries.length !== 1) out.push(`deep doctor ends with ${summaries.length} summary lines, not one: ${JSON.stringify(summaries.map((at) => lines[at]))}`);
  else if (summaries[0] !== lines.length - 1) out.push(`deep doctor's summary line ${JSON.stringify(lines[summaries[0]!])} isn't its last line`);
  if (items.length && items.every((i) => i.level === 'ok')) {
    const fixes = lines.filter((l) => /^\s*Fix:/.test(l));
    if (fixes.length) out.push(`deep doctor prints ${fixes.length} Fix: lines with every item healthy`);
  }
  return [...new Set(out)];
}

// ---- AC5: one definition of the line Set up says.

/** The folders that ship code: what a definition of a sentence is in. Tests, docs and build output aren't. */
const SHIPPED = ['packages', 'crates', 'contracts'];
const CODE = /\.(ts|mts|cts|js|mjs|cjs|rs|json|swift|toml)$/;
/** Every shipped source file, by its path from the repo's root: a test, a fixture or build output is none. */
export function shippedFiles(root = REPO): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'target', 'test', 'tests', 'fixtures', '.git'].includes(entry.name)) continue;
        walk(path);
      } else if (CODE.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name) && statSync(path).size < 4_000_000) {
        let text = readFileSync(path, 'utf8');
        // A Rust file's unit tests sit after its #[cfg(test)]: they check a sentence, they don't define one.
        if (path.endsWith('.rs')) text = text.split(/^\s*#\[cfg\(test\)\]/m)[0]!;
        files.set(relative(root, path), text);
      }
    }
  };
  for (const top of SHIPPED) if (existsSync(join(root, top))) walk(join(root, top));
  return files;
}
/**
 * The longest piece of `line` holding no quote, backslash or backtick and no path (a word with `/` or `~`, which a
 * template fills in at run time): what a source literal or template holds as it is.
 */
export const literalPiece = (line: string): string => line.split(/['"`\\]|\s*\S*[/~]\S*\s*/).map((p) => p.trim()).sort((a, b) => b.length - a.length)[0]!;
/** Each shipped file that holds the line, with how many times. */
export function copiesOf(line: string, files: ReadonlyMap<string, string>): { file: string; times: number }[] {
  const piece = literalPiece(line);
  if (piece.length < 30) blocked(`the line Set up says has no piece of 30 characters a source would hold as it is: ${JSON.stringify(line)}`);
  return [...files].map(([file, text]) => ({ file, times: text.split(piece).length - 1 })).filter((c) => c.times > 0);
}
/** What's wrong with the line's definitions: none, or more than one, naming each file. */
export function definitionFailures(line: string, files: ReadonlyMap<string, string>): string[] {
  const copies = copiesOf(line, files);
  const total = copies.reduce((n, c) => n + c.times, 0);
  if (total === 1) return [];
  if (!total) return [`no shipped source defines the line Set up says: ${JSON.stringify(line)}`];
  return [`the line Set up says is defined ${total} times: ${copies.map((c) => `${c.file}${c.times > 1 ? ` (${c.times} times)` : ''}`).join(', ')}`];
}

// ---- The merge base, for AC4's `--json` and AC7's "before".

/** `git merge-base HEAD origin/main` (or main), read-only. */
export function mergeBase(): string {
  for (const ref of ['origin/main', 'main']) {
    try { return execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: REPO, encoding: 'utf8' }).trim(); } catch { /* the next */ }
  }
  return blocked('no merge base with origin/main or main');
}
/**
 * The merge base's tree, extracted once with `git archive` (no worktree is added and nothing in the checkout moves),
 * under $TMPDIR, kept by its commit for later runs.
 */
export function baseTree(sha = mergeBase()): string {
  const dir = join(tmpdir(), `da1455-base-${sha.slice(0, 12)}`);
  if (existsSync(join(dir, '.da1455-complete'))) return dir;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('/bin/sh', ['-c', `git archive --format=tar ${sha} | tar -x -C '${dir}'`], { cwd: REPO, maxBuffer: 1 << 30 });
  writeFileSync(join(dir, '.da1455-complete'), `${sha}\n`);
  return dir;
}
/**
 * The merge base's CLI, built in its own tree: its node_modules links every package to this checkout's, except the
 * workspace's own packages, which link to the base's.
 */
let baseCli: Promise<string> | undefined;
export function mergeBaseCli(): Promise<string> {
  baseCli ??= (async () => {
    const sha = mergeBase();
    const dir = baseTree(sha);
    const cli = join(dir, 'packages/cli/dist/main.js');
    if (existsSync(join(dir, '.da1455-built'))) return cli;
    const modules = join(dir, 'node_modules');
    rmSync(modules, { recursive: true, force: true });
    mkdirSync(join(modules, '@deepbuild'), { recursive: true });
    const { symlinkSync } = await import('node:fs');
    for (const entry of readdirSync(join(REPO, 'node_modules'))) {
      if (entry === '@deepbuild' || entry === '.bin' || entry.startsWith('.package-lock')) continue;
      symlinkSync(join(REPO, 'node_modules', entry), join(modules, entry));
    }
    symlinkSync(join(REPO, 'node_modules/.bin'), join(modules, '.bin'));
    for (const pkg of readdirSync(join(dir, 'packages'))) {
      const manifest = join(dir, 'packages', pkg, 'package.json');
      if (!existsSync(manifest)) continue;
      const name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name: string }).name;
      if (name.startsWith('@deepbuild/')) symlinkSync(join(dir, 'packages', pkg), join(modules, name));
    }
    const built = await run('npm', ['run', 'build', '--workspaces', '--if-present'], { cwd: dir, timeoutMs: 30 * MINUTES });
    if (built.code !== 0 || !existsSync(cli)) blocked(`the merge base ${sha.slice(0, 8)}'s CLI didn't build: ${shown(built)}`);
    writeFileSync(join(dir, '.da1455-built'), `${sha}\n`);
    return cli;
  })();
  return baseCli;
}

// ---- The taste call (AC7), in #1454's TASTE.json shape.

export interface Taste { issue?: number; criterion?: string; verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));
/** What a run reads of TASTE.json: `null` only when a person called exactly this run's files `looks_right`. */
export function tasteFailure(taste: Taste, got: Record<string, string>): { inconclusive?: string; fails?: string } | null {
  if (taste.verdict === null || taste.verdict === undefined) return { inconclusive: 'AC7: no taste call is recorded for these screenshots (TASTE.json holds none)' };
  if (!taste.who || !taste.when) return { inconclusive: 'AC7: the taste call names no one or no time' };
  if (sorted(taste.files ?? {}) !== sorted(got)) return { inconclusive: 'AC7: the recorded taste call was made on other pictures than this run\'s' };
  if (taste.verdict !== 'looks_right') return { fails: `the recorded taste call says they don't look right: ${taste.note ?? ''}` };
  return null;
}
export const sha256File = (path: string): string => sha256(readFileSync(path));
export { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync };
