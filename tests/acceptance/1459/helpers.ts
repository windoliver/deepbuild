// Test-side tools for #1459 (README). The replica is the real `deep-drive`, `deep-replica` and `deep-live` binaries, each
// built from the checkout (a plant is a Cargo feature of deep-app) and copied out of the target folder under its own name;
// the real app is the real `deep-app` on a real hub, read from outside its process by probe.swift, as an assistive client
// reads it. The judges each criterion's failure message comes from are here too, and judges.test.ts holds each one to a
// right input and the wrong ones. Nothing here stands in for the app, the replica or the hub.
//
// Reused by import: #1172's fixture world (a real hub on a temp home with two sessions and three open asks) and its plain
// app build; #16's temp folders and PID cleanup.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was started
// with; no test touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { childEnv, own, REPO, sleep, tempDir } from '../16/helpers.ts';

export { REPO, sleep, tempDir };
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const FIXTURES = join(SUITE, 'fixtures');

/** The criteria, by `#1459.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  ids: '#1459.7cddc858',
  handle: '#1459.ed7429c5',
  journey: '#1459.8eb65c2f',
  kit: '#1459.7f466ddb',
  panel: '#1459.6759f060',
  parity: '#1459.cd8e77fe',
  identifier: '#1459.73dd3590',
  chart: '#1459.83780a4b',
  voiceover: '#1459.f979c200',
} as const;

/** The reference window, in points, at 2× (design: Decided). */
export const REFERENCE = { width: 1512, height: 982, scale: 2 } as const;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
const LAUNCH_MS = 180_000;

const run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 0): Promise<{ code: number; stdout: string; stderr: string }> => new Promise((resolve) => {
  execFile(cmd, args, { cwd: REPO, env: env ?? process.env, maxBuffer: 256 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
    const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
    resolve({ code, stdout: String(stdout), stderr: String(stderr) + (error && typeof error.code !== 'number' ? ` ${error.message}` : '') });
  });
});

// ---- Builds (README, How to run). The same environment #1172's builds use, so one target folder serves both suites.

/** Cargo features of deep-app this suite builds into the replica (README, Pinned 9). `plant-handle-rows` is #1172's. */
export type Plant = 'plant-row-index-ids' | 'plant-handle-rows' | 'plant-chart-label-beside' | 'plant-row-title-only';
const BIN = join(tmpdir(), `dd1459-bin-${userInfo().uid}`);
export const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const built = new Map<string, Promise<string>>();
async function cargo(args: string[]): Promise<void> {
  const r = await run('cargo', ['build', '--locked', '-q', ...args], CARGO_ENV);
  if (r.code === 0) return;
  const plant = /plant-[\w-]+/.exec(args.join(' '))?.[0];
  if (plant && new RegExp(`feature[^\\n]*${plant}|${plant}[^\\n]*feature`).test(r.stderr)) {
    throw Error(`crates/deep-app/Cargo.toml has no feature ${plant} (README, Pinned 9), so this wrong program can't be built: ${r.stderr.trim().slice(0, 300)}`);
  }
  blocked(`cargo build ${args.join(' ')} failed: ${r.stderr.split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n') || r.stderr.slice(-600)}`);
}
/** `name` from `package`, built plain or with a plant, copied out of the target folder; a plant's build is followed by the plain one. */
function binary(pkg: string, name: string, plant?: Plant): Promise<string> {
  const key = `${name}-${plant ?? 'plain'}`;
  let build = built.get(key);
  if (!build) {
    build = (async () => {
      mkdirSync(BIN, { recursive: true });
      if (plant) await binary(pkg, name);
      await cargo(['-p', pkg, '--bin', name, ...(plant ? ['--features', `deep-app/${plant}`] : [])]);
      const out = join(BIN, key);
      copyFileSync(target(name), out);
      if (plant) await cargo(['-p', pkg, '--bin', name]);
      return out;
    })();
    built.set(key, build);
  }
  return build;
}
export const driveBinary = (plant?: Plant): Promise<string> => binary('deep-replica', 'deep-drive', plant);
export const replicaBinary = (): Promise<string> => binary('deep-replica', 'deep-replica');
export const liveBinary = (): Promise<string> => binary('deep-replica', 'deep-live');
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

export function requireMacos(): void {
  if (process.platform !== 'darwin') blocked(`the replica and the app draw on macOS only; this is ${process.platform}`);
}

// ---- The fixture record (README, The fixture): four sessions, four open asks, oldest first.

