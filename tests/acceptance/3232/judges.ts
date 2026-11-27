// The judges of #3232's suite (README, Criterion to tests): each decides one criterion from what a run read, and
// returns its failures, each naming what its criterion says a failure names. They read data only: a snapshot, its
// announcements, the notifications a replica posted, a tree read through the Accessibility API. Nothing here starts a
// process, so each judge is also run against planted inputs as a plain script (README, What was run).
//
// Node built-ins only: no test runner and no other suite's file is imported here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** The criteria, by `#3232.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  ask: '#3232.2159e687',
  line: '#3232.67b6e9ba',
  rows: '#3232.98c95ce3',
  other: '#3232.1291a87a',
  state: '#3232.2276c799',
  card: '#3232.7554be7e',
  hold: '#3232.c570463b',
  together: '#3232.b7a0e74d',
  hub: '#3232.a096a169',
  live: '#3232.a107747a',
  budgets: '#3232.fec442e2',
} as const;

/** The planted wrong programs the criteria name (README, Plants), each selected by DEEP_HUB_PLANT=<name>. */
export const PLANT = {
  /** AC2: a line about an ask starts with its session's doing words, where the shipped line starts with "needs you". */
  lineStartsWithDoing: 'ask-line-starts-with-doing',
  /** AC3: the region keeps only its last line as a row. */
  keepsLastLine: 'region-keeps-last-line',
  /** AC4: every ask that opens is announced, the ones the notifier posts for too. */
  everyAsk: 'announces-every-ask',
  /** AC5: each change of the open page's session's doing line is announced. */
  doingLine: 'announces-doing-line',
  /** AC7: the held receipt announces its countdown each second. */
  eachSecond: 'receipt-announces-each-second',
  /** AC8: each change is its own entry, however close together they land. */
  eachChange: 'announces-each-change',
} as const;

/** The region's node: the one node of the snapshot's tree with this `id` (README, Surfaces 2). */
export const REGION = 'live-region';
/** Flicks a second: every time a replica answers is in flicks since its launch. */
export const FLICKS = 705_600_000;
/** The state's word and the issue's other words. */
export const NEEDS_YOU = 'needs you';
export const SENT_BACK = 'sent back';
export const HOLD = '10 s';

export interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds: number[]; children: SNode[] }
export interface Run { text: string; bounds: number[] }
export interface Snapshot { window: { size: number[]; scale: number }; tree: SNode; runs?: Run[]; announcements?: unknown }
/** One announcement, as the snapshot carries it (README, Surfaces 1): when it was made, in flicks since launch, and its line. */
export interface Entry { t: number; text: string }
/** A snapshot's announcements, or why they can't be read. A missing list is never an empty one. */
export interface Read { entries: Entry[]; missing?: string }
/** A notification a replica posted, as its trace keeps it. */
export interface Posted { t: number; ask: string | null; session: string; text: string }

export const said = (v: unknown, n = 300): string => (JSON.stringify(v) ?? String(v)).slice(0, n);
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
const quoted = (entries: readonly Entry[], most = 12): string => entries.slice(0, most).map((e) => `"${e.text}"`).join(' | ') + (entries.length > most ? ` | and ${entries.length - most} more` : '');
const many = (n: number): string => `${n} ${n === 1 ? 'entry' : 'entries'}`;

/** Text as it is compared: one form, typewriter apostrophes, single spaces. */
const fold = (s: string): string => s.normalize('NFC').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
/** Whether `text` holds `words` exactly as written. */
export const holds = (text: string, words: string): boolean => fold(text).includes(fold(words));
/** Whether `text` holds `words` whatever their case. */
export const says = (text: string, words: string): boolean => fold(text).toLowerCase().includes(fold(words).toLowerCase());
const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether `text` holds `words` standing alone: no letter or digit against either end. */
export const holdsAlone = (text: string, words: string): boolean => new RegExp(`(?<![\\p{L}\\p{N}])${escaped(fold(words))}(?![\\p{L}\\p{N}])`, 'iu').test(fold(text));
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/**
 * Whether `text` holds the count `n`, as a number or in words ("3" or "three"), standing alone, outside `besides`: the
 * question, a session's name and a key are left out first, so a digit in one of them is never read as the count.
 */
