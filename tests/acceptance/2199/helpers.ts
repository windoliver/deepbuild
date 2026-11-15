// Test-side tools for the #2199 acceptance tests (README). The world is #1463's: a real hub (`deep hub run`) in a
// temporary home, each session's hooks played through its socket, the asks raised through the real asks core with the
// hub stopped, then a real hub on that record with the OS confirmation stubbed `confirmed` (#24's
// DEEP_HUB_TEST_CONFIRM). Every observation is the built CLI's `deep inbox` output, or the hub's record read through
// `events.read`; no hub or CLI module is imported.
//
// The issue fixes that an ask's option IDs are printed with it and leaves how open. So the judges below take any
// output that prints each ID as a token of its own on the ask's line or on a line under it, and each says in its own
// comment what it takes (README: Pinned here).
import { DAY, type FixtureAsk, type SessionSpec, type AskSpec } from '../1463/helpers.ts';

export { allEventsOf, cleanup, deep, inboxFailures, jsonRows, makeWorld, shown, type FixtureAsk, type World } from '../1463/helpers.ts';

/** The criteria, by `#2199.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  shown: '#2199.bff55edb',
  answers: '#2199.3ebf26b3',
  label: '#2199.e1f74e0f',
  order: '#2199.4b672bc1',
} as const;

/** The planted wrong program of criterion 3 (README: The plant). */
export const PLANT = 'inbox-labels-only';

// ---- The fixture: two sessions in two repos, one open ask each.

/** The issue's own ask: a taste ask with the options thin and thick. Its question holds both words, which never count as the IDs. */
export const BORDER: AskSpec = { kind: 'taste', question: 'Which border for the card, thin or thick?', options: [['thin', 'Thin'], ['thick', 'Thick']], default: 'thin', deadline: (at) => at + 2 * DAY };
/** An option whose label is "Plain files" and whose ID is files; it is the default, so its label is on the line at the base. */
export const STORE: AskSpec = { kind: 'choice', question: 'Where does the cart keep its data?', options: [['sqlite', 'SQLite'], ['files', 'Plain files']], default: 'files', deadline: (at) => at + DAY };
export const FIXTURE: SessionSpec[] = [
  { key: 'card', repo: 'work', title: 'Card border', calls: 1, stop: true, asks: [BORDER] },
  { key: 'cart', repo: 'shop', title: 'Cart storage', calls: 1, stop: true, asks: [STORE] },
];
const SPECS = [BORDER, STORE];
export const specOf = (a: { question: string }): AskSpec => SPECS.find((s) => s.question === a.question)!;
export const askOf = (w: { asks: FixtureAsk[] }, spec: AskSpec): FixtureAsk => w.asks.find((a) => a.question === spec.question)!;

// ---- Judges (judges.test.ts holds each to a right input and the wrong ones). Each returns what's wrong, or nothing.

/** An ask as a judge reads it: its handle, its question and its options, each `[id, label]`, with its default's ID. */
export interface Shown { handle: string; question: string; options: readonly (readonly [string, string])[]; default: string }
export const asShown = (a: FixtureAsk): Shown => ({ handle: a.handle, question: a.question, options: specOf(a).options, default: specOf(a).default });

const said = (v: unknown): string => JSON.stringify(v)?.slice(0, 600) ?? String(v);
const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `token` standing as a word of its own: nothing a name is written with (a letter, a digit, `_` or `-`) on either side. Case counts. */
const asWord = (token: string): RegExp => new RegExp(`(?<![A-Za-z0-9_-])${esc(token)}(?![A-Za-z0-9_-])`);
/** The count sentence `deep inbox` ends on. */
const COUNT = /^\s*(?:\d+ asks? needs? you|Nothing needs you)\s*$/;

/**
 * What `deep inbox` prints with one ask: the line that holds its question and every line under it, up to the next
 * line that holds another listed ask's question, a `decided for you` line or the count sentence. Undefined when no
 * line holds the question.
 */
export function blockOf(text: string, ask: Shown, all: readonly Shown[]): string | undefined {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes(ask.question));
  if (start < 0) return undefined;
  const others = all.filter((a) => a.handle !== ask.handle);
  let end = start + 1;
  while (end < lines.length && !COUNT.test(lines[end]!) && !lines[end]!.startsWith('decided for you') && !others.some((o) => lines[end]!.includes(o.question))) end++;
  return lines.slice(start, end).join('\n');
}
/**
 * The ask's block with what can't count as an option ID taken out: its question (the issue's own holds "thin or
 * thick"), and every label that differs from its ID, as written ("Plain files" holds "files").
 */
function idText(block: string, ask: Shown): string {
  let text = block.split(ask.question).join(' ');
  for (const [id, label] of ask.options) if (label !== id) text = text.split(label).join(' ');
  return text;
}
/** The option IDs `deep inbox` prints with the ask, each as a word of its own; the question and the labels don't count. */
export function idsShown(text: string, ask: Shown, all: readonly Shown[]): string[] {
  const block = blockOf(text, ask, all);
  if (block === undefined) return [];
  const rest = idText(block, ask);
  return ask.options.map(([id]) => id).filter((id) => asWord(id).test(rest));
}
/**
 * `deep inbox` shows each of the ask's options by its ID, with the ask. A missing ID whose label is printed where an
 * option goes (anywhere in the block but the question and the default sentence) is said to be shown by its label.
 * `only` keeps the judgement to those IDs.
 */
export function optionFailures(text: string, ask: Shown, all: readonly Shown[], only?: readonly string[]): string[] {
  const block = blockOf(text, ask, all);
  if (block === undefined) return [`deep inbox lacks the question of ${ask.handle} ("${ask.question}")`];
  const have = idsShown(text, ask, all);
  const defaultLabel = ask.options.find(([id]) => id === ask.default)?.[1];
  const options = block.split(ask.question).join(' ').split(`If you don't answer: ${defaultLabel}`).join(' ');
  const out: string[] = [];
  for (const [id, label] of ask.options) {
    if (have.includes(id) || (only && !only.includes(id))) continue;
    if (label !== id && options.includes(label)) out.push(`deep inbox shows ${ask.handle}'s option ${id} by its label "${label}" and not by its ID: \`deep inbox answer ${ask.handle}\` takes ${id}, which isn't with the ask: ${said(block)}`);
    else out.push(`deep inbox's ask ${ask.handle} ("${ask.question}") lacks its option ID ${id}: ${said(block)}`);
  }
  return out;
}
/** The default sentence, as #1463 has it, between each ask's question and its handle: "If you don't answer: <the default's label>, <when>". */
export function sentenceFailures(text: string, asks: readonly Shown[]): string[] {
  const out: string[] = [];
  for (const a of asks) {
    const q = text.indexOf(a.question);
    const h = text.indexOf(a.handle);
    if (q < 0 || h < q) continue; // inboxFailures (#1463's) says so
    const sentence = `If you don't answer: ${a.options.find(([id]) => id === a.default)![1]}, `;
    if (!text.slice(q, h).includes(sentence)) out.push(`deep inbox's ask ${a.handle} ("${a.question}") lacks its default sentence "${sentence}…" between its question and its handle: ${said(text.slice(q, h + a.handle.length))}`);
  }
  return out;
}
