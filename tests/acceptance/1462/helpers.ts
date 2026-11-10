// Test-side tools for #1462 (README). The replica is the real `deep-drive`, driven over its stdin as the hub's
// deep_drive tool drives it, built from the checkout (a plant or `test-confirm` is a Cargo feature of deep-app) and
// copied out of the target folder under its own name. The real app is the real `deep-app` on a real hub in a temp home,
// read from outside its process by probe.swift as an assistive client reads it, its keys posted to its PID alone. The
// judges each criterion's failure message comes from are here too. Nothing here stands in for the app, the replica or
// the hub.
//
// Reused by import: #26's temp folders, PID cleanup, hub, agent stand-in and record seeding (../26/helpers.ts).
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was started
// with; no test touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { askSources, type AskKind } from '../../../packages/asks/src/index.ts';
import * as t26 from '../26/helpers.ts';

export { t26 };
export const REPO = t26.REPO;
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const FIXTURES = join(SUITE, 'fixtures');
export const RECORD = join(FIXTURES, 'record.events.jsonl');
export const MIN = 60_000;
export const sleep = t26.sleep;
/** The replica's clock ticks in flicks, 705,600,000 a second (crates/deep-replica/src/drive/mod.rs). */
export const FLICKS = 705_600_000;
/** The reference window, in points, at 2× (design: Decided). */
export const REFERENCE = { width: 1512, height: 982, scale: 2 } as const;

/** The criteria, by `#1462.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  table: '#1462.d090fc8d',
  noPointer: '#1462.61a5fe15',
  plugin: '#1462.84d5c9de',
  neverAnswers: '#1462.3f4642da',
  hover: '#1462.dc5506c4',
  follows: '#1462.8cf69728',
  box: '#1462.80c987cd',
  cardKey: '#1462.37c12e9d',
  guard: '#1462.da9a3a2e',
  push: '#1462.efa89138',
  digit: '#1462.f51260a6',
  commandK: '#1462.a91570d4',
  standard: '#1462.bac1a512',
  context: '#1462.a484845b',
  preferences: '#1462.bb9f84a2',
  typeAhead: '#1462.bc2ffc0b',
  failedView: '#1462.c6bf9687',
  switchControl: '#1462.d9f64dd4',
  later: '#1462.e1f0fec7',
  shown: '#1462.7b2b38a6',
  rebind: '#1462.0251dfc8',
  statusMenu: '#1462.bda7846d',
} as const;

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
/** Stops what the file started and removes its folders, once its tests are done. */
export const useCleanup = (): void => { afterAll(() => t26.cleanup(), 60_000); };
export function requireMacos(): void {
  if (process.platform !== 'darwin') blocked(`the app and the replica draw on macOS only; this is ${process.platform}`);
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 0): Promise<{ code: number; stdout: string; stderr: string }> => new Promise((resolve) => {
  execFile(cmd, args, { cwd: REPO, env: env ?? process.env, maxBuffer: 256 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
    const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
    resolve({ code, stdout: String(stdout), stderr: String(stderr) + (error && typeof error.code !== 'number' ? ` ${error.message}` : '') });
  });
});
export { run };

// ---- The fixture record (README, The fixtures): four sessions, three open asks, oldest first.

export const NOW = 1_800_000_000_000;
const session = (n: number): string => `1462e55a-7c1d-4f3e-9b2a-00000000000${n}`;
export interface FixtureSession { id: string; title: string; project: string }
export const SESSIONS: Record<'A' | 'B' | 'C' | 'D', FixtureSession> = {
  A: { id: session(1), title: 'Cart totals', project: 'shop' },
  B: { id: session(2), title: 'Release notes', project: 'docs' },
  C: { id: session(3), title: 'Search index', project: 'docs' },
  D: { id: session(4), title: 'Shop banner', project: 'web' },
};
export interface Option { id: string; label: string; decision: string }
export interface FixtureAsk { handle: string; question: string; session: string; options: Option[]; deadline: number }
const ask = (n: number): string => `ask:01KB1462AK${String(n).padStart(16, '0')}`;
/** The open asks, oldest first: a taste call whose default is an hour and 20 s away, a choice of four, and a push. */
export const ASKS: Record<'taste' | 'choice' | 'push', FixtureAsk> = {
  taste: { handle: ask(1), question: 'Which header colour for the cart page?', session: SESSIONS.A.id, deadline: NOW + 60 * MIN + 20_000, options: [{ id: 'blue', label: 'Blue header', decision: 'none' }, { id: 'green', label: 'Green header', decision: 'none' }] },
  choice: { handle: ask(2), question: 'Which store keeps the release notes?', session: SESSIONS.B.id, deadline: NOW + 1440 * MIN, options: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }, { id: 'postgres', label: 'Postgres', decision: 'none' }, { id: 'redis', label: 'Redis', decision: 'none' }] },
  push: { handle: ask(3), question: 'Push main to origin?', session: SESSIONS.C.id, deadline: NOW + 1440 * MIN, options: [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'No', decision: 'deny' }] },
};
export const OPEN_ASKS = [ASKS.taste, ASKS.choice, ASKS.push];
/** The push's one plan step, which can't be undone, so its switch starts off. */
export const PUSH_STEP = 'git push origin main';
/** Addresses (#1460, Pinned 1): a record ID, never a position. */
export const askAt = (handle: string): string => `ask/${handle.slice('ask:'.length)}`;
export const sessionAt = (id: string): string => `session/${id}`;
export const ADDRESS = /^(ask|session|project|page)\/\S+$/;
/** A row of the list, by its id (#1459, #1460, README Pinned 7): a session's, an ask's, or a project's heading. */
export const ROW_ID = /^(session:[^\s:]+|ask:[0-9A-HJKMNP-TV-Z]{26}|project:[^\s:]+)$/;

