// Helpers for #3472's acceptance tests (README.md names every surface they read). Three kinds:
//   - the design, read as the design links lane reads it: headings, anchors, link targets and where each lands are
//     copied from scripts/doc-links.mjs at the base, never imported. A section is found by an anchor the issue links
//     and runs to the next heading of its level or higher; what it gained is its sentences and table cells that the
//     same section at the base commit doesn't hold.
//   - the judges, one for each thing a criterion asks. Each takes what was read and returns what is wrong, one line
//     each, so a planted text, issue body or record can be judged with no checkout, no GitHub and no file written.
//     `read`, `sectionOf`, `pieces` and `sha` are exported for that too: a planted input is built with them.
//   - git and gh as the shell has them, with a long wait: the machine these run on may be heavily loaded.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const REPO = 'windoliver/deepbuild';
export const ISSUE = 3472;
/** The base commit these tests were drafted on (main, no work on the issue). */
export const BASE = 'fd9be7a702f7cac74bab5095a2780ebe4d487095';
export const DESIGN = 'docs/technical-design.md';
/** The anchors the issue links: States people see, Later, as extensions, and Decisions, which holds the Decided tables. */
export const STATES = 'states-people-see';
export const LATER = 'later-as-extensions';
const DECISIONS = 'decisions';
/** The record of the taste call (README.md, The taste call). */
export const RECORD = 'docs/evidence/3472/taste-call.json';

const WAIT = 600_000;
/** git in this checkout: `{ status, stdout, stderr }`. */
export const git = (args) => spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28, timeout: WAIT });
/** gh, as the shell has it. */
export const gh = (args) => spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 28, timeout: WAIT });
/** What a command said when it failed, on one line. */
export const said = (r) => `${r.error?.message ?? ''}${r.stderr ?? ''}`.trim().replace(/\s+/g, ' ').slice(0, 300) || `exit ${r.status}`;
/** Why GitHub can't be read from this shell, or null when it can. */
export function ghDown() {
  const auth = gh(['auth', 'status']);
  return auth.status === 0 ? null : `gh isn't signed in or can't reach GitHub: ${said(auth)}`;
}

/** A file of this checkout, or null when it isn't there. */
export const fileHere = (path) => (existsSync(join(CHECKOUT, path)) ? readFileSync(join(CHECKOUT, path), 'utf8') : null);
/** A file as the base commit holds it. Throws when git can't show it: nothing is told from a base that wasn't read. */
export function fileAtBase(path) {
  const shown = git(['show', `${BASE}:${path}`]);
  if (shown.status !== 0) throw new Error(`git show ${BASE}:${path} failed, so what the base held can't be read (the checkout needs the base commit): ${said(shown)}`);
  return shown.stdout;
}

// ---------------------------------------------------------------------------------------------------------------------
// The design links lane's reading of a doc, copied from scripts/doc-links.mjs.

const BLOB = `https://github.com/${REPO}/blob/main/`;
const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');
const anchorOnly = (line) => !line.replace(/<a\s[^>]*>(?:\s*<\/a>)?/gi, '').trim();

/** A text's lines, and those outside fenced code with their index. */
function prose(text) {
  const lines = text.split(/\r?\n/), outside = [];
  let fence;
  for (const [index, line] of lines.entries()) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
    } else if (mark) fence = mark[1];
    else outside.push({ index, line });
  }
  return { lines, outside };
}

/**
 * A doc's outline: its lines, its headings in order (GitHub's slug, repeats taking -1, -2, …; level; line index), and
 * each anchor with the slug of the heading it lands on: a heading's own slug, and each explicit `<a id>`, which lands
 * on the heading that follows it, or on the section it sits in when text comes between them.
 */
