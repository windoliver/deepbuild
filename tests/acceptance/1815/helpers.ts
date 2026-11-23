// Test-side tools for #1815 (README). The window is the real `deep-drive` (#124) drawing the app's own views headless,
// launched on a fixture record these helpers write to a temp folder: no hub, no CLI and no network. A session's page
// draws its newest failed run's output as content (#1498's `content`), so a fixture's "messages" are lines of that run.
//
// Reused by import: #16's temp folders, child environment and PID cleanup; #1461's snapshot readers; #1808's `deep-drive`
// client and its geometry; #1101's build of `deep-drive` with `env-plants` and `test-confirm`, in a grant of the build
// throttle, kept outside the target folder and reused while it is newer than every Rust source.
//
// Safety: HOME is a temp folder for every process started; a process is stopped only by the PID it was started with;
// nothing touches the real ~/.deepbuild or ~/.claude; no network, no model.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { childEnv, cleanup, makeHome, own, REPO, sha256, tempDir, type Line } from '../16/helpers.ts';
import { byId, flat, FLICKS, runsIn, type Snapshot, type SNode } from '../1461/helpers.ts';
import { cross, inside, overlap, pageView, Replica, windowBox, type Box } from '../1808/helpers.ts';
import { driveBin } from '../1101/helpers.ts';

export { byId, cleanup, driveBin, inside, pageView, REPO, Replica, sha256, tempDir, windowBox, type Line, type Snapshot };
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const MIN = 60_000;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
export const said = (v: unknown, n = 300): string => (JSON.stringify(v) ?? String(v)).slice(0, n);

/** The criteria, by `#1815.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  walk: '#1815.346b32b0',
  chrome: '#1815.d7e06bb8',
  closes: '#1815.fb03fd00',
  budget: '#1815.e2a26281',
  shown: '#1815.0afba244',
} as const;

/** The planted wrong programs (README, Plants), each selected by DEEP_HUB_PLANT=<name> in the `env-plants` build. */
export const PLANT = {
  /** AC1: find searches only the content lines the window draws when the words change. */
  drawnOnly: 'find-drawn-only',
  /** AC2: find's matches also count the page's and the list's chrome: titles, headings, state words and labels. */
  matchesChrome: 'find-matches-chrome',
  /** AC3: Escape closes the field and scrolls the page back to its top. */
  escapeRewinds: 'find-escape-rewinds',
  /** AC3: ⌘F on an ask's page opens the field there as on any page. */
  onAsk: 'find-on-ask',
} as const;

// ---- The fixture record (README, The fixtures).

/** `crates/deep-replica`'s NOW: where a replica launched on a fixture starts its clock. */
const NOW = 1_800_000_000_000;
export const WORD = 'backoff';
/** Every page's title, a heading; `HEADING_WORD` is drawn nowhere but in it and in what repeats it. */
export const TITLE = 'Ledger reconciliation';
export const HEADING_WORD = 'reconciliation';
const no = (n: number): string => String(n).padStart(5, '0');
/** Every other line; it holds no q (AC4) and no word of AC2's. */
const plain = (n: number): string => `step ${no(n)}: call sent, reply received`;

/** A session whose page draws `lines`, its newest failed run's output; `match`, in order, the lines holding what is searched for. */
export interface Page { id: string; address: string; lines: string[]; match: string[] }
function pageOf(n: number, total: number, match: Record<number, string>): Page {
  const id = `1815a5e0-6f1c-4a2b-9c3d-00000000000${n}`;
  const texts = Object.fromEntries(Object.entries(match).map(([at, text]) => [at, `step ${no(Number(at))}: ${text}`]));
  return { id, address: `session/${id}`, lines: Array.from({ length: total }, (_, i) => texts[i + 1] ?? plain(i + 1)), match: Object.values(texts) };
}
const retries = (third: number): Record<number, string> => ({ 3: `first retry, ${WORD} 200 ms`, 12: `second retry, ${WORD} 400 ms`, [third]: `third retry, ${WORD} 800 ms` });
/** AC1's page: the word on lines 3 and 12, on the first screen, and on line 4,003, 4,000 lines below the first. */
export const LONG = pageOf(1, 4100, retries(4003));
/** The same on a page cheaper to draw, its third line 200 below its first, past the first screen too. */
export const SHORT = pageOf(2, 240, retries(203));
/** AC4's 10,000 lines: one character its page draws nowhere else, in the line before the last. */
export const FAR = 'Q';
export const BIG = pageOf(3, 10_000, { 9999: `case ${FAR} replayed` });
const ASK_ID = '01KB1815AK0000000000000001';
export const ASK_AT = `ask/${ASK_ID}`;
const QUESTION = 'Which store keeps the release notes?';

/**
 * The record as `launch.fixture` reads it, written to a temp folder: each of `pages` as a session with a title and a
 * failed run whose actual output is its lines (run.finished@3, as #1808 feeds one), and a session with an open choice ask.
 */