export function holdsCount(text: string, n: number, besides: readonly string[] = []): boolean {
  let rest = fold(text);
  for (const b of besides) if (fold(b)) rest = rest.split(fold(b)).join(' ');
  return [String(n), ...(NUMBER_WORDS[n] ? [NUMBER_WORDS[n]!] : [])].some((form) => holdsAlone(rest, form));
}

// ---- The action table's keys, as the app shows a key (crates/deep-app/src/actions.rs, `glyphs`; #1462's Pinned 4).

export interface Action { name: string; verb: string; target: string; key: string | null }
export const actionTable = (): Action[] => (JSON.parse(readFileSync(join(REPO, 'crates/deep-app/src/actions.json'), 'utf8')) as { actions: Action[] }).actions;
const NAMED: Record<string, string> = { enter: '↩', escape: '⎋', tab: '⇥', space: 'Space', backspace: '⌫', delete: '⌦', up: '↑', down: '↓', left: '←', right: '→' };
/** A keystroke in the table's form (`cmd-shift-j`) as a menu draws it: ⌃⌥⇧⌘ in that order, then the key, a letter in capitals. */
export function glyphs(key: string): string {
  const parts = key.split('-');
  let last = parts.pop() ?? '';
  if (last === '' && parts.length) { parts.pop(); last = '-'; }
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const has = (...names: string[]): boolean => names.some((n) => mods.has(n));
  const marks = [has('ctrl', 'control') ? '⌃' : '', has('alt', 'option') ? '⌥' : '', has('shift') ? '⇧' : '', has('cmd', 'platform', 'super', 'win') ? '⌘' : ''].join('');
  return marks + (NAMED[last.toLowerCase()] ?? last.toUpperCase());
}
/** The keys the table gives for opening an ask's card: each action whose verb is Open and whose target is the app or an ask. */
export const openKeys = (table: readonly Action[] = actionTable()): string[] => table.filter((a) => a.verb === 'Open' && a.key && (a.target === 'app' || a.target.startsWith('ask'))).map((a) => glyphs(a.key!));
/** The keys the table gives for undoing an answer on its card: each action whose verb is Undo and whose target is the card. */
export const undoKeys = (table: readonly Action[] = actionTable()): string[] => table.filter((a) => a.verb === 'Undo' && a.key && a.target.startsWith('card')).map((a) => glyphs(a.key!));

// ---- Reading the announcements.

/** A snapshot's announcements (README, Surfaces 1): `snapshot.announcements`, a list of `{t, text}` in the order made. */
export function readOf(s: Snapshot | undefined): Read {
  const list = s?.announcements;
  if (!Array.isArray(list)) return { entries: [], missing: `the snapshot carries no announcements list (snapshot.announcements is ${list === undefined ? 'missing' : said(list, 80)})` };
  const entries: Entry[] = [];
  for (const [i, raw] of (list as unknown[]).entries()) {
    const e = raw as { t?: unknown; text?: unknown } | null;
    if (!e || typeof e !== 'object' || !Number.isInteger(e.t) || (e.t as number) < 0 || typeof e.text !== 'string' || !e.text.trim()) return { entries, missing: `entry ${i} of snapshot.announcements is ${said(raw, 160)}, not {t: <flicks since launch>, text: <its line>}` };
    if (i > 0 && (e.t as number) < entries[i - 1]!.t) return { entries, missing: `snapshot.announcements isn't in the order made: entry ${i} (t ${String(e.t)}) follows one at t ${entries[i - 1]!.t}` };
    entries.push({ t: e.t as number, text: e.text });
  }
  return { entries };
}
/**
 * The entries `after` holds that `before` didn't. Both are read while nothing is pending, 3 s or more after the last
 * change, so every entry `before` holds stays as it was in `after`; anything else is a problem, never a count.
 */
