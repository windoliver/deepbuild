// Test-side tools for #3495 (README). One fixture record, made the way #2018's suite makes one: every session is seeded
// with the hub stopped through the real record and asks core, each event in its kind's published shape, and then a real
// hub (`deep hub run` in a temp HOME) builds the list's rows. The readers are the real ones: the built CLI for `deep`,
// `deep status` and its `--json`, and the real `deep-drive` for the app's list, the project's page and a session's
// page, launched with `launch.from: "record_copy"` in the world's HOME, so it draws a copy of that hub's record. The
// judges are in judges.ts.
//
// Reused by import, as #2019's suite reuses them: #2018's seeder, record, rows, CLI, replica and builds; #16's hub and
// ULIDs; #26's seeding, for the two events #2018's seeder has no step for.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; no test touches the real ~/.deepbuild or ~/Library/LaunchAgents; no network, no model.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHub, ulid } from '../16/helpers.ts';
import { seed } from '../26/helpers.ts';
import {
  blocked, byId, DAY, flat, letters, MIN, needBuilds, quiet, Replica, REPO, rowOf, Script, seedRecord, statusRows, wordsOf,
  type Row, type Rows, type Seeder, type Seen, type Snapshot, type SNode, type World,
} from '../2018/helpers.ts';
import { ageless, placesOf, sentenceOf, type Box, type Drawn, type Reading, type RowView, type Shown } from './judges.ts';

export { blocked, cleanup, deep, MIN, none, shown, statusRows, tempDir, type World } from '../2018/helpers.ts';
export * from './judges.ts';
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
/** `make`'s one result, made at its first call: a world, a print or a window every test of a file reads. */
export function once<T>(make: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | undefined;
  return () => (made ??= make());
}

/**
 * The planted wrong programs (README, Pinned 6), each selected by DEEP_HUB_PLANT. The first three are read by `deep`'s
 * own process, and the hub runs without them. The last two are read by the app in the replica built with
 * `--features env-plants` only.
 */
export const PLANT = {
  /** AC1: `deep` prints each session's row with its word and no sentence before it, as the merge base does. */
  wordAlone: 'print-word-alone',
  /** AC3: `deep` prints a working session's row with a sentence before its word, as a table that held one for working would. */
  workingSentence: 'working-has-sentence',
  /** AC6: `deep status --json` gives the row of a session reading BLOCKED a `word` that holds the table's sentence. */
  wordHoldsSentence: 'word-holds-sentence',
  /** AC2: the list's row of a session reading BLOCKED leads its word with a sentence the view wrote itself. */
  ownSentence: 'view-own-sentence',
  /** AC4: a session's row that has no room for its whole sentence cuts its state word to make room for it. */
  cutsWord: 'row-cuts-word',
} as const;

// ---- The fixture (README, The fixture): fourteen sessions in two projects, one in each state a record can hold.

export interface Spec { key: string; repo: 'shop' | 'docs'; title?: string; word: string }
/** The six states that read a sentence are shop's; the eight a record can hold of the other nine are docs'. */
export const FIXTURE: readonly Spec[] = [
  { key: 'pass', repo: 'shop', title: 'Cart totals', word: 'PASS' },
  { key: 'sentback', repo: 'shop', title: 'Tax', word: 'sent back' },
  { key: 'blocked', repo: 'shop', title: 'Publish check', word: 'BLOCKED' },
  { key: 'invalid', repo: 'shop', title: 'Search index', word: 'INVALID' },
  { key: 'inconclusive', repo: 'shop', title: 'Login page', word: 'INCONCLUSIVE' },
  { key: 'stale', repo: 'shop', title: 'Release notes', word: 'stale' },
  { key: 'needs', repo: 'docs', title: 'API guide', word: 'needs you' },
  { key: 'stuck', repo: 'docs', title: 'Sign-up form', word: 'stuck' },
  { key: 'flagged', repo: 'docs', title: 'Image upload', word: 'flagged' },
  { key: 'saysdone', repo: 'docs', title: 'Checkout page', word: 'says done' },
  { key: 'working', repo: 'docs', title: 'Search box', word: 'working' },
  { key: 'queued', repo: 'docs', title: 'Price list', word: 'queued' },
  { key: 'finished', repo: 'docs', title: 'Footer links', word: 'finished' },
  { key: 'quiet', repo: 'docs', word: 'quiet' },
];
/** The project whose page criterion 2 opens: the one that holds the six. */
export const PROJECT = 'shop';
export const PAGE = `project/${PROJECT}`;
/** What each verdict that isn't PASS or FAIL leaves open, in the words its row says after "waits for you:". */
export const EVIDENCE = { blocked: 'a run of publish-check.sh', invalid: 'a run of index-check.sh that reads this change', inconclusive: 'a run of login-check.sh that finishes' } as const;
export const QUESTION = 'Which accent colour for the headings?';
/** A running job's row, fed to the replica as the hub writes one: no record holds one once its hub has stopped. */
export const JOB = { id: 'job:3495-encode', title: 'encode' } as const;