function outline(text) {
  const { lines, outside } = prose(text);
  const anchors = new Map(), headings = [], slugs = new Set();
  let section, waiting = [];
  const settle = (ids, heading) => { for (const id of ids) if (!anchors.has(id)) anchors.set(id, heading); };
  for (const { index, line } of outside) {
    const ids = [...line.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      const own = slug(headingText(heading[2]));
      let id = own;
      for (let n = 1; slugs.has(id); n++) id = `${own}-${n}`;
      slugs.add(id);
      headings.push({ slug: id, level: heading[1].length, index });
      section = id;
      settle([id, ...waiting, ...ids], id);
      waiting = [];
    } else if (anchorOnly(line)) waiting.push(...ids);
    else if (section) {
      settle([...waiting, ...ids], section);
      waiting = [];
    } else waiting.push(...ids);
  }
  settle(waiting, section);
  return { lines, headings, anchors };
}

/**
 * The section an anchor lands on: its text from the heading to the next heading of its level or higher, its
 * subheadings included, without the blank and `<a id>` lines that close it (those belong to the next heading); and
 * `anchors`, every anchor the lane lands on its heading or on a heading inside it. Null when the anchor lands nowhere.
 */
export function sectionOf(text, anchor) {
  const { lines, headings, anchors } = outline(text);
  const at = headings.findIndex((h) => h.slug === anchors.get(anchor));
  if (at === -1) return null;
  const { index: from, level } = headings[at];
  let to = headings.slice(at + 1).find((h) => h.level <= level)?.index ?? lines.length;
  while (to > from + 1 && anchorOnly(lines[to - 1])) to--;
  const inside = new Set(headings.filter((h) => h.index >= from && h.index < to).map((h) => h.slug));
  return { slug: headings[at].slug, text: lines.slice(from, to).join('\n'), anchors: new Set([...anchors].filter(([, heading]) => inside.has(heading)).map(([id]) => id)) };
}

/** The link targets on a line, outside code spans: markdown links' targets, and bare links into this repo. */
function targets(line) {
  const text = line.replace(/(`+).+?\1/g, '');
  const linked = [...text.matchAll(/\]\(\s*<?([^\s)>]+)/g)].map((m) => m[1]);
  const bare = text.replace(/\]\(\s*<?[^\s)>]+/g, '').split(BLOB).slice(1).map((rest) => BLOB + rest.match(/^[^\s)>\]"'`]*/)[0].replace(/[.,:;!?*_~]+$/, ''));
  return [...linked, ...bare];
}
/** The doc file and anchor a target links to, or null for a link that isn't into docs/*.md. `from` is the doc a link sits in; an issue has none. */
function resolve(target, from) {
  const [, path, anchor = ''] = target.match(/^([^#?]*)(?:\?[^#]*)?(?:#(.*))?$/);
  let file;
  if (path.startsWith(BLOB)) file = path.slice(BLOB.length);
  else if (/^[a-z][\w+.-]*:/i.test(path)) return null;
  else if (from) file = path ? posix.join(posix.dirname(from), path) : from;
  else if (/^(?:\.?\/)?(?:docs\/)?[^/]+\.md$/.test(path)) file = `docs/${path.split('/').at(-1)}`;
  else return null;
  if (!/^docs\/[^/]+\.md$/.test(file)) return null;
  let id = anchor;
  try {
    id = decodeURIComponent(anchor);
  } catch { /* an anchor that isn't valid percent-encoding is compared as written */ }
  return { file, id };
}
/** The anchors of the technical design that a text links, as the lane reads its links: outside fenced code and code spans. */
const designLinks = (text, from = null) => prose(text ?? '').outside.flatMap(({ line }) => targets(line)).map((target) => resolve(target, from))
  .filter((link) => link?.file === DESIGN && link.id).map((link) => link.id);

// ---------------------------------------------------------------------------------------------------------------------
// A text's sentences and table cells, and what a section gained.

const tidy = (text) => text.replace(/\s+/g, ' ').trim();
const isRow = (line) => line.trim().startsWith('|');
const isRule = (line) => /^\|[\s:|-]*-[\s:|-]*$/.test(line.trim());
/** A table row's cells, cut at each `|` that isn't escaped. */
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(tidy);

/**
 * A text's pieces, with case kept and white space collapsed. A line of prose is cut after each full stop followed by
 * white space, as tests/acceptance/3267/ cuts one. A table row gives its first cell, and each other cell that isn't
 * empty as `<first cell> | <cell>`, so a cell says which row it sits in. A table's rule line and a line that holds
 * only an `<a id>` give nothing.
 */
export const pieces = (text) => (text ?? '').split(/\r?\n/).flatMap((line) => {
  if (anchorOnly(line) || isRule(line)) return [];
  if (!isRow(line)) return line.split(/(?<=\.)\s+/);
  const [first, ...rest] = cellsOf(line);
  return [first, ...rest.filter(Boolean).map((cell) => `${first} | ${cell}`)];
}).map(tidy).filter(Boolean);
/** A piece as it reads rendered, for the words it holds: a link by its label and no tag, so an anchor's own name is no word of the text. */
const rendered = (text) => (text ?? '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '');
/** The pieces `now` holds that `before` doesn't, each once, in `now`'s order. */
function gained(now, before) {
  const old = new Set(pieces(before));
  return [...new Set(pieces(now))].filter((piece) => !old.has(piece));
}
/** The SHA-256 a taste call names a piece by. */
export const sha = (piece) => createHash('sha256').update(piece).digest('hex');

/** Every table of a text: its header's cells and its body rows, each with its cells and its line. */
function tables(text) {
  const lines = (text ?? '').split(/\r?\n/), found = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i]) || isRule(lines[i]) || !isRule(lines[i + 1] ?? '')) continue;
    const table = { header: cellsOf(lines[i]), rows: [] };
    for (i += 2; i < lines.length && isRow(lines[i]); i++) table.rows.push({ cells: cellsOf(lines[i]), line: tidy(lines[i]) });
    found.push(table);
    i--;
  }
  return found;
}

