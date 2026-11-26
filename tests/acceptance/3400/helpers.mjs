// Helpers for #3400's acceptance tests: the design read from this checkout and from the base commit, where each of its
// anchors lands (the rules are copied from scripts/doc-links.mjs, never imported), a section's lines, and the judges
// the tests share. Each judge takes text and returns what is wrong, one line a finding, so a planted text, issue body
// or record can be held against it outside the checkout. README.md says what each one reads and why.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const DESIGN = 'docs/technical-design.md';
/** The base commit these tests were drafted on: the head of #3365's branch, which holds #3242's text. */
export const BASE = 'd0030e12ba9b71ab37aafba73c5633989d36530f';
export const REPO = 'windoliver/deepbuild';
/** The criterion a taste call names, and where its record is kept. */
const TASTE_CALL = '#3400.28fd1eed';
export const RECORD = 'docs/evidence/3400/taste-call.json';

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
    if (r.status !== 0) throw new Error(`git show ${BASE}:${path} failed (the checkout needs the base commit, the head of #3365's branch): ${why(r)}`);
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
function outline(text) {
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

/** One hub for a project and The learned layer, each by the anchor the issue links it with. */
export const HUB = 'project-hub';
export const NO_HUB = `${DESIGN} has no heading or <a id> #${HUB}, the anchor the issue links One hub for a project by`;
const LEARNED = 'the-learned-layer';

// The words of the issue's Scope lines (README.md, The words), whole and without case.
const AUDIT = /\baudit/i;
const FREEZE = /\bfreez|\bfrozen?\b/i;
const COUNT = /\bcount(?:s|ed|ing)?\b|\b[35]0\b/i;
/** The three decisions of the issue's Scope, each by the words any answer to it has to use. */
const DECISIONS = [
  { name: 'what a miss freezes', words: [FREEZE, /\baudit|\bmiss(?:es)?\b/i], say: '`freez…` or `frozen`, and `audit…` or `miss`' },
  { name: 'whose count', words: [AUDIT, COUNT], say: '`audit…`, and `count…`, `30` or `50`' },
  { name: 'when an unshared claim reaches the project', words: [/\bclaims?\b/i, /\bunshared\b|\bnobody shared\b/i], say: '`claim`, and `unshared` or `nobody shared`' },
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
function decidedRows(text) {
  const doc = outline(text);
  const decided = doc.lands.get('decided');
  if (!decided) throw new Error(`${DESIGN} has no heading or <a id> #decided, the anchor the issue links the Decided tables by`);
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
function gainedRows(text, base) {
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

/** The two things criterion 2 has The learned layer's audit lines say on a project's hub, each by its words. */
const SAID = [
  { name: 'what a miss freezes', words: FREEZE, say: '`freez…` or `frozen`' },
  { name: 'whose count starts an audit', words: COUNT, say: '`count…`, `30` or `50`' },
];
/** A line names a project's hub when it holds the whole words `project` and `hub`, plural or possessive too. */
const namesProjectHub = (text) => /\bprojects?\b/i.test(text) && /\bhubs?\b/i.test(text);
/** A line's sentences (README.md, A new sentence): what lies between one `.`, `?` or `!` before white space and the next. */
const sentences = (text) => text.split(/(?<=[.?!])\s+/).map(same).filter(Boolean);
/**
 * The learned layer's audit lines, the lines of its section that hold `audit…`: each with whether it names a
 * project's hub, and its new sentences, those no line of the section held at the base. Null without the section.
 */
function auditLines(text, base) {
  const section = sectionAt(text, LEARNED);
  if (!section) return null;
  const had = new Set((sectionAt(base, LEARNED)?.lines ?? []).flatMap((line) => sentences(line.text)));
  return section.lines.filter((line) => AUDIT.test(line.text))
    .map((line) => ({ ...line, hub: namesProjectHub(line.text), fresh: sentences(line.text).filter((sentence) => !had.has(sentence)) }));
}
const says = (line, { words }) => line.hub && line.fresh.some((sentence) => words.test(sentence));

/**
 * Criterion 2, the audit lines: which of the two things no audit line of The learned layer says on a project's hub.
 * A line says one when it names a project's hub and holds the words in a new sentence.
 */
export function auditProblems(text, base) {
  const lines = auditLines(text, base);
  if (!lines) return [`${DESIGN} has no heading or <a id> #${LEARNED}, the anchor the issue links The learned layer by`];
  if (!lines.length) return [`The learned layer has no audit lines: no line of the section #${LEARNED} holds \`audit…\``];
  const hub = lines.filter((line) => line.hub);
  if (!hub.length) return [`The learned layer's audit lines are silent on a project's hub: none of the section's ${lines.length} lines that hold \`audit…\` holds both \`project\` and \`hub\``];
  return SAID.filter((thing) => !hub.some((line) => says(line, thing)))
    .map(({ name, say }) => `${name}: silent on a project's hub. None of the section's ${hub.length} audit lines that name a project's hub (${hub.map(opening).join(', ')}) holds ${say} in a sentence the section didn't hold at ${BASE.slice(0, 9)}`);
}

/**
 * The text a taste call is on (README.md, The taste call): the lines the judges above read, in the order the design
 * holds them, as it holds them, joined with `\n`; and that text's SHA-256.
 */
export function theText(text = readDesign(), base = baseDesign()) {
  const found = [
    ...(sectionAt(text, HUB)?.lines ?? []).filter((line) => DECISIONS.some((decision) => holds(line.text, decision))),
    ...(auditLines(text, base) ?? []).filter((line) => SAID.some((thing) => says(line, thing))),
    ...gainedRows(text, base).filter((row) => DECISIONS.some((decision) => holds(row.text, decision))),
  ];
  const lines = [...new Map(found.map((line) => [line.index, line])).values()].sort((a, b) => a.index - b.index).map((line) => line.raw);
  return { lines, sha256: createHash('sha256').update(lines.join('\n')).digest('hex') };
}

/** The design anchors a text links: each `technical-design.md#<anchor>`, decoded, without closing punctuation. */
const linkedAnchors = (body) => [...body.matchAll(/technical-design\.md#([^\s)"'>\]]+)/g)].map(([, anchor]) => {
  const id = anchor.replace(/[.,:;!?*_~]+$/, '');
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
});
const hashed = (anchors) => [...new Set(anchors)].map((anchor) => `#${anchor}`).join(', ');
/**
 * Criterion 3: the issues, as [number, body] pairs, with no link into the new text (README.md, A link into the new
 * text). Such a link lands in the section, and it either uses an anchor the design didn't have at the base or sits
 * on a line of the body that holds a decision's words.
 */
export function linkProblems(bodies, section, base) {
  const had = outline(base).lands;
  return bodies.flatMap(([number, body]) => {
    const doc = outline(body);
    const links = linesIn(doc, 0, doc.lines.length).flatMap((line) => linkedAnchors(line.raw).map((anchor) => ({ anchor, line })));
    const landing = links.filter(({ anchor }) => section.anchors.includes(anchor));
    if (!landing.length) return [`#${number} links ${hashed(links.map(({ anchor }) => anchor)) || 'no design anchor'}, and none of them lands in "${section.heading}" (${hashed(section.anchors)})`];
    if (landing.some(({ anchor, line }) => !had.has(anchor) || DECISIONS.some((decision) => holds(line.text, decision)))) return [];
    return [`#${number} links nothing new: it links "${section.heading}" by ${hashed(landing.map(({ anchor }) => anchor))}, which the design had at ${BASE.slice(0, 9)}, and only on lines that hold no decision's words (${[...new Set(landing.map(({ line }) => opening(line)))].join(', ')})`];
  });
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
  if (Number.isNaN(instant(call.when))) problems.push(`"when" is ${JSON.stringify(call.when)}, not an ISO 8601 time with its zone, such as 2026-11-26T18:04:00Z`);
  if (call.call !== 'reads_right') problems.push(`"call" is ${JSON.stringify(call.call)}, not "reads_right"`);
  if (call.text?.file !== DESIGN) problems.push(`"text.file" is ${JSON.stringify(call.text?.file)}, not "${DESIGN}"`);
  if (!lines.length) problems.push(`${DESIGN} holds none of the text a call is on: no line of One hub for a project that holds a decision's words, no audit line of The learned layer that says a thing on a project's hub, and no gained Decided row`);
  else if (call.text?.sha256 !== sha256) problems.push(`"text.sha256" is ${JSON.stringify(call.text?.sha256)}, and the text as it is now is ${sha256}: the call was made on other text`);
  return problems;
}
/**
 * Criterion 4, the others: what keeps an issue's comments from telling them of the call. A comment tells them when it
 * names the criterion and says the call can be overruled, and it was made no earlier than the call it tells of.
 */
export function toldProblems(comments, call) {
  const telling = comments.filter(({ body }) => (body ?? '').includes(TASTE_CALL) && /\boverrul/i.test(body ?? ''));
  if (!telling.length) return [`none of #3400's ${comments.length} comments names ${TASTE_CALL} and says the call can be overruled (\`overrul…\`)`];
  const made = instant(call?.when);
  if (call && Number.isNaN(made)) return [`${RECORD}'s "when" is ${JSON.stringify(call.when)}, so no comment can be held against the time of the call`];
  if (call && !telling.some(({ createdAt }) => Date.parse(createdAt) >= made)) return [`the comments that name ${TASTE_CALL} (${telling.map(({ url, createdAt }) => `${url ?? 'a comment'} at ${createdAt}`).join(', ')}) were made before the call (${call.when}), so none tells the others of it`];
  return [];
}
