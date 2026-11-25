// The judges of the #1583 tests (README, The judges): each decides one thing from text alone, a card's lines, a
// provider's item or the CLI's stdout, and starts nothing. The same `drawn` judges the shipped card and the planted
// one. Node's built-ins only, so a plain `node` run can try each judge on planted inputs.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HIDDEN, type Hidden } from './texts.ts';

/** `text` as it is drawn: each of the three characters written as the escape the base's `visible` writes for it. */
export const asDrawn = (text: string): string => HIDDEN.reduce((t, h) => t.replaceAll(h.char, h.escape), text);
/** `text` with the three characters taken out. */
export const taken = (text: string): string => HIDDEN.reduce((t, h) => t.replaceAll(h.char, ''), text);
/** `text` for a failure message: quoted, with each of the three characters it holds raw written as its code point. */
export const show = (text: string): string => `“${HIDDEN.reduce((t, h) => t.replaceAll(h.char, `⟦${h.code}⟧`), text)}”`;

/** What is wrong with how one character is drawn: `raw` as held, `removed` with nothing in its place, or `missing`. */
export interface Finding { code: string; how: 'raw' | 'removed' | 'missing'; message: string }

/**
 * Criterion 1's check. `held` is a field as the record holds it, `shown` every string of the place it is drawn in (a
 * card's lines, a summary, a label, the lines of stdout). Each of the three characters `held` holds must be drawn as
 * its escape where it stands, with the text around it unchanged, and nowhere raw. One finding per character that
 * isn't, starting with its code point and its name.
 */
export function drawn(where: string, held: string, shown: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const h of HIDDEN) {
    if (!held.includes(h.char)) continue;
    const raw = shown.find((line) => line.includes(h.char));
    if (raw !== undefined) {
      findings.push({ code: h.code, how: 'raw', message: `${h.code} ${h.name} is drawn raw in ${where}: ${show(raw)}` });
      continue;
    }
    // Where it stands: each run of `held` between blanks that holds it, with its escape in its place.
    for (const run of held.split(/\s+/).filter((part) => part.includes(h.char))) {
      const want = asDrawn(run);
      if (shown.some((line) => line.includes(want))) continue;
      const gone = shown.find((line) => line.includes(taken(run)));
      findings.push(gone !== undefined
        ? { code: h.code, how: 'removed', message: `${h.code} ${h.name} is gone from ${where}, with nothing where it was held: ${show(gone)} (its escape is ${h.escape})` }
        : { code: h.code, how: 'missing', message: `${h.code} ${h.name} isn't drawn as its escape ${h.escape} in ${where}: nothing there holds “${want}”; it holds ${shown.length ? shown.map(show).join(' | ') : 'nothing'}` });
      break;
    }
  }
  return findings;
}

/**
 * Criterion 2's first check. `withOne` is a card's lines whose text holds `hidden` at one place, `plain` the lines of
 * the same card without it. `extra` is each line the first draws and the second doesn't, the escape aside: what the
 * card says of the character. `lost` is each line of the plain card the other doesn't draw.
 */
export function added(withOne: readonly string[], plain: readonly string[], hidden: Hidden): { extra: string[]; lost: string[] } {
  const lost = [...plain];
  const extra: string[] = [];
  for (const line of withOne) {
    const at = lost.indexOf(line.replaceAll(hidden.escape, ''));
    if (at >= 0) lost.splice(at, 1);
    else extra.push(line);
  }
  return { extra, lost };
}

