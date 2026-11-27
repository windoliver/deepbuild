// Helpers for the blind redraft of #1352's section finder and Decided reading (#3402). The design is read from this
// checkout only: no git, no base commit. The slug and heading-text rules, the section's extent and its anchors, the
// eight decisions' words, the agents and the record's shape are copied from tests/acceptance/1352/ (never imported).
// What is new here (README.md, What changed): the section is found by its anchor, and the rows #1352 added are looked
// for in every table with the Decided columns under Decisions.
//
// Each check returns what it found and a list of problems, each a sentence; a test passes when the list is empty. A
// check takes the finder or the reading it uses, so tests/acceptance/3402/ can run it with a planted one.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const DESIGN = 'docs/technical-design.md';
export const RECORD = 'docs/evidence/1352/taste-call.json';
/** The anchor the section is found by (#3402's Scope; the recorded taste call names it too). */
export const ANCHOR = 'cloud-hub';
export const readDesign = () => readFileSync(join(CHECKOUT, DESIGN), 'utf8');

// GitHub's slug and a heading's rendered text, as scripts/design-links.mjs computes them.
const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');

/** Every heading outside fenced code: its line index, level, rendered text and GitHub slug (repeats get -1, -2, …). */
export function headings(text) {
  const lines = text.split(/\r?\n/), found = [], seen = new Set();
  let fence;
  for (const [index, line] of lines.entries()) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
      continue;
    }
    if (mark) { fence = mark[1]; continue; }
    const h = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (!h) continue;
    const words = headingText(h[2]);
    let id = slug(words);
    for (let n = 1; seen.has(id); n++) id = `${slug(words)}-${n}`;
    seen.add(id);
    found.push({ index, level: h[1].length, text: words, slug: id });
  }
  return { lines, found };
}

const ANCHOR_LINE = /<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>\s*(?:<\/a>)?/gi;
const isAnchorLine = (line) => line.trim() && !line.replace(/<a\s[^>]*>\s*(?:<\/a>)?/gi, '').trim();

/** A heading's anchors: its slug and each `<a id>` on the lines just above it (blank and other anchor lines between). */
function anchorsOf(lines, h) {
  const anchors = [h.slug];
  for (let i = h.index - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!isAnchorLine(line)) break;
    anchors.push(...[...line.matchAll(ANCHOR_LINE)].map((m) => m[1]));
  }
  return anchors;
}

// One heading's section, as #1352's suite reads it: its body from the heading to the next heading of its level or
// higher (its subheadings included), without the blank and `<a id>` lines that close it (those belong to the next
// heading), and its anchors.
export function sectionOf(lines, found, h) {
  const next = found.find((o) => o.index > h.index && o.level <= h.level);
  const body = lines.slice(h.index, next ? next.index : lines.length);
  while (body.length && (!body.at(-1).trim() || isAnchorLine(body.at(-1)))) body.pop();
  return { heading: h.text, level: h.level, slug: h.slug, anchors: anchorsOf(lines, h), body: body.join('\n') };
}

/**
 * The redrafted finder: the section of the one heading that carries the anchor `cloud-hub`, as its slug or as an
 * `<a id>` just above it, whatever other headings say. { section }, or { problem } when no heading or several carry it.
 */
export function findSection(text) {
  const { lines, found } = headings(text);
  const carrying = found.filter((h) => anchorsOf(lines, h).includes(ANCHOR));
  if (carrying.length === 0) return { problem: `${DESIGN} has no heading that carries the anchor "${ANCHOR}", so it has no section for a hub of your own in the cloud` };
  if (carrying.length > 1) return { problem: `more than one heading carries the anchor "${ANCHOR}": ${carrying.map((h) => `"${h.text}"`).join(', ')}` };
  return { section: sectionOf(lines, found, carrying[0]) };
}

// Each Scope decision of #1352 by the words any answer to it has to use (tests/acceptance/1352/README.md, What
// "answers" a decision means), copied from the first draft.
export const DECISIONS = [
  ['a hub of your own, not a shared service (one isolated machine, the only writer)', [/\bisolated\b/i, /\bwriter\b/i, /\bshared\b/i]],
  ['the same hub (the Linux hub in a sandbox, the host seam, the remote connection)', [/\bLinux\b/, /\bsandbox(?:ed|es)?\b/i, /\bseams?\b|host@1/i, /\bconnection\b/i]],
  ['who runs it (hosted with one sign-up, the same image on your own account or machine)', [/\bhosted\b/i, /\bsign[- ]?up\b/i, /\bimage\b/i, /\block(?:ed)?[- ]in\b/i]],
  ['whose agents and plan (the unmodified agent on your own account, an API key kept as a secret)', [/\bunmodified\b/i, /\baccounts?\b/i, /\bsubscriptions?\b/i, /\bAPI keys?\b/i, /\bsecrets?\b/i]],
  ['what leaves your machine (privacy, the first screen before sign-up, encryption at rest, who can read it)', [/\bprivacy\b/i, /\bfirst screen\b/i, /\bencrypt/i, /\bat rest\b/i, /\bwho can read\b/i]],
  ["the browser (a web client, the person's own hub, the authenticated connection, a passkey; no agent, page or plug-in answers an ask)", [/\bweb client\b/i, /\bown hub\b/i, /\bauthenticated connection\b/i, /\bpasskeys?\b/i, /\bplug-ins?\b/i, /\bask\b/i]],
  ['who pays for hosting (pay for use, idle machines asleep, bring-your-own free; not free for everyone, not a flat plan)', [/\bpay(?:s|ing)?\b/i, /\bidle\b/i, /\basleep\b/i, /\bbring[- ]your[- ]own\b/i, /\bfree\b/i, /\bflat\b/i]],
  ['moving (deep backup and deep restore, the writer generation refusing a stale copy)', [/\bdeep backup\b/, /\bdeep restore\b/, /\bgeneration\b/i, /\bstale\b/i]],
];