/** Every session but stuck's and flagged's last event, each time counted back from `T`, appended oldest first. */
async function seedSessions(s: Seeder, T: number): Promise<void> {
  const sc = new Script();
  const spec = (key: string): Spec => FIXTURE.find((f) => f.key === key) ?? blocked(`the fixture has no session ${key}`);
  /** A session's start, its task and its first prompt, a second apart. */
  const begin = (key: string, at: number): void => {
    const { repo, title } = spec(key);
    sc.on(at, () => s.start(key, repo, at));
    sc.on(at + 1000, () => s.task(key, title ?? key, at + 1000));
    sc.on(at + 2000, () => s.prompt(key, `work on ${title ?? key}`, at + 2000));
  };
  /** A stop that claims done at `at`, and what `then` appends for its claim two minutes on. */
  const claimed = (key: string, at: number, then: (claim: string, at: number) => Promise<unknown>): void => {
    let claim = '';
    sc.on(at, async () => { claim = (await s.stop(key, at)) ?? blocked(`the seeder made no claim for ${key}`); });
    sc.on(at + 2 * MIN, () => then(claim, at + 2 * MIN));
  };
  // quiet: a session that started three days ago, with nothing since, as #2018's fixture holds one.
  sc.on(T - 3 * DAY, () => s.start('quiet', spec('quiet').repo, T - 3 * DAY));
  begin('pass', T - 300 * MIN);
  claimed('pass', T - 250 * MIN, (claim, at) => s.verdict('pass', claim, 'PASS', at));
  // sent back: a FAIL the gate sent back to it, round 1. Its claim is three and a half hours old, so its time reads 3 h.
  begin('sentback', T - 270 * MIN);
  claimed('sentback', T - 210 * MIN, async (claim, at) => s.sentBack('sentback', claim, await s.verdict('sentback', claim, 'FAIL', at), 1, at + 1000));
  begin('blocked', T - 180 * MIN);
  claimed('blocked', T - 150 * MIN, async (claim, at) => { await s.verdict('blocked', claim, 'BLOCKED', at, EVIDENCE.blocked); await s.openItem('blocked', EVIDENCE.blocked, at + 1000); });
  begin('invalid', T - 140 * MIN);
  claimed('invalid', T - 130 * MIN, (claim, at) => s.verdict('invalid', claim, 'INVALID', at, EVIDENCE.invalid));
  begin('inconclusive', T - 120 * MIN);
  claimed('inconclusive', T - 110 * MIN, (claim, at) => s.verdict('inconclusive', claim, 'INCONCLUSIVE', at, EVIDENCE.inconclusive));
  // stale: a PASS whose commit moved.
  begin('stale', T - 100 * MIN);
  let passed = '';
  claimed('stale', T - 90 * MIN, async (claim, at) => { passed = await s.verdict('stale', claim, 'PASS', at); });
  sc.on(T - 80 * MIN, () => s.stale('stale', passed, T - 80 * MIN));
  // says done: a stop that claims done, with no verdict yet.
  begin('saysdone', T - 60 * MIN);
  let call = '';
  sc.on(T - 52 * MIN, async () => { call = await s.toolStart('saysdone', T - 52 * MIN); });
  sc.on(T - 52 * MIN + 9000, () => s.toolEnd('saysdone', call, T - 52 * MIN + 9000));
  sc.on(T - 50 * MIN, () => s.stop('saysdone', T - 50 * MIN));
  // finished: a turn that stopped with no claim to judge.
  begin('finished', T - 45 * MIN);
  sc.on(T - 40 * MIN, () => s.stop('finished', T - 40 * MIN, false));
  // needs you: an open ask.
  begin('needs', T - 35 * MIN);
  sc.on(T - 30 * MIN, () => s.ask('needs', 'choice', QUESTION, T - 30 * MIN));
  // stuck and flagged: each a turn in progress here; the core says how each ended once these are appended.
  begin('stuck', T - 25 * MIN);
  begin('flagged', T - 20 * MIN);
  // queued: a task its agent hasn't started.
  sc.on(T - 10 * MIN, () => s.start('queued', spec('queued').repo, T - 10 * MIN));
  sc.on(T - 10 * MIN + 1000, () => s.task('queued', spec('queued').title ?? 'queued', T - 10 * MIN + 1000));
  // working: a tool call that started and hasn't ended.
  begin('working', T - 8 * MIN);
  sc.on(T - 150_000, () => s.toolStart('working', T - 150_000));
  await sc.play();
}