// ---- Builds (README, How to run). Each binary once, copied out of the target folder under its own name.

/** Cargo features of deep-app this suite builds (README, Pinned 16). `test-confirm` is #1454's; the rest are plants. */
export type Feature = 'test-confirm'
  | 'plant-action-missing-from-menu' | 'plant-approve-menu-item' | 'plant-hover-only-control' | 'plant-tab-skips-control'
  | 'plant-card-starts-on-allow' | 'plant-commands-click-only' | 'plant-opener-only-logs' | 'plant-no-quit-item'
  | 'plant-context-only-action' | 'plant-list-hides-row' | 'plant-failed-view-silent' | 'plant-step-ignores-press'
  | 'plant-no-later' | 'plant-written-key-hint';
const BIN = join(tmpdir(), `dd1462-bin-${userInfo().uid}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const built = new Map<string, Promise<string>>();
async function cargo(args: string[]): Promise<void> {
  const r = await run('cargo', ['build', '--locked', '-q', ...args], CARGO_ENV);
  if (r.code === 0) return;
  const named = /(plant-[\w-]+|test-confirm)/.exec(args.join(' '));
  const missing = [...args.join(' ').matchAll(/(plant-[\w-]+)/g)].map((m) => m[1]!).find((f) => new RegExp(`feature[^\\n]*${f}|${f}[^\\n]*feature`).test(r.stderr));
  if (named && missing) throw Error(`crates/deep-app/Cargo.toml has no feature ${missing} (README, Pinned 16), so this wrong program can't be built: ${r.stderr.trim().slice(0, 300)}`);
  blocked(`cargo build ${args.join(' ')} failed: ${r.stderr.split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n') || r.stderr.slice(-600)}`);
}
/** `name` from `pkg`, plain or with deep-app's `features`, copied out; a build with features is followed by the plain one. */
function binary(pkg: string, name: string, features: Feature[]): Promise<string> {
  const key = `${name}-${features.join('+') || 'plain'}`;
  let made = built.get(key);
  if (!made) {
    made = (async () => {
      mkdirSync(BIN, { recursive: true });
      if (features.length) await binary(pkg, name, []);
      const flag = features.map((f) => (pkg === 'deep-app' ? f : `deep-app/${f}`)).join(',');
      await cargo(['-p', pkg, '--bin', name, ...(features.length ? ['--features', flag] : [])]);
      const out = join(BIN, key);
      copyFileSync(target(name), out);
      if (features.length) await cargo(['-p', pkg, '--bin', name]);
      return out;
    })();
    built.set(key, made);
  }
  return made;
}
export const driveBinary = (...features: Feature[]): Promise<string> => binary('deep-replica', 'deep-drive', features);
export const appBinary = (...features: Feature[]): Promise<string> => binary('deep-app', 'deep-app', features);
/** What the agent stand-in's hooks run, where the hub looks for it. */
export const hookBinary = (): Promise<void> => cargo(['-p', 'deep-hook', '--bin', 'deep-hook']);

// ---- The action table (README, Pinned 1): one JSON file the app, the guard and these tests read.

export const TABLE = 'crates/deep-app/src/actions.json';
export const RELEASED = 'scripts/actions-released.json';
export interface Action { name: string; verb: string; target: string; key: string | null; variant_of: string | null }
/** The table at `path` under `root`; a failure naming the file when it isn't there or isn't the pinned shape. */
export function readTable(root = REPO, path = TABLE): Action[] {
  const file = join(root, path);
  if (!existsSync(file)) throw Error(`${path}, the action table (README, Pinned 1), doesn't exist`);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { actions?: Action[] };
  if (!Array.isArray(parsed.actions) || !parsed.actions.length) throw Error(`${path} holds no {"actions": [...]} (README, Pinned 1)`);
  for (const a of parsed.actions as unknown as Record<string, unknown>[]) {
    for (const field of ['name', 'verb', 'target']) if (typeof a[field] !== 'string' || !a[field]) throw Error(`${path}: an action has no ${field}: ${JSON.stringify(a)}`);
    if (!('key' in a) || !('variant_of' in a)) throw Error(`${path}: the action "${String(a.name)}" lacks key or variant_of (null when it has none): ${JSON.stringify(a)}`);
  }
  return parsed.actions;
}
export const actionNamed = (table: readonly Action[], name: string): Action | undefined => table.find((a) => a.name === name);

