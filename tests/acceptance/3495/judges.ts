// The judges of #3495's suite (README, Criterion to tests). Each decides one criterion from what a surface read: a
// print, a row's accessible name, the strings a row draws, a check's lines, a row list or a recorded call. Each returns
// what is wrong, one line a finding, or nothing. The values are the issue's and the design's: the six sentences, word
// for word, from the table under What a person reads on a plain surface, and each word's status-map entry from the
// table under States people see. Nothing here is read from a program's output.
//
// This file imports nothing, so a plain node script can hold each judge to a right input and the wrong ones.

/** The criteria, by `#3495.<first 8 hex of SHA-256(text, white space collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  print: '#3495.ce97e581',
  views: '#3495.7db893a8',
  nine: '#3495.0c4822f4',
  narrow: '#3495.a6932d9f',
  check: '#3495.7faace76',
  detail: '#3495.66e86bd1',
  shown: '#3495.f4a87a07',
} as const;

/**
 * The fifteen words of States people see, in the design's order, each with its status-map entry and what a person
 * reads for it on a plain surface: the design's sentence, or null where the word reads as it is.
 */
export const TABLE: readonly { word: string; entry: string; sentence: string | null }[] = [
  { word: 'queued', entry: 'idle', sentence: null },
  { word: 'working', entry: 'running', sentence: null },
  { word: 'says done', entry: 'running', sentence: null },
  { word: 'PASS', entry: 'pass', sentence: 'done, and the checks agree' },
  { word: 'sent back', entry: 'fail', sentence: "not done yet: a check didn't get what it expected, and the agent is fixing it" },
  { word: 'BLOCKED', entry: 'blocked', sentence: "couldn't be checked: something a check needs is missing" },
  { word: 'INVALID', entry: 'invalid', sentence: "can't be counted: the proof offered doesn't hold" },
  { word: 'INCONCLUSIVE', entry: 'inconclusive', sentence: "couldn't tell: a check didn't finish, or an answer is missing" },
  { word: 'needs you', entry: 'needs_you', sentence: null },
  { word: 'stale', entry: 'stale', sentence: 'checked, and changed since' },
  { word: 'quiet', entry: 'idle', sentence: null },
  { word: 'stuck', entry: 'blocked', sentence: null },
  { word: 'flagged', entry: 'fail', sentence: null },
  { word: 'finished', entry: 'idle', sentence: null },
  { word: 'running', entry: 'running', sentence: null },
];
/** The six words that come from a verdict, each with its sentence. */
export const SIX: readonly { word: string; sentence: string }[] = TABLE.flatMap((t) => (t.sentence === null ? [] : [{ word: t.word, sentence: t.sentence }]));
/** The other nine, which read as they are. */
export const NINE: readonly string[] = TABLE.filter((t) => t.sentence === null).map((t) => t.word);
export const sentenceOf = (word: string): string | null => TABLE.find((t) => t.word === word)?.sentence ?? null;
export const entryOf = (word: string): string | undefined => TABLE.find((t) => t.word === word)?.entry;
/** What joins a sentence to its word, and a row's parts to each other: the issue's "… is missing · BLOCKED". */
export const JOIN = ' · ';
/** A state as a plain surface reads it: its sentence, then its word. */
export const led = (word: string): string => `${sentenceOf(word) ?? ''}${JOIN}${word}`;

const said = (v: unknown, most = 260): string => (JSON.stringify(v) ?? String(v)).slice(0, most);
const LETTER = /[\p{L}\p{N}]/u;
const LEADING = /^[\s·]+/;
const TRAILING = /[\s·]+$/;
/** Whether `text` starts with `words` as whole words. */
const starts = (text: string, words: string): boolean => text.startsWith(words) && !LETTER.test(text[words.length] ?? '');
/** Where `words` stand in `text` as whole words, from `from` on: each place, in order. */
export function placesOf(text: string, words: string, from = 0): number[] {
  const out: number[] = [];
  for (let at = text.indexOf(words, from); at >= 0; at = text.indexOf(words, at + 1)) {
    if (!LETTER.test(text[at - 1] ?? '') && !LETTER.test(text[at + words.length] ?? '')) out.push(at);
  }
  return out;
}

// ---- A row as one surface reads it.

