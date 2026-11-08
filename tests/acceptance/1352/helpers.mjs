// Helpers for #1352's acceptance tests: the design read from this checkout and from the base commit, its headings by
// GitHub's slugs (the slug and heading-text rules are copied from tests/acceptance/1336/helpers.mjs, which copied them
// from scripts/design-links.mjs; never imported), the new section found by the rule in README.md, other sections by
// slug, and table rows.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const DESIGN = 'docs/technical-design.md';
/** The base commit these tests were drafted on (main, no implementation). */
export const BASE = '6aa228ce';

const git = (args) => spawnSync('git', args, { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28 });
export const readDesign = () => readFileSync(join(CHECKOUT, DESIGN), 'utf8');
export function baseFile(path) {
  const r = git(['show', `${BASE}:${path}`]);
  if (r.status !== 0) throw new Error(`git show ${BASE}:${path} failed (the checkout needs the base commit): ${r.stderr}`);
  return r.stdout;
}
export const baseDesign = () => baseFile(DESIGN);

// The text files a search for old wording reads: every text file under docs/ and README.md.
const TEXT = /\.(md|mdx|markdown|txt|html?|json|ya?ml)$/i;
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
/** [path relative to the checkout, text] for each text file under docs/ and README.md, in this checkout. */
export const currentTexts = () => [...walk(join(CHECKOUT, 'docs')).map((f) => f.slice(CHECKOUT.length + 1)), 'README.md']
  .filter((f) => TEXT.test(f) && existsSync(join(CHECKOUT, f))).map((f) => [f, readFileSync(join(CHECKOUT, f), 'utf8')]);
/** The same files at the base commit that hold `word` (any case), found with git grep so evidence files aren't all read. */
export const baseTextsHolding = (word) => git(['grep', '-l', '-i', '-F', '-e', word, BASE, '--', 'docs', 'README.md']).stdout.split('\n')
  .map((line) => line.slice(BASE.length + 1)).filter((f) => TEXT.test(f))
  .map((f) => [f, git(['show', `${BASE}:${f}`])]).filter(([, r]) => r.status === 0).map(([f, r]) => [f, r.stdout]);
/** Case, curly apostrophes and line wrapping don't hide a phrase. */
export const normal = (text) => text.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ');

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

// One heading's section: its body from the heading to the next heading of its level or higher (its subheadings
// included), without the blank and `<a id>` lines that close it (those belong to the next heading), and its anchors:
// its slug and each `<a id>` on the lines just above it (blank lines and other anchor lines between).
function sectionOf(lines, found, h) {
  const next = found.find((o) => o.index > h.index && o.level <= h.level);
  const anchors = [h.slug];
  for (let i = h.index - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!isAnchorLine(line)) break;
    anchors.push(...[...line.matchAll(ANCHOR_LINE)].map((m) => m[1]));
  }
  const body = lines.slice(h.index, next ? next.index : lines.length);
  while (body.length && (!body.at(-1).trim() || isAnchorLine(body.at(-1)))) body.pop();
  return { heading: h.text, level: h.level, slug: h.slug, anchors, body: body.join('\n') };
}

// README.md, The section: a heading whose text holds the word "hub" and the word "cloud" or "hosted".
export const isSectionHeading = (text) => /\bhub\b/i.test(text) && /\b(?:cloud|hosted)\b/i.test(text);

/** The new section, by isSectionHeading. Null when there's no such heading; throws when there are several. */
export function findSection(text) {
  const { lines, found } = headings(text);
  const matches = found.filter((h) => isSectionHeading(h.text));
  if (matches.length > 1) throw new Error(`more than one heading holds "hub" and "cloud" or "hosted": ${matches.map((h) => `"${h.text}"`).join(', ')}`);
  return matches.length ? sectionOf(lines, found, matches[0]) : null;
}
export const NO_SECTION = 'docs/technical-design.md has no heading holding the words "hub" and "cloud" or "hosted", so it has no section for a hub of your own in the cloud';

/** The section whose heading has this GitHub slug; throws when there's none. */
export function sectionBySlug(text, id) {
  const { lines, found } = headings(text);
  const h = found.find((o) => o.slug === id);
  if (!h) throw new Error(`the design has no heading slugged "${id}"`);
  return sectionOf(lines, found, h);
}

/** A table's body rows in a section's text: its `|` lines without header and rule lines (every table in the body). */
export function tableRows(body) {
  const rows = [], lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    if (/^\|[\s:|-]+\|?\s*$/.test(lines[i].trim())) continue;
    if (lines[i + 1] && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1].trim())) continue; // a header
    rows.push(lines[i]);
  }
  return rows;
}

/** The Decided table's body rows: the `|` lines under the heading slugged `decided`. */
export const decidedRows = (text) => tableRows(sectionBySlug(text, 'decided').body);

/** The SHA-256 a taste call names for the section's text (README.md, The taste call). */
export const sectionSha256 = (section) => createHash('sha256').update(section.body).digest('hex');