export const RECORD = join(FIXTURES, 'record.events.jsonl');
/** #338's fixture record, the one the replica's `--view` and `needs-you@1` draw. */
export const RECORD_338 = join(REPO, 'docs/spikes/338/fixtures/needs-you.events.jsonl');
export interface FixtureAsk { handle: string; question: string; session: string }
export interface FixtureSession { id: string; title: string }
interface Row { session_id: string; event: { id: string; kind: string; subject?: string; log_pos: number; data: Record<string, any> } }
const rowsOf = (path: string): Row[] => readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);
const CLOSING = ['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot'];
/** The open asks of a fixture record, oldest first, as the inbox projection lists them (crates/deep-app/src/events.rs). */
export function openAsks(path = RECORD): FixtureAsk[] {
  const rows = rowsOf(path);
  const closed = new Set(rows.filter((r) => CLOSING.includes(r.event.kind)).map((r) => r.event.subject));
  return rows.filter((r) => r.event.kind === 'ask.created').sort((a, b) => a.event.log_pos - b.event.log_pos)
    .map((r) => ({ handle: `ask:${r.event.id}`, question: String(r.event.data.question), session: r.session_id }))
    .filter((a) => !closed.has(a.handle));
}
export function sessionsOf(path = RECORD): FixtureSession[] {
  return rowsOf(path).filter((r) => r.event.kind === 'task.created').map((r) => ({ id: r.session_id, title: String(r.event.data.title) }));
}
/** Each fixture question, reworded: the same ask, its words changed. */
export const REWORDED: Record<string, string> = {
  'ask:01KB1459AK0000000000000001': 'Login page: blue or green header?',
  'ask:01KB1459AK0000000000000002': 'Receipt font: serif or sans?',
  'ask:01KB1459AK0000000000000003': 'Changelog: a list or prose?',
  'ask:01KB1459AK0000000000000004': 'Totals: ship now or after the sale?',
};
/** A copy of the fixture record with the oldest ask closed (answered from the card), or with every question reworded. */
export function variant(change: 'close-first' | 'reword'): string {
  const rows = rowsOf(RECORD);
  const out = join(tempDir(), `${change}.events.jsonl`);
  if (change === 'close-first') {
    const first = openAsks(RECORD)[0]!;
    const pos = Math.max(...rows.map((r) => r.event.log_pos)) + 1;
    rows.push({ session_id: first.session, event: { v: 1, id: '01KB1459CL0000000000000001', kind: 'ask.answered', writer: 'core', actor: 'you', scope: 'you', subject: first.handle, data: { answer: 'one', via: 'card' }, ts: 1_800_000_000_000 - 60_000, log_pos: pos } as Row['event'] });
  } else {
    for (const r of rows) if (r.event.kind === 'ask.created') r.event.data.question = REWORDED[`ask:${r.event.id}`] ?? blocked(`no rewording for ask:${r.event.id}`);
  }
  writeFileSync(out, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return out;
}

// ---- Snapshots: {window, tree, items}; a node is {role, name, value, id, bounds: [x, y, w, h] in device pixels, children}.

export interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds: number[]; children: SNode[] }
export interface Snapshot { window: { size: number[]; scale: number }; tree: SNode; items: { id: string; value: any }[] }
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
/** The outermost node, in reading order, whose name starts with `words`: a row and the run of text inside it are one row. */
export const rowStarting = (s: Snapshot, words: string): SNode | undefined => flat(s.tree).find((n) => (n.name ?? '').startsWith(words));
/** A session's sidebar row: the button whose name holds its title. */
export const sessionRow = (s: Snapshot, title: string): SNode[] => flat(s.tree).filter((n) => n.role === 'button' && (n.name ?? '').includes(title));
const idOf = (n: SNode | undefined): string | null => (n && typeof n.id === 'string' && n.id ? n.id : null);
const said = (n: SNode): string => JSON.stringify(n.name).slice(0, 120);

// ---- Judges (judges.test.ts holds each to a right input and the wrong ones).

/**
 * AC1: what's wrong with the rows' IDs across closing the oldest ask, `before` showing `asks` and `after` showing every one
 * but `closed`. Every row needs a non-empty `id`, no two rows the same; each other row keeps its `id`; session rows too.
 */