export function addedSince(before: Read, after: Read): { added: Entry[]; problem?: string } {
  if (before.missing) return { added: [], problem: before.missing };
  if (after.missing) return { added: [], problem: after.missing };
  for (const [i, was] of before.entries.entries()) {
    const now = after.entries[i];
    if (!now || now.t !== was.t || now.text !== was.text) return { added: [], problem: `an entry made earlier changed or left the list: entry ${i} was ${said(was)} and is ${said(now ?? null)}` };
  }
  return { added: after.entries.slice(before.entries.length) };
}

// ---- AC1: an ask from the session whose page is open in the key window.

export interface AskRun {
  /** The ask as a failure names it: its handle and its question. */
  who: string;
  handle: string;
  question: string;
  /** How many asks need you once it opened. */
  count: number;
  /** The announcements with the page open, before the ask. */
  base: Read;
  /** Once the ask's own events were delivered and at most one event more. */
  first: Read;
  /** 3 s later, past the notifier's delay. */
  settled: Read;
  /** Every notification the replica posted in the run; undefined when its trace holds no list. */
  posted: readonly Posted[] | undefined;
  /** What else the line may hold a digit in: the keys and the session's name. */
  besides?: readonly string[];
}
export function askOpened(o: AskRun): string[] {
  if (o.base.missing) return [`${o.who} opened on its session's open page in the key window and nothing was announced: ${o.base.missing}`];
  const out: string[] = [];
  if (o.base.entries.length) out.push(`before ${o.who} opened, the announcements already held ${many(o.base.entries.length)}: ${quoted(o.base.entries)}`);
  const [first, settled] = [addedSince(o.base, o.first), addedSince(o.base, o.settled)];
  const problem = first.problem ?? settled.problem;
  if (problem) return [...out, `${o.who}: ${problem}`];
  if (first.added.length === 0) out.push(`${o.who} opened on its session's open page in the key window and no entry was made within one event of it`);
  if (settled.added.length !== 1) out.push(`${o.who}: the announcements hold ${many(settled.added.length)} for it 3 s after it opened, not exactly one${settled.added.length ? `: ${quoted(settled.added)}` : ''}`);
  const entry = settled.added[0] ?? first.added[0];
  if (entry) {
    if (!holds(entry.text, o.question)) out.push(`${o.who}: its entry doesn't hold the ask's question: "${entry.text}"`);
    if (!holdsCount(entry.text, o.count, [o.question, ...(o.besides ?? [])])) out.push(`${o.who}: its entry doesn't hold the count ${o.count}, as a number or in words: "${entry.text}"`);
  }
  if (o.posted === undefined) out.push(`${o.who}: the replica's trace holds no notifications list, so "no notification is posted" can't be read`);
  for (const p of (o.posted ?? []).filter((p) => p.ask === o.handle)) out.push(`${o.who}: a notification was posted for it though its session's page was open in the key window: ${said(p.text, 160)}`);
  return out;
}

// ---- AC2: the line starts with "needs you" and ends with the key that opens the ask's card.

export function askLine(o: { who: string; text: string | undefined; keys: readonly string[] }): string[] {
  if (o.text === undefined) return [`${o.who}: no entry was made for it, so there is no line to read`];
  if (!o.keys.length) return [`the action table (crates/deep-app/src/actions.json) gives no key for opening an ask's card, so the line "${o.text}" can't end with one`];
  const out: string[] = [];
  const line = fold(o.text);
  if (!new RegExp(`^${escaped(NEEDS_YOU)}(?![\\p{L}\\p{N}])`, 'iu').test(line)) out.push(`the line "${o.text}" (${o.who}) doesn't start with "${NEEDS_YOU}"`);
  if (!o.keys.some((k) => line.endsWith(k))) out.push(`the line "${o.text}" (${o.who}) doesn't end with the key that opens its card, ${o.keys.join(' or ')}`);
  return out;
}

// ---- AC3: the region's rows.

