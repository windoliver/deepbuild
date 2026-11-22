// Test-side tools for the #2563 acceptance tests (README). The world is #1463's (`makeWorld`): a real hub
// (`deep hub run`) in a temporary home, a session's hooks played through its socket, the asks raised through the real
// asks core with the hub stopped, then a real hub on that record with the OS confirmation stubbed `confirmed` (#24's
// DEEP_HUB_TEST_CONFIRM). Before it, a probe raises the same asks through the same asks core in a home of its own
// (#26's `seed`), so a test knows which IDs an ask may carry and what a refused one was told. Every other observation
// is the built CLI's `deep inbox` output, `deep inbox answer` typed through `/bin/sh -c`, or the hub's record read
// through `events.read`; no hub or CLI module is imported.
//
// The issue leaves open how `deep inbox` prints an option ID and how `deep inbox answer` reads it. So no judge here
// knows the printed format: "as printed" is any run of characters on one line of the ask's block that a POSIX shell
// reads as that one argument (README: Pinned here).
import { DAY, type AskSpec, type SessionSpec } from '../1463/helpers.ts';
import { childEnv, CLI, NODE, run, type Ran } from '../16/helpers.ts';
import { makeHome, PROJECT, seed, sha256 } from '../26/helpers.ts';
import { blockOf, type Shown } from '../2199/helpers.ts';

export { allEventsOf, cleanup, deep, jsonRows, makeWorld, shown, type FixtureAsk, type World } from '../1463/helpers.ts';
export type { AskSpec, Ran, Shown };

/** The criteria, by `#2563.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  answers: '#2563.644f8f08',
  refused: '#2563.1937a1ef',
} as const;

// ---- The fixture: one open ask per kind of ID the issue names, each in a session of its own (more open asks in one
// session fold under the asks core's "this session keeps asking"). Each ask's other option is a plain ID and
// its default, so the default sentence never prints the hard option's label, and an ask answers once, so each hard ID
// has an ask of its own. No question holds its hard ID, and no label is its hard ID written another way.

export interface Case { kind: string; id: string; spec: AskSpec }
const ask = (question: string, hard: [string, string], plain: [string, string]): AskSpec => ({ kind: 'choice', question, options: [hard, plain], default: plain[0], deadline: (at) => at + 2 * DAY });
export const CASES: readonly Case[] = [
  { kind: 'starts with -', id: '-fast', spec: ask('Which build mode for the release?', ['-fast', 'Fast build'], ['normal', 'Normal build']) },
  { kind: 'holds a control character (ESC)', id: 'esc\u001bkey', spec: ask('Which key closes the dialog?', ['esc\u001bkey', 'Escape key'], ['enter', 'Enter']) },
  { kind: 'holds an invisible character (zero-width space)', id: 'zero​width', spec: ask('Which joiner goes between the words?', ['zero​width', 'No visible gap'], ['plain', 'Plain space']) },
  { kind: 'holds a space', id: 'title case', spec: ask('How are the headings cased?', ['title case', 'Title Case'], ['lower', 'Lower case']) },
  { kind: 'holds a comma', id: 'red, green', spec: ask('Which colours does the chart use?', ['red, green', 'Red and green'], ['blue', 'Blue only']) },
  { kind: 'is shaped like x (y)', id: 'wide (padded)', spec: ask('Which margin goes around the table?', ['wide (padded)', 'Wide with padding'], ['narrow', 'Narrow']) },
];
/** The probe's control: an ask whose IDs every reading allows. If it can't be raised, the probe proves nothing. */
export const CONTROL: AskSpec = ask('Which font for the footer?', ['serif', 'Serif'], ['sans', 'Sans serif']);
export const sessionsOf = (asks: AskSpec[]): SessionSpec[] => asks.map((a, i) => ({ key: `opts${i + 1}`, repo: 'work', title: `Option IDs ${i + 1}`, calls: 1, stop: true, asks: [a] }));
export const shownOf = (handle: string, spec: AskSpec): Shown => ({ handle, question: spec.question, options: spec.options, default: spec.default });

// ---- The probe: each ask raised through the real asks core, as #1463's world raises it, in a home of its own.

export type Raised = { carried: true } | { carried: false; refusal: string };
/** Each case's ask raised through the asks core (`deep_ask.choice`, the source an agent's deep_ask raises a choice through). */
export async function probe(): Promise<{ control: Raised; cases: Map<string, Raised> }> {
  const { home } = makeHome();
  const cases = new Map<string, Raised>();
  let control: Raised = { carried: false, refusal: 'not raised' };
  const at = Date.now();
  let n = 0;
  await seed(home, async (sd) => {
    sd.at(at);
    // Each ask in a session of its own, as in the world.
    const raise = async (a: AskSpec): Promise<Raised> => {
      const session = `probe-2563-session-${++n}`;
      await sd.start(session);
      try {
        await sd.asks.raise({ writer: 'core', actor: 'you', scope: 'you', session, project: PROJECT }, `deep_ask.${a.kind}`, {
          kind: a.kind, question: a.question, options: a.options.map(([id, label]) => ({ id, label, decision: 'none' })), recommended: a.default, deadline: a.deadline(at),
          fallback: 'you', default: a.default, provisional: false, owner: 'you', key: sha256(`#1463 ${a.question}`), pinned_to: { kind: 'evidence', ref: sha256(a.question) },
        });
        return { carried: true };
      } catch (error) {
        return { carried: false, refusal: error instanceof Error ? `${error.message}${'details' in error ? ` ${JSON.stringify((error as { details?: unknown }).details)}` : ''}` : String(error) };
      }
    };
    control = await raise(CONTROL);
    for (const c of CASES) cases.set(c.id, await raise(c.spec));
  }, at);
  return { control, cases };
}

