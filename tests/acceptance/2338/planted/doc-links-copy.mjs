// The design links lane's anchor code, copied from the base's scripts/doc-links.mjs (#910) at 58d3e19ee, so the
// suite's oracle and its planted programs read headings, anchors and links exactly as the lane does, whatever the
// implementation later does to that file. `prose`, `slug`, `headingText`, `anchors`, `targets` and `resolve` are the
// lane's, unchanged; `headings` (each heading's byte offset, level and slug, by the same scan) is this suite's own.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const REPO = 'https://github.com/windoliver/deepbuild/blob/main/';

// The lines outside fenced code, numbered from 1.
export function* prose(text) {
  let fence;
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
    } else if (mark) fence = mark[1];
    else yield { number: i + 1, line };
  }
}

// GitHub's slug: lowercase, keeping letters, marks, numbers, connectors, spaces and hyphens, each space a hyphen.
export const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
// A heading's text as GitHub renders it: code spans, links and images by their text, without tags, entities,
// emphasis or closing hashes.
export const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');

// A doc's anchors in order, each to the slug of the heading it belongs to (the lane's code).
const anchorsOf = new Map();
export function anchors(file) {
  if (!anchorsOf.has(file)) {
    const found = new Map();
    const headings = new Set();
    let section;
    let waiting = [];
    const settle = (ids, heading) => { for (const id of ids) if (!found.has(id)) found.set(id, heading); };
    for (const { line } of prose(readFileSync(file, 'utf8'))) {
      const ids = [...line.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
      const heading = line.match(/^ {0,3}#{1,6}\s+(.*)$/);
      if (heading) {
        const base = slug(headingText(heading[1]));
        let id = base;
        for (let n = 1; headings.has(id); n++) id = `${base}-${n}`;
        headings.add(id);
        section = id;
        settle([id, ...waiting, ...ids], id);
        waiting = [];
      } else if (!line.replace(/<a\s[^>]*>(?:\s*<\/a>)?/gi, '').trim()) waiting.push(...ids);
      else if (section) {
        settle([...waiting, ...ids], section);
        waiting = [];
      } else waiting.push(...ids);
    }
    settle(waiting, section);
    anchorsOf.set(file, found);
  }
  return anchorsOf.get(file);
}

// The link targets on a line, outside code spans (the lane's code).
export function targets(line) {
  const text = line.replace(/(`+).+?\1/g, '');
  const linked = [...text.matchAll(/\]\(\s*<?([^\s)>]+)/g)].map((m) => m[1]);
  const bare = text.replace(/\]\(\s*<?[^\s)>]+/g, '').split(REPO).slice(1).map((rest) => REPO + rest.match(/^[^\s)>\]"'`]*/)[0].replace(/[.,:;!?*_~]+$/, ''));
  return [...linked, ...bare];
}

// The doc file and anchor a target links to, or null (the lane's code).
export function resolve(target, from) {
  const [, path, anchor = ''] = target.match(/^([^#?]*)(?:\?[^#]*)?(?:#(.*))?$/);
  let file;
  if (path.startsWith(REPO)) file = path.slice(REPO.length);
  else if (/^[a-z][\w+.-]*:/i.test(path)) return null;
  else if (from) file = path ? posix.join(posix.dirname(from), path) : from;
  else if (/^(?:\.?\/)?(?:docs\/)?[^/]+\.md$/.test(path)) file = `docs/${path.split('/').at(-1)}`;
  else return null;
  if (!/^docs\/[^/]+\.md$/.test(file)) return null;
  let id = anchor;
  try {
    id = decodeURIComponent(anchor);
  } catch { /* compared as written */ }
  return { file, id };
}

/**
 * This suite's own: every line of a doc with its byte offset, and each heading the lane's scan sees (outside fenced
 * code, `^ {0,3}#{1,6}\s+`) with its line index, level and slug (GitHub's, with the lane's -1, -2 rule). With
 * `fenced: true` a line inside fenced code that looks like a heading counts as one too (a planted fault only).
 */
export function headings(buffer, { fenced = false } = {}) {
  const raw = buffer.toString('utf8').split('\n');
  const lines = [];
  let offset = 0;
  for (const text of raw) {
    lines.push({ offset, text: text.replace(/\r$/, '') });
    offset += Buffer.byteLength(text) + 1;
  }
  const inProse = new Set([...prose(buffer.toString('utf8'))].map(({ number }) => number - 1));
  const found = [];
  const seen = new Set();
  for (const [index, { offset: at, text }] of lines.entries()) {
    if (!inProse.has(index) && !fenced) continue;
    const match = text.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (!match) continue;
    let id = '';
    if (inProse.has(index)) {
      const base = slug(headingText(match[2]));
      id = base;
      for (let n = 1; seen.has(id); n++) id = `${base}-${n}`;
      seen.add(id);
    }
    found.push({ index, offset: at, level: match[1].length, id, text });
  }
  return { lines, headings: found, size: buffer.length };
}
