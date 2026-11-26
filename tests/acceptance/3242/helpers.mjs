// Helpers for #3242's acceptance tests: the design read from this checkout and from the base commit, where each of its
// anchors lands (the rules are copied from scripts/doc-links.mjs, never imported), a section's lines, and the judges
// the tests share. Each judge takes text and returns what is wrong, one line a finding, so a planted text, issue body
// or record can be held against it outside the checkout. README.md says what each one reads and why.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const DESIGN = 'docs/technical-design.md';
/** The base commit these tests were drafted on (origin/main on November 24, no implementation). */
export const BASE = '7cb1e5c4a62cd797b00839bb2c27d730937303f6';
export const REPO = 'windoliver/deepbuild';
/** The criterion a taste call names, and where its record is kept. */
export const TASTE_CALL = '#3242.28fd1eed';
export const RECORD = 'docs/evidence/3242/taste-call.json';

// git gets ten minutes and a gh call three, or the time its caller gives: the machines these run on are shared.
const why = (r) => `${r.error?.message ?? ''}${r.stderr ?? ''}`.trim() || `exit ${r.status}`;
export const git = (args) => spawnSync('git', args, { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 600_000 });
/** What gh printed, or why it printed nothing (signed out, offline, timed out, or the issue can't be read). */
export function gh(args, wait = 180_000) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 28, timeout: wait });
  return r.status === 0 ? { out: r.stdout } : { why: why(r) };
}

/** Findings as the lines of a failure message. */
export const listed = (problems) => `\n- ${problems.join('\n- ')}`;

export const readDesign = () => readFileSync(join(CHECKOUT, DESIGN), 'utf8');
const shown = new Map();
/** A file as the base commit holds it; throws when the checkout doesn't hold that commit. */
export function baseFile(path) {
  if (!shown.has(path)) {
    const r = git(['show', `${BASE}:${path}`]);
    if (r.status !== 0) throw new Error(`git show ${BASE.slice(0, 9)}:${path} failed (the checkout needs the base commit): ${why(r)}`);
    shown.set(path, r.stdout);
  }
  return shown.get(path);
}
export const baseDesign = () => baseFile(DESIGN);

// GitHub's slug and a heading's rendered text, as scripts/doc-links.mjs computes them.
const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');
const withoutAnchors = (line) => line.replace(/<a\s[^>]*>(?:\s*<\/a>)?/gi, '').trim();

/**
 * A doc's outline, as the design links lane reads it: its lines, which of them are fenced code, its headings (line
 * index, level, text, slug; a repeated slug gets -1, -2, …), and the heading each anchor lands on. A heading's slug
 * lands on it; an `<a id>` lands on the heading that follows it, or on the heading it sits under when text comes
 * between them.
 */
export function outline(text) {
  const lines = text.split(/\r?\n/), headings = [], lands = new Map(), slugs = new Set(), fenced = new Set();
  let fence, under, waiting = [];
  const settle = (ids, heading) => { for (const id of ids) if (heading && !lands.has(id)) lands.set(id, heading); };
  for (const [index, line] of lines.entries()) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence || mark) {
      fenced.add(index);
      if (!fence) fence = mark[1];
      else if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
      continue;
    }
    const ids = [...line.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    const h = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (h) {
      const words = headingText(h[2]);
      let id = slug(words);
      for (let n = 1; slugs.has(id); n++) id = `${slug(words)}-${n}`;
      slugs.add(id);
      under = { index, level: h[1].length, text: words, slug: id };
      headings.push(under);
      settle([id, ...waiting, ...ids], under);
      waiting = [];
    } else if (!withoutAnchors(line)) waiting.push(...ids);
    else if (under) {
      settle([...waiting, ...ids], under);
      waiting = [];
    } else waiting.push(...ids);
  }
  settle(waiting, under);
  return { lines, headings, lands, fenced };
}

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const ROW = /^\s*\|/;
/**
 * The lines of a stretch of a doc (README.md, A line): each list item without what is nested under it, each paragraph
 * and each table row, outside fenced code, with the physical lines that continue it. `raw` is the line as the file
 * holds it, `text` the same with each run of white space as one space, for reading words across a wrap.
 */
