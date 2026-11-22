// Where a link into docs/*.md lands, shared by the design links lane (#910) and the design coverage script (#2340):
// the link targets on a line, the doc file and anchor a target links to, and each doc's anchors with the heading
// each belongs to.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

/** Where the repo's files are on GitHub, as a bare link names them. */
export const REPO = 'https://github.com/windoliver/deepbuild/blob/main/';
/** The design docs. */
export const DOCS = ['docs/technical-design.md', 'docs/canvas-primitives.md'];

// The lines outside fenced code, numbered from 1, each with the byte offset where it starts in the text's UTF-8.
export function* prose(text) {
  let fence;
  let offset = 0;
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const at = offset;
    offset += Buffer.byteLength(raw) + 1;
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
    } else if (mark) fence = mark[1];
    else yield { number: i + 1, line, offset: at };
  }
}

// GitHub's slug: lowercase, keeping letters, marks, numbers, connectors, spaces and hyphens, each space a hyphen.
const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
// A heading's text, or a line's, as GitHub renders it: code spans, links and images by their text, without tags, entities,
// emphasis or closing hashes.
export const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');

// A doc's anchors in order, each to the slug of the heading it belongs to: a heading's own slug, slugged as GitHub
// slugs it, and each explicit <a id> to the heading that follows it, or to the section it sits in when text comes
// between them.
export const anchors = (file) => outline(file).anchors;

// A doc's outline: its anchors as above; its headings in order, each with its slug, level and the byte offset of its
// line; and the byte offset of the line each explicit <a id> sits on. Read once per file.
const outlines = new Map();
export function outline(file) {
  if (!outlines.has(file)) {
    const found = new Map();
    const headings = [];
    const lines = new Map();
    const slugs = new Set();
    let section;
    let waiting = [];
    const settle = (ids, heading) => { for (const id of ids) if (!found.has(id)) found.set(id, heading); };
    for (const { line, offset } of prose(readFileSync(file, 'utf8'))) {
      const ids = [...line.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
      for (const id of ids) if (!lines.has(id)) lines.set(id, offset);
      const heading = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
      if (heading) {
        // A repeated slug takes the first free -1, -2, … suffix, as GitHub's does.
        const base = slug(headingText(heading[2]));
        let id = base;
        for (let n = 1; slugs.has(id); n++) id = `${base}-${n}`;
        slugs.add(id);
        headings.push({ id, level: heading[1].length, offset });
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
    outlines.set(file, { anchors: found, headings, lines });
  }
  return outlines.get(file);
}

// The link targets on a line, outside code spans: markdown links' targets, and bare links into this repo
// without the trailing punctuation GitHub leaves out of an autolink.
export function targets(line) {
  const text = line.replace(/(`+).+?\1/g, '');
  const linked = [...text.matchAll(/\]\(\s*<?([^\s)>]+)/g)].map((m) => m[1]);
  const bare = text.replace(/\]\(\s*<?[^\s)>]+/g, '').split(REPO).slice(1).map((rest) => REPO + rest.match(/^[^\s)>\]"'`]*/)[0].replace(/[.,:;!?*_~]+$/, ''));
  return [...linked, ...bare];
}

// The doc file and anchor a target links to, or null for a link that isn't into docs/*.md. A doc's relative
// links resolve beside it; an issue's relative links count only as docs/<name>.md or <name>.md.
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
  } catch { /* an anchor that isn't valid percent-encoding is compared as written */ }
  return { file, id };
}
