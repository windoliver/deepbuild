// #2668's judges: how the current design's readers name a row, with no hub, CLI or replica of their own. Each returns
// what's wrong, naming the row or session, or nothing. judges.test.ts holds each to a right input and the wrong ones;
// the redrafts (proposed/, README) call them on what the real hub, CLI and replica print.
//
// What they read is current main's: the window is #1461's "one list and one page" (the design's One list and one page),
// the rows' one order and their words are States people see, and a session has one name (#2018). The tree's ids are
// the ones #1459 and #1461's suite pin: `list`, `heading:needs-you`, `heading:<project>`, a row's own id
// (`ask:<ULID>`, `session:<ID>`), a project's folded quiet row `quiet:<project>`, and a row's slots `<row id>:<slot>`.

/** A snapshot node and a snapshot, in the one snapshot shape `see` answers (#1459). */
export interface SNode { role: string; name: string | null; value: unknown; id?: unknown; bounds: number[]; children: SNode[] }
export interface Snapshot { window: { size: number[]; scale: number }; tree: SNode; items: unknown[] }
/** A row as `deep status --json` and `see`'s `rows` hold it: the fields these judges read. */
export interface Row { id: string; title: string; word: string; entry?: unknown; project?: unknown; session?: unknown; [key: string]: unknown }

export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };
const said = (v: unknown): string => JSON.stringify(v)?.slice(0, 160) ?? String(v);
const textOf = (n: SNode): string => [n.name ?? '', typeof n.value === 'string' ? n.value : '', ...(n.children ?? []).map(textOf)].join(' ');
const named = (r: Row): string => `row ${r.id} ("${r.title}")`;

/** Needs you's heading: the first heading of the list (#1461, the tree's `heading:needs-you`). */
export const NEEDS_YOU = 'heading:needs-you';
/** How an ask waits besides open, which its node's value says in place of its entry (#1461: folded, later, held). */
const WAITS = ['folded', 'later', 'held'];
/** A row id of the list: one colon, so a slot (`<row id>:word`) never counts as a row. */
const isRowId = (id: unknown): id is string => typeof id === 'string' && /^[a-z]+:[^:]+$/.test(id);
const isHeading = (id: unknown): id is string => typeof id === 'string' && id.startsWith('heading:');

/**
 * The window draws `see`'s rows as the design lays out its one list (#1463 AC1's drawn-row judge, current design):
 *
 * - the list (`list`) opens with the heading Needs you, then a row per open ask in the order the rows hold the asks
 *   (oldest first), all above every project's heading; an ask's node carries the ask's title, its value the row's
 *   entry (or how it waits), and its state-word slot a word (its kind; the heading says it needs you);
 * - then a heading per project, each session's row under its own project's heading and before the next heading, the
 *   sessions of one project in the order the rows hold them; a session's node carries its title, its value the row's
 *   entry, and its state-word slot the row's word;
 * - a quiet session is folded into its project's one quiet row (`quiet:…`), which counts every quiet session of the
 *   project and reads quiet;
 * - any other row (a running job's) is a node of the list with its id, carrying its title and word.
 *
 * The rows' one order puts sessions first and the asks last (States people see); the window draws Needs you first.
 * So the judge holds each section to the rows' order, never the whole window.
 */