function linesIn({ lines, headings, fenced }, from, to) {
  const heads = new Set(headings.map((h) => h.index));
  const found = [];
  let open = null;
  for (let index = from; index < to; index++) {
    const line = lines[index];
    if (fenced.has(index) || heads.has(index) || !withoutAnchors(line)) {
      open = null;
      continue;
    }
    if (open && !open.row && !ITEM.test(line) && !ROW.test(line)) open.raw.push(line);
    else {
      open = { index, raw: [line], row: ROW.test(line) };
      found.push(open);
    }
  }
  return found.map(({ index, raw }) => ({ index, raw: raw.join('\n'), text: raw.join(' ').replace(/\s+/g, ' ').trim() }));
}

/**
 * The section an anchor lands on: its heading, its lines up to the next heading of its level or higher (its
 * subheadings' lines included), and every anchor that lands in it. Null when the doc has no such anchor.
 */
export function sectionAt(text, anchor) {
  const doc = outline(text);
  const h = doc.lands.get(anchor);
  if (!h) return null;
  const end = doc.headings.find((o) => o.index > h.index && o.level <= h.level)?.index ?? doc.lines.length;
  const anchors = [...doc.lands].filter(([, o]) => o.index >= h.index && o.index < end).map(([id]) => id);
  return { heading: h.text, anchors, lines: linesIn(doc, h.index + 1, end) };
}

/** One hub for a project, by the anchor the issue links it with. */
export const HUB = 'project-hub';
export const NO_HUB = `${DESIGN} has no heading or <a id> #${HUB}, the anchor the issue links One hub for a project by`;

/**
 * The four decisions of the issue's Scope, each by the words any answer to it has to use (README.md, The words). The
 * rule's third word is either of two: that a rule is offered, or the three answers it is offered from.
 */
export const DECISIONS = [
  { name: 'who is audited', words: [/\baudit/i], say: '`audit…`' },
  { name: 'whose answers make a rule', words: [/\brules?\b/i, /\banswer/i, /\boffer(?:s|ed|ing)?\b|\bthree\b/i], say: '`rule`, `answer…` and `offer…` or `three`' },
  { name: 'where a quote is checked', words: [/\bquotes?\b/i], say: '`quote`' },
  { name: 'who a habit belongs to', words: [/\bhabits?\b/i], say: '`habit`' },
];
const holds = (text, { words }) => words.every((word) => word.test(text));
const notTaken = (text) => text.match(/\bnot taken\b/gi)?.length ?? 0;
const opening = ({ text }) => `"${text.slice(0, 60)}…"`;

/**
 * Criterion 1, the section: what keeps its lines from answering each decision with what was not taken. A decision is
 * answered by a line that holds its words and says "Not taken", and no "Not taken" counts for two decisions.
 */
export function decisionProblems(lines) {
  const problems = [];
  const answers = DECISIONS.map((decision) => {
    const about = lines.filter((line) => holds(line.text, decision));
    const answering = about.filter((line) => notTaken(line.text));
    if (!about.length) problems.push(`${decision.name}: no line of the section holds ${decision.say}`);
    else if (!answering.length) problems.push(`${decision.name}: no line that holds ${decision.say} says "Not taken" (${about.map(opening).join(', ')})`);
    return answering;
  });
  if (problems.length) return problems;
  const left = new Map(lines.map((line) => [line.index, notTaken(line.text)]));
  const place = (n) => n === DECISIONS.length || answers[n].some(({ index }) => {
    if (!left.get(index)) return false;
    left.set(index, left.get(index) - 1);
    if (place(n + 1)) return true;
    left.set(index, left.get(index) + 1);
    return false;
  });
  if (!place(0)) {
    const shared = [...new Map(answers.flat().map((line) => [line.index, line])).values()];
    problems.push(`the ${DECISIONS.length} decisions are answered on lines that say "Not taken" ${shared.reduce((sum, line) => sum + notTaken(line.text), 0)} times in a way that leaves one without its own: ${shared.map(opening).join(', ')}`);
  }
  return problems;
}

const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim());
const RULE = /^\|[\s:|-]+\|?\s*$/;
const COLUMNS = ['question', 'decision', 'reopens if'];
const same = (text) => text.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim();

