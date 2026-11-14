// @deepbuild/briefs (#1342; design: One input): a person's words, with any file or link, as one brief on one card,
// with no model in any of it. The research job on the runner answers with a draft whose every line cites its sources
// by the exact words there; here the draft is held to what those sources say. A line no source says is gone. A
// requirement only your own words make: a line that rests on a page or a file is shown as that source's text and adds
// nothing. Every promise maps to a check of a named kind or a taste call, or the brief is refused naming it, and every
// task serves a line of the brief, or it's left out naming it. The hub keeps the record, raises the card and applies it.

/** What it makes, read from your words; never asked. */
export const MAKES = ['document', 'deck', 'film', 'plan', 'budget', 'report', 'site', 'game', 'app'] as const;
export type Makes = (typeof MAKES)[number];
/** What is software, and so gets a private code project instead of a workspace. */
const SOFTWARE: ReadonlySet<string> = new Set(['site', 'game', 'app']);
/** The kinds of check a promise maps to; taste is a call that takes its recommended answer and never stops the run. */
export const KINDS = ['document', 'data', 'message', 'money', 'code', 'taste'] as const;
export type Kind = (typeof KINDS)[number];
/** The brief's fields, one page in plain words; `fact` is a source's own text, shown with it, which adds nothing. */
export const FIELDS = ['makes', 'for', 'holds', 'leaves_out', 'proves', 'goes'] as const;
export type Field = (typeof FIELDS)[number] | 'fact';
/** Your own words, as a line's cite names them. */
export const WORDS = 'words';

/** A source as a line cites it: your words, a link as you gave it, or a file's path as you gave it, and the exact words there. */
export interface Cite { at: string; quote: string }
export interface Line { id: string; field: Field; text: string; cites: Cite[]; /** A strong default you didn't choose: no source. */ default?: true }
export interface Task { title: string; serves: string[]; criteria: string[]; blocked_by: string[] }
/** A step that buys, books, posts or sends: never in the card's plan, and asked once when it's due. */
export interface Held { does: string; usd: number; due: string | null; at: string }
export interface Promised { line: string; kind: Kind; /** A taste call's recommended answer. */ recommended?: string }
export type Cadence = 'day' | 'week' | 'month' | 'year';
export interface Brief {
  makes: Makes; software: boolean;
  lines: Line[]; promises: Promised[]; tasks: Task[];
  /** Each task the brief left out, and why. */
  left_out: { title: string; why: string }[];
  held: Held[];
  /** A project of yours this fits, by its id, offered as the other answer. */
  fits: string | null;
  every: Cadence | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []);
/** Text as quotes are compared: NFC, any case, each white space run one space. */
const norm = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

// ---- The input.

const LINK = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
/** A repo on a forge: a host with an owner and a name and nothing past them. Such a link takes #1341's route. */
export function repoLink(url: string): boolean {
  try {
    const u = new URL(url);
    return /^(www\.)?(github\.com|gitlab\.com|codeberg\.org)$/i.test(u.hostname) && /^\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(u.pathname) && !u.search;
  } catch { return false; }
}
/** The links in your words, each as you gave it. */
export function linksOf(words: string): string[] {
  return [...new Set([...words.matchAll(LINK)].map((m) => m[0].replace(/[.,;:!?]+$/, '')))];
}
/** The heading a new project's row shows: your first words, cut at a word within 60 characters. */
export function headingOf(words: string): string {
  const line = (words.trim().split('\n')[0] ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...line];
  if (chars.length <= 60) return line;
  const cut = chars.slice(0, 60).join('');
  const at = cut.lastIndexOf(' ');
  return `${(at > 20 ? cut.slice(0, at) : cut).trim()}…`;
}
/** "every month", "monthly": a job that repeats, read with no model. */
export function cadenceOf(words: string): Cadence | null {
  const m = /\b(?:every|each)\s+(day|week|month|year)\b|\b(daily|weekly|monthly|yearly|annually)\b/i.exec(words);
  if (!m) return null;
  const w = (m[1] ?? m[2]!).toLowerCase();
  return w.startsWith('da') ? 'day' : w.startsWith('w') ? 'week' : w.startsWith('m') ? 'month' : 'year';
}
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** A fetched page as the text a person reads on it, so a quote from it matches. */
export function pageText(body: string, type = 'text/html'): string {
  if (!/html/i.test(type)) return body.trim();
  return body
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(p|div|br|li|h[1-6]|tr|section|article|header|footer|ul|ol|table|title)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, e: string) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? all)
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