const MODS = ['ctrl', 'alt', 'shift', 'cmd'] as const;
/** A keystroke as GPUI writes it (`cmd-shift-j`): its modifiers in ⌃⌥⇧⌘ order and its key, lower-cased. */
export function parseKey(key: string): { mods: string[]; key: string } {
  const k = key.trim().toLowerCase();
  const minus = k.endsWith('--') || k === '-';
  const parts = (minus ? k.slice(0, -1).replace(/-$/, '') : k).split('-').filter(Boolean);
  const last = minus ? '-' : parts.pop() ?? '';
  const alias: Record<string, string> = { meta: 'cmd', command: 'cmd', option: 'alt', control: 'ctrl' };
  const given = new Set(parts.map((p) => alias[p] ?? p));
  return { mods: MODS.filter((m) => given.has(m)), key: last };
}
export function canon(key: string | null | undefined): string | null {
  if (!key) return null;
  const { mods, key: k } = parseKey(key);
  return [...mods, k].join('-');
}
const NAMED: Record<string, string> = {
  enter: '↩', return: '↩', escape: '⎋', tab: '⇥', space: 'Space', backspace: '⌫', delete: '⌦', up: '↑', down: '↓',
  left: '←', right: '→', home: '↖', end: '↘', pageup: '⇞', pagedown: '⇟',
};
/** The key as a menu draws it (README, Pinned 4): ⌃⌥⇧⌘ in that order, then the key, a letter in capitals. */
export function glyphs(key: string | null): string | null {
  if (!key) return null;
  const { mods: parts, key: k } = parseKey(key);
  const mods = parts.map((m) => ({ ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' })[m as (typeof MODS)[number]] ?? '').join('');
  const shown = NAMED[k] ?? (/^f\d+$/.test(k) ? k.toUpperCase() : k.length === 1 ? k.toUpperCase() : k);
  return `${mods}${shown}`;
}

// ---- Snapshots: {window, tree, items, menu_bar, focus}; a node is {role, name, value, id, bounds, children}.

export interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds: number[]; children: SNode[] }
export interface Snapshot { window: { size: number[]; scale: number }; tree: SNode; items: unknown[]; menu_bar?: { title?: string; items?: unknown }; focus?: unknown }
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
/** The words a subtree holds: every node's name and value, in order. */
export const words = (n: SNode): string[] => flat(n).flatMap((x) => [x.name, typeof x.value === 'string' ? x.value : null]).filter((w): w is string => !!w);
export const byId = (s: Snapshot, id: string): SNode | undefined => flat(s.tree).find((n) => n.id === id);
const said = (n: SNode): string => `${n.role} ${JSON.stringify(n.name)}${typeof n.id === 'string' ? ` (${n.id})` : ''}`;
/** The list's rows in the order the window draws them (README, Pinned 7). */
export const rowIds = (s: Snapshot): string[] => flat(s.tree).map((n) => n.id).filter((id): id is string => typeof id === 'string' && ROW_ID.test(id));
export const askRows = (s: Snapshot): string[] => rowIds(s).filter((id) => id.startsWith('ask:'));
/** The roles of a control: what a person can press, switch or type into. */
export const CONTROL_ROLES = new Set(['button', 'switch', 'check_box', 'radio_button', 'menu_item', 'link', 'combo_box', 'text_input', 'multiline_text_input', 'search_input', 'slider', 'tab', 'list_box_option', 'pop_up_button', 'toggle_button']);
export const controls = (n: SNode): SNode[] => flat(n).filter((x) => CONTROL_ROLES.has(x.role));
/** A control's identity across snapshots: its id, else its role and name. */
export const controlKey = (n: SNode): string => (typeof n.id === 'string' && n.id ? n.id : `${n.role} ${JSON.stringify(n.name)}`);
/** The card's node (#1459) and its controls in reading order (README, Pinned 8). */
export const CARD = 'question-card';
export const cardControls = (s: Snapshot): SNode[] => { const card = byId(s, CARD); return card ? controls(card) : []; };
/** ⌘K's hits (README, Pinned 4): the options in its list, each named exactly its entry, its value the key it shows. */
export const COMMAND_LIST = 'command-list';
export function hits(s: Snapshot): SNode[] {
  const list = byId(s, COMMAND_LIST);
  return list ? flat(list).filter((n) => n.role === 'list_box_option') : [];
}
/** The window's notices (README, Pinned 10): each a node whose id is `notice` or starts with `notice:`. */
export const notices = (s: Snapshot): SNode[] => flat(s.tree).filter((n) => typeof n.id === 'string' && /^notice(:|$)/.test(n.id));
/** A row's context menu (README, Pinned 6): the node `context-menu` and its items in order. */
export const contextItems = (s: Snapshot): string[] | null => {
  const menu = byId(s, 'context-menu');
  return menu ? flat(menu).filter((n) => n.role === 'menu_item').map((n) => n.name ?? '') : null;
};

// ---- What the app sent its hub in a replica (README, Pinned 3).

export interface HubCall { method: string; params?: Record<string, any>; error?: unknown }
const READS = /(\.read$)|^(hub\.health|health|stream\.subscribe|ask\.card|views\.installed)$/;
/** The calls that write: every method but a read. */
export const writes = (calls: readonly HubCall[]): HubCall[] => calls.filter((c) => !READS.test(c.method));
export const shownCalls = (calls: readonly HubCall[]): string => JSON.stringify(calls.map((c) => ({ method: c.method, params: c.params }))).slice(0, 800);

// ---- The replica, driven: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Record<string, any>) => void)[] = [];
  private exited = false;
  private err = '';
  private constructor(readonly child: ChildProcess, readonly home: string) {
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
  /** The binary in a temp home of its own (or `home`), with `env` added, once it says `{"ready": true}`. */
  static async start(bin: string, env: Record<string, string> = {}, at?: string): Promise<Drive> {
    const dir = t26.tempDir();
    const out = join(dir, 'out');
    const home = at ?? join(dir, 'h');
    mkdirSync(out, { recursive: true });
    mkdirSync(join(home, '.deepbuild'), { recursive: true });
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: t26.childEnv(home, env), stdio: ['pipe', 'pipe', 'pipe'] });
    t26.own(child.pid);
    const drive = new Drive(child, home);
    const ready = await drive.next(300_000);
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
  /** One call and its reply; BLOCKED when the binary gives none. */
  async call(args: Record<string, any>, ms = 300_000): Promise<Record<string, any>> {
    const reply = this.next(ms);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${JSON.stringify(got).slice(0, 300)} ${this.err.slice(-600)}`);
    return got;
  }
  stderr(): string { return this.err; }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

/** A launch: the fixture (this suite's by default), or `record_copy` of the hub in `home`; a panel and its view. */
export interface Launch { fixture?: string; from?: 'fixture' | 'record_copy'; home?: string; env?: Record<string, string>; panel?: string; view?: Record<string, unknown>; clock?: 'virtual' | 'real' }
export interface Seen { snapshot: Snapshot; hub: HubCall[] | undefined; address: string | null; t: number }
export interface MenuItem { name: string; key: string | null; enabled?: boolean; items?: MenuItem[] }
export interface Menu { name: string; items: MenuItem[] }
/** Every item of a menu bar, with the menu it is in, submenus flattened. */
export const allItems = (menus: readonly Menu[]): { menu: string; item: MenuItem }[] => {
  const out: { menu: string; item: MenuItem }[] = [];
  const walk = (menu: string, items: readonly MenuItem[]): void => { for (const item of items) { out.push({ menu, item }); if (item.items) walk(menu, item.items); } };
  for (const m of menus) walk(m.name, m.items ?? []);
  return out;
};

/** A replica, as an agent drives it: each call's reply, or the failure it gave, in words a test reports. */
export class Replica {
  private constructor(readonly drive: Drive) {}
  /** A fresh `deep-drive` of `bin`, launched on the fixture with Needs you in the center; the launch's reply too. */
  static async start(bin: string, o: Launch = {}): Promise<{ r: Replica; launched: Record<string, any> }> {
    const drive = await Drive.start(bin, o.env ?? {}, o.home);
    const launch: Record<string, unknown> = o.from === 'record_copy'
      ? { from: 'record_copy', center: 'deepbuild/needs-you' }
      : { from: 'fixture', fixture: o.fixture ?? RECORD, center: 'deepbuild/needs-you' };
    if (o.panel) launch.panel = o.panel;
    if (o.view) launch.view = o.view;
    if (o.clock) launch.clock = o.clock;
    const launched = await drive.call({ call: 'launch', launch });
    return { r: new Replica(drive), launched };
  }
  /** As `start`, failing BLOCKED when the replica doesn't launch. */
  static async on(bin: string, o: Launch = {}): Promise<Replica> {
    const { r, launched } = await Replica.start(bin, o);
    if (launched.ok !== true) { await r.stop(); blocked(`the replica didn't launch on the fixture: ${JSON.stringify(launched).slice(0, 400)}`); }
    return r;
  }
  get home(): string { return this.drive.home; }
  /** One call; its reply, or a thrown failure naming `what` and the replica's error. */
  async must(what: string, call: Record<string, unknown>, wallMs = 300_000): Promise<Record<string, any>> {
    const reply = await this.drive.call(call, wallMs);
    if (reply.ok !== true) throw Error(`${what}: ${JSON.stringify(reply.error ?? reply).slice(0, 400)}`);
    return reply;
  }
  press(keys: string): Promise<Record<string, any>> { return this.must(`pressing ${keys}`, { call: 'act', act: { kind: 'press', keys } }); }
  type(words: string): Promise<Record<string, any>> { return this.must(`typing "${words}"`, { call: 'act', act: { kind: 'type', text: words } }); }
  click(locator: Record<string, unknown>, what = `a click on ${JSON.stringify(locator)}`): Promise<Record<string, any>> { return this.must(what, { call: 'act', locator, act: { kind: 'click' } }); }
  hover(locator: Record<string, unknown>): Promise<Record<string, any>> { return this.must(`hovering ${JSON.stringify(locator)}`, { call: 'act', locator, act: { kind: 'hover' } }); }
  /** A secondary click (README, Pinned 6): `act` of kind `context_click`. */
  contextClick(locator: Record<string, unknown>): Promise<Record<string, any>> { return this.must(`a secondary click on ${JSON.stringify(locator)}`, { call: 'act', locator, act: { kind: 'context_click' } }); }
  open(address: string): Promise<Record<string, any>> { return this.must(`deep_drive's open of ${address}`, { call: 'open', open: { address } }); }
  feed(sessionId: string, event: Record<string, unknown>): Promise<Record<string, any>> { return this.must(`feeding ${String(event.kind)}`, { call: 'feed', feed: { session: sessionId, event } }); }
  /** Lets `ms` of the replica's clock pass from now. */
  async pass(ms: number, timeoutMs = ms + 5000): Promise<void> {
    const t = (await this.see()).t;
    await this.must(`waiting ${ms} ms of the replica's clock`, { call: 'wait_for', wait_for: { t: Math.round(t + (ms * FLICKS) / 1000) }, timeout: timeoutMs });
  }
  /** The window now: its snapshot, what the app sent its hub (Pinned 3), the address it shows and the clock. */
  async see(): Promise<Seen> {
    const reply = await this.must('see', { call: 'see' });
    return { snapshot: reply.snapshot as Snapshot, hub: Array.isArray(reply.hub) ? (reply.hub as HubCall[]) : undefined, address: (reply.address as string | null) ?? null, t: Number(reply.t ?? 0) };
  }
  async focus(): Promise<string | null> { const f = (await this.see()).snapshot.focus; return typeof f === 'string' ? f : null; }
  /** The menu bar as the app set it (README, Pinned 2): a failure naming the call when the replica has none. */
  async menus(): Promise<Menu[]> {
    const reply = await this.drive.call({ call: 'menus' });
    if (reply.ok !== true) throw Error(`deep_drive has no menu bar to read: {"call": "menus"} answered ${JSON.stringify(reply.error ?? reply).slice(0, 300)} (README, Pinned 2)`);
    return reply.menus as Menu[];
  }
  /** What the app sent its hub since launch (Pinned 3); a failure naming the field when `see` gives none. */
  async hubCalls(): Promise<HubCall[]> {
    const { hub } = await this.see();
    if (!hub) throw Error('deep_drive\'s see reply has no `hub` list of what the app sent its hub (README, Pinned 3)');
    return hub;
  }
  stop(): Promise<void> { return this.drive.stop(); }
}

/** Waits for the question card to arm, up to 3 s of the replica's clock; its value then. */
export async function armed(r: Replica): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const card = byId((await r.see()).snapshot, CARD);
    if (card?.value === 'armed') return 'armed';
    await r.pass(100);
  }
  return String(byId((await r.see()).snapshot, CARD)?.value ?? 'no card');
}