export function idFailures(before: Snapshot, after: Snapshot, asks: readonly FixtureAsk[], closed: FixtureAsk, sessions: readonly FixtureSession[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  for (const ask of asks) {
    const row = rowStarting(before, ask.question);
    if (!row) { out.push(`no row's name starts with ${ask.handle}'s question "${ask.question}"`); continue; }
    const id = idOf(row);
    if (!id) { out.push(`the row for ${ask.handle} ("${ask.question}") carries no id: its node is ${JSON.stringify({ ...row, children: undefined })}`); continue; }
    if (seen.has(id)) out.push(`the rows for ${seen.get(id)} and ${ask.handle} share the id ${id}`);
    seen.set(id, ask.handle);
    if (ask === closed) {
      if (rowStarting(after, ask.question)) out.push(`the closed ask ${ask.handle} still has a row, so nothing closed`);
      continue;
    }
    const later = rowStarting(after, ask.question);
    if (!later) out.push(`the row for ${ask.handle} ("${ask.question}") is gone after ${closed.handle} closed`);
    else if (idOf(later) !== id) out.push(`the row for ${ask.handle} ("${ask.question}") had id ${id} and has ${String(idOf(later))} after ${closed.handle} closed: its id is its place`);
  }
  for (const s of sessions) {
    const [a] = sessionRow(before, s.title);
    const [b] = sessionRow(after, s.title);
    if (!a || !b) { out.push(`session ${s.id} ("${s.title}") has no sidebar row ${a ? 'after' : 'before'} the close`); continue; }
    if (!idOf(a)) out.push(`session ${s.id}'s row ("${s.title}") carries no id`);
    else if (idOf(a) !== idOf(b)) out.push(`session ${s.id}'s row ("${s.title}") had id ${idOf(a)} and has ${String(idOf(b))} after ${closed.handle} closed`);
  }
  return out;
}

const HANDLE = /ask:[0-9A-HJKMNP-TV-Z]{26}/;
/** Every place a handle is drawn or spoken in a snapshot: a node's name or value holding one. */
export const handlesShown = (s: Snapshot): string[] => flat(s.tree).filter((n) => HANDLE.test(`${text(n.name)} ${text(n.value)}`)).map((n) => `${n.role} ${said(n)}${n.value == null ? '' : ` valued ${text(n.value).slice(0, 80)}`}`);

/** AC2: the node `{handle}` located is its ask's row, named first by its question. */
export function locatedFailures(root: SNode | undefined, ask: FixtureAsk): string[] {
  if (!root) return [`{handle: "${ask.handle}"} located nothing`];
  if (!(root.name ?? '').startsWith(ask.question)) return [`{handle: "${ask.handle}"} located a ${root.role} named ${said(root)}, not a row whose name starts with its question "${ask.question}"`];
  if (HANDLE.test(root.name ?? '')) return [`{handle: "${ask.handle}"} located a row whose name holds a handle: ${said(root)}`];
  return [];
}

/** AC3: every string a journey's locators hold, with the step it's in (1-based, the launch first). */
export function locatorWords(journey: readonly Record<string, any>[]): { step: number; key: string; word: string }[] {
  const out: { step: number; key: string; word: string }[] = [];
  const walk = (v: unknown, step: number, key: string): void => {
    if (typeof v === 'string') out.push({ step, key, word: v });
    else if (Array.isArray(v)) v.forEach((x) => walk(x, step, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, step, k);
  };
  journey.forEach((call, i) => {
    for (const where of [call.locator, call.act?.to, call.screenshot?.locator, call.screenshot?.mask, call.screenshot?.highlight, call.record?.mask]) walk(where, i + 1, 'locator');
  });
  return out;
}
/** AC3: the locator words a person can see on the screen: in a node's name or value. */
export function visibleWords(journey: readonly Record<string, any>[], s: Snapshot): string[] {
  const shown = flat(s.tree).map((n) => `${text(n.name)}\n${text(n.value)}`);
  return locatorWords(journey).filter((w) => w.key !== 'role' && shown.some((t) => t.includes(w.word))).map((w) => `step ${w.step}'s locator holds "${w.word}", which the screen shows`);
}

/** The canvas's text items in a snapshot (#390's shape: a `text`, whether it's `bound`, where it's `at` and its `box`, in points). */
export const textItems = (s: Snapshot): { id: string; text: string; bound: boolean; box: number[] | null }[] => s.items
  .filter((i) => i.value && typeof i.value === 'object' && typeof i.value.text === 'string')
  .map((i) => ({ id: i.id, text: i.value.text as string, bound: i.value.bound === true, box: Array.isArray(i.value.at) && Array.isArray(i.value.box) ? [i.value.at[0], i.value.at[1], i.value.box[0], i.value.box[1]].map((v: number) => v * s.window.scale) : null }));
const overlaps = (a: number[], b: number[]): boolean => a[0]! < b[0]! + b[2]! && b[0]! < a[0]! + a[2]! && a[1]! < b[1]! + b[3]! && b[1]! < a[1]! + a[3]!;
/**
 * AC8: the chart's readout (its bound text) is in the tree, on a node where it's drawn; its caption (its other text) is
 * named once in the whole tree, so nothing beside the chart repeats it.
 */
export function chartFailures(s: Snapshot): string[] {
  const items = textItems(s);
  const readouts = items.filter((i) => i.bound);
  const captions = items.filter((i) => !i.bound);
  if (!readouts.length || !captions.length) return [`the page draws no chart with a caption and a readout: its canvas text is ${JSON.stringify(items.map((i) => i.text))}`];
  const out: string[] = [];
  const nodes = flat(s.tree);
  for (const r of readouts) {
    const holding = nodes.filter((n) => `${text(n.name)} ${text(n.value)}`.includes(r.text) && (!r.box || overlaps(n.bounds, r.box)));
    if (!holding.length) out.push(`the chart's readout "${r.text}" (${r.id}) is drawn but no node where it's drawn names or values it`);
  }
  for (const c of captions) {
    const naming = nodes.filter((n) => (n.name ?? '').includes(c.text));
    if (naming.length !== 1) out.push(`the chart's caption "${c.text}" is named by ${naming.length} nodes, not once: ${naming.map(said).join(', ')}`);
  }
  return out;
}

export interface Before { session: string; name: string; parts: string[] }
/** AC9: what a reading lacks of what a screen reader read before: each part, in order, and nothing that's a code or an ID. */
export function readingFailures(reading: string | null, before: Pick<Before, 'parts'>, who: string): string[] {
  if (!reading) return [`${who} reads nothing`];
  const out: string[] = [];
  let at = 0;
  for (const part of before.parts) {
    const found = reading.toLowerCase().indexOf(part.toLowerCase(), at);
    if (found < 0) { out.push(`${who} reads ${JSON.stringify(reading)}, which lacks "${part}"${reading.toLowerCase().includes(part.toLowerCase()) ? ' in its place' : ''}`); continue; }
    at = found + part.length;
  }
  const code = /\b[a-z]+_[a-z_]+\b|\b(?:ask|session|task|claim):\S+|\b[0-9A-HJKMNP-TV-Z]{26}\b/.exec(reading);
  if (code) out.push(`${who} reads ${JSON.stringify(reading)}, which speaks "${code[0]}", a code or an ID, not a word`);
  return out;
}

// ---- The replica, driven: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Record<string, any>) => void)[] = [];
  private exited = false;
  private err = '';
  private constructor(readonly child: ChildProcess) {
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
  /** The binary in `home` (a temp one unless given), once it says `{"ready": true}`. */
  static async start(bin: string, home?: string): Promise<Drive> {
    const dir = tempDir();
    const out = join(dir, 'out');
    mkdirSync(out, { recursive: true });
    const h = home ?? join(dir, 'h');
    mkdirSync(h, { recursive: true });
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(h, {}), stdio: ['pipe', 'pipe', 'pipe'] });
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
  /** One call and its reply; BLOCKED when the binary gives none. */
  async call(args: Record<string, any>): Promise<Record<string, any>> {
    const reply = this.next(180_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${JSON.stringify(got).slice(0, 300)} ${this.err.slice(-600)}`);
    return got;
  }
  async must(args: Record<string, any>): Promise<Record<string, any>> {
    const reply = await this.call(args);
    expect(reply.ok, `${String(args.call)}: ${JSON.stringify(reply).slice(0, 600)}`).toBe(true);
    return reply;
  }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

export const NEEDS_YOU = 'deepbuild/needs-you';
export const SESSION_PAGE = 'deepbuild/session';
/** The whole window's snapshot of `center` over `fixture`, from a fresh replica of `bin`. */
export async function see(bin: string, fixture: string, center = NEEDS_YOU): Promise<Snapshot> {
  const drive = await Drive.start(bin);
  try {
    await drive.must({ call: 'launch', launch: { from: 'fixture', fixture, center } });
    const seen = await drive.must({ call: 'see' });
    return seen.snapshot as Snapshot;
  } finally {
    await drive.stop();
  }
}

/** A stored journey, its `$FIXTURE` set to `fixture`, played call by call; every reply, and the `close` call's. */
export async function playJourney(bin: string, file: string, fixture: string): Promise<{ replies: Record<string, any>[]; closed: Record<string, any> }> {
  const calls = JSON.parse(readFileSync(file, 'utf8').replaceAll('$FIXTURE', fixture)) as Record<string, any>[];
  const drive = await Drive.start(bin);
  try {
    const replies: Record<string, any>[] = [];
    for (const call of calls) replies.push(await drive.call(call));
    return { replies, closed: replies[calls.findIndex((c) => c.call === 'close')] ?? {} };
  } finally {
    await drive.stop();
  }
}

// ---- The kit and the lint (README, Pinned 5 and 6): one JSON line, `needs-you@1`'s and `panel@1`'s verdict shape.

export interface KitVerdict { result?: string; names?: string }
async function verdictOf(args: string[]): Promise<{ code: number; verdict: KitVerdict | null; said: string }> {
  const r = await run(await replicaBinary(), args, childEnv(tempDir(), {}), 120_000);
  const line = r.stdout.trim().split('\n').pop() ?? '';
  let verdict: KitVerdict | null = null;
  try { verdict = JSON.parse(line) as KitVerdict; } catch { verdict = null; }
  return { code: r.code, verdict, said: `${r.stdout.slice(-300)} ${r.stderr.slice(-300)}`.trim() };
}
/** `deep-replica --view-kit needs-you@1 <dir>` on a copy of the view: gpui-shell writes files beside a script it runs. */
export function viewKit(view: string): Promise<{ code: number; verdict: KitVerdict | null; said: string }> {
  const copy = join(tempDir(), 'view');
  cpSync(view, copy, { recursive: true });
  return verdictOf(['--view-kit', 'needs-you@1', copy]);
}
export const journeyLint = (file: string): Promise<{ code: number; verdict: KitVerdict | null; said: string }> => verdictOf(['--journey-lint', file]);

// ---- The shipped pages, replica beside live (AC6).

export const SHIPPED = ['needs-you', 'sidebar', 'session'] as const;
export async function replicaSnapshot(view: string): Promise<Snapshot> {
  const out = tempDir();
  const r = await run(await replicaBinary(), ['--view', view, '--out', out], childEnv(join(out, 'h'), {}), 300_000);
  const file = join(out, 'snapshots', `${view}.json`);
  if (!existsSync(file)) blocked(`deep-replica --view ${view} wrote no snapshot (exit ${r.code}): ${r.stderr.slice(-400)}`);
  return JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
}
/** `deep-live --view <view>`: the real app window on this Mac, its accessibility tree read in its own process. */
export async function liveSnapshot(view: string): Promise<Snapshot> {
  const out = join(tempDir(), `${view}.live.json`);
  const r = await run(await liveBinary(), ['--view', view, '--out', out], childEnv(tempDir(), {}), 300_000);
  if (!existsSync(out)) blocked(`deep-live --view ${view} wrote no live tree (exit ${r.code}): ${r.stderr.slice(-400)}`);
  return JSON.parse(readFileSync(out, 'utf8')) as Snapshot;
}
/** The first node, in pre-order, where two snapshots differ on role, name, value, id, bounds or children; or their items. */
export function firstDifference(a: Snapshot, b: Snapshot): string | null {
  if (JSON.stringify(a.window) !== JSON.stringify(b.window)) return `the window differs: ${JSON.stringify(a.window)} vs ${JSON.stringify(b.window)}`;
  let index = 0;
  const differ = (x: SNode, y: SNode): string | null => {
    const at = index++;
    for (const key of ['role', 'name', 'value', 'id', 'bounds'] as const) {
      if (JSON.stringify(x[key] ?? null) !== JSON.stringify(y[key] ?? null)) return `node ${at} (${x.role} ${said(x)}) differs in ${key}: ${JSON.stringify(x[key] ?? null)} vs ${JSON.stringify(y[key] ?? null)}`;
    }
    if (x.children.length !== y.children.length) return `node ${at} (${x.role} ${said(x)}) has ${x.children.length} children and ${y.children.length}`;
    for (let i = 0; i < x.children.length; i++) { const d = differ(x.children[i]!, y.children[i]!); if (d) return d; }
    return null;
  };
  return differ(a.tree, b.tree) ?? (JSON.stringify(a.items) === JSON.stringify(b.items) ? null : 'the canvas items differ');
}
/** The nodes of a snapshot that carry no `id` key at all, which is missing evidence, not "no id". */
export const withoutIdKey = (s: Snapshot): SNode[] => flat(s.tree).filter((n) => !Object.hasOwn(n, 'id'));

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
    const access = JSON.parse((await run(out, ['access'])).stdout) as { ax: boolean; screen: boolean };
    if (!access.ax) blocked('this process has no Accessibility permission, so no assistive client can read the real window; grant it to the app the tests run under');
    if (!access.screen) blocked('this process has no Screen Recording permission, so nothing can read the real window\'s pixels; grant it to the app the tests run under');
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
export const axFlat = (n: AxNode, into: AxNode[] = []): AxNode[] => { into.push(n); for (const c of n.children) axFlat(c, into); return into; };
/** What VoiceOver speaks for a node's label: its title, else its description. */
export const label = (n: AxNode): string | null => n.title ?? n.description;
export interface Line { text: string; box: number[] }

export class RealApp {
  private err = '';
  private constructor(readonly child: ChildProcess) {
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
  }
  get pid(): number { return this.child.pid!; }
  stderr(): string { return this.err; }
  /** Starts `bin` with `args` in `home`, waits for its window and sets it to the reference window. */
  static async launch(home: string, bin: string, args: string[] = []): Promise<RealApp> {
    await probeBinary();
    const child = spawn(bin, args, { cwd: REPO, env: childEnv(home, {}), stdio: ['ignore', 'ignore', 'pipe'] });
    own(child.pid);
    const app = new RealApp(child);
    const deadline = Date.now() + LAUNCH_MS;
    while (!(await app.windows()).length) {
      if (child.exitCode !== null || child.signalCode !== null) blocked(`deep-app exited (${child.exitCode ?? child.signalCode}) before its window: ${app.err.slice(-600)}`);
      if (Date.now() > deadline) blocked(`deep-app showed no window in ${LAUNCH_MS} ms: ${app.err.slice(-600)}`);
      await sleep(250);
    }
    // The tree read starts the app's accessibility; the resize draws a frame of it.
    await app.tree();
    for (let tries = 0; tries < 40; tries++) {
      const frame = await probe<number[]>('place', String(app.pid), String(REFERENCE.width), String(REFERENCE.height)).catch(() => [] as number[]);
      if (Math.abs((frame[2] ?? 0) - REFERENCE.width) < 1 && Math.abs((frame[3] ?? 0) - REFERENCE.height) < 1) break;
      await sleep(250);
    }
    await probe('front', String(app.pid)).catch(() => undefined);
    await sleep(500);
    return app;
  }
  windows(): Promise<{ id: number; frame: number[] }[]> { return probe('windows', String(this.pid)); }
  async nodes(): Promise<AxNode[]> { return (await probe<{ tree: AxNode }[]>('tree', String(this.pid))).flatMap((w) => axFlat(w.tree)); }
  tree(): Promise<{ tree: AxNode }[]> { return probe('tree', String(this.pid)); }
  /** The main window's pixels read as text (screencapture by window ID, then Vision). */
  async lines(): Promise<Line[]> {
    const wins = await this.windows();
    const win = [...wins].sort((a, b) => b.frame[2]! * b.frame[3]! - a.frame[2]! * a.frame[3]!)[0] ?? blocked('deep-app has no window to read');
    const path = join(tempDir(), 'window.png');
    const shot = await run('/usr/sbin/screencapture', ['-x', '-o', `-l${win.id}`, path]);
    if (shot.code !== 0 || !existsSync(path)) blocked(`screencapture of window ${win.id} failed: ${shot.stderr.slice(-300)}`);
    return probe<Line[]>('ocr', path);
  }
  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill('SIGTERM');
    const deadline = Date.now() + 3000;
    while (this.child.exitCode === null && this.child.signalCode === null && Date.now() < deadline) await sleep(50);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
  }
}
/** Repeats `judge` until it finds nothing wrong or `ms` pass: the app draws what its reader reads a moment after it opens. */
export async function settled(judge: () => Promise<string[]>, ms = 30_000): Promise<string[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const failures = await judge();
    if (!failures.length || Date.now() > deadline) return failures;
    await sleep(500);
  }
}
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** The pixels read as text hold `words`, whatever spacing or punctuation the reading gives it. */
export const reads = (lines: readonly Line[], words: string): boolean => lines.some((l) => squash(l.text).includes(squash(words)));

/** A copy of one of this suite's fixture folders: gpui-shell writes its type files beside a panel it loads. */
export function fixtureCopy(...path: string[]): string {
  const dir = join(tempDir(), path[path.length - 1]!);
  cpSync(join(FIXTURES, ...path), dir, { recursive: true });
  return dir;
}

export { run };