/** The clock times a time `ms` since the epoch may be written as, `HH:MM` in this machine's zone, a second either side. */
export function clocksOf(ms: number): string[] {
  const clock = (at: number): string => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  return [...new Set([clock(ms - 1000), clock(ms), clock(ms + 1000)])];
}
export interface RowsRun {
  snapshot: Snapshot | undefined;
  /** Every entry made in the run, in order, as the test read each when it was made. */
  made: readonly Entry[];
  /** How many lines the region keeps: five. */
  kept: number;
  /** An entry's time, in ms since the epoch on the views' clock. */
  at: (e: Entry) => number;
}
export const regionOf = (s: Snapshot | undefined): SNode[] => (s ? flat(s.tree).filter((n) => n.id === REGION) : []);
export function regionRows(o: RowsRun): string[] {
  const regions = regionOf(o.snapshot);
  if (regions.length !== 1) return [`the snapshot's tree holds ${regions.length} nodes with the id "${REGION}", not the one region${o.made.length ? `; it should keep its last ${o.kept} lines: ${quoted(o.made.slice(-o.kept))}` : ', and the run made no entry for it to keep'}`];
  const want = o.made.slice(-o.kept).reverse();
  if (want.length !== o.kept) return [`the run made ${many(o.made.length)}, not the ${o.kept} the region should keep: ${quoted(o.made)}`];
  const rows = regions[0]!.children ?? [];
  const lost = want.filter((e) => !rows.some((r) => r.name === e.text));
  if (lost.length) return [`the region keeps ${rows.length} of its last ${o.kept} lines as rows and lost ${lost.length}: ${quoted(lost)}${rows.length ? `; it holds ${rows.map((r) => said(r.name, 160)).join(' | ')}` : ''}`];
  const out: string[] = [];
  if (rows.length !== want.length || rows.some((r, i) => r.name !== want[i]!.text)) out.push(`the region's rows aren't its last ${o.kept} lines, newest first: its rows read ${rows.map((r) => said(r.name, 120)).join(' | ')}, and the lines, newest first, ${quoted(want)}`);
  for (const [i, e] of want.entries()) {
    const row = rows.find((r) => r.name === e.text);
    const clocks = clocksOf(o.at(e));
    if (row && !(typeof row.value === 'string' && clocks.includes(row.value.trim()))) out.push(`the row "${e.text}" (${i + 1} of ${want.length}, newest first) carries the time ${said(row.value)}, not its line's, ${clocks.join(' or ')}`);
  }
  return out;
}
/** A screenshot of one node asked of the replica: whether it has a picture, and the replica's code when it has none. */
export interface Shot { what: string; ok: boolean; code?: string; said?: string }
/**
 * "The screenshot draws none of them" (README, Readings): the replica's screenshot of the region and of each row has no
 * picture (`locate.none`, the replica's word for a node the window doesn't draw), and the frame draws no string that
 * holds a row's line.
 */
export function drawsNone(o: { shots: readonly Shot[]; runs: readonly Run[]; lines: readonly string[] }): string[] {
  const out: string[] = [];
  if (!o.shots.length) out.push('no screenshot was asked of the region or its rows, so what the screenshot draws of them is unread');
  for (const s of o.shots) {
    if (s.ok) out.push(`the screenshot draws ${s.what}: deep-drive's screenshot of it has a picture`);
    else if (s.code !== 'locate.none') out.push(`the screenshot of ${s.what} couldn't be read: ${s.said ?? s.code ?? 'no reason given'}`);
  }
  for (const line of o.lines) for (const r of o.runs.filter((r) => holds(r.text, line))) out.push(`the window draws the line "${line}" as text at ${said(r.bounds)}`);
  return out;
}

// ---- AC4: an ask from another session.