/** Criterion 1, the section: found, answering each of the eight decisions, with at least eight "Not taken". */
export function sectionCheck(text, find = findSection) {
  const { section, problem } = find(text);
  if (!section) return { heading: null, answered: 0, notTaken: 0, problems: [problem] };
  const unanswered = DECISIONS.filter(([, words]) => !words.every((w) => w.test(section.body)));
  const notTaken = section.body.match(/\bnot taken\b/gi)?.length ?? 0;
  const problems = unanswered.map(([decision, words]) => `the section "${section.heading}" doesn't answer this decision: ${decision}: missing ${words.filter((w) => !w.test(section.body)).join(', ')}`);
  if (notTaken < DECISIONS.length) problems.push(`the section "${section.heading}" says "Not taken" ${notTaken} times; each of the ${DECISIONS.length} decisions needs what was not taken`);
  return { heading: section.heading, answered: DECISIONS.length - unanswered.length, notTaken, problems };
}

/** The seven rows #1352 added to the Decided table, by their questions (the row's first cell). */
export const ADDED_QUESTIONS = [
  'A hub for someone with no computer',
  'Who runs a hub in the cloud',
  'Whose agents a hosted hub runs',
  'What a hosted hub keeps in the cloud',
  'A browser reaching a hub',
  'Who pays for a hosted hub',
  'Moving between a hosted hub and your own computer',
];
/** The Decided columns: a table is one of the Decided tables when its header row holds exactly these cells. */
export const DECIDED_COLUMNS = ['Question', 'Decision', 'Reopens if'];

const RULE = /^\|[\s:|-]+\|?\s*$/;
/** A table row's cells, trimmed: the text between its `|`s, a `\|` kept as part of a cell. */
export const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim());

/**
 * The redrafted Decided reading: the body rows of every table with the Decided columns under the heading slugged
 * `decisions` (`## Decisions`), whatever heading inside it the table sits under, each as { heading, row }.
 * { rows }, or { problem } when the design has no such heading or no such table.
 */
export function decidedRows(text) {
  const { lines, found } = headings(text);
  const top = found.find((h) => h.slug === 'decisions');
  if (!top) return { problem: `${DESIGN} has no heading slugged "decisions"` };
  const next = found.find((o) => o.index > top.index && o.level <= top.level);
  const end = next ? next.index : lines.length, rows = [];
  let tables = 0;
  for (let i = top.index + 1; i < end; i++) {
    // A table starts at a `|` line whose next line is the rule line; its rows run to the first line that isn't a `|` line.
    if (!lines[i].trim().startsWith('|') || !RULE.test((lines[i + 1] ?? '').trim())) continue;
    const decided = cells(lines[i]).join('|') === DECIDED_COLUMNS.join('|');
    const heading = found.findLast((h) => h.index < i).text;
    let at = i + 2;
    for (; at < end && lines[at].trim().startsWith('|'); at++) if (decided) rows.push({ heading, row: lines[at] });
    if (decided) tables += 1;
    i = at - 1;
  }
  if (!tables) return { problem: `no table under "${top.text}" has the Decided columns (${DECIDED_COLUMNS.join(' | ')})` };
  return { rows };
}

// tests/acceptance/1352/README.md, The Decided table: a new row links to the section or names the hub and the cloud.
const namesHubAndCloud = (text) => /\bhub\b/i.test(text) && /\b(?:cloud|hosted)\b/i.test(text);

/**
 * Criterion 1, the Decided rows: each of the seven rows #1352 added is a row of a table the reading returns, and at
 * least one of them links to the section (`](#anchor)`) or names the hub and the cloud. A missing row is named by its
 * question.
 */