/**
 * Puts the keyboard in the list (README, Pinned 7): F6 moves between the list, the page and the box, so up to three
 * presses. With `pointer`, a click on session B's row is the fallback, for a criterion that doesn't say "no pointer": B's
 * title and project don't start with "shop", so the click can't stand in for AC16's typing.
 */
export async function toList(r: Replica, pointer: boolean): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    const f = await r.focus();
    if (f && ROW_ID.test(f)) return f;
    await r.press('f6');
  }
  const f = await r.focus();
  if (f && ROW_ID.test(f)) return f;
  if (!pointer) return null;
  await r.click({ id: `session:${SESSIONS.B.id}` }, 'a click on session B\'s row, to put the keyboard in the list');
  const g = await r.focus();
  return g && ROW_ID.test(g) ? g : null;
}

/** Moves the keyboard down or up the list until it is on `id`; whether it got there. */
export async function focusRow(r: Replica, id: string): Promise<boolean> {
  for (const key of ['down', 'up']) {
    for (let i = 0; i < 16; i++) {
      if ((await r.focus()) === id) return true;
      await r.press(key);
    }
  }
  return (await r.focus()) === id;
}

/** Runs the table's action `name` on what is selected: by its key when the table gives one, else ⌘K, its name, Return. */
export async function runAction(r: Replica, table: readonly Action[] | null, name: string): Promise<string> {
  const key = table ? actionNamed(table, name)?.key : null;
  if (key) { await r.press(key); return `its key ${key}`; }
  await r.press('cmd-k');
  await r.type(name);
  await r.press('enter');
  return `⌘K, "${name}", Return`;
}
/** The table, or null with why, so a test that runs an action can still try ⌘K. */
export function tableOrNull(): { table: Action[] | null; why: string } {
  try { return { table: readTable(), why: '' }; } catch (error) { return { table: null, why: (error as Error).message }; }
}