export function otherAsk(o: { who: string; handle: string; before: Read; after: Read; posted: readonly Posted[] | undefined }): string[] {
  const { added, problem } = addedSince(o.before, o.after);
  if (problem) return [`${o.who}: ${problem}`];
  const out: string[] = [];
  if (added.length) out.push(`${o.who}, whose session's page isn't the open one, added ${many(added.length)} though its notification says it: ${quoted(added)}`);
  if (o.posted === undefined) return [...out, `${o.who}: the replica's trace holds no notifications list, so its notification can't be read`];
  const posts = o.posted.filter((p) => p.ask === o.handle);
  if (posts.length !== 1) out.push(`${o.who} posted ${posts.length} notifications, not its one`);
  return out;
}

// ---- AC5: a state word on the open page, and a turn's doing line.

export function stateLine(o: { who: string; name: string; round: string; before: Read; after: Read }): string[] {
  const { added, problem } = addedSince(o.before, o.after);
  if (problem) return [`${o.who}: ${problem}`];
  if (added.length !== 1) return [`${o.who} went from says done to ${SENT_BACK}, round ${o.round}, on the open page and ${many(added.length)} ${added.length === 1 ? 'was' : 'were'} made, not one${added.length ? `: ${quoted(added)}` : ''}`];
  const text = added[0]!.text;
  const out: string[] = [];
  if (!holds(text, o.name)) out.push(`${o.who}: its entry doesn't hold its name "${o.name}": "${text}"`);
  if (!says(text, SENT_BACK)) out.push(`${o.who}: its entry doesn't hold "${SENT_BACK}": "${text}"`);
  if (!holdsAlone(text, o.round)) out.push(`${o.who}: its entry doesn't hold the round, ${o.round}: "${text}"`);
  return out;
}
/** Nothing may be added between two reads; a failure names what was read, the count and the entries. */
export function noneAdded(o: { what: string; before: Read; after: Read }): string[] {
  const { added, problem } = addedSince(o.before, o.after);
  if (problem) return [`${o.what}: ${problem}`];
  return added.length ? [`${o.what} added ${many(added.length)}: ${quoted(added)}`] : [];
}

// ---- AC6: a presented card whose pinned revision moved.

export function questionChanged(o: { who: string; before: Read; after: Read }): string[] {
  const { added, problem } = addedSince(o.before, o.after);
  if (problem) return [`${o.who}: ${problem}`];
  if (added.length !== 1) return [`${o.who}: its pinned revision moved under the presented card and ${many(added.length)} ${added.length === 1 ? 'was' : 'were'} made, not one${added.length ? `: ${quoted(added)}` : ''}`];
  const text = added[0]!.text;
  return says(text, 'question') && says(text, 'chang') ? [] : [`${o.who}: its entry doesn't say the question changed: "${text}"`];
}
/** The card's value before the move and at each read after it: armed, then not, then armed again. */
export function armedAgain(o: { who: string; before: unknown; after: readonly unknown[] }): string[] {
  if (o.before !== 'armed') return [`the fixture's premise doesn't hold: ${o.who} read ${said(o.before)}, not armed, before its pinned revision moved`];
  const left = o.after.findIndex((v) => v !== 'armed');
  if (left < 0) return [`${o.who} stayed armed through its pinned revision's move: it never returned to presented`];
  return o.after.slice(left).includes('armed') ? [] : [`${o.who} never armed again after its pinned revision moved: it reads ${o.after.slice(-3).map((v) => said(v)).join(', ')}`];
}

// ---- AC7: the hold before a step that can't be undone.