// ---- Typing back: what a POSIX shell makes of a run of printed characters.

/** The shell's blanks: the field separators of a command line. */
const BLANK = new Set([' ', '\t']);
/** Characters a shell treats as more than themselves when unquoted: operators, expansions, globs and quotes. */
const SPECIAL = new Set(['|', '&', ';', '<', '>', '(', ')', '$', '`', '*', '?', '[', ']', '{', '}', '"', "'", '\\']);
const SIMPLE: Record<string, number> = { '"': 0x22, "'": 0x27, '\\': 0x5c, a: 0x07, b: 0x08, e: 0x1b, f: 0x0c, n: 0x0a, r: 0x0d, t: 0x09, v: 0x0b };
const utf8 = (s: string): number[] => [...new TextEncoder().encode(s)];

/**
 * The arguments a POSIX shell (POSIX.1-2024, `$'…'` included) makes of `text` typed after a command, or undefined
 * when it would do more than quote: an operator, a parameter, command or arithmetic expansion, a glob or brace, a
 * comment, a tilde, an unknown `$'…'` escape or an unclosed quote. Undefined never passes, so a form this model
 * doesn't read is a failure, never a pass. `$'\x..'` and `$'\ooo'` give bytes, read as UTF-8, as the shell passes them.
 */
export function shellWords(text: string): string[] | undefined {
  const words: string[] = [];
  let word: number[] | undefined;
  const add = (bytes: number[]): void => { (word ??= []).push(...bytes); };
  for (let i = 0; i < text.length;) {
    const c = text[i]!;
    if (BLANK.has(c)) {
      if (word) words.push(new TextDecoder().decode(new Uint8Array(word)));
      word = undefined;
      i++;
      continue;
    }
    if (word === undefined && (c === '#' || c === '~')) return undefined;
    if (c === '\\') {
      if (i + 1 >= text.length) return undefined;
      const cp = text.codePointAt(i + 1)!;
      add(utf8(String.fromCodePoint(cp)));
      i += 1 + String.fromCodePoint(cp).length;
      continue;
    }
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return undefined;
      add(utf8(text.slice(i + 1, end)));
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      const bytes: number[] = [];
      for (;;) {
        if (j >= text.length) return undefined;
        const d = text[j]!;
        if (d === '"') break;
        if (d === '$' || d === '`') return undefined;
        if (d === '\\' && j + 1 < text.length && '$`"\\'.includes(text[j + 1]!)) { bytes.push(text.charCodeAt(j + 1)); j += 2; continue; }
        const cp = text.codePointAt(j)!;
        bytes.push(...utf8(String.fromCodePoint(cp)));
        j += String.fromCodePoint(cp).length;
      }
      add(bytes);
      i = j + 1;
      continue;
    }
    if (c === '$' && text[i + 1] === "'") {
      let j = i + 2;
      const bytes: number[] = [];
      for (;;) {
        if (j >= text.length) return undefined;
        const d = text[j]!;
        if (d === "'") break;
        if (d !== '\\') { const cp = text.codePointAt(j)!; bytes.push(...utf8(String.fromCodePoint(cp))); j += String.fromCodePoint(cp).length; continue; }
        const e = text[j + 1];
        if (e === undefined) return undefined;
        if (e in SIMPLE) { bytes.push(SIMPLE[e]!); j += 2; continue; }
        if (e === 'x') {
          const hex = /^[0-9A-Fa-f]{1,2}/.exec(text.slice(j + 2))?.[0];
          if (!hex) return undefined;
          bytes.push(parseInt(hex, 16));
          j += 2 + hex.length;
          continue;
        }
        if (/[0-7]/.test(e)) {
          const oct = /^[0-7]{1,3}/.exec(text.slice(j + 1))![0];
          bytes.push(parseInt(oct, 8) & 0xff);
          j += 1 + oct.length;
          continue;
        }
        if (e === 'c') {
          const x = text[j + 2];
          if (x === undefined || x === "'" || x.charCodeAt(0) > 0x7e) return undefined;
          bytes.push(x === '?' ? 0x7f : x.toUpperCase().charCodeAt(0) ^ 0x40);
          j += 3;
          continue;
        }
        return undefined;
      }
      add(bytes);
      i = j + 1;
      continue;
    }
    if (SPECIAL.has(c)) return undefined;
    const cp = text.codePointAt(i)!;
    add(utf8(String.fromCodePoint(cp)));
    i += String.fromCodePoint(cp).length;
  }
  if (word) words.push(new TextDecoder().decode(new Uint8Array(word)));
  return words;
}