export function drawnRowFailures(s: Snapshot, rows: readonly Row[]): string[] {
  const list = flat(s.tree).find((n) => n.id === 'list');
  if (!list) return [`the window has no list: no node's id is "list", so none of see's ${rows.length} rows is drawn`];
  const order = flat(list);
  const at = (id: string): number => order.findIndex((n) => n.id === id);
  const slot = (id: string, part: string): SNode | undefined => order.find((n) => n.id === `${id}:${part}`);
  const headings = order.map((n, i) => (isHeading(n.id) ? i : -1)).filter((i) => i >= 0);
  const nextHeading = (from: number): number => headings.find((i) => i > from) ?? order.length;
  const projectHeading = (project: string | null | undefined): number => {
    const byId = at(`heading:${project ?? 'none'}`);
    return byId >= 0 ? byId : headings.find((i) => i !== at(NEEDS_YOU) && order[i]!.name === (project ?? 'No project')) ?? -1;
  };
  const out: string[] = [];
  const asks = rows.filter((r) => r.id.startsWith('ask:'));
  const sessions = rows.filter((r) => r.id.startsWith('session:'));
  const others = rows.filter((r) => !r.id.startsWith('ask:') && !r.id.startsWith('session:'));

  // Needs you and its asks.
  const needs = at(NEEDS_YOU);
  const firstProject = headings.find((i) => i !== needs) ?? order.length;
  if (asks.length && needs < 0) out.push(`the list draws no heading Needs you (${NEEDS_YOU}) over its ${asks.length} ask rows`);
  if (asks.length && needs >= 0 && headings[0] !== needs) out.push(`the list's first heading is ${said(order[headings[0]!]!.id)}, not Needs you`);
  let lastAsk: { r: Row; i: number } | undefined;
  for (const r of asks) {
    const i = at(r.id);
    if (i < 0) { out.push(`${named(r)} is in see's rows but no node of the list carries its id`); continue; }
    if (needs >= 0 && i < needs) out.push(`${named(r)} is drawn above the heading Needs you`);
    if (i > firstProject) out.push(`${named(r)} is drawn under a project's heading (${said(order[firstProject]!.id)}), not under Needs you`);
    if (lastAsk && i < lastAsk.i) out.push(`${named(r)} is drawn above ${lastAsk.r.id}, the ask before it in see's rows: a second order of the asks`);
    lastAsk = { r, i };
    const n = order[i]!;
    if (!textOf(n).includes(r.title)) out.push(`${named(r)}'s node reads ${said(textOf(n).trim())}, which lacks its title`);
    if (n.value !== r.entry && !WAITS.includes(String(n.value))) out.push(`${named(r)}'s node has the value ${said(n.value)}, not its entry "${r.entry}"`);
    const word = slot(r.id, 'word');
    if (!word || !(word.name ?? '').trim()) out.push(`${named(r)} draws no word in its state-word slot (${r.id}:word)`);
  }

  // Each project's sessions, under its heading, in the rows' order; the quiet ones folded into one row.
  const lastIn = new Map<string, { r: Row; i: number }>();
  for (const r of sessions) {
    const project = typeof r.project === 'string' ? r.project : null;
    const h = projectHeading(project);
    if (h < 0) { out.push(`${named(r)}: the list has no heading for its project ${said(project)}`); continue; }
    const end = nextHeading(h);
    if (r.word === 'quiet') {
      const folded = order.slice(h + 1, end).find((n) => isRowId(n.id) && String(n.id).startsWith('quiet:'));
      const many = sessions.filter((x) => x.word === 'quiet' && (x.project ?? null) === project).length;
      if (!folded) { out.push(`${named(r)} reads quiet, and no quiet row (quiet:…) under project ${said(project)}'s heading folds it`); continue; }
      const text = textOf(folded);
      if (!new RegExp(`\\b${many} quiet sessions?\\b`).test(text)) out.push(`${named(r)} is one of ${many} quiet sessions of project ${said(project)}, and its folded row ${String(folded.id)} reads ${said(text.trim())}`);
      if ((slot(String(folded.id), 'word')?.name ?? '') !== 'quiet') out.push(`${named(r)}'s folded row ${String(folded.id)} doesn't read quiet in its state-word slot`);
      continue;
    }
    const i = at(r.id);
    if (i < 0) { out.push(`${named(r)} is in see's rows but no node of the list carries its id`); continue; }
    if (i < h || i >= end) out.push(`${named(r)} is drawn outside its project ${said(project)}'s heading`);
    if (needs >= 0 && i < needs) out.push(`${named(r)} is drawn above the heading Needs you`);
    const before = lastIn.get(String(project));
    if (before && i < before.i) out.push(`${named(r)} is drawn above ${before.r.id}, the session of its project before it in see's rows: a second order`);
    lastIn.set(String(project), { r, i });
    const n = order[i]!;
    if (!(n.name ?? '').includes(r.title)) out.push(`${named(r)}'s node reads ${said(n.name)}, which lacks its title`);
    if (n.value !== r.entry) out.push(`${named(r)}'s node has the value ${said(n.value)}, not its entry "${r.entry}"`);
    const word = slot(r.id, 'word')?.name;
    if (word !== r.word) out.push(`${named(r)}'s state-word slot reads ${said(word ?? null)}, not its word "${r.word}"`);
  }

  for (const r of others) {
    const i = at(r.id);
    if (i < 0) { out.push(`${named(r)} is in see's rows but no node of the list carries its id`); continue; }
    const text = textOf(order[i]!);
    for (const [what, value] of [['title', r.title], ['word', r.word]] as const) if (!text.includes(value)) out.push(`${named(r)}'s node reads ${said(text.trim())}, which lacks its ${what} "${value}"`);
  }
  return out;
}

