// The design's principles (#2339), read by the design links lane. The section headed "Principles" in
// docs/technical-design.md sits before "What version 0 builds, and what waits" and holds 8 to 12 list lines, each one
// sentence of at most 160 characters as it reads rendered, with a link into the design and the name of a check that
// exists: a file under scripts/, or a lane scripts/lanes.mjs lists, in code. Its first four lines open with AGENTS.md's
// four invariants word for word, so neither file is edited alone, and the first paragraph under the canvas reference's
// "Conventions every primitive uses" links to the section. Each finding names its file and line.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { outline, prose, resolve, targets } from './doc-links.mjs';
import { checks, releaseLanes } from './lanes.mjs';

const DESIGN = 'docs/technical-design.md';
const CANVAS = 'docs/canvas-primitives.md';
const ITEM = /^ {0,3}(?:[-*+]|\d+[.)])\s+/;
const ANCHOR = /^\s*<a\s[^>]*>(?:\s*<\/a>)?\s*$/i;
// A line as it reads rendered: links by their label, code spans by their content, emphasis dropped.
const rendered = (text) => text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(`+)(.+?)\1/g, '$2').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
// Sentences, each link and code span read as one word: one ends at . ! or ? before anything but the closing parenthesis.
const sentences = (text) => text.replace(/!?\[[^\]]*\]\([^)]*\)|(`+).+?\1/g, 'X').trim().split(/(?<=[.!?]["')\]]?)\s+(?=[^\s(])/).length;

// A doc's prose lines from the heading slugged `id` to the next heading of its level or higher, the heading first.
function section(file, id) {
  const { headings } = outline(file);
  const at = headings.findIndex((h) => h.id === id);
  if (at === -1) return null;
  const end = headings.slice(at + 1).find((h) => h.level <= headings[at].level)?.offset ?? Infinity;
  return [...prose(readFileSync(file, 'utf8'))].filter(({ offset }) => offset >= headings[at].offset && offset < end);
}

// AGENTS.md's four invariants: the numbered lines under "The four invariants", with their line numbers.
function invariants() {
  const lines = readFileSync('AGENTS.md', 'utf8').split(/\r?\n/);
  const from = lines.findIndex((line) => /^#+\s+The four invariants\s*$/.test(line));
  return [1, 2, 3, 4].map((n) => {
    const i = from === -1 ? -1 : lines.findIndex((line, j) => j > from && line.startsWith(`${n}. `));
    return i === -1 ? null : { number: i + 1, text: lines[i].slice(`${n}. `.length).trim() };
  });
}

/** The findings, one line each; none when the section and the canvas link hold. */
export function principles() {
  const found = [];
  const fail = (where, problem) => found.push(`${where} ${problem}`);
  const body = section(DESIGN, 'principles');
  const next = outline(DESIGN).headings.find((h) => h.id === 'what-version-0-builds-and-what-waits');
  if (!body) fail(DESIGN, 'has no heading "Principles"');
  else {
    const head = `${DESIGN}:${body[0].number}`;
    if (!next || next.offset < body[0].offset) fail(head, 'Principles must come before the heading "What version 0 builds, and what waits"');
    const first = body.findIndex(({ line }) => ITEM.test(line));
    const items = first === -1 ? [] : body.slice(first).filter(({ line }) => line.trim() && !ANCHOR.test(line));
    for (const { number } of items.filter(({ line }) => !ITEM.test(line))) fail(`${DESIGN}:${number}`, 'is not a Principles line: after the list starts, each line is one list item on one physical line');
    const lines = items.filter(({ line }) => ITEM.test(line));
    if (lines.length < 8 || lines.length > 12) fail(head, `Principles holds ${lines.length} lines; it holds 8 to 12`);
    const words = invariants();
    const lanes = new Set([...checks, ...releaseLanes].map(({ name }) => name));
    for (const [index, { number, line }] of lines.entries()) {
      const where = `${DESIGN}:${number} (line ${index + 1})`;
      const text = line.replace(ITEM, '');
      const invariant = index < 4 ? words[index] : undefined;
      // An invariant's line is its words, then the parenthesis that links its rule and names its check.
      const stated = text.includes(' ([') ? text.slice(0, text.lastIndexOf(' ([')) : text;
      if (invariant === null) fail(where, `has no invariant ${index + 1} to match: AGENTS.md lists none under "The four invariants"`);
      else if (invariant && stated !== invariant.text) fail(where, `doesn't state invariant ${index + 1} as AGENTS.md:${invariant.number} words it: "${invariant.text}"`);
      const length = rendered(text).length;
      if (length > 160) fail(where, `is ${length} characters; a line holds at most 160`);
      const allowed = invariant ? sentences(invariant.text) : 1;
      if (invariant !== null && sentences(text) > allowed) fail(where, `holds ${sentences(text)} sentences; it holds ${allowed}`);
      if (!targets(line).some((target) => resolve(target, DESIGN)?.file === DESIGN && resolve(target, DESIGN).id)) fail(where, 'has no link into the design');
      // A script is a path under scripts/ to a file; a lane is a code span written as `<name>` lane or `<name> lane`.
      const scripts = [...new Set(line.match(/(?<![\w./-])scripts\/[\w./-]*\w/g) ?? [])];
      const real = (path) => posix.normalize(path).startsWith('scripts/') && existsSync(path) && statSync(path).isFile();
      for (const path of scripts.filter((path) => !real(path))) fail(where, `names ${path}, which isn't a file under scripts/`);
      const named = [...line.matchAll(/(`+)(.+?)\1( lane\b)?/g)].flatMap(([, , code, after]) => (after || / lane$/i.test(code) ? [code.replace(/ lane$/i, '')] : []));
      for (const name of named.filter((name) => !lanes.has(name))) fail(where, `names the \`${name}\` lane, which scripts/lanes.mjs doesn't list`);
      if (!named.some((name) => lanes.has(name)) && !scripts.some(real)) fail(where, 'names no check: a file under scripts/ or a lane scripts/lanes.mjs lists, in code');
    }
  }

  // The canvas reference's conventions open with a link to the section: its first paragraph, anchor lines skipped.
  const conventions = section(CANVAS, 'conventions-every-primitive-uses');
  if (!conventions) fail(CANVAS, 'has no heading "Conventions every primitive uses"');
  else {
    const ids = new Set([...outline(DESIGN).anchors].filter(([, heading]) => heading === 'principles').map(([id]) => id));
    const rest = conventions.slice(1).filter(({ line }) => !ANCHOR.test(line));
    const start = rest.findIndex(({ line }) => line.trim());
    const after = start === -1 ? [] : rest.slice(start);
    const stop = after.findIndex(({ line }) => !line.trim() || /^ {0,3}#/.test(line));
    const linked = (stop === -1 ? after : after.slice(0, stop)).some(({ line }) => targets(line).some((target) => {
      const link = resolve(target, CANVAS);
      return link?.file === DESIGN && ids.has(link.id);
    }));
    if (!linked) fail(`${CANVAS}:${conventions[0].number}`, '"Conventions every primitive uses" doesn\'t open with a link to the design\'s Principles section');
  }
  return found;
}