/**
 * A row on one surface: its id, its title, its state word, its agent where the surface writes one after the title
 * (`deep`'s line), the row's own sentence (`why`) where the surface must keep it, and the one text the surface reads
 * the row as: `deep`'s line for it, or its node's accessible name. `text` is undefined when the surface shows no such row.
 */
export interface Reading { id: string; title: string; word: string; agent?: string | null; why?: string; text: string | undefined }
/** A row as a finding names it: its id and its title. */
export const named = (r: { id: string; title: string }): string => `row ${r.id} ("${r.title}")`;

/** What a row's text says after its title, and after its agent where one follows: where its state is read. */
export function afterTitle(text: string, title: string, agent?: string | null): string | undefined {
  const at = text.indexOf(title);
  if (at < 0) return undefined;
  let rest = text.slice(at + title.length).replace(LEADING, '');
  if (agent && starts(rest, agent)) rest = rest.slice(agent.length).replace(LEADING, '');
  return rest;
}

/**
 * A row in one of the six states: after its title it reads its sentence, then its word, as in "couldn't be checked:
 * something a check needs is missing · BLOCKED", and where `why` is given, the row's own sentence after that. A
 * finding names the surface, the row and its state, and says which way it is wrong: the word alone, a sentence of the
 * surface's own, or no word at all.
 */
export function leadFailure(surface: string, r: Reading): string | undefined {
  const sentence = sentenceOf(r.word);
  const row = `${named(r)}, ${r.word}`;
  if (sentence === null) return `${row} is not one of the six states that read a sentence`;
  if (r.text === undefined) return `${surface} shows no ${row}`;
  const rest = afterTitle(r.text, r.title, r.agent);
  if (rest === undefined) return `${surface} reads ${row}, as ${said(r.text)}, which doesn't hold its title`;
  const want = led(r.word);
  if (starts(rest, want)) {
    if (r.why && !rest.slice(want.length).includes(r.why)) return `${surface} reads ${row}, as ${said(rest)}: after "${want}" the row's own sentence, ${said(r.why)}, is gone`;
    return undefined;
  }
  if (starts(rest, r.word)) return `${surface} reads ${row}, as its word alone: ${said(rest)} has no sentence before ${r.word}; the table's is "${sentence}"`;
  const [at] = placesOf(rest, r.word);
  if (at === undefined) return `${surface} doesn't read the word of ${row}: ${said(rest)}`;
  const own = rest.slice(0, at).replace(TRAILING, '');
  if (own === sentence) return `${surface} reads ${row}, as ${said(rest.slice(0, at + r.word.length))}: its sentence and its word aren't joined as "${want}"`;
  return `${surface} reads ${row}, with a sentence of its own, ${said(own)}, before ${r.word}; the table's is "${sentence}"`;
}
export const leadFailures = (surface: string, rows: readonly Reading[]): string[] => rows.flatMap((r) => leadFailure(surface, r) ?? []);

/** The table's sentences `text` holds, each with its word. */
export const sentencesIn = (text: string): { word: string; sentence: string }[] => SIX.filter((s) => text.includes(s.sentence));

/**
 * A row that reads its word and no sentence before it: one of the other nine on a plain surface, or any state on a
 * detail view, where it reads as on the merge base. After its title the word comes first. A finding names the surface,
 * the row and its state, and quotes what stands before the word.
 */
export function bareFailure(surface: string, r: Reading, how = 'reads as it is, with no sentence before it'): string | undefined {
  const row = `${named(r)}, ${r.word}`;
  if (r.text === undefined) return `${surface} shows no ${row}`;
  const rest = afterTitle(r.text, r.title, r.agent);
  if (rest === undefined) return `${surface} reads ${row}, as ${said(r.text)}, which doesn't hold its title`;
  if (starts(rest, r.word)) return undefined;
  const [at] = placesOf(rest, r.word);
  if (at === undefined) return `${surface} doesn't read the word of ${row}: ${said(rest)}`;
  return `${surface} reads ${row}, with ${said(rest.slice(0, at).replace(TRAILING, ''))} before its word: ${r.word} ${how}`;
}
export const bareFailures = (surface: string, rows: readonly Reading[], how?: string): string[] => rows.flatMap((r) => bareFailure(surface, r, how) ?? []);

/**
 * A detail view (a session's page, `deep status`): each row reads its state's word as on the merge base, the word
 * first after its title, and nothing the view shows of the row (`whole`) holds a sentence of the table.
 */