/**
 * The word `deep status`'s text gives a row (#2018's listing: `  <name>  <agent>  <word> · <flag> · <why>, <age>` under
 * its project, the quiet ones folded into `<n> quiet, by repo: <project> <n>, …`): the row's word when the text says
 * it, else what the text says in its place.
 */
export function statusTextWord(text: string, row: Row): { word: string | undefined; said: string } {
  const lines = text.split('\n');
  if (row.word === 'quiet') {
    const fold = lines.find((l) => /^\d+ quiet, by repo: /.test(l));
    const project = row.project ?? 'no repo';
    const holds = fold !== undefined && fold.replace(/^\d+ quiet, by repo: /, '').split(', ').some((p) => p.replace(/ \d+$/, '') === project);
    const own = lines.find((l) => l.startsWith(`  ${row.title}  `));
    if (holds && !own) return { word: 'quiet', said: fold! };
    return { word: undefined, said: own ?? fold ?? 'no line folds it' };
  }
  const line = lines.find((l) => l.startsWith(`  ${row.title}  `));
  if (!line) return { word: undefined, said: `no line for "${row.title}"` };
  const tail = line.slice(`  ${row.title}  `.length).split('  ').slice(1).join('  ');
  const says = tail === row.word || tail.startsWith(`${row.word} · `) || tail.startsWith(`${row.word}, `);
  return { word: says ? row.word : undefined, said: line };
}

/**
 * The word the app's list gives a session (the window `see` draws): its row's state-word slot, or, for a session the
 * hub reads quiet, the state-word slot of the quiet row under its project's heading. With its node's value.
 */
export function appSessionWord(s: Snapshot, row: Row): { word: string | undefined; value: unknown; node: string } {
  const list = flat(s.tree).find((n) => n.id === 'list');
  if (!list) return { word: undefined, value: undefined, node: 'no list' };
  const order = flat(list);
  const slotName = (id: string) => order.find((n) => n.id === `${id}:word`)?.name ?? undefined;
  const own = order.find((n) => n.id === row.id);
  if (own) return { word: slotName(row.id), value: own.value, node: `${row.id} ${said(own.name)}` };
  const h = order.findIndex((n) => n.id === `heading:${row.project ?? 'none'}`);
  if (h < 0) return { word: undefined, value: undefined, node: `no row ${row.id} and no heading:${row.project ?? 'none'}` };
  const end = order.findIndex((n, i) => i > h && isHeading(n.id));
  const folded = order.slice(h + 1, end < 0 ? undefined : end).find((n) => isRowId(n.id) && String(n.id).startsWith('quiet:'));
  if (!folded) return { word: undefined, value: undefined, node: `no row ${row.id} and no quiet row under heading:${row.project ?? 'none'}` };
  return { word: slotName(String(folded.id)), value: folded.value, node: `${String(folded.id)} ${said(folded.name)}` };
}

/** One recorded session as both readers named it. */
export interface Named { name: string; session: string; status: string | undefined; statusSaid: string; app: string | undefined; appNode: string }
/** Each session `deep status` and the app's list name differently (#992 AC3), naming the recording and the session. */
export const disagreements = (named: readonly Named[]): string[] => named.flatMap((x) => (x.status !== undefined && x.status === x.app ? [] : [
  `${x.name}: session ${x.session} reads ${x.status === undefined ? `no word (${x.statusSaid})` : `"${x.status}"`} in deep status and ${x.app === undefined ? `no word (${x.appNode})` : `"${x.app}" (${x.appNode})`} in the app's list`,
]));