export function record(pages: readonly Page[]): string {
  const rows: string[] = [];
  let pos = 0;
  const add = (session: string, project: string, kind: string, v: number, writer: string, data: Line, id?: string): void => {
    pos += 1;
    const event = { v, id: id ?? `01KB1815EV${String(pos).padStart(16, '0')}`, kind, writer, actor: 'you', scope: 'you', data, ts: NOW - (60 - pos) * MIN, log_pos: pos };
    rows.push(JSON.stringify({ session_id: session, project_id: project, event }));
  };
  const session = (id: string, project: string, title: string): void => {
    add(id, project, 'session.start', 1, 'hook', { agent: 'claude-code', worktree: `~/src/${project}`, branch: 'work', thread: id });
    add(id, project, 'task.created', 1, 'app', { task_ref: `task:01KB1815TK${String(pos).padStart(16, '0')}`, thread: id, owner: 'you', title });
  };
  const asking = '1815a5e0-6f1c-4a2b-9c3d-000000000009';
  session(asking, 'docs', 'Release notes');
  add(asking, 'docs', 'ask.created', 1, 'core', {
    kind: 'choice', question: QUESTION, options: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }],
    recommended: 'sqlite', deadline: NOW + 24 * 60 * MIN, fallback: 'you', default: 'sqlite', provisional: false, owner: 'you',
    key: sha256(`choice:${QUESTION}`), pinned_to: { kind: 'evidence', ref: sha256(QUESTION) },
  }, ASK_ID);
  for (const page of pages) {
    session(page.id, 'shop', TITLE);
    add(page.id, 'shop', 'run.finished', 3, 'core', {
      run: `run:01KB1815RN${String(pos).padStart(16, '0')}`, outcome: 'failed', tests_run: 1, passed: 0, runs: 1, evidence: [], check: 'unit', assertion: null,
      expected: null, actual: page.lines.join('\n'), step: null, points_to: null, findings: [], environment: 'darwin-arm64', exit: 1,
    });
  }
  const path = join(tempDir(), 'record.events.jsonl');
  writeFileSync(path, `${rows.join('\n')}\n`);
  return path;
}

// ---- The replica.

/** A replica on a record of `pages` at the reference window (the launch's own size), drawing only the frames a real
 * window would (#1546) unless `every`; `plant` its DEEP_HUB_PLANT; `bin` another deep-drive than the debug one. */
