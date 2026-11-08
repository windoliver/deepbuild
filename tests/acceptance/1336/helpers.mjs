// Helpers for #1336's acceptance tests: the design read from this checkout and from the base commit, its headings by
// GitHub's slugs (the slug and heading-text rules are copied from scripts/design-links.mjs, never imported), the new
// section found by the rule in README.md, and the Decided table's rows.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const DESIGN = 'docs/technical-design.md';
/** The base commit these tests were drafted on (origin/main, no implementation). */
export const BASE = '2c89d582';

export const readDesign = () => readFileSync(join(CHECKOUT, DESIGN), 'utf8');
export function baseDesign() {
  const r = spawnSync('git', ['show', `${BASE}:${DESIGN}`], { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git show ${BASE}:${DESIGN} failed (the checkout needs the base commit): ${r.stderr}`);
  return r.stdout;
}

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

// README.md, The section: a heading whose text holds the words "hub" and "project" (or "projects").
export const isSectionHeading = (text) => /\bhub\b/i.test(text) && /\bprojects?\b/i.test(text);

/**
 * The new section: the one heading isSectionHeading accepts, its body up to the next heading of its level or higher
 * (its subheadings included), and its anchors: its slug and each `<a id>` on the lines just above it (blank lines and
 * other anchor lines between). Null when there's no such heading; throws when there are several.
 */
export function findSection(text) {
  const { lines, found } = headings(text);
  const matches = found.filter((h) => isSectionHeading(h.text));
  if (matches.length > 1) throw new Error(`more than one heading holds "hub" and "project": ${matches.map((h) => `"${h.text}"`).join(', ')}`);
  const [h] = matches;
  if (!h) return null;
  const next = found.find((o) => o.index > h.index && o.level <= h.level);
  const anchors = [h.slug];
  for (let i = h.index - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const ids = [...line.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>\s*(?:<\/a>)?/gi)];
    if (!ids.length || line.replace(/<a\s[^>]*>\s*(?:<\/a>)?/gi, '').trim()) break;
    anchors.push(...ids.map((m) => m[1]));
  }
  return { heading: h.text, level: h.level, anchors, body: lines.slice(h.index, next ? next.index : lines.length).join('\n') };
}

/** The Decided table's body rows: the `|` lines under the heading slugged `decided`, without its header and rule. */
export function decidedRows(text) {
  const { lines, found } = headings(text);
  const h = found.find((o) => o.slug === 'decided');
  if (!h) throw new Error('the design has no heading slugged "decided"');
  const next = found.find((o) => o.index > h.index);
  const table = lines.slice(h.index + 1, next ? next.index : lines.length).filter((l) => l.trim().startsWith('|'));
  return table.filter((l) => !/^\|[\s:|-]+\|?\s*$/.test(l.trim())).slice(1);
}