/**
 * The world: the fixture's record, and a real hub on it. stuck's and flagged's last event is the core's own word on how
 * the turn ended (`session.attention`, stuck and failed), which #2018's seeder has no step for, so it is appended
 * through #26's seeding, after everything else and in its kind's published shape.
 */
export async function makeWorld(): Promise<World> {
  needBuilds();
  const made = await seedRecord({ repos: ['shop', 'docs'], seed: seedSessions });
  await seed(made.home, async (sd) => {
    for (const [key, state, back] of [['stuck', 'stuck', 100_000], ['flagged', 'failed', 90_000]] as const) {
      const s = made.sessions[key] ?? blocked(`the fixture has no session ${key}`);
      const at = made.at - back;
      sd.at(at);
      await sd.record.append({ writer: 'core', actor: 'you', scope: 'you', session: s.id, project: s.project ?? s.repo }, { v: 2, id: ulid(at), kind: 'session.attention', ts: at, subject: `session:${letters(s.id)}`, data: { state } });
    }
  }, made.at);
  const hub = await startHub({ home: made.home, env: { DEEP_HUB_TEST_CONFIRM: made.confirm } }, 180_000);
  await quiet(hub);
  return { ...made, hub };
}

// ---- The rows, as each surface reads them.

/** A fixture session's row as `deep status --json` lists it: what every other reading of the row is held against. */
export interface Listed { key: string; id: string; session: string; title: string; word: string; agent: string | null; why: string }
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Each fixture session with its row's title, agent and own sentence from `rows`; the fixture's title where it has no row. */
export function listed(w: World, rows: readonly Row[]): Listed[] {
  return FIXTURE.map((spec) => {
    const session = (w.sessions[spec.key] ?? blocked(`the world has no session ${spec.key}`)).id;
    const row = rowOf(rows, session);
    return { key: spec.key, id: `session:${session}`, session, title: text(row?.title) || spec.title || spec.key, word: spec.word, agent: text(row?.agent) || null, why: text(row?.why) };
  });
}
/**
 * The fixture as every test but criterion 6's own needs it: each session reads its state in `deep status --json`.
 * A session that doesn't is the fixture's fault, never the work's, so it is BLOCKED, naming the session.
 */
export async function reached(w: World): Promise<{ status: Rows; rows: Listed[] }> {
  const status = await statusRows(w);
  const rows = listed(w, status.rows);
  const off = rows.filter((r) => rowOf(status.rows, r.session)?.word !== r.word);
  if (off.length) blocked(`the fixture doesn't reach its states: ${off.map((r) => `session ${r.key} (${r.id}) reads ${JSON.stringify(rowOf(status.rows, r.session)?.word ?? 'no row')} in deep status --json, not "${r.word}"`).join('; ')}`);
  return { status, rows };
}
/** The six rows that read a sentence, and the rows of the other states that have a row of their own on a surface. */
export const sixOf = (rows: readonly Listed[]): Listed[] => rows.filter((r) => sentenceOf(r.word) !== null);
export const bareOf = (rows: readonly Listed[]): Listed[] => rows.filter((r) => sentenceOf(r.word) === null && r.word !== 'quiet');

/** A row's line in what `deep` or `deep status` prints: the first line that holds its title. */
export const lineOf = (print: string, title: string): string | undefined => print.split('\n').find((l) => l.includes(title));
/** Each row as a print reads it; `own` holds each to its own sentence after its word too. */
export const printed = (print: string, rows: readonly Listed[], own = false): Reading[] =>
  rows.map((r) => ({ id: r.id, title: r.title, word: r.word, agent: r.agent, ...(own && r.why ? { why: r.why } : {}), text: lineOf(print, r.title) }));
/** Each row as the window reads it: its node's accessible name. */
export const drawn = (s: Snapshot, rows: readonly Listed[]): Reading[] => rows.map((r) => ({ id: r.id, title: r.title, word: r.word, text: byId(s, r.id)?.name ?? undefined }));

// ---- The window: one replica over a copy of the world's record, read in every state the criteria name.