export interface HoldRun {
  who: string;
  /** The page open, before the approval. */
  base: Read;
  /** When the approval's events were delivered, in flicks since launch: the hold's start. */
  startedAt: number;
  /** `through` ms into the hold on the virtual clock, with nothing delivered since its start. */
  counted: Read;
  through: number;
  /** 3 s after the events of the push running were delivered. */
  ran: Read;
  keys: readonly string[];
}
export function holdLines(o: HoldRun): string[] {
  const held = addedSince(o.base, o.counted);
  if (held.problem) return [`${o.who}: ${held.problem}`];
  const out: string[] = [];
  const first = held.added[0];
  if (!first) out.push(`${o.who}: approving it made no entry at the hold's start`);
  else {
    if (first.t - o.startedAt > 2.5 * FLICKS) out.push(`${o.who}: its first entry came ${((first.t - o.startedAt) / FLICKS).toFixed(1)} s into the hold, not at its start: "${first.text}"`);
    if (!holdsAlone(first.text, HOLD)) out.push(`${o.who}: the entry at the hold's start doesn't hold "${HOLD}": "${first.text}"`);
    if (!o.keys.length) out.push('the action table (crates/deep-app/src/actions.json) gives no key that undoes an answer');
    else if (!o.keys.some((k) => holds(first.text, k))) out.push(`${o.who}: the entry at the hold's start doesn't hold the key that undoes it, ${o.keys.join(' or ')}: "${first.text}"`);
  }
  if (held.added.length > 1) out.push(`${o.who}: the hold added ${many(held.added.length)} from its start through ${o.through / 1000} s of its countdown on the virtual clock, not the one at its start: ${quoted(held.added)}`);
  const ran = addedSince(o.counted, o.ran);
  if (ran.problem) return [...out, `${o.who}: ${ran.problem}`];
  if (ran.added.length !== 1) out.push(`${o.who}: ${many(ran.added.length)} ${ran.added.length === 1 ? 'was' : 'were'} made when its push ran, not one${ran.added.length ? `: ${quoted(ran.added)}` : ''}`);
  return out;
}

// ---- AC8: changes that land together.

export function together(o: { what: string; n: number; before: Read; after: Read; besides?: readonly string[] }): string[] {
  const { added, problem } = addedSince(o.before, o.after);
  if (problem) return [`${o.what}: ${problem}`];
  if (added.length !== 1) return [`${o.what} added ${many(added.length)}, not one with the count ${o.n}${added.length ? `: ${quoted(added)}` : ''}`];
  return holdsCount(added[0]!.text, o.n, o.besides) ? [] : [`${o.what} added one entry that doesn't hold the count ${o.n}, as a number or in words: "${added[0]!.text}"`];
}

// ---- AC9: the hub stops answering, and answers again.

const DOWN = "isn't answering";
/**
 * Whether the window itself says the hub isn't answering (#1461's words, where the base draws them): a string the frame
 * draws holds them, or a node outside the region names them. The region's own rows are what was said, not what is so.
 */
export function windowSaysDown(s: Snapshot | undefined): boolean {
  if (!s) return false;
  const named = (n: SNode): boolean => n.id !== REGION && (says(`${n.name ?? ''} ${typeof n.value === 'string' ? n.value : ''}`, DOWN) || (n.children ?? []).some(named));
  return (s.runs ?? []).some((r) => says(r.text, DOWN)) || named(s.tree);
}
export interface HubRun {
  base: Read;
  /** 3 s after the hub stopped. */
  down: Read;
  /** 60 s later, the hub still stopped. */
  still: Read;
  /** How long after the hub answered again the window stopped saying it isn't answering: its next read of the hub, in ms of the replica's clock. */
  knewAfter: number;
  /** 3 s after the window stopped saying it. */
  back: Read;
  /** Why the window's own read that the hub answers couldn't be told, when it couldn't: nothing is judged of its return then. */
  unread?: string;
}
/** One entry says the hub isn't answering. */
export function hubDown(o: Pick<HubRun, 'base' | 'down'>): string[] {
  const { added, problem } = addedSince(o.base, o.down);
  if (problem) return [`the hub stopped: ${problem}`];
  if (added.length !== 1) return [`the hub stopped and ${many(added.length)} ${added.length === 1 ? 'was' : 'were'} made in the next 3 s, not one${added.length ? `: ${quoted(added)}` : ''}`];
  const text = added[0]!.text;
  return says(text, 'hub') && says(text, DOWN) ? [] : [`the hub stopped and the entry doesn't say the hub ${DOWN}: "${text}"`];
}
/**
 * None repeats over the next 60 s, and one more comes when it answers: from the 60 s' end to 3 s after the window's own
 * read that the hub answers (README, Readings 16), exactly one entry, and not one saying it isn't answering.
 */