/** A copy of one of this suite's fixture folders: gpui-shell writes files beside a panel it loads. */
export function fixtureCopy(name: string): string {
  const dir = join(t26.tempDir(), name);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}
/** The plug-in's registration (README, The fixtures), as `deep.registerView` gives it. */
export const BOARD_VIEW = { name: 'Board', pages: [{ name: 'Board', param: 'name', values: ['alpha'] }], commands: [{ name: 'Refresh board', action: 'ext.board.refresh' }] };
export const BOARD_PAGE = 'Board: alpha';
export const BOARD_COMMAND = 'Refresh board';
export const FAILING_VIEW = { name: 'Refused board', pages: [], commands: [] };

/** ⌘K opened with `query` typed: its hits. Escape closes it again when `close`. */
export async function commandK(r: Replica, query: string, close = true): Promise<SNode[]> {
  await r.press('cmd-k');
  if (query) await r.type(query);
  const found = hits((await r.see()).snapshot);
  if (close) await r.press('escape');
  return found;
}

// ---- Judges.

/** AC1: each action of the table in the menu bar and in ⌘K, with its name and its key. */
export function tableFailures(table: readonly Action[], menus: readonly Menu[], shown: ReadonlyMap<string, SNode | undefined>): string[] {
  const items = allItems(menus);
  const out: string[] = [];
  for (const a of table) {
    const found = items.filter((i) => i.item.name === a.name);
    if (!found.length) out.push(`the action "${a.name}" (${a.key ?? 'no key'}) is in no menu of the menu bar`);
    else if (!found.some((i) => canon(i.item.key) === canon(a.key))) out.push(`the menu's "${a.name}" shows ${found.map((i) => i.item.key ?? 'no key').join(', ')}, not the table's ${a.key ?? 'no key'}`);
    const hit = shown.get(a.name);
    if (!hit) out.push(`⌘K finds no hit named "${a.name}"`);
    else if ((typeof hit.value === 'string' && hit.value.trim() ? hit.value.trim() : null) !== glyphs(a.key)) out.push(`⌘K shows ${JSON.stringify(hit.value)} beside "${a.name}", not ${JSON.stringify(glyphs(a.key))}, the table's ${a.key ?? 'no key'}`);
  }
  return out;
}