/**
 * What the tests read of the design: `now` is docs/technical-design.md here and `before` the same file at the base.
 * States people see's anchors, the pieces it gained, the anchors in it that the base's doc doesn't have, and the
 * words of its table; Later, as extensions; and the Decided tables' rows, now and at the base.
 */
export function read(now = fileHere(DESIGN), before = fileAtBase(DESIGN)) {
  if (now === null) throw new Error(`${DESIGN} isn't in this checkout`);
  const section = (text, anchor, where) => {
    const found = sectionOf(text, anchor);
    if (!found) throw new Error(`${DESIGN} ${where} has no heading or <a id> #${anchor}, which the issue links`);
    return found;
  };
  const states = section(now, STATES, 'here'), was = section(before, STATES, `at ${BASE}`);
  const old = outline(before).anchors;
  return {
    now,
    states,
    gained: gained(states.text, was.text),
    fresh: new Set([...states.anchors].filter((id) => !old.has(id))),
    words: stateWords(states.text),
    later: section(now, LATER, 'here'),
    rows: { now: decidedRows(section(now, DECISIONS, 'here').text), before: decidedRows(section(before, DECISIONS, `at ${BASE}`).text) },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 1: States people see answers each decision, with what was not taken, and the Decided tables gain their rows.

/** The Scope's five decisions, each with the words any answer to it has to use (README.md, The decisions' words). */
const ANSWERS = [
  ['what a state reads as on a plain surface', [/\bplain\b/i, /\bsurfaces?\b/i, /\bstates?\b/i, /\bwords?\b/i]],
  ['the sentences', [/\bsentences?\b/i]],
  ["which surfaces are plain: whether the list's rows are, and whether `deep` with no arguments stays one", [/\bplain\b/i, /\bsurfaces?\b/i, /\blists?\b/i, /`deep`|\bdeep with no arguments\b/]],
  ["the words for the levels: the milestone, whether attempt, check, run and goal get plain words, and what the Index's chapter, entry and thread are called",
    [/\bmilestones?\b/i, /\battempts?\b/i, /\bchecks?\b/i, /\bruns?\b/i, /\bgoals?\b/i, /\bchapters?\b/i, /\bentr(?:y|ies)\b/i, /\bthreads?\b/i]],
  ["who holds a row's sentence to the list: whether the hub's sentences are judged where they are written, or only where they are drawn", [/\bhub\b/i, /\bsentences?\b/i, /\bwritten\b|\bdrawn\b/i]],
];

/**
 * What is wrong with the decisions as `text` answers them, one line each; none when nothing is. `text` is the list of
 * pieces to read: what States people see gained since the base, or the part of that a taste call names. `since` says
 * which, for the lines.
 */
export function judgeAnswers(text, since = `it didn't hold at ${BASE.slice(0, 8)}`) {
  if (!text.length) return [`States people see (${DESIGN}#${STATES}) holds no sentence or table cell ${since}, so it answers no decision`];
  const all = text.map(rendered).join('\n'), problems = [];
  for (const [decision, words] of ANSWERS) {
    const missing = words.filter((word) => !word.test(all));
    if (missing.length) problems.push(`not answered: ${decision}. What States people see holds ${since} lacks ${missing.join(', ')}`);
  }
  const notTaken = all.match(/\bnot taken\b/gi)?.length ?? 0;
  if (notTaken < ANSWERS.length) problems.push(`what States people see holds ${since} says "Not taken" ${notTaken} times; each of the ${ANSWERS.length} decisions needs what was not taken`);
  return problems;
}

/** The Decided tables' body rows in a Decisions section's text: every table there headed `Question | Decision | Reopens if`. */
const decidedRows = (text) => tables(text).filter(({ header }) => header.map((cell) => cell.toLowerCase()).join('|') === 'question|decision|reopens if').flatMap(({ rows }) => rows);

/**
 * What is wrong with the Decided tables' rows, one line each. `rows` is `{ now, before }`, the tables' rows here and
 * at the base; `anchors` is States people see's. A gained row is one the base's tables don't hold. One of them has to
 * hold a question, a decision and what reopens it, and be about the new text: it links into States people see, or
 * names it, or holds the word `plain`.
 */
export function judgeDecided({ rows, anchors }) {
  const old = new Set(rows.before.map(({ line }) => line));
  const added = rows.now.filter(({ line }) => !old.has(line));
  if (!added.length) return [`the Decided tables hold no row they didn't hold at ${BASE.slice(0, 8)}: of the ${rows.now.length} rows under Decisions in tables headed Question | Decision | Reopens if, all ${rows.before.length} of the base's and no other`];
  const about = added.filter(({ line }) => /\bplain\b/i.test(rendered(line)) || /\bStates people see\b/.test(rendered(line)) || designLinks(line, DESIGN).some((id) => anchors.has(id)));
  if (!about.length) return [`none of the ${added.length} rows the Decided tables gained links into States people see, names it or holds the word "plain":\n${added.map(({ line }) => line.slice(0, 160)).join('\n')}`];
  const full = about.filter(({ cells }) => cells.length >= 3 && cells.slice(0, 3).every(Boolean));
  return full.length ? [] : [`no row the Decided tables gained about the new text holds all of a question, a decision and what reopens it:\n${about.map(({ line }) => line.slice(0, 160)).join('\n')}`];
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 3: the text names each word of the States people see table.

/** The words of the States people see table: the first cell of each row of the section's table that has a `Status-map entry` column. */
const stateWords = (text) => tables(text).find(({ header }) => header.some((cell) => /^status-map entry$/i.test(cell)))?.rows.map(({ cells }) => cells[0]).filter(Boolean) ?? [];
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A state word standing whole: PASS, BLOCKED, INVALID and INCONCLUSIVE in capitals, the rest in any case. */
const whole = (word) => new RegExp(`(?<![\\w-])${word.split(/\s+/).map(escaped).join('\\s+')}(?![\\w-])`, word === word.toUpperCase() ? '' : 'i');

/** What is wrong with how `text` names the table's words, one line each. `text` is the list of pieces to read, as for judgeAnswers. */
export function judgeWords(text, words, since = `it didn't hold at ${BASE.slice(0, 8)}`) {
  if (!words.length) return ['States people see holds no table with a `Status-map entry` column, so the words of its table can\'t be read'];
  const unnamed = words.filter((word) => !text.some((piece) => whole(word).test(rendered(piece))));
  return unnamed.length ? [`what States people see holds ${since} never names ${unnamed.length} of the ${words.length} words of its table, so it says nothing of what a person reads for them on a plain surface: ${unnamed.join(', ')}`] : [];
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 2: the plain-words line under Later, as extensions and the line in States people see agree.

/** The surfaces the issue names as plain, or asks about, each by the name both lines have to use for it. */
const SURFACES = [
  ['the card', /\bcards?\b/i],
  ['the page', /\bpages?\b/i],
  ["the list's rows", /\blist(?:'s|’s)? rows?\b|\brows? (?:of|in|on) the (?:app(?:'s|’s) )?list\b/i],
  ['notifications', /\bnotifications?\b/i],
  ['end notices', /\bend notices?\b/i],
  ['`deep` with no arguments', /`deep`/],
];
const named = (texts) => SURFACES.filter(([, word]) => texts.some((text) => word.test(rendered(text)))).map(([name]) => name);
const plain = (text) => /\bplain\b/i.test(rendered(text));

/** The plain-words line under Later, as extensions: each line of that section that holds `plain words` and links into States people see. */
const plainLines = (later, anchors) => later.text.split('\n').filter((line) => /\bplain[- ]words?\b/i.test(rendered(line)) && designLinks(line, DESIGN).some((id) => anchors.has(id)));
/** That line's sentences that hold `plain`, cut as pieces are. */
export const plainSentences = (later, anchors) => plainLines(later, anchors).flatMap((line) => pieces(line)).filter(plain);

/**
 * What is wrong with how the two lines agree on which surfaces are plain, one line each. `later` is the Later, as
 * extensions section, `text` the pieces States people see gained, `anchors` States people see's. Each surface the
 * plain-words line names in a sentence that holds `plain` has to be named in the new text, and each surface the new
 * text names in a sentence that holds `plain` has to be named in the plain-words line.
 */
export function judgeAgreement({ later, text, anchors }) {
  const lines = plainLines(later, anchors), problems = [];
  if (!lines.length) problems.push('Later, as extensions holds no line that says "plain words" and links into States people see, so the plain-words line can\'t be read');
  const about = text.filter(plain);
  if (!about.some((piece) => /\bsurfaces?\b/i.test(rendered(piece)))) problems.push(`States people see holds no sentence it didn't hold at ${BASE.slice(0, 8)} that names a plain surface, so it has no line for the plain-words line to agree with`);
  if (problems.length) return problems;
  const there = named(text), here = named(lines);
  for (const name of named(plainSentences(later, anchors)).filter((surface) => !there.includes(surface))) problems.push(`the plain-words line under Later, as extensions names ${name} in a sentence on plain words, and what States people see gained never names it`);
  for (const name of named(about).filter((surface) => !here.includes(surface))) problems.push(`States people see names ${name} in a new sentence that holds "plain", and the plain-words line under Later, as extensions never names it`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 4: the issues that build the answer.

/** Whether a body cites an issue of this repository: `#n`, `windoliver/deepbuild#n` or its URL. */
function cites(body, number) {
  const n = String(number);
  return new RegExp(`(?:^|[^&\\w/-])#${n}(?!\\d)|${REPO}#${n}(?!\\d)|github\\.com/${REPO}/issues/${n}(?!\\d)`, 'im').test(body ?? '');
}
/**
 * The numbers of the issues, no pull requests, filed after #3472 in this repository that GitHub records as citing it:
 * `{ numbers }`, or `{ why }` when its timeline can't be read. `ask` is the gh to ask, so a planted one can stand in.
 */
export function citing(ask = gh) {
  const PAGE = 100, numbers = new Set();
  for (let page = 1; ; page++) {
    const call = `repos/${REPO}/issues/${ISSUE}/timeline?per_page=${PAGE}&page=${page}`;
    const listed = ask(['api', call]);
    if (listed.status !== 0) return { why: `gh api ${call} failed: ${said(listed)}` };
    let events;
    try {
      events = JSON.parse(listed.stdout);
    } catch (error) {
      return { why: `gh api ${call} gave no JSON: ${error.message}` };
    }
    if (!Array.isArray(events)) return { why: `gh api ${call} gave no list` };
    for (const event of events) {
      const from = event?.event === 'cross-referenced' ? event.source?.issue : null;
      if (from && from.number > ISSUE && !from.pull_request && (!from.repository_url || from.repository_url.toLowerCase().endsWith(`/repos/${REPO}`))) numbers.add(from.number);
    }
    if (events.length < PAGE) return { numbers: [...numbers].sort((a, b) => a - b) };
  }
}
/** Closed as not planned or as a duplicate: nothing is filed to be done, as scripts/design-issues.mjs reads it. */
const dropped = (issue) => String(issue.state).toLowerCase() === 'closed' && String(issue.stateReason ?? '').toLowerCase() !== 'completed';

/** The two issues the Scope already knows, each by the words an issue that is it has to use (README.md, The issues). */
const KNOWN = [
  ["`deep`'s list read by the lane", [/`deep`|\bdeep(?:'s|’s)/, /\blists?\b/i, /\blanes?\b/i]],
  ['a lane run that reaches every state', [/\blanes?\b/i, /\bruns?\b/i, /\b(?:every|each) state\b/i]],
];
/** How many issues the list holds at the least: the two the Scope already knows. */
const FEWEST = KNOWN.length;
/** Why no design link can land in the new text, one line; none when the new text holds an anchor. `landing` is the set of anchors that sit in it. */
export const judgeLanding = (landing) => (landing.size ? [] : [`States people see holds no anchor the design didn't have at ${BASE.slice(0, 8)} (a subheading, or an <a id> in its text), so no design link can land in the new text`]);

/**
 * What is wrong with the issues that build the answer, one line each. `issues` is what GitHub holds of each
 * candidate: `{ number, title, body, state, stateReason, pullRequest }`. `landing` is the set of anchors that sit in
 * the new text. An issue that builds the answer is an issue filed after #3472 (a higher number), no pull request, not
 * closed as not planned or as a duplicate, whose body cites #3472 and holds a design link that lands in the new text.
 * Which of the two known issues it is, is told by the words of its title and body.
 */
export function judgeBuilders({ issues, landing }) {
  const problems = judgeLanding(landing);
  const later = issues.filter((issue) => issue.number > ISSUE && !issue.pullRequest && !dropped(issue) && cites(issue.body, ISSUE));
  const lands = (issue) => designLinks(issue.body).some((id) => landing.has(id));
  const builders = later.filter(lands);
  const outside = later.filter((issue) => !lands(issue)).map((issue) => `#${issue.number} cites #${ISSUE} and links ${[...new Set(designLinks(issue.body))].map((id) => `#${id}`).join(', ') || 'no anchor of the design'}, nothing in the new text`);
  if (builders.length < FEWEST) problems.push(`${builders.length} issue${builders.length === 1 ? '' : 's'} filed after #${ISSUE} cite${builders.length === 1 ? 's' : ''} it and hold${builders.length === 1 ? 's' : ''} a design link that lands in the new text (${[...landing].map((id) => `#${id}`).join(', ') || 'which has no anchor'}); the list holds at least the ${FEWEST} the Scope already knows${outside.length ? `. ${outside.join('; ')}` : ''}`);
  const covers = (issue, [, words]) => words.every((word) => word.test(rendered(`${issue.title ?? ''}\n${issue.body ?? ''}`)));
  for (const known of KNOWN) {
    if (builders.some((issue) => covers(issue, known))) continue;
    const near = later.filter((issue) => !lands(issue) && covers(issue, known)).map((issue) => `#${issue.number} holds its words and no design link that lands in the new text`);
    problems.push(`no issue that builds the answer is ${known[0]}: none filed after #${ISSUE} cites it, links into the new text and holds ${known[1].join(', ')}${near.length ? ` (${near.join('; ')})` : ''}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 5: the taste call, bound to the sentences and table cells it judged.

/** The `text` a call made on the design as it is now has to hold: what States people see gained, and the plain-words line's sentences that hold `plain`. */
export const callText = (design) => [
  { file: DESIGN, anchor: STATES, sha256: design.gained.map(sha) },
  { file: DESIGN, anchor: LATER, sha256: [...new Set(plainSentences(design.later, design.states.anchors))].map(sha) },
];

/**
 * What is wrong with the record of the taste call, one line each. `call` is the record parsed, or null when there is
 * none; `design` is what `read` returns; `criterion` is the ID of the criterion the call is for. Every piece the call
 * names has to be in the section it names it under, so a call can't outlive an edit to what it judged; and the pieces
 * it names have to hold the decisions, each state word and the plain-words line, so a call on part of the text isn't
 * a call on the text.
 */
export function judgeCall(call, design, criterion) {
  if (call === null) return [`no taste call is recorded: ${RECORD} isn't there`];
  if (typeof call !== 'object' || Array.isArray(call)) return [`${RECORD} isn't a JSON object`];
  const problems = [];
  if (call.criterion !== criterion) problems.push(`${RECORD} names criterion ${JSON.stringify(call.criterion)}, not "${criterion}"`);
  if (!(typeof call.who === 'string' && call.who.trim())) problems.push(`${RECORD} names no person in "who"`);
  if (!(typeof call.when === 'string' && !Number.isNaN(Date.parse(call.when)))) problems.push(`${RECORD} has no ISO 8601 time in "when"`);
  if (call.call !== 'reads_right') problems.push(`${RECORD}'s call is ${JSON.stringify(call.call)}, not "reads_right"`);
  const entry = (e) => e && e.file === DESIGN && typeof e.anchor === 'string' && Array.isArray(e.sha256) && e.sha256.length > 0 && e.sha256.every((h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h));
  if (!Array.isArray(call.text) || !call.text.length || !call.text.every(entry)) return [...problems, `${RECORD}'s "text" isn't a list of {"file": "${DESIGN}", "anchor": an anchor of it, "sha256": [the SHA-256 of each sentence and table cell judged there]}`];
  const names = new Set();
  for (const { anchor, sha256 } of call.text) {
    const section = sectionOf(design.now, anchor);
    if (!section) {
      problems.push(`${RECORD} names text under #${anchor}, which is no heading or <a id> of ${DESIGN}`);
      continue;
    }
    const held = new Set(pieces(section.text).map(sha));
    const gone = sha256.filter((h) => !held.has(h));
    if (gone.length) problems.push(`the call was made on other text: ${gone.length} of the ${sha256.length} sentences and table cells it names under #${anchor} are not in that section now, edited or removed since the call`);
    for (const h of sha256) if (held.has(h)) names.add(h);
  }
  const judged = design.gained.filter((piece) => names.has(sha(piece)));
  const open = design.gained.length ? [...judgeAnswers(judged, 'that the call names'), ...judgeWords(judged, design.words, 'that the call names')] : [`States people see holds no sentence it didn't hold at ${BASE.slice(0, 8)}, so there is no new text for a call to judge`];
  problems.push(...open);
  const unjudged = design.gained.filter((piece) => !names.has(sha(piece)));
  if (open.length && judged.length && unjudged.length) problems.push(`the call names ${judged.length} of the ${design.gained.length} sentences and table cells States people see gained; not these:\n${unjudged.map((piece) => `"${piece.slice(0, 120)}"`).join('\n')}`);
  const line = plainSentences(design.later, design.states.anchors).filter((piece) => !names.has(sha(piece)));
  if (line.length) problems.push(`the call doesn't name the plain-words line under Later, as extensions as it is now, so it didn't judge that the two lines agree: ${line.map((piece) => `"${piece.slice(0, 120)}"`).join(', ')}`);
  return problems;
}