// ---- The brief.

/** The line a field takes when nothing chose one: fixed text, so no model can add a requirement there. */
const DEFAULTS: Record<Exclude<Field, 'fact' | 'makes'>, string> = {
  for: 'You, the person who asked.',
  holds: 'What your words ask for, and nothing more.',
  leaves_out: "Anything your words don't ask for.",
  proves: 'Each line above holds in the finished version.',
  goes: 'Kept in its own folder on this computer, where you open it.',
};
/** The check a default promise maps to, by what it makes. */
const DEFAULT_KIND: Record<Makes, Kind> = { document: 'document', deck: 'document', film: 'taste', plan: 'document', budget: 'money', report: 'document', site: 'code', game: 'code', app: 'code' };

/**
 * The research job's answer held to its sources, or why it's refused. `sources` holds each source's text by the name
 * a cite gives it: your words under `words`, a link or a file as you gave it. `projects` are your projects' ids.
 */
export function briefOf(answer: unknown, sources: ReadonlyMap<string, string>, projects: readonly string[], typed: string): Brief | { refused: string } {
  if (!isObj(answer)) return { refused: 'The research gave no brief.' };
  const makes = String(answer.makes ?? '').trim().toLowerCase();
  if (!(MAKES as readonly string[]).includes(makes)) return { refused: `The brief says it makes "${makes || 'nothing'}", which is none of ${MAKES.join(', ')}.` };
  const said = new Map([...sources].map(([at, text]) => [at, norm(text)] as const));
  const lines: Line[] = [];
  const ids = new Set<string>();
  for (const l of Array.isArray(answer.lines) ? answer.lines.filter(isObj) : []) {
    const text = typeof l.text === 'string' ? l.text.trim() : '';
    const id = typeof l.id === 'string' && l.id.trim() ? l.id.trim() : `L${lines.length + 1}`;
    if (!text || ids.has(id)) continue;
    const field = ((FIELDS as readonly string[]).includes(String(l.field)) ? l.field : 'fact') as Field;
    // A cite counts only where its words are at the source it names.
    const cites = (Array.isArray(l.cites) ? l.cites.filter(isObj) : [])
      .map((c) => ({ at: String(c.at ?? ''), quote: String(c.quote ?? '') }))
      .filter((c) => norm(c.quote) !== '' && said.get(c.at)?.includes(norm(c.quote)));
    if (l.default === true && field !== 'fact' && !(Array.isArray(l.cites) && l.cites.length)) {
      ids.add(id);
      lines.push({ id, field, text, cites: [], default: true });
      continue;
    }
    // A claim no source says is gone.
    if (!cites.length) continue;
    // A requirement only your words make; one that rests on a page or a file is that source's text.
    ids.add(id);
    lines.push({ id, field: field !== 'fact' && cites.some((c) => c.at === WORDS) ? field : 'fact', text, cites });
  }
  for (const f of FIELDS) {
    if (f === 'makes' || lines.some((l) => l.field === f)) continue;
    lines.push({ id: `default:${f}`, field: f, text: DEFAULTS[f], cites: [], default: true });
  }
  const required = new Map(lines.filter((l) => l.field !== 'fact').map((l) => [l.id, l] as const));
  // Every promise maps to a check of a named kind or a taste call, or the brief is refused naming it. A promise on a
  // source's text, or on a line that's gone, rests on nothing and isn't one.
  const promises: Promised[] = [];
  for (const p of Array.isArray(answer.promises) ? answer.promises.filter(isObj) : []) {
    const line = required.get(String(p.line ?? ''));
    if (!line || promises.some((x) => x.line === line.id)) continue;
    const kind = String(p.kind ?? '');
    if (!(KINDS as readonly string[]).includes(kind)) return { refused: `The promise "${line.text}" maps to ${kind ? `"${kind}", which is no kind of check,` : 'no kind of check'} and to no taste call.` };
    promises.push({ line: line.id, kind: kind as Kind, ...(kind === 'taste' ? { recommended: typeof p.recommended === 'string' && p.recommended.trim() ? p.recommended.trim() : 'the recommended one' } : {}) });
  }
  for (const line of lines.filter((l) => l.field === 'proves' && !promises.some((p) => p.line === l.id))) {
    if (!line.default) return { refused: `The promise "${line.text}" maps to no kind of check and to no taste call.` };
    promises.push({ line: line.id, kind: DEFAULT_KIND[makes as Makes] });
  }
  // Every task serves a line of the brief; one that doesn't is left out, by name.
  const left_out: Brief['left_out'] = [];
  let tasks: Task[] = [];
  for (const t of Array.isArray(answer.tasks) ? answer.tasks.filter(isObj) : []) {
    const title = typeof t.title === 'string' ? t.title.trim() : '';
    if (!title) continue;
    const serves = strings(t.serves);
    const off = serves.filter((s) => !required.has(s));
    const why = tasks.some((x) => norm(x.title) === norm(title)) ? 'another task has its title'
      : !serves.length ? 'it serves no line of the brief' : off.length ? `it serves no line of the brief (${off.join(', ')})` : undefined;
    if (why) { left_out.push({ title, why }); continue; }
    const criteria = strings(t.criteria);
    tasks.push({ title, serves, criteria: criteria.length ? criteria : serves.map((s) => required.get(s)!.text), blocked_by: strings(t.blocked_by) });
  }
  // A task waits only on a task the brief holds, and none waits on itself through others.
  for (let changed = true; changed;) {
    const held = new Set(tasks.map((t) => norm(t.title)));
    const out = tasks.filter((t) => t.blocked_by.some((b) => !held.has(norm(b))) || waitsOnItself(t, tasks));
    for (const t of out) left_out.push({ title: t.title, why: waitsOnItself(t, tasks) ? 'it waits on itself through other tasks' : `it waits on a task the brief doesn't hold (${t.blocked_by.filter((b) => !held.has(norm(b))).join(', ')})` });
    tasks = tasks.filter((t) => !out.includes(t));
    changed = out.length > 0;
  }
  const held: Held[] = (Array.isArray(answer.held) ? answer.held.filter(isObj) : []).flatMap((h) => {
    const does = typeof h.does === 'string' ? h.does.trim() : '';
    const usd = typeof h.usd === 'number' && Number.isFinite(h.usd) && h.usd >= 0 ? h.usd : 0;
    const due = typeof h.due === 'string' && Number.isFinite(Date.parse(h.due)) ? new Date(Date.parse(h.due)).toISOString() : null;
    return does ? [{ does, usd, due, at: typeof h.at === 'string' ? h.at : '' }] : [];
  });
  const fits = typeof answer.fits === 'string' && projects.includes(answer.fits) ? answer.fits : null;
  return { makes: makes as Makes, software: SOFTWARE.has(makes), lines, promises, tasks, left_out, held, fits, every: cadenceOf(typed) };
}
function waitsOnItself(start: Task, tasks: readonly Task[]): boolean {
  const by = new Map(tasks.map((t) => [norm(t.title), t] as const));
  const seen = new Set<string>();
  const walk = (t: Task): boolean => t.blocked_by.some((b) => {
    const k = norm(b);
    if (k === norm(start.title)) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    const next = by.get(k);
    return next ? walk(next) : false;
  });
  return walk(start);
}