export function detailFailures(surface: string, r: Reading, whole: string): string[] {
  const bare = bareFailure(surface, r, 'reads there as on the merge base, its word alone');
  return [
    ...(bare ? [bare] : []),
    ...sentencesIn(whole).map((s) => `${surface} holds the sentence "${s.sentence}" for ${named(r)}, ${r.word}: a detail view reads the state's word as on the merge base`),
  ];
}

/**
 * The project's page, its own region: wherever one of its strings reads one of the six words among other words, the
 * table's sentence leads the word. A string that is the word alone is the word in a slot of its own, which keeps its
 * place, and isn't judged. A finding names the page and the state.
 */
export function pageFailures(surface: string, texts: readonly string[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const { word, sentence } of SIX) {
      if (text.trim() === word) continue;
      for (const at of placesOf(text, word)) {
        if (!text.slice(0, at).endsWith(`${sentence}${JOIN}`)) out.push(`${surface} reads ${word} in ${said(text)} without the table's sentence before it: "${sentence}${JOIN}${word}"`);
      }
    }
  }
  return out;
}

// ---- A row as the list draws it at its narrowest width.

/** A node of the window: its accessible name and its bounds, [x, y, w, h] in device pixels. */
export interface Box { name: string | null; bounds: number[] }
/** A string the window drew: its text, its painted bounds, and whether its clip cut glyphs off its end. */
export interface Drawn { text: string; bounds: number[]; cut?: boolean }
/** One row of the list as drawn: its node, its slots that keep their place, and every string drawn over it. */
export interface RowView {
  id: string; title: string; word: string; sentence: string;
  row: Box | undefined;
  slots: { word: Box | undefined; time: Box | undefined; mark: Box | undefined; flag: Box | undefined };
  runs: readonly Drawn[];
}
const inside = (b: readonly number[], box: readonly number[], slack = 2): boolean => b[0]! >= box[0]! - slack && b[1]! >= box[1]! - slack && b[0]! + b[2]! <= box[0]! + box[2]! + slack && b[1]! + b[3]! <= box[1]! + box[3]! + slack;
const squash = (text: string): string => text.replace(/\s+/g, '');
const ELLIPSIS = /(?:…|\.\.\.)$/;
const ELLIPSIS_FIRST = /^(?:…|\.\.\.)/;
const shownAs = (runs: readonly Drawn[]): string => said(runs.map((r) => (r.cut ? `${r.text} (clipped)` : r.text)));

/** What a slot that keeps its place draws: `text` whole, inside the slot, inside the row. What is wrong, or nothing. */
function wholeIn(v: RowView, part: 'word' | 'time', text: string): string | undefined {
  const slot = v.slots[part];
  if (!slot) return `has no ${part} slot (${v.id}:${part})`;
  const drawn = v.runs.filter((r) => inside(r.bounds, slot.bounds)).sort((a, b) => a.bounds[0]! - b.bounds[0]!);
  if (slot.bounds[2]! <= 0 || squash(drawn.map((r) => r.text).join('')) !== squash(text) || drawn.some((r) => r.cut)) {
    return `"${text}" is drawn as ${shownAs(drawn)} in its slot (${v.id}:${part}, ${slot.bounds[2]} px wide)`;
  }
  return v.row && !inside(slot.bounds, v.row.bounds) ? `its slot (${v.id}:${part}) lies past its row` : undefined;
}

/**
 * At the list's narrowest width: the row shows its word and its time whole, each in its slot; its sentence is cut from
 * its end, so a start of it shows, short of the whole, ending in an ellipsis or at its clip, and stops before the
 * word; and the row's accessible name holds the whole sentence. Each finding starts with the row.
 */
