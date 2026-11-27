// The sections a text links in the design docs and what they cost to read (#2338, #3546), shared by
// scripts/design-section.mjs, which prints an issue's, and the design links lane, which counts every open issue's, so
// the lane's reading is the script's own loop. A section is the text from its heading, or from the explicit <a id>
// before it, to the next heading of the same or a higher level, subsections included; a line in fenced code is never a
// heading. Anchors resolve as the design links lane (#910) resolves them, so a link that lands there is a section here.
import { existsSync, readFileSync } from 'node:fs';
import { outline, prose, resolve, targets } from './doc-links.mjs';

/** The tokens past which an issue's sections print as their outlines (drafted, #3546). */
export const LIMIT = 25_000;

// The pinned tokenizer's count, gpt-tokenizer's o200k_base as scripts/tool-load.mjs counts with it, loaded when a count
// is first asked for, since loading it takes longer than printing a section. Null in a tree with no node_modules, where
// tokens are not counted, never read as 0.
let tokenizer;
const counter = () => (tokenizer ??= import('gpt-tokenizer/encoding/o200k_base').then(({ countTokens }) => countTokens, (error) => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return null;
}));

// Each doc's bytes, read once.
const docs = new Map();
const bytesOf = (file) => docs.get(file) ?? docs.set(file, readFileSync(file)).get(file);

/** The section of `file` anchor `id` lands in: its bytes, its heading's anchor and where it starts and ends, or the `problem` that stops it. */
export function section(file, id) {
  if (!/^docs\/[^/]+\.md$/.test(file) || !existsSync(file)) return { problem: `${file} is not a doc under docs/` };
  const { anchors: found, headings, lines } = outline(file);
  if (!found.has(id)) return { problem: `no heading or <a id> in ${file} is #${id}` };
  const heading = found.get(id);
  const bytes = bytesOf(file);
  const at = headings.findIndex((candidate) => candidate.id === heading);
  // An <a id> in a doc with no heading: the lane lands it, so its section runs from its line to the end.
  if (at === -1) return { bytes: bytes.subarray(lines.get(id)), heading: `#${id}`, start: lines.get(id), end: bytes.length };
  const { level, offset } = headings[at];
  // An <a id> before its heading starts the section at its own line; one inside a section's text belongs to that section.
  const start = id === heading ? offset : Math.min(offset, lines.get(id) ?? offset);
  const end = headings.slice(at + 1).find((next) => next.level <= level)?.offset ?? bytes.length;
  return { bytes: bytes.subarray(start, end), heading, start, end };
}

/**
 * Each section `text` links, once each, in the order it first links them, with the link's file and anchor, and the
 * problems that stop a link's section. A link to a heading already listed, or to a subsection inside a section already
 * listed, adds nothing. A parent linked after its subsection is still listed whole, since the order is the text's.
 */
export function linked(text) {
  const seen = new Set();
  const sections = [];
  const problems = new Set();
  for (const { line } of prose(text ?? '')) {
    for (const target of targets(line)) {
      const link = resolve(target, null);
      if (!link?.id) continue;
      const found = section(link.file, link.id);
      if (found.problem) problems.add(found.problem);
      else if (!seen.has(`${link.file}#${found.heading}`) && !sections.some((s) => s.file === link.file && s.start <= found.start && found.end <= s.end)) {
        seen.add(`${link.file}#${found.heading}`);
        sections.push({ file: link.file, id: link.id, ...found });
      }
    }
  }
  return { sections, problems };
}

const counted = new Map();
/**
 * The headings a section holds, in order, each with its line, its anchor and its own tokens: those of the text from its
 * line to the next heading's of any level. The first also holds an <a id> line the section starts at, so the headings'
 * tokens add up to the section's. `tokens` is null where the tokenizer isn't installed.
 */
export async function headings({ file, id, start, end }) {
  const count = await counter();
  const bytes = bytesOf(file);
  const inside = outline(file).headings.filter(({ offset }) => start <= offset && offset < end);
  const cuts = inside.length ? inside.map(({ offset }, i) => (i ? offset : start)) : [start];
  return cuts.map((from, i) => {
    const to = cuts[i + 1] ?? end;
    const key = `${file}:${from}:${to}`;
    if (count && !counted.has(key)) counted.set(key, count(bytes.toString('utf8', from, to)));
    const at = inside[i]?.offset ?? from;
    const stop = bytes.indexOf('\n', at);
    return { id: inside[i]?.id ?? id, line: bytes.toString('utf8', at, stop === -1 ? to : stop).trimEnd(), tokens: counted.get(key) ?? null };
  });
}

/** What sections cost to read: their bytes, and their tokens by the pinned tokenizer, null where it isn't installed. */
export async function cost(sections) {
  const own = (await Promise.all(sections.map(headings))).flat().map(({ tokens }) => tokens);
  return { bytes: sections.reduce((sum, { start, end }) => sum + end - start, 0), tokens: own.includes(null) ? null : own.reduce((sum, tokens) => sum + tokens, 0) };
}