/** AC4: a menu item that answers: an answer's verb, or an open ask's option by its label. */
const ANSWERING = /^(approve|allow|deny|decline|reject|accept|yes|no)\b/i;
export function answeringItems(menus: readonly Menu[], labels: readonly string[]): string[] {
  return allItems(menus).filter(({ item }) => ANSWERING.test(item.name.trim()) || labels.includes(item.name.trim()))
    .map(({ menu, item }) => `the menu item "${item.name}" in ${menu} answers an ask`);
}

/** AC13: the Quit item, on ⌘Q. */
export function quitFailures(items: readonly { menu: string; item: MenuItem }[]): string[] {
  const quit = items.filter(({ item }) => /^quit\b/i.test(item.name));
  if (!quit.length) return ['the menu bar has no Quit item: no item named "Quit …" in any menu'];
  return quit.some(({ item }) => canon(item.key) === 'cmd-q') ? [] : [`the Quit item ${quit.map(({ item }) => `"${item.name}"`).join(', ')} isn't on ⌘Q: ${quit.map(({ item }) => item.key ?? 'no key').join(', ')}`];
}

/** AC10: on an approval focus starts on the option that says no; naming the option it started on. */
export function startFailures(focus: string | null, options: readonly Option[]): string[] {
  const no = options.find((o) => o.decision === 'deny')!;
  if (focus === `card-option:${no.id}`) return [];
  const on = options.find((o) => focus === `card-option:${o.id}`);
  if (on) return [`focus starts on "${on.label}" (${focus})${on.decision === 'allow' ? ', the option that allows' : ''}; on an approval it starts on "${no.label}" (card-option:${no.id})`];
  return [`focus starts on ${focus ?? 'nothing'}, not on "${no.label}" (card-option:${no.id})`];
}

/** AC10: Tab from the first control reaches every control on the card, each named when it's skipped. */
export function tabFailures(visited: readonly (string | null)[], all: readonly SNode[]): string[] {
  const out: string[] = [];
  for (const c of all) {
    if (typeof c.id !== 'string' || !c.id) { out.push(`the card's control ${said(c)} carries no id, so no one can tell where focus is (README, Pinned 8)`); continue; }
    if (!visited.includes(c.id)) out.push(`Tab skips the card's control "${c.name ?? ''}" (${c.id}): it visits ${JSON.stringify(visited)}`);
  }
  return out;
}

/** AC6, AC16: what a screen reader speaks of a row: its name, never an ID. */
export function readingFailures(reading: string | null | undefined, startsWith: string, who: string): string[] {
  if (!reading) return [`${who} reads nothing`];
  const out: string[] = [];
  if (!reading.startsWith(startsWith)) out.push(`${who} reads ${JSON.stringify(reading)}, which doesn't start with "${startsWith}"`);
  const code = /\b(?:ask|session|task|claim):\S+|\b[0-9A-HJKMNP-TV-Z]{26}\b/.exec(reading);
  if (code) out.push(`${who} reads ${JSON.stringify(reading)}, which speaks "${code[0]}", an ID, not a word`);
  return out;
}

// ---- The real app, read from outside its process as an assistive client reads it (probe.swift).

let compiled: Promise<string> | undefined;
export function probeBinary(): Promise<string> {
  requireMacos();
  compiled ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    const out = join(BIN, `probe-${sha256(readFileSync(join(SUITE, 'probe.swift'))).slice(0, 12)}`);
    if (!existsSync(out)) {
      const r = await run('swiftc', ['-O', '-module-cache-path', join(BIN, 'swift-cache'), join(SUITE, 'probe.swift'), '-o', out]);
      if (r.code !== 0) blocked(`probe.swift didn't compile: ${r.stderr.slice(-400)}`);
    }
    const access = JSON.parse((await run(out, ['access'])).stdout) as { ax: boolean; screen: boolean; locked: boolean };
    if (!access.ax) blocked('this process has no Accessibility permission, so no assistive client can read the real window or post its keys; grant it to the app the tests run under');
    if (!access.screen) blocked('this process has no Screen Recording permission, so nothing can read the real window\'s pixels; grant it to the app the tests run under');
    if (access.locked) blocked('the screen is locked, so the real window draws nothing a person could read and takes no key');
    return out;
  })();
  return compiled;
}
const probe = async <T>(...args: string[]): Promise<T> => {
  const r = await run(await probeBinary(), args, undefined, 60_000);
  if (r.code !== 0) blocked(`probe ${args[0]} failed: ${r.stderr.slice(-300)}`);
  return JSON.parse(r.stdout) as T;
};