// ---- The page and the card.

const HEADINGS: Record<Exclude<Field, 'fact'>, string> = {
  makes: 'What it makes', for: "Who it's for", holds: 'What the first finished version holds', leaves_out: 'What it leaves out', proves: 'What would prove it', goes: 'Where it goes when finished',
};
const KIND_WORDS: Record<Kind, string> = {
  document: 'a document check: every claim names its source', data: 'a data check', message: 'a message check: it was delivered',
  money: 'a money check: totals add up', code: 'a code check', taste: 'how it looks, taking the recommended answer unless you change it',
};
const EVERY: Record<Cadence, string> = { day: 'every day', week: 'every week', month: 'every month', year: 'every year' };
const usd = (n: number): string => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
/** A held step in plain words: what it does, its price and when it's due. */
export const heldWords = (h: Held): string => `${h.does}${h.usd ? `, for ${usd(h.usd)}` : ''}${h.at ? ` at ${h.at}` : ''}${h.due ? `, due ${h.due}` : ''}`;

/** The one page, in plain words: the same bytes on the card and in the project. `names` gives each source's name. */
export function pageOf(brief: Brief, heading: string): string {
  const kindOf = new Map(brief.promises.map((p) => [p.line, p] as const));
  const out = [`# ${heading}`, '', `It makes ${/^[aeiou]/.test(brief.makes) ? 'an' : 'a'} ${brief.makes}, ${brief.software ? 'in a private code project' : 'in a folder of its own'}.`, ''];
  for (const f of FIELDS) {
    const lines = brief.lines.filter((l) => l.field === f);
    if (!lines.length) continue;
    out.push(`**${HEADINGS[f]}:**`);
    for (const l of lines) {
      const p = kindOf.get(l.id);
      out.push(`- ${l.text}${l.default ? ' (picked for you)' : ''}${p ? ` — ${KIND_WORDS[p.kind]}${p.recommended ? `: ${p.recommended}` : ''}` : ''}`);
    }
    out.push('');
  }
  const facts = brief.lines.filter((l) => l.field === 'fact');
  if (facts.length) {
    out.push('**What its sources say, each in its own words (it adds nothing to the brief):**');
    for (const l of facts) out.push(`- ${l.text} (${l.cites.map((c) => (c.at === WORDS ? 'your words' : c.at)).join('; ')})`);
    out.push('');
  }
  out.push('**Tasks:**');
  brief.tasks.forEach((t, i) => out.push(`${i + 1}. ${t.title}${t.blocked_by.length ? ` (after ${t.blocked_by.join(', ')})` : ''}`));
  for (const t of brief.left_out) out.push(`- Left out: ${t.title}, because ${t.why}.`);
  out.push('');
  if (brief.every) out.push(`**It repeats:** ${EVERY[brief.every]}, under this same approval.`, '');
  out.push('**Held for you, asked when it is due:**');
  out.push(...(brief.held.length ? brief.held.map((h) => `- ${heldWords(h)}`) : ['- Nothing to buy, book, post or send.']));
  out.push('', '**What it may spend:** up to your plan window, and no money: anything that costs money is held above.', '');
  return `${out.join('\n').trim()}\n`;
}