/** One step of the window's reading: what it read, or why it couldn't. */
export type Step<T> = { got: T } | { failed: unknown };
const step = async <T>(run: () => Promise<T>): Promise<Step<T>> => { try { return { got: await run() }; } catch (failed) { return { failed }; } };
export function got<T>(s: Step<T>): T {
  if ('failed' in s) throw s.failed;
  return s.got;
}
export interface Narrow { seen: Seen; listMin: number; width: number }
export interface WindowRead {
  /** As the window opens. */
  opened: Seen;
  /** With the project's page open. */
  page: Step<Seen>;
  /** With each of the six sessions' pages open, by the session's key. */
  pages: Step<Record<string, Seen>>;
  /** After a running job's row arrived. */
  job: Step<Seen>;
  /** With the list at its narrowest width. */
  narrow: Step<Narrow>;
}

/** The list's narrowest width and the page's, in points, from the look the app's chrome reads its sizes from. */
function shell(): { list_min: number; page_min: number } {
  const file = 'crates/deep-canvas-marks/looks/clean.json';
  let sizes: { list_min?: unknown; page_min?: unknown } | undefined;
  try { sizes = (JSON.parse(readFileSync(join(REPO, file), 'utf8')) as { shell?: { list_min?: unknown; page_min?: unknown } }).shell; } catch { sizes = undefined; }
  const { list_min, page_min } = sizes ?? {};
  if (typeof list_min !== 'number' || typeof page_min !== 'number') return blocked(`${file} gives no shell.list_min and shell.page_min, the list's and the page's narrowest widths`);
  return { list_min, page_min };
}
/** The window once half a second of the replica's own clock has run since the last call: what it shows drawn in full. */
async function settled(r: Replica): Promise<Seen> {
  await r.wait(500);
  return r.see();
}
/**
 * The window made as wide as the list's narrowest width and the page's together, where the app holds the list at its
 * narrowest: the window as it then draws, and the list's width in points.
 */
async function narrowed(r: Replica): Promise<Narrow> {
  const { list_min, page_min } = shell();
  const size = (await r.see()).snapshot.window.size;
  await r.must(`resizing the window to ${list_min + page_min} points wide`, { call: 'resize', resize: { size: [list_min + page_min, size[1] ?? 982] } });
  const seen = await settled(r);
  const list = byId(seen.snapshot, 'list') ?? blocked(`a window ${list_min + page_min} points wide draws no list (no node with the id "list")`);
  return { seen, listMin: list_min, width: (list.bounds[2] ?? 0) / seen.snapshot.window.scale };
}
/** A running job's row as the hub writes one (`row.set`, listed, placed after the sessions), with no counter, so it reads its word. */
const jobRow = (since: number): Record<string, unknown> => ({
  v: 2, id: ulid(), kind: 'row.set', writer: 'core', actor: 'you', scope: 'you',
  data: {
    listed: true, order: `0|4|${String(since).padStart(16, '0')}|${JOB.id}`, id: JOB.id, title: JOB.title, project: null, session: '', agent: null, entry: 'running', word: 'running',
    why: 'its tool runs it, and it keeps running when the app or the session closes', waits_on: null, since, actions: [], unread: false,
  },
});

/** The shipped app's window over the world's record, read once: one launch serves every criterion that reads it. */
export async function readWindow(w: World, six: readonly Listed[]): Promise<WindowRead> {
  const r = await Replica.of(w);
  try {
    const opened = await settled(r);
    const page = await step(async () => { await r.open(PAGE); return settled(r); });
    const pages = await step(async () => {
      const out: Record<string, Seen> = {};
      for (const row of six) { await r.open(`session/${row.session}`); out[row.key] = await settled(r); }
      return out;
    });
    const job = await step(async () => { await r.must("feeding a running job's row", { call: 'feed', feed: { session: '', event: jobRow(w.at) } }); return settled(r); });
    const narrow = await step(() => narrowed(r));
    return { opened, page, pages, job, narrow };
  } finally {
    await r.stop();
  }
}
/** The planted app's window as it opens, and at the list's narrowest width: the env-plants build with `plant` chosen. */
export async function plantedOpened(w: World, plant: string): Promise<Seen> {
  const r = await Replica.of(w, plant);
  try { return await settled(r); } finally { await r.stop(); }
}
export async function plantedNarrow(w: World, plant: string): Promise<Narrow> {
  const r = await Replica.of(w, plant);
  try { return await narrowed(r); } finally { await r.stop(); }
}