export function narrowFailures(v: RowView): string[] {
  const row = named(v);
  if (!v.row) return [`${row} isn't drawn in the list`];
  const out: string[] = [];
  const word = wholeIn(v, 'word', v.word);
  if (word) out.push(`${row} doesn't show its word whole: ${word}`);
  const time = v.slots.time?.name?.trim();
  if (!time) out.push(`${row} shows no time: its time slot (${v.id}:time) names none`);
  else {
    const wrong = wholeIn(v, 'time', time);
    if (wrong) out.push(`${row} doesn't show its time whole: ${wrong}`);
  }
  // The sentence is drawn outside the slots that keep their place: the mark, the word, the flag and the time.
  const kept = [v.slots.mark, v.slots.word, v.slots.flag, v.slots.time].flatMap((slot) => (slot ? [slot] : []));
  const free = v.runs.filter((r) => !kept.some((slot) => inside(r.bounds, slot.bounds))).sort((a, b) => a.bounds[0]! - b.bounds[0]!);
  const cutAtEnd = free.filter((r) => {
    if (r.cut) return r.text.startsWith(v.sentence) && r.bounds[2]! > 0;
    const start = r.text.replace(ELLIPSIS, '').trimEnd();
    return ELLIPSIS.test(r.text) && start.length > 0 && start.length < v.sentence.length && v.sentence.startsWith(start);
  });
  const wordSlot = v.slots.word;
  if (!cutAtEnd.length) {
    const end = (r: Drawn): string => r.text.replace(ELLIPSIS_FIRST, '').trim();
    if (free.some((r) => !r.cut && r.text.includes(v.sentence))) out.push(`${row} draws its sentence whole, not cut: ${shownAs(free)}`);
    else if (free.some((r) => ELLIPSIS_FIRST.test(r.text) && end(r).length > 0 && v.sentence.endsWith(end(r)))) out.push(`${row} cuts its sentence from its start, not from its end: ${shownAs(free)}`);
    else out.push(`${row} draws no start of its sentence "${v.sentence}" cut from its end: beside its word and its time it draws ${shownAs(free)}`);
  } else if (wordSlot && cutAtEnd.some((r) => r.bounds[0]! + r.bounds[2]! > wordSlot.bounds[0]! + 2)) {
    out.push(`${row} draws its sentence over its word: ${shownAs(cutAtEnd)} runs past the word slot's left edge`);
  }
  if (!v.row.name?.includes(v.sentence)) out.push(`${row} has the accessible name ${said(v.row.name)}, which doesn't hold its whole sentence "${v.sentence}"`);
  return out;
}

// ---- `deep status --json`.

/** A row the fixture holds: its id, its title and the word its state reads as on the merge base. */
export interface Expected { id: string; title: string; word: string }
/** Each expected row is in the list once, with the same `word` and `entry` as on the merge base. A finding names the row. */
export function jsonFailures(rows: readonly { id?: unknown; word?: unknown; entry?: unknown }[], expected: readonly Expected[], who = 'deep status --json'): string[] {
  const out: string[] = [];
  for (const e of expected) {
    const mine = rows.filter((r) => r.id === e.id);
    const [row] = mine;
    if (mine.length !== 1 || !row) { out.push(`${named(e)} is in ${who} ${mine.length} times, not once`); continue; }
    if (row.word !== e.word) {
      const sentence = typeof row.word === 'string' && sentencesIn(row.word).length > 0;
      out.push(`${named(e)} holds the word ${said(row.word)} in ${who}, not "${e.word}" as on the merge base${sentence ? ': its word holds a sentence' : ''}`);
    }
    if (row.entry !== entryOf(e.word)) out.push(`${named(e)} holds the entry ${said(row.entry)} in ${who}, not "${entryOf(e.word)}" as on the merge base`);
  }
  return out;
}

// ---- The lint lane's check of the table.

/** The name the check's lines carry: `PASS plain states …`, `FAIL plain states: …`. */
export const CHECK_NAME = 'plain states';
export interface CheckRun { code: number | null; stdout: string; stderr: string }
const linesOf = (run: CheckRun, verdict: 'PASS' | 'FAIL'): string[] => run.stdout.split('\n').filter((l) => starts(l, `${verdict} ${CHECK_NAME}`));
const ranAs = (run: CheckRun): string => `exit ${run.code}, stdout ${said(run.stdout.slice(-1200), 1300)}, stderr ${said(run.stderr.slice(-600), 700)}`;
/** The check passes: exit 0, a `PASS plain states` line and no FAIL line. */
export function passFailures(run: CheckRun): string[] {
  const fails = run.stdout.split('\n').filter((l) => l.startsWith('FAIL'));
  return [
    ...(run.code === 0 ? [] : [`the check exits ${run.code}, not 0: ${ranAs(run)}`]),
    ...(linesOf(run, 'PASS').length ? [] : [`the check prints no line starting "PASS ${CHECK_NAME}": ${ranAs(run)}`]),
    ...fails.map((l) => `the check prints ${said(l)}`),
  ];
}
/**
 * The check fails naming `name`: exit 1, and a `FAIL plain states` line that holds `name` as a whole word. With
 * `planted`, a sentence the test planted, the name must stand outside it: a line that only quotes the planted
 * sentence names nothing.
 */