export function hubQuietThenBack(o: HubRun): string[] {
  const first = hubDown(o);
  if (first.length) return first.map((f) => `nothing to repeat: ${f}`);
  const out = noneAdded({ what: 'the 60 s after the hub stopped, with it still stopped,', before: o.down, after: o.still });
  if (o.unread) return [...out, `BLOCKED: the fixture didn't hold: ${o.unread}`];
  const { added, problem } = addedSince(o.still, o.back);
  if (problem) return [...out, `the hub answered again: ${problem}`];
  const when = `the window read that it answers ${(o.knewAfter / 1000).toFixed(1)} s later, and by 3 s after that`;
  if (added.length !== 1) out.push(`the hub answered again, ${when} ${many(added.length)} ${added.length === 1 ? 'was' : 'were'} made, not one${added.length ? `: ${quoted(added)}` : ''}`);
  else if (says(added[0]!.text, DOWN)) out.push(`the hub answered again, ${when} the entry made says it ${DOWN}: "${added[0]!.text}"`);
  return out;
}

// ---- AC10: the live window's tree, read through the Accessibility API (probe.swift).

export interface AxNode { role: string | null; subrole: string | null; title: string | null; description: string | null; value: string | null; identifier: string | null; live: string | null; children: AxNode[] }
export const axFlat = (n: AxNode, into: AxNode[] = []): AxNode[] => { into.push(n); for (const c of n.children ?? []) axFlat(c, into); return into; };
const labelOf = (n: AxNode): string | null => n.title ?? n.description;
/** The nodes AppKit marks as a polite live region: those whose `AXARIALive` reads `polite` (README, Surfaces 6). */
export const politeRegions = (windows: readonly AxNode[]): AxNode[] => windows.flatMap((w) => axFlat(w)).filter((n) => (n.live ?? '').trim().toLowerCase() === 'polite');
/**
 * The live tree against the replica's entries for the same run: one node marked polite, the region (`live-region`), its
 * value the last line, and its rows the replica's entries, newest first.
 */
export function liveTree(o: { windows: readonly AxNode[]; entries: readonly Entry[] }): string[] {
  const marked = politeRegions(o.windows);
  if (marked.length !== 1) return [`the live window's tree, read through AppKit, holds ${marked.length} nodes marked as a polite live region (AXARIALive "polite"), not one${marked.length ? `: ${marked.map((n) => said({ identifier: n.identifier, value: n.value }, 160)).join(' | ')}` : ''}`];
  const region = marked[0]!;
  const out: string[] = [];
  if (region.identifier !== REGION) out.push(`the node marked as a polite live region carries the identifier ${said(region.identifier)}, not the region's, "${REGION}"`);
  const last = o.entries.at(-1);
  if (!last) return [...out, `the replica made no entry in the same run, so the live region's value ${said(region.value)} has no last line to equal`];
  if (region.value !== last.text) out.push(`the live region's value is ${said(region.value)}, not the last line "${last.text}"`);
  const want = [...o.entries].reverse().map((e) => e.text);
  const rows = (region.children ?? []).map(labelOf);
  if (rows.length < want.length || want.some((line, i) => rows[i] !== line)) out.push(`the live run's entries aren't the replica's: the live region's rows read ${rows.map((r) => said(r, 120)).join(' | ') || 'nothing'}, and the replica's entries, newest first, ${want.map((l) => `"${l}"`).join(' | ')}`);
  return out;
}

// ---- AC11: an idle window.

/** A frame of a replica's clock, as `close` reports it in the mode that draws only what a real window would (#1482). */
export interface Frame { t: number; drawn?: boolean; notified?: unknown[] }
/** The wakeups after `from` and up to `to`, in flicks: frames of the clock that drew or told an entity. */
export const wakeups = (frames: readonly Frame[], from: number, to: number): Frame[] => frames.filter((f) => Number(f.t) > from && Number(f.t) <= to && (f.drawn === true || (Array.isArray(f.notified) && f.notified.length > 0)));