export function decidedCheck(text, read = decidedRows, find = findSection) {
  const { rows, problem } = read(text);
  if (!rows) return { found: [], problems: [problem] };
  const found = ADDED_QUESTIONS.map((question) => [question, rows.find(({ row }) => cells(row)[0] === question)]).filter(([, hit]) => hit)
    .map(([question, hit]) => ({ question, heading: hit.heading, row: hit.row }));
  const problems = ADDED_QUESTIONS.filter((question) => !found.some((hit) => hit.question === question))
    .map((question) => `no table with the Decided columns holds the row #1352 added for the question "${question}" (${rows.length} rows read)`);
  const anchors = find(text).section?.anchors ?? [];
  if (found.length && !found.some(({ row }) => anchors.some((a) => row.includes(`](#${a})`)) || namesHubAndCloud(row))) {
    problems.push(`none of the ${found.length} rows #1352 added links to the section (${anchors.map((a) => `#${a}`).join(', ') || 'no section'}) or names the hub and the cloud`);
  }
  return { found, problems };
}

// The agents the design's "What each agent gives us" table named at #1352's base (tests/acceptance/1352/README.md,
// The agents), copied from the first draft.
export const AGENTS = [
  ['Claude Code', /\bClaude Code\b/],
  ['Codex', /\bCodex\b/],
  ['pi', /(?<![\w-])pi(?![\w-])/],
  ['Cursor', /\bCursor\b/],
  ['Copilot', /\bCopilot\b/],
  ['OpenCode', /\bOpenCode\b/],
];
const ROUTE = /\bnot allowed\b|\bAPI key only\b|\ballowed\b/i;
// A link out to a provider's terms: any http(s) address that isn't this repo's.
const TERMS = /https?:\/\/(?!(?:www\.)?github\.com\/windoliver\/)[^\s)>\]|]+/i;

/** Criterion 3: the section gives each agent a line naming it with a route word and a link to its provider's terms. */
export function routesCheck(text, find = findSection) {
  const { section, problem } = find(text);
  if (!section) return { heading: null, routed: [], problems: [problem] };
  const lines = section.body.split('\n');
  const routed = AGENTS.filter(([, name]) => lines.some((l) => name.test(l) && ROUTE.test(l) && TERMS.test(l))).map(([agent]) => agent);
  const problems = AGENTS.filter(([agent]) => !routed.includes(agent)).map(([agent, name]) => {
    const named = lines.filter((l) => name.test(l));
    return `the section "${section.heading}" doesn't write down ${agent}'s route: ${named.length ? `named on ${named.length} line(s), none with both a route word and a link to the provider's terms` : 'not named in the section'}`;
  });
  return { heading: section.heading, routed, problems };
}

/** The SHA-256 a taste call names for the section's text (tests/acceptance/1352/README.md, The taste call). */
export const sectionSha256 = (section) => createHash('sha256').update(section.body).digest('hex');
export const CRITERION_5 = '#1352.28fd1eed';

/**
 * Criterion 5: the record of the taste call, given as the file's text (null when there is no file): it names this
 * criterion and a person, a time, says the text reads right, is bound by anchor and SHA-256 to the section's text as
 * the finder returns it now, and says the others are told and can overrule it.
 */
export function tasteCallCheck(text, record, find = findSection) {
  const { section, problem } = find(text);
  if (!section) return { sha256: null, problems: [problem] };
  const sha256 = sectionSha256(section);
  if (record === null) return { sha256, problems: [`no taste call is recorded: ${RECORD} doesn't exist`] };
  let call;
  try {
    call = JSON.parse(record);
  } catch (error) {
    return { sha256, problems: [`${RECORD} is not JSON: ${error.message}`] };
  }
  const problems = [];
  if (call?.criterion !== CRITERION_5) problems.push(`${RECORD} names criterion ${JSON.stringify(call?.criterion)}, not ${CRITERION_5}`);
  if (!(typeof call?.who === 'string' && call.who.trim())) problems.push(`${RECORD} names no person in "who"`);
  if (!(typeof call?.when === 'string' && !Number.isNaN(Date.parse(call.when)))) problems.push(`${RECORD} has no ISO 8601 time in "when"`);
  if (call?.call !== 'reads_right') problems.push(`${RECORD}'s call is ${JSON.stringify(call?.call)}, not "reads_right"`);
  if (call?.text?.file !== DESIGN) problems.push(`${RECORD}'s text.file isn't ${DESIGN}`);
  if (!section.anchors.includes(call?.text?.anchor)) problems.push(`${RECORD}'s text.anchor ${JSON.stringify(call?.text?.anchor)} isn't one of the section's anchors (${section.anchors.join(', ')})`);
  if (call?.text?.sha256 !== sha256) problems.push(`${RECORD}'s text.sha256 ${JSON.stringify(call?.text?.sha256)} isn't the section's text as it is now (${sha256}): the call was made on other text`);
  if (!(/\btold\b/i.test(call?.note ?? '') && /\boverrul/i.test(call?.note ?? ''))) problems.push(`${RECORD}'s note doesn't say the others on the project are told and can overrule the call`);
  return { sha256, problems };
}