/**
 * The Decided tables' rows (README.md, The Decided tables): the body rows of every table headed Question, Decision,
 * Reopens if in the section that holds the heading #decided lands on, each with its question.
 */
export function decidedRows(text) {
  const doc = outline(text);
  const decided = doc.lands.get('decided');
  if (!decided) throw new Error(`${DESIGN} has no heading or <a id> #decided, the anchor the issue links the Decided table by`);
  const over = doc.headings.findLast((h) => h.index < decided.index && h.level < decided.level) ?? decided;
  const end = doc.headings.find((h) => h.index > over.index && h.level <= over.level)?.index ?? doc.lines.length;
  const rows = [];
  let table = null;
  for (let index = over.index; index < end; index++) {
    const line = doc.lines[index].trim();
    if (doc.fenced.has(index) || !line.startsWith('|')) table = null;
    else if (!table) table = { decided: RULE.test((doc.lines[index + 1] ?? '').trim()) && COLUMNS.every((name, i) => same(cells(line)[i] ?? '') === name) };
    else if (table.decided && !RULE.test(line)) rows.push({ index, question: cells(line)[0], raw: doc.lines[index], text: line.replace(/\s+/g, ' ') });
  }
  return rows;
}
/** The rows the Decided tables gained: those whose question no Decided row has at the base. */
export function gainedRows(text, base) {
  const had = new Set(decidedRows(base).map((row) => same(row.question)));
  return decidedRows(text).filter((row) => !had.has(same(row.question)));
}
/** Criterion 1, the Decided tables: the decisions no gained row holds the words of. */
export function rowProblems(text, base) {
  const gained = gainedRows(text, base);
  if (!gained.length) return [`the Decided tables gained no row: each row's question is one a Decided row had at ${BASE.slice(0, 9)}`];
  const questions = gained.map((row) => `"${row.question}"`).join(', ');
  return DECISIONS.filter((decision) => !gained.some((row) => holds(row.text, decision)))
    .map((decision) => `${decision.name}: none of the ${gained.length} rows the Decided tables gained (${questions}) holds ${decision.say}`);
}

/** The three places criterion 2 names, each by the anchor the issue links its section with and the lines it means. */
export const PLACES = [
  { name: 'The learned layer', anchor: 'the-learned-layer', lines: 'lines' },
  { name: 'the audit lines in How we know version 0 works', anchor: 'how-we-know-version-0-works', pick: /\baudit/i, lines: 'lines that hold `audit…`' },
  { name: 'the taste-rule line in Later, as extensions', anchor: 'later-as-extensions', pick: /\btaste[- ]rules?\b/i, lines: 'lines that hold `taste rule`' },
];
/** A line names a project's hub when it holds the whole words `project` and `hub`, plural or possessive too. */
export const namesProjectHub = (text) => /\bprojects?\b/i.test(text) && /\bhubs?\b/i.test(text);
const placeLines = (text, { anchor, pick }) => sectionAt(text, anchor)?.lines.filter((line) => !pick || pick.test(line.text));

/** Criterion 2, the three places: those with no line that names a project's hub. */
export function placeProblems(text) {
  return PLACES.flatMap((place) => {
    const lines = placeLines(text, place);
    if (!lines) return [`${place.name}: ${DESIGN} has no heading or <a id> #${place.anchor}`];
    if (!lines.length) return [`${place.name}: the section #${place.anchor} has no ${place.lines}`];
    return lines.some((line) => namesProjectHub(line.text)) ? [] : [`${place.name}: silent on a project's hub. None of the section's ${lines.length} ${place.lines} holds both \`project\` and \`hub\``];
  });
}

/**
 * The text a taste call is on (README.md, The taste call): the lines the judges above read, in the order the design
 * holds them, as it holds them, joined with `\n`; and that text's SHA-256.
 */
export function theText(text = readDesign(), base = baseDesign()) {
  const found = [
    ...(sectionAt(text, HUB)?.lines ?? []).filter((line) => DECISIONS.some((decision) => holds(line.text, decision))),
    ...PLACES.flatMap((place) => (placeLines(text, place) ?? []).filter((line) => namesProjectHub(line.text))),
    ...gainedRows(text, base).filter((row) => DECISIONS.some((decision) => holds(row.text, decision))),
  ];
  const lines = [...new Map(found.map((line) => [line.index, line])).values()].sort((a, b) => a.index - b.index).map((line) => line.raw);
  return { lines, sha256: createHash('sha256').update(lines.join('\n')).digest('hex') };
}