/** Typed after `deep inbox answer <handle>`, the words give the option `id`: `id` alone, or after the `--` that ends options. */
export const givesOption = (words: readonly string[] | undefined, id: string): boolean =>
  !!words && ((words.length === 1 && words[0] === id) || (words.length === 2 && words[0] === '--' && words[1] === id));

/**
 * Every printed form of the option `id` in what `deep inbox` printed with the ask (#2199's `blockOf`): each run of
 * characters on one line of the block, with no blank at either end, that a POSIX shell reads as the option `id`
 * (`givesOption`). Distinct, in the order printed. Empty when the block holds none, or there is no block.
 */
export function printedForms(text: string, ask: Shown, all: readonly Shown[], id: string): string[] {
  const block = blockOf(text, ask, all);
  if (block === undefined) return [];
  const out = new Set<string>();
  // No form is longer than `-- ` and each of the ID's bytes in a quote of its own, `$'\xHH'` (7), with room to spare.
  const longest = 8 * utf8(id).length + 6;
  for (const line of block.split('\n')) {
    for (let i = 0; i < line.length; i++) {
      if (BLANK.has(line[i]!)) continue;
      for (let j = i + 1; j <= Math.min(line.length, i + longest); j++) {
        if (BLANK.has(line[j - 1]!)) continue;
        const run = line.slice(i, j);
        if (givesOption(shellWords(run), id)) out.add(run);
      }
    }
  }
  return [...out];
}

/** `/bin/sh -c` on the argument list it reads from `typed`: each argument as the shell passes it to a command. */
export async function shArgs(typed: string): Promise<string[]> {
  const r = await run('/bin/sh', ['-c', `printf '%s\\0' ${typed}`], { timeoutMs: 10_000 });
  if (r.code !== 0) return [`<sh exit ${r.code}: ${r.stderr.trim()}>`];
  return r.stdout.split('\0').slice(0, -1);
}

/**
 * `deep inbox answer <handle> <typed>` as you type it into a POSIX shell: `typed` pasted verbatim into the command
 * line of `/bin/sh -c`, so a printed form that needs quoting must carry its quoting. The built CLI, as `deep` runs it.
 */
export function answerTyped(home: string, handle: string, typed: string): Promise<Ran> {
  if (!/^[A-Za-z0-9:_-]+$/.test(handle)) throw Error(`BLOCKED: the handle ${JSON.stringify(handle)} isn't one this test can paste into a shell unquoted`);
  return run('/bin/sh', ['-c', `exec "$0" "$1" inbox answer ${handle} ${typed}`, NODE, CLI], { env: childEnv(home), timeoutMs: 120_000 });
}

// ---- Criterion 2's judge: a refusal names the ID and says why.

/** The characters `visible()` (#1510) and any reader would write as an escape: controls and the invisible ones. */
const MARKED = /[\u{0}-\u{1f}\u{7f}-\u{9f}\u{61c}\u{200b}\u{200e}-\u{200f}\u{2028}-\u{202e}\u{2060}-\u{2064}\u{2066}-\u{206f}\u{feff}\u{fff9}-\u{fffb}\u{e0000}-\u{e007f}]/u;
const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * The ID as a refusal may write it: each character as itself, or, for a control or invisible one, as an escape a
 * reader writes it in: `\x1b`, `\e` (ESC), `\u001b`, `\u{1b}`, `U+001B` or `<U+200B>`, any case of hex, any zero
 * padding. Letters keep their case.
 */
export function idPattern(id: string): RegExp {
  let src = '';
  for (const ch of id) {
    if (!MARKED.test(ch)) { src += esc(ch); continue; }
    const n = ch.codePointAt(0)!;
    const hex = `0*${[...n.toString(16)].map((d) => (/[a-f]/.test(d) ? `[${d}${d.toUpperCase()}]` : d)).join('')}`;
    src += `(?:${esc(ch)}|\\\\x${hex}|\\\\u${hex}|\\\\u\\{${hex}\\}|<?[Uu]\\+${hex}>?${n === 0x1b ? '|\\\\e' : ''})`;
  }
  return new RegExp(src);
}
/**
 * A refusal when the ask is raised names the ID and why: it holds the ID (`idPattern`), and, with the ID taken out,
 * a reason of at least three words. Returns what's wrong, or nothing.
 */
export function refusalFailures(refusal: string, id: string): string[] {
  const named = idPattern(id).exec(refusal);
  if (!named) return [`the refusal doesn't name the option ID ${JSON.stringify(id)}: ${JSON.stringify(refusal.slice(0, 600))}`];
  const rest = refusal.replace(named[0], ' ');
  const words = rest.match(/[A-Za-z]{2,}/g) ?? [];
  if (words.length < 3) return [`the refusal names ${JSON.stringify(id)} but not why it can't be carried: ${JSON.stringify(refusal.slice(0, 600))}`];
  return [];
}