/** The node whose id is the address the window shows: a page. BLOCKED when the window shows another, or none. */
export function pageNode(seen: Seen, address: string): SNode {
  if (seen.address !== address) blocked(`deep_drive's open of ${address} left the window on ${JSON.stringify(seen.address)}`);
  return byId(seen.snapshot, address) ?? blocked(`the window shows ${address} and draws no node whose id is that address, so the page can't be read`);
}
const within = (b: readonly number[], box: readonly number[]): boolean => b[0]! >= box[0]! - 1 && b[1]! >= box[1]! - 1 && b[0]! + b[2]! <= box[0]! + box[2]! + 1 && b[1]! + b[3]! <= box[1]! + box[3]! + 1;
/**
 * Every string a person reads in a node: the accessible names of its subtree and the strings drawn inside it. A node's
 * value is left out: a row's is its state's status-map entry, a code and no words.
 */
export const stringsOf = (seen: Seen, node: SNode): string[] => [
  ...flat(node).flatMap((n) => (n.name ? [n.name] : [])),
  ...((seen.snapshot.runs ?? []) as Drawn[]).filter((r) => within(r.bounds, node.bounds)).map((r) => r.text),
].filter((t) => t.trim());
/** The list's folded row of a project's quiet sessions, as the window reads it: its title is its title slot's name. */
export function quietRow(seen: Seen, project: string): Reading {
  const id = `quiet:${project}`;
  const row = byId(seen.snapshot, id);
  const title = row ? byId(seen.snapshot, `${id}:title`)?.name ?? blocked(`the list's row ${id} has no title slot (${id}:title), so its title can't be told from its word`) : '';
  return { id, title, word: 'quiet', text: row?.name ?? undefined };
}
/** The running job's row, as the window reads it once its row arrived. */
export const jobReading = (seen: Seen): Reading => ({ id: JOB.id, title: JOB.title, word: 'running', text: byId(seen.snapshot, JOB.id)?.name ?? undefined });
/**
 * One of the six sessions on its own page, as the window reads it there: the first string of the page that holds its
 * title and its word, and everything the page holds: its names, its string values and the strings drawn in it.
 */
export function onItsPage(seen: Seen, r: Listed): { reading: Reading; whole: string } {
  const page = pageNode(seen, `session/${r.session}`);
  const strings = stringsOf(seen, page);
  return { reading: { id: r.id, title: r.title, word: r.word, text: strings.find((t) => t.includes(r.title) && placesOf(t, r.word).length > 0) }, whole: wordsOf(seen.snapshot, page) };
}

const overlap = (a: readonly number[], b: readonly number[]): boolean => a[0]! < b[0]! + b[2]! && b[0]! < a[0]! + a[2]! && a[1]! < b[1]! + b[3]! && b[1]! < a[1]! + a[3]!;
/** One row of the list as drawn: its node, its mark, word, flag and time slots, and every string drawn over it. */
export function rowView(s: Snapshot, r: { id: string; title: string; word: string }): RowView {
  const box = (id: string): Box | undefined => { const n = byId(s, id); return n ? { name: n.name, bounds: n.bounds } : undefined; };
  const row = box(r.id);
  const runs = ((s.runs ?? []) as Drawn[]).filter((x) => row !== undefined && overlap(x.bounds, row.bounds));
  return { id: r.id, title: r.title, word: r.word, sentence: sentenceOf(r.word) ?? '', row, slots: { word: box(`${r.id}:word`), time: box(`${r.id}:time`), mark: box(`${r.id}:mark`), flag: box(`${r.id}:flag`) }, runs };
}

/**
 * The six rows as this run's three plain surfaces read them (criterion 7): `deep`'s line with its agent's name and
 * its time made placeholders, the list's row by its accessible name, the same row beside the project's page, and each
 * string of the page's own region that holds the row's title. BLOCKED when a surface shows no such row.
 */
export function shownRows(six: readonly Listed[], print: string, opened: Seen, page: Seen): Shown[] {
  const own = stringsOf(page, pageNode(page, PAGE));
  return six.map((r) => {
    const line = lineOf(print, r.title) ?? blocked(`deep prints no line for ${r.id} ("${r.title}"), so it can't be shown`);
    const list = byId(opened.snapshot, r.id)?.name ?? blocked(`the list draws no ${r.id} ("${r.title}"), so it can't be shown`);
    const beside = byId(page.snapshot, r.id)?.name ?? blocked(`the list beside ${PAGE} draws no ${r.id} ("${r.title}"), so it can't be shown`);
    return { word: r.word, deep: ageless(r.agent ? line.replace(r.agent, '<agent>') : line), list, beside, page: own.filter((t) => t.includes(r.title)) };
  });
}