export interface Step { does: string; changes: string[]; undo: string | null; public: boolean; cost: number }
export interface CardOptions { page: string; folder: string; fits: { id: string; name: string } | null; read: { name: string; text: string }[] }
/** The one card: the question, the plan your yes applies, and its answers. Held steps are never in the plan. */
export function cardOf(brief: Brief, o: CardOptions): { question: string; steps: Step[]; options: { id: string; label: string; decision: 'allow' | 'deny' }[] } {
  const read = o.read.length ? ['', '**What your links and files say, as their own text (it adds nothing to the brief):**', ...o.read.map((r) => `- ${r.name}: “${r.text.replace(/\s+/g, ' ').slice(0, 400)}”`)].join('\n') : '';
  const all = `${o.page}${read}\n`;
  const question = all.length <= 8192 ? all : `${all.slice(0, 8150).trimEnd()}\n… (the rest is in the brief)\n`;
  const where = brief.software ? `a private code project, ${o.folder}` : `a folder of its own, ${o.folder}`;
  const steps: Step[] = [
    { does: `Make ${where}${o.fits ? `, or use ${o.fits.name} if you pick it instead` : ''}, and save the brief in it`, changes: [o.folder, ...(o.fits ? [o.fits.name] : [])], undo: brief.software ? null : 'Remove it', public: false, cost: 0 },
    ...brief.tasks.map((t) => ({ does: `Add the task "${t.title}"`, changes: ['the project you pick'], undo: 'Remove the task', public: false, cost: 0 })),
    { does: `Start the agent on ${brief.tasks.length} task${brief.tasks.length === 1 ? '' : 's'}, one at a time, each finishing only when its checks pass`, changes: ['copies of the project', 'plan usage, up to the whole window'], undo: null, public: false, cost: 0 },
  ];
  const options: { id: string; label: string; decision: 'allow' | 'deny' }[] = [{ id: 'allow', label: 'Make it and start', decision: 'allow' }];
  if (o.fits) options.push({ id: 'there', label: `Add it to ${o.fits.name} instead`, decision: 'allow' });
  options.push({ id: 'deny', label: "Don't", decision: 'deny' });
  return { question, steps, options };
}