/** The safety list (README, The safety list): one table of strings in the repo, each with the issue that requires it. */
export const SAFETY_LIST = 'crates/deep-app/safety.json';
export interface SafetyRow { string: string; issue: string }
/** The safety list's rows as the checkout at `repo` holds them, or what is wrong with the file. */
export function safetyRows(repo: string): { rows: SafetyRow[]; problem?: string } {
  const file = join(repo, SAFETY_LIST);
  if (!existsSync(file)) return { rows: [], problem: `${SAFETY_LIST} is missing: this checkout has no safety list` };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { rows: [], problem: `${SAFETY_LIST} isn't JSON: ${(error as Error).message.split('\n')[0]}` };
  }
  const row = (r: unknown): r is SafetyRow => typeof r === 'object' && r !== null
    && typeof (r as SafetyRow).string === 'string' && typeof (r as SafetyRow).issue === 'string' && /^#[1-9][0-9]*$/.test((r as SafetyRow).issue);
  if (!Array.isArray(json) || !json.every(row)) return { rows: [], problem: `${SAFETY_LIST} isn't an array of rows, each {"string": "<the words>", "issue": "#<number>"}` };
  return { rows: json };
}
/**
 * Whether a drawn line is a safety row's string: the same words, each placeholder of the app's copy table (`{0}`,
 * `{1}`) standing for any text. A string of placeholders alone, which every line would be, is no row's words.
 */
export function isRow(row: SafetyRow, line: string): boolean {
  const parts = row.string.split(/\{\d+\}/);
  if (parts.join('').trim().length < 3) return false;
  return new RegExp(`^${parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')}$`, 'u').test(line);
}

/**
 * Criterion 4's check on a card. `lines` is a card whose fields hold plain text, `ascii` the lines of the same card
 * in ASCII, `pairs` each field's text with its ASCII counterpart. The card must draw each field's text as it is, and
 * otherwise exactly the ASCII card's lines: no line more, so no warning, and none less.
 */
export function unchanged(where: string, lines: readonly string[], ascii: readonly string[], pairs: readonly (readonly [string, string])[]): string[] {
  const problems: string[] = [];
  for (const [text] of pairs) {
    if (!lines.some((line) => line.includes(text))) problems.push(`${where} draws no line holding ${show(text)} as it is: ${lines.map(show).join(' | ')}`);
  }
  const mapped = lines.map((line) => pairs.reduce((t, [text, plain]) => t.replaceAll(text, plain), line));
  const more = [...mapped];
  const less: string[] = [];
  for (const line of ascii) {
    const at = more.indexOf(line);
    if (at >= 0) more.splice(at, 1);
    else less.push(line);
  }
  if (more.length) problems.push(`${where} draws ${more.length} line(s) the same card in ASCII doesn't: ${more.map(show).join(' | ')}`);
  if (less.length) problems.push(`${where} lacks ${less.length} line(s) the same card in ASCII draws: ${less.map(show).join(' | ')}`);
  return problems;
}

/** A provider's item, as far as these judges read it. */
export interface Card { summary: string; options: { id: string; label: string }[] }
/** Criterion 4's check on a channel's card: its summary is the question and each option's label the label, as raised. */
export function sameCard(where: string, card: Card, raised: { question: string; options: readonly { id: string; label: string }[] }): string[] {
  const problems: string[] = [];
  if (card.summary !== raised.question) problems.push(`${where}'s summary is ${show(card.summary)}, not the question as raised, ${show(raised.question)}`);
  const labels = card.options.map((o) => `${o.id}: ${o.label}`);
  const wanted = raised.options.map((o) => `${o.id}: ${o.label}`);
  if (JSON.stringify(labels) !== JSON.stringify(wanted)) problems.push(`${where}'s options are ${labels.map(show).join(', ') || 'none'}, not the options as raised, ${wanted.map(show).join(', ')}`);
  return problems;
}

/** Criterion 3's check: what the record holds of an ask is, byte for byte, what was raised. */
export function sameBytes(where: string, stored: unknown, raised: string): string[] {
  if (typeof stored !== 'string') return [`${where} holds ${JSON.stringify(stored)}, not text`];
  if (Buffer.from(stored, 'utf8').equals(Buffer.from(raised, 'utf8'))) return [];
  return [`${where} holds ${show(stored)} (${Buffer.byteLength(stored, 'utf8')} bytes), not the ${Buffer.byteLength(raised, 'utf8')} bytes raised, ${show(raised)}`];
}