export async function replicaOf(pages: readonly Page[], o: { plant?: string | undefined; every?: boolean; theme?: 'light' | 'dark'; bin?: string } = {}): Promise<Replica> {
  if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
  const bin = o.bin ?? await driveBin(true);
  const out = join(tempDir(), 'out');
  mkdirSync(out, { recursive: true });
  const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(makeHome(), { DEEP_HUB_PLANT: o.plant }), stdio: ['pipe', 'pipe', 'pipe'] });
  own(child.pid);
  // #1808's client, given this process; its first line is deep-drive's ready line.
  const r = new (Replica as unknown as new (c: ChildProcess) => Replica)(child);
  const ready = await (r as unknown as { next(ms: number): Promise<Line> }).next(600_000);
  if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)}`);
  await r.launch({ from: 'fixture', fixture: record(pages), ...(o.theme ? { theme: o.theme } : {}), ...(o.every ? {} : { frames: 'dirty', read_back: 'off' }) });
  return r;
}
/** Runs `f` on a replica of `pages` and stops it. */
export async function on<T>(pages: readonly Page[], o: Parameters<typeof replicaOf>[1], f: (r: Replica) => Promise<T>): Promise<T> {
  const r = await replicaOf(pages, o);
  try { return await f(r); } finally { await r.stop(); }
}
export interface Look { s: Snapshot; address: string | null; hub: Line[]; logPos: number | null }
/** `see`: the window, its address, every call the app made of its hub since launch, and the record's position. */
export async function look(r: Replica): Promise<Look> {
  const got = await r.must('see', { call: 'see' });
  return { s: got.snapshot as Snapshot, address: (got.address ?? null) as string | null, hub: (got.hub ?? []) as Line[], logPos: typeof got.log_pos === 'number' ? got.log_pos : null };
}
/** Lets `ms` of the replica's clock pass with no input, a frame each 250 ms: a debug frame of 4,100 lines is slow. */
export const rest = (r: Replica, ms: number): Promise<Line> => r.must(`waiting ${ms} ms`, { call: 'wait_for', wait_for: { t: r.t + Math.round((ms * FLICKS) / 1000), step_ms: 250 }, timeout: ms + 2000 });
/** Waits on the replica's clock, up to `ms`, until `ready` holds of the window; the last look. */
export async function until(r: Replica, ready: (x: Look) => boolean, ms = 2000): Promise<Look> {
  let x = await look(r);
  for (let waited = 0; waited < ms && !ready(x); waited += 250) {
    await rest(r, 250);
    x = await look(r);
  }
  return x;
}
/** Opens `address`, and waits until the window shows it and `ready` holds. */
export async function open(r: Replica, address: string, ready: (x: Look) => boolean): Promise<Look> {
  await r.open(address);
  return until(r, (x) => x.address === address && ready(x));
}
/** Opens `LONG` or `SHORT`; BLOCKED where the fixture's premise doesn't hold: its first two matches' lines drawn in the
 * lane and its third not drawn. */
export async function openPage(r: Replica, page: Page): Promise<Look> {
  const [first, second, third] = page.match as [string, string, string];
  const x = await open(r, page.address, (l) => inLane(l.s, first));
  if (!inLane(x.s, first) || !inLane(x.s, second) || lineAt(x.s, third)) blocked(`the fixture's premise doesn't hold: ${page.address} opens on ${String(x.address)} with "${first}" at ${said(lineAt(x.s, first) ?? null)}, "${second}" at ${said(lineAt(x.s, second) ?? null)} and "${third}" at ${said(lineAt(x.s, third) ?? null)}`);
  return x;
}
/** What the app wrote to its hub: every call but a read (#1462's list). */
const READS = /(\.read$)|^(hub\.health|health|stream\.subscribe|ask\.card|views\.installed)$/;
export const writes = (calls: readonly Line[]): string[] => calls.filter((c) => !READS.test(String(c.method))).map((c) => String(c.method));

// ---- Find (README, Surfaces).

export const FIELD = 'find-field';
export const PLACE = 'find-place';
export const field = (x: Look): SNode | undefined => byId(x.s, FIELD);
const words = (s: Snapshot, n: SNode | undefined): string => (n ? [...flat(n).flatMap((c) => [c.name ?? '', typeof c.value === 'string' ? c.value : '']), ...runsIn(s, n.bounds).map((x) => x.text)].join('\n') : '');
/** The match's place, as the field shows it: `<n> of <m>`; null when it shows none, or m is 0. */
export function placeOf(x: Look): string | null {
  const m = /(\d+) of (\d+)/.exec(words(x.s, byId(x.s, PLACE)));
  return m && Number(m[2]) > 0 ? `${m[1]} of ${m[2]}` : null;
}
/** ⌘F, and the look once the field shows, or once a second has passed with none. */
export async function find(r: Replica): Promise<Look> {
  await r.press('cmd-f');
  return until(r, (x) => field(x) !== undefined, 1000);
}
/** Words typed in the field in place of what it holds, and the look once it shows `place`, with `line` in the lane, or once a second has passed. */
export async function type(r: Replica, text: string, place: string, line?: string): Promise<Look> {
  await r.press('cmd-a');
  await r.must(`typing "${text}"`, { call: 'act', act: { kind: 'type', text } });
  return until(r, (x) => placeOf(x) === place && (!line || inLane(x.s, line)), 1000);
}
/** A key pressed in the field, and the look once it shows `place` with `line` in the lane, or once a second has passed. */
export async function step(r: Replica, key: string, place: string, line: string): Promise<Look> {
  await r.press(key);
  return until(r, (x) => placeOf(x) === place && inLane(x.s, line), 1000);
}
export const NO_FIELD = (page: Page): string => `⌘F on ${page.address} opens no field: the window holds no node ${FIELD} (README, Surfaces)`;

// ---- Reading the window. Bounds are [x, y, w, h] in device pixels.

/** The page's reading lane as it shows: the `lane` node under the page's title row, inside the window. */
export function laneView(s: Snapshot): Box {
  const lane = byId(s, 'lane');
  if (!lane) return [0, 0, 0, 0];
  const title = byId(s, 'page-title');
  const top = Math.max(lane.bounds[1]!, title ? title.bounds[1]! + title.bounds[3]! : 0);
  return cross([lane.bounds[0]!, top, lane.bounds[2]!, lane.bounds[1]! + lane.bounds[3]! - top], windowBox(s));
}
/** Where a content line is drawn: the string drawn that is it, else its node (#1498: one node a line, named by it), which
 * the snapshot also holds while its line is scrolled out of the window; undefined when neither is in the window. */
export function lineAt(s: Snapshot, text: string): Box | undefined {
  const run = (s.runs ?? []).find((x) => x.text === text && !x.cut);
  if (run) return run.bounds;
  return flat(s.tree).find((n) => n.name === text && n.bounds[2]! > 0 && n.bounds[3]! > 0 && overlap(n.bounds, windowBox(s)))?.bounds;
}
export const inLane = (s: Snapshot, text: string): boolean => { const b = lineAt(s, text); return !!b && inside(b, laneView(s)); };
/** Where a line is from the window's top, and under the title row's foot. */
export function placed(s: Snapshot, text: string): { window: number; row: number } | undefined {
  const b = lineAt(s, text);
  const title = byId(s, 'page-title');
  return b && { window: b[1]!, row: b[1]! - (title ? title.bounds[1]! + title.bounds[3]! : 0) };
}
/** Every node and drawn string of the window, and where the keyboard is, for comparing two looks. */
export const drawn = (x: Look): string[] => [
  `the page is ${String(x.address)}`, `the keyboard is on ${said(x.s.focus ?? null)}`,
  ...flat(x.s.tree).map((n) => `${n.role} ${said(n.id ?? null)} ${said(n.name)} ${said(n.value)} ${said(n.bounds)}`),
  ...(x.s.runs ?? []).map((t) => `"${t.text}" ${said(t.bounds)}`),
];