/** A node as an assistive client gets it: each text null when it gets none. */
export interface AxNode { role: string | null; title: string | null; description: string | null; value: string | null; identifier: string | null; frame: number[]; children: AxNode[] }
export const axFlat = (n: AxNode, into: AxNode[] = []): AxNode[] => { into.push(n); for (const c of n.children ?? []) axFlat(c, into); return into; };
/** What VoiceOver speaks for a node's label: its title, else its description. */
export const label = (n: AxNode): string | null => n.title ?? n.description;
export interface AxItem { title: string; char: string | null; mods: number; virtual: number | null; glyph: number | null; enabled: boolean; items: AxItem[] }
/** A menu item's key as AppKit keeps it, in the table's keystroke form (README, Pinned 4). */
export function axKey(item: Pick<AxItem, 'char' | 'mods' | 'virtual'>): string | null {
  if (!item.char && item.virtual == null) return null;
  const mods: string[] = [];
  if (item.mods & 4) mods.push('ctrl');
  if (item.mods & 2) mods.push('alt');
  if (item.mods & 1) mods.push('shift');
  if (!(item.mods & 8)) mods.push('cmd');
  const virtual: Record<number, string> = { 36: 'enter', 53: 'escape', 48: 'tab', 49: 'space', 51: 'backspace', 123: 'left', 124: 'right', 125: 'down', 126: 'up', 97: 'f6' };
  const key = item.char && item.char.trim() ? item.char.toLowerCase() : virtual[item.virtual ?? -1] ?? String(item.virtual);
  return canon([...mods, key].join('-'));
}
export const axMenus = (bar: { title: string | null; items: AxItem[] }[]): Menu[] => {
  const conv = (i: AxItem): MenuItem => ({ name: i.title, key: axKey(i), enabled: i.enabled, items: i.items.map(conv) });
  return bar.map((m) => ({ name: m.title ?? '', items: m.items.map(conv) }));
};

/** macOS's virtual key codes on a US keyboard, which probe.swift posts (kVK_*). */
const KEYCODES: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, 1: 18, 2: 19, 3: 20,
  4: 21, 6: 22, 5: 23, '=': 24, 9: 25, 7: 26, '-': 27, 8: 28, 0: 29, ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35, enter: 36, l: 37,
  j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46, '.': 47, tab: 48, space: 49, '`': 50, backspace: 51,
  escape: 53, f5: 96, f6: 97, f7: 98, f3: 99, f8: 100, f9: 101, f11: 103, f10: 109, f12: 111, f4: 118, f2: 120, f1: 122,
  left: 123, right: 124, down: 125, up: 126,
};
/** probe.swift's `key` arguments for a keystroke in the table's form. */
export function keyArgs(keystroke: string): string[] {
  const { mods, key } = parseKey(keystroke);
  const code = KEYCODES[key === 'return' ? 'enter' : key];
  if (code === undefined) throw Error(`no key code for "${key}" in ${keystroke}`);
  return [String(code), ...mods];
}