export function namingFailures(run: CheckRun, name: string, planted?: string): string[] {
  const fails = linesOf(run, 'FAIL');
  if (run.code !== 1 || !fails.length) return [`the check doesn't fail with exit 1 and a line starting "FAIL ${CHECK_NAME}": ${ranAs(run)}`];
  const names = (line: string): boolean => placesOf(planted ? line.split(planted).join(' ') : line, name).length > 0;
  return fails.some(names) ? [] : [`no "FAIL ${CHECK_NAME}" line names ${said(name)}${planted ? ' outside the planted sentence' : ''}: ${said(fails, 900)}`];
}

// ---- Shown to you, and the call recorded on it.

/** A `deep` line with the time at its end made a placeholder, so two runs a minute apart read the same. */
export const ageless = (line: string): string => line.replace(/, \d+ ?(?:s|m|min|h|d)$/, ', <age>');
/** A text as the merge base reads it: the same text with the sentence before its word taken out. */
export const before = (text: string, word: string): string => text.split(`${sentenceOf(word) ?? ''}${JOIN}${word}`).join(word);
/** One of the six rows as the three plain surfaces read it in this run. */
export interface Shown { word: string; deep: string; list: string; beside: string; page: readonly string[] }
/**
 * The six rows in what `deep` prints, in the list and on the project's page, before and after: the text a person
 * reads to make criterion 7's call. It holds no id and no time, so one record gives one text.
 */
export function shownText(rows: readonly Shown[]): string {
  const out = [
    `The six rows of #3495's fixture record on each plain surface, before and after (criterion ${ID.shown}).`,
    'After is what this run read. Before is the same row as the merge base reads it: its word, with no sentence before it.',
    "In what deep prints, the agent's name reads <agent> and the time at a line's end reads <age>.",
  ];
  for (const r of rows) {
    const pair = (text: string): string[] => [`    before: ${before(text, r.word)}`, `    after:  ${text}`];
    out.push('', r.word, '  what deep prints', ...pair(r.deep.trim()), "  the list's row", ...pair(r.list), "  the project's page, the row beside it", ...pair(r.beside));
    out.push("  the project's page, its own region", ...(r.page.length ? r.page.flatMap(pair) : ['    before: no line for this row', '    after:  no line for this row']));
  }
  return `${out.join('\n')}\n`;
}

/** The record a person fills in once: TASTE.json. */
export interface Taste { issue?: unknown; criterion?: unknown; verdict?: unknown; who?: unknown; when?: unknown; files?: unknown; note?: unknown }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
/**
 * What the recorded call says of this run's files, each by its SHA-256: that they read right, that they read wrong,
 * or why the run stays INCONCLUSIVE: no call, one that names no person or no time, or one made on other rows.
 */
export function tasteReading(taste: Taste | null, files: Record<string, string>): { reads: 'right' } | { reads: 'wrong'; note: string } | { inconclusive: string } {
  if (taste === null || typeof taste !== 'object') return { inconclusive: 'TASTE.json holds no record' };
  if (taste.issue !== 3495 || taste.criterion !== ID.shown) return { inconclusive: `TASTE.json is the record of issue ${said(taste.issue)}, criterion ${said(taste.criterion)}, not of ${ID.shown}` };
  if (taste.verdict === null || taste.verdict === undefined) return { inconclusive: 'no taste call is recorded for these rows (TASTE.json holds none)' };
  if (taste.verdict !== 'reads_right' && taste.verdict !== 'reads_wrong') return { inconclusive: `the recorded verdict ${said(taste.verdict)} is neither reads_right nor reads_wrong` };
  if (typeof taste.who !== 'string' || !taste.who.trim() || typeof taste.when !== 'string' || !taste.when.trim()) return { inconclusive: 'the recorded taste call names no one or no time' };
  const judged = taste.files !== null && typeof taste.files === 'object' && !Array.isArray(taste.files) ? (taste.files as Record<string, string>) : {};
  if (sorted(judged) !== sorted(files)) return { inconclusive: `the recorded taste call was made on other rows than this run's: it names ${said(judged)}, and this run wrote ${said(files)}` };
  return taste.verdict === 'reads_right' ? { reads: 'right' } : { reads: 'wrong', note: typeof taste.note === 'string' ? taste.note : '' };
}