/** The design anchors an issue body links: each `technical-design.md#<anchor>`, decoded, without closing punctuation. */
export const linkedAnchors = (body) => [...body.matchAll(/technical-design\.md#([^\s)"'>\]]+)/g)].map(([, anchor]) => {
  const id = anchor.replace(/[.,:;!?*_~]+$/, '');
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
});
/** Criterion 3: the issues, as [number, body] pairs, with no link that lands in the section. */
export function linkProblems(bodies, section) {
  return bodies.filter(([, body]) => !linkedAnchors(body).some((anchor) => section.anchors.includes(anchor)))
    .map(([number, body]) => `#${number} links ${[...new Set(linkedAnchors(body))].map((anchor) => `#${anchor}`).join(', ') || 'no design anchor'}, and none of them lands in "${section.heading}" (${section.anchors.map((anchor) => `#${anchor}`).join(', ')})`);
}

/** The recorded taste call, or why there is none to read. */
export function readRecord() {
  const path = join(CHECKOUT, RECORD);
  if (!existsSync(path)) return { why: `no taste call is recorded: ${RECORD} doesn't exist` };
  try {
    const call = JSON.parse(readFileSync(path, 'utf8'));
    return call && typeof call === 'object' && !Array.isArray(call) ? { call } : { why: `${RECORD} isn't a JSON object` };
  } catch (error) {
    return { why: `${RECORD} isn't JSON: ${error.message}` };
  }
}
/** A time with its zone, so it can be held against a comment's: milliseconds, or NaN. */
const instant = (when) => (typeof when === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(when.trim()) ? Date.parse(when) : NaN);
/** Criterion 4, the call: what keeps a record from being one person's call that the text, as it is now, reads right. */
export function callProblems(call, { lines, sha256 }) {
  const problems = [];
  if (call.criterion !== TASTE_CALL) problems.push(`"criterion" is ${JSON.stringify(call.criterion)}, not "${TASTE_CALL}"`);
  if (typeof call.who !== 'string' || !call.who.trim()) problems.push('"who" names no person');
  if (Number.isNaN(instant(call.when))) problems.push(`"when" is ${JSON.stringify(call.when)}, not an ISO 8601 time with its zone, such as 2026-11-25T18:04:00Z`);
  if (call.call !== 'reads_right') problems.push(`"call" is ${JSON.stringify(call.call)}, not "reads_right"`);
  if (call.text?.file !== DESIGN) problems.push(`"text.file" is ${JSON.stringify(call.text?.file)}, not "${DESIGN}"`);
  if (!lines.length) problems.push(`${DESIGN} holds none of the text a call is on: no line that answers a decision or names a project's hub in the three places, and no gained Decided row`);
  else if (call.text?.sha256 !== sha256) problems.push(`"text.sha256" is ${JSON.stringify(call.text?.sha256)}, and the text as it is now is ${sha256}: the call was made on other text`);
  return problems;
}
/**
 * Criterion 4, the others: what keeps an issue's comments from telling them of the call. A comment tells them when it
 * names the criterion and says the call can be overruled, and it was made no earlier than the call it tells of.
 */
export function toldProblems(comments, call) {
  const telling = comments.filter(({ body }) => (body ?? '').includes(TASTE_CALL) && /\boverrul/i.test(body ?? ''));
  if (!telling.length) return [`none of #3242's ${comments.length} comments names ${TASTE_CALL} and says the call can be overruled (\`overrul…\`)`];
  const made = instant(call?.when);
  if (call && Number.isNaN(made)) return [`${RECORD}'s "when" is ${JSON.stringify(call.when)}, so no comment can be held against the time of the call`];
  if (call && !telling.some(({ createdAt }) => Date.parse(createdAt) >= made)) return [`the comments that name ${TASTE_CALL} (${telling.map(({ url, createdAt }) => `${url ?? 'a comment'} at ${createdAt}`).join(', ')}) were made before the call (${call.when}), so none tells the others of it`];
  return [];
}