const LAUNCH_MS = 180_000;
export class App {
  private err = '';
  private constructor(readonly child: ChildProcess) {
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-20_000); });
  }
  get pid(): number { return this.child.pid!; }
  stderr(): string { return this.err; }
  get exited(): boolean { return this.child.exitCode !== null || this.child.signalCode !== null; }
  /** Starts `bin` in `home` with `env`, waits for its window, sets it to the reference window and brings it forward. */
  static async launch(home: string, bin: string, env: Record<string, string> = {}): Promise<App> {
    await probeBinary();
    const child = spawn(bin, [], { cwd: REPO, env: t26.childEnv(home, env), stdio: ['ignore', 'ignore', 'pipe'] });
    t26.own(child.pid);
    const app = new App(child);
    const deadline = Date.now() + LAUNCH_MS;
    while (!(await app.windows()).length) {
      if (app.exited) blocked(`deep-app exited (${child.exitCode ?? child.signalCode}) before its window: ${app.err.slice(-600)}`);
      if (Date.now() > deadline) blocked(`deep-app showed no window in ${LAUNCH_MS} ms: ${app.err.slice(-600)}`);
      await sleep(250);
    }
    await app.nodes();
    for (let tries = 0; tries < 40; tries++) {
      const frame = await probe<number[]>('place', String(app.pid), String(REFERENCE.width), String(REFERENCE.height)).catch(() => [] as number[]);
      if (Math.abs((frame[2] ?? 0) - REFERENCE.width) < 1 && Math.abs((frame[3] ?? 0) - REFERENCE.height) < 1) break;
      await sleep(250);
    }
    await app.front();
    await sleep(500);
    return app;
  }
  windows(): Promise<{ id: number; frame: number[] }[]> { return probe('windows', String(this.pid)); }
  async nodes(): Promise<AxNode[]> { return (await probe<{ tree: AxNode }[]>('tree', String(this.pid))).flatMap((w) => axFlat(w.tree)); }
  front(): Promise<void> { return probe<boolean>('front', String(this.pid)).then(() => undefined, () => undefined); }
  /** One keystroke in the table's form, posted to this process alone, the app brought forward first. */
  async key(keystroke: string): Promise<void> {
    await this.front();
    await probe('key', String(this.pid), ...keyArgs(keystroke));
    await sleep(150);
  }
  async type(words: string): Promise<void> {
    await this.front();
    await probe('type', String(this.pid), words);
    await sleep(150);
  }
  /** What holds the keyboard, as VoiceOver and Full Keyboard Access follow it (README, Pinned 8). */
  focused(): Promise<AxNode | null> { return probe('focused', String(this.pid)); }
  async focusId(): Promise<string | null> { return (await this.focused())?.identifier ?? null; }
  /** The address the window shows: its page node's identifier (#1460, Pinned 2). */
  async address(): Promise<string | null> {
    const pages = (await this.nodes()).map((n) => n.identifier).filter((id): id is string => !!id && ADDRESS.test(id));
    return pages.length === 1 ? pages[0]! : null;
  }
  async menus(): Promise<Menu[]> { return axMenus(await probe('menubar', String(this.pid))); }
  openMenu(title: string): Promise<{ found: boolean; frame?: number[]; items?: AxItem[] }> { return probe('openmenu', String(this.pid), title); }
  cancelMenus(): Promise<void> { return probe('cancel', String(this.pid)).then(() => undefined); }
  status(): Promise<{ title: string | null; opened: boolean; items: AxItem[] }[]> { return probe('status', String(this.pid)); }
  pressId(id: string): Promise<{ found: boolean; pressed?: boolean }> { return probe('pressid', String(this.pid), id); }
  /** The main window's pixels, captured by its window ID, never the display. */
  async capture(path: string): Promise<string> {
    const wins = await this.windows();
    const win = [...wins].sort((a, b) => b.frame[2]! * b.frame[3]! - a.frame[2]! * a.frame[3]!)[0] ?? blocked('deep-app has no window to capture');
    const shot = await run('/usr/sbin/screencapture', ['-x', '-o', `-l${win.id}`, path]);
    if (shot.code !== 0 || !existsSync(path)) blocked(`screencapture of window ${win.id} failed: ${shot.stderr.slice(-300)}`);
    return path;
  }
  async stop(): Promise<void> {
    if (this.exited) return;
    this.child.kill('SIGTERM');
    const deadline = Date.now() + 3000;
    while (!this.exited && Date.now() < deadline) await sleep(50);
    if (!this.exited) this.child.kill('SIGKILL');
  }
}
/** Repeats `judge` until it finds nothing wrong or `ms` pass. */
export async function settled(judge: () => Promise<string[]>, ms = 15_000): Promise<string[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const failures = await judge();
    if (!failures.length || Date.now() > deadline) return failures;
    await sleep(400);
  }
}

// ---- Real worlds: #26's hub and agent stand-in in a temp home, the record seeded before the hub starts.

export interface RealAsk { handle: string; question: string; session: string; options: Option[] }
export interface RealSession { id: string; title: string }
export interface Real { world: t26.World; sessions: RealSession[]; asks: RealAsk[] }
const sourceOf = (kind: AskKind): string => askSources().find((row) => row.kind === kind && !/^(asks|request)\./.test(row.source))!.source;
export interface Spec { title: string; ask?: { kind: 'taste' | 'choice' | 'authority'; question: string; options: Option[]; recommended: string | null; default: string; steps?: Record<string, unknown>[] } }
/**
 * A real hub in a temp home with the agent stand-in's session and one seeded session per spec, each with its task's title
 * and its ask; setup finished, so the window opens on the shell (#1002's marker).
 */
export async function realWorld(specs: readonly Spec[]): Promise<Real> {
  await hookBinary();
  const sessions: RealSession[] = [];
  const asks: RealAsk[] = [];
  const world = await t26.agentWorld({
    seeded: async (s) => {
      for (const spec of specs) {
        const id = randomUUID();
        s.at(s.now() + 1000);
        await s.start(id);
        const who = { actor: 'you', scope: 'you', session: id, project: t26.PROJECT };
        await s.record.append({ writer: 'app', ...who }, { v: 1, id: t26.ulid(s.now()), kind: 'task.created', ts: s.now(), data: { task_ref: `task:${t26.ulid(s.now())}`, thread: id, owner: 'you', title: spec.title } } as never);
        sessions.push({ id, title: spec.title });
        if (!spec.ask) continue;
        const a = spec.ask;
        const data = { ...t26.askData(a.kind, a.question, s.now()), options: a.options, recommended: a.recommended, default: a.default };
        const plan = a.steps ? { steps: a.steps, diff: sha256(a.question) } : undefined;
        const handle = await (s.asks.raise as (...args: unknown[]) => Promise<string>)({ writer: 'core', ...who }, sourceOf(a.kind), data, plan);
        asks.push({ handle, question: a.question, session: id, options: a.options });
      }
    },
  });
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(t26.rootOf(world.home), 'setup-finished.json'), JSON.stringify({ version }));
  return { world, sessions, asks };
}
/** The confirm file `test-confirm` reads in place of the OS's prompt (#1454): `confirmed` is you. */
export function confirmFile(said: 'confirmed' | 'cancelled'): string {
  const file = join(t26.tempDir(), 'confirm');
  writeFileSync(file, `${said}\n`);
  return file;
}
export const answersOf = (all: readonly t26.Ev[], handle: string): t26.Ev[] => all.filter((e) => e.kind === 'ask.answered' && e.subject === handle);
