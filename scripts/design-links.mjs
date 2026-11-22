// The design links and names lane (#910, #1329): every link from the design docs or an open issue into docs/*.md
// lands. The file exists, and its anchor is a heading slugged as GitHub slugs it or an explicit <a id>. And every
// `deep` command and agent tool an open issue names in code is in a design doc's code, or in scripts/planned-names.txt
// with the open issue that plans it. It reads the open issues the catalogue drift lane fetched; without them it is
// INCONCLUSIVE, never PASS. It also reads the design's Principles section (#2339): see principles() below.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { DOCS, REPO, anchors, headingText, prose, resolve, targets } from './doc-links.mjs';
import { checks } from './lanes.mjs';
import { openIssues } from './open-issues.mjs';

const PLANNED = 'scripts/planned-names.txt';

const broken = [];
let checked = 0;
function check(where, from, text) {
  for (const { number, line } of prose(text)) {
    for (const target of targets(line)) {
      const link = resolve(target, from);
      if (!link) continue;
      checked++;
      const problem = !existsSync(link.file) ? `${link.file} does not exist`
        : link.id && !anchors(link.file).has(link.id) ? `no heading or <a id> in ${link.file} is #${link.id}` : null;
      if (problem) broken.push(`${from ? `${where}:${number}` : where} ${target} (${problem})`);
    }
  }
}

// The `deep` commands and agent tools a text names in code: each code span and each fenced line. A span such as
// `deep setup · spec · env up\|down` names every command it lists; `deep_gpu::view` is a crate path, not a tool.
function names(text) {
  const found = new Set();
  const lines = text.split(/\r?\n/);
  const prosed = new Set([...prose(text)].map(({ number }) => number));
  const codes = lines.flatMap((line, i) => (prosed.has(i + 1) ? [...line.matchAll(/(`+)(.+?)\1/g)].map((m) => m[2].trim()) : [line.trim().replace(/^\$\s+/, '')]));
  for (const code of codes) {
    if (code.startsWith('deep ')) {
      for (const part of code.slice(5).split('·')) {
        for (const command of part.trim().split(/\s/)[0].split(/\\?\|/)) if (/^[a-z][a-z0-9-]*$/.test(command)) found.add(`deep ${command}`);
      }
    }
    for (const [tool] of code.matchAll(/(?<![\w./:-])deep_[a-z0-9_]*[a-z0-9](?![\w-]|::)/g)) found.add(tool);
  }
  return found;
}

for (const doc of DOCS) check(doc, doc, readFileSync(doc, 'utf8'));

// The Principles section (#2339): `## Principles`, right before "What version 0 builds, and what waits", holds 8 to 12
// list lines. Lines 1 to 4 start with AGENTS.md's four invariants, word for word; every other line is one sentence.
// Each line is at most 160 characters as rendered, links into the design, and names a check that exists: a
// `scripts/…` file, in code or by link, or a lane of scripts/lanes.mjs's checks, in code. And the canvas reference's "Conventions every
// primitive uses" opens with a link to the section.
const TD = 'docs/technical-design.md';
const CANVAS = 'docs/canvas-primitives.md';
const CONVENTIONS = 'Conventions every primitive uses';
const LANES = new Set(checks.map(({ name }) => name));
// A line as GitHub renders it, its white space collapsed.
const rendered = (text) => headingText(text).replace(/\s+/g, ' ');
// The sentences of a line as rendered, code spans left out: each end (a . ! or ? with any closing quote or bracket,
// then space, never e.g., i.e. or etc.), and any text after the last end but a closing parenthesis of links and checks.
function sentences(text) {
  const plain = rendered(text.replace(/(`+).+?\1/g, '')).replace(/\b(?:e\.g|i\.e|etc)\./gi, 'eg');
  const ends = [...plain.matchAll(/[.!?]["'’”)\]]*(?=\s|$)/g)];
  const tail = plain.slice(ends.length ? ends.at(-1).index + ends.at(-1)[0].length : 0).trim();
  return ends.length + (!tail || /^\([^()]*\)$/.test(tail) ? 0 : 1);
}
// A line without what GitHub never shows as a link or code: HTML comments and tags, and backslash-escaped links.
const shown = (text) => text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>/gi, '').replace(/\\\[[^\]]*\\?\]\([^)]*\)/g, '');
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
// A level-2 section of a doc: the headings before its heading, the heading after it, its list items, each with its
// line number and its continuation lines joined as GitHub joins an indented or lazy one, and the lines of any paragraph
// after the first item. Lines in fenced code are skipped.
function section(file, title) {
  const lines = [...prose(readFileSync(file, 'utf8'))];
  const at = lines.findIndex(({ line }) => { const heading = line.match(HEADING); return heading?.[1] === '##' && heading[2].toLowerCase() === title.toLowerCase(); });
  if (at < 0) return null;
  // A setext heading is a line of = or - right under a line of text.
  const before = lines.slice(0, at).filter(({ number, line }, i, all) => HEADING.test(line) || (/^ {0,3}(?:=+|-+)\s*$/.test(line) && all[i - 1]?.number === number - 1 && all[i - 1].line.trim()));
  const found = [];
  const stray = [];
  let open = false;
  let inside = 0;
  let next;
  for (const { number, line } of lines.slice(at + 1)) {
    if (HEADING.test(line)) {
      next = line;
      break;
    }
    // An item indented to the last item's text is nested in it, so it is part of that line.
    const item = line.match(/^( {0,3}(?:[-*+]|\d{1,9}[.)])\s+)(.*)$/);
    const nested = item && found.length && item[1].length - item[1].trimStart().length >= inside;
    if (item && !nested) {
      found.push({ number, text: item[2] });
      inside = item[1].length;
    } else if (nested) found.at(-1).text += ` ${line.trim()}`;
    else if (found.length && line.trim() && (open || /^\s+\S/.test(line))) found.at(-1).text += ` ${line.trim()}`;
    else if (found.length && line.trim() && !/^\s*<a\s[^>]*>(?:\s*<\/a>)?\s*$/i.test(line)) stray.push(number);
    open = item ? true : open && Boolean(line.trim());
  }
  return { before, next, found, stray };
}
// The scripts a line names: a code span whose first word is a path under scripts/, or a link to one.
function scriptsOf(text) {
  const spans = [...text.matchAll(/(`+)(.+?)\1/g)].map((m) => m[2].trim().split(/\s/)[0]);
  const links = targets(text).map((target) => target.replace(/[?#].*$/, '')).map((path) => (path.startsWith(REPO) ? path.slice(REPO.length) : /^[a-z][\w+.-]*:/i.test(path) ? '' : posix.join(posix.dirname(TD), path)));
  return [...new Set([...spans, ...links].filter((path) => path.startsWith('scripts/')).map((path) => posix.normalize(path)))];
}
function principles() {
  const problems = [];
  const principled = section(TD, 'Principles');
  if (!principled) return [`${TD} has no \`## Principles\` section before "What version 0 builds, and what waits"`];
  const { before, next, found, stray } = principled;
  for (const number of stray) problems.push(`${TD}:${number} is text in Principles outside its lines: only the opening paragraph may stand outside the list`);
  if (before.length !== 1 || !/^# /.test(before[0].line)) problems.push(`${TD}:${before.at(-1)?.number ?? 1} Principles doesn't follow the doc's title alone`);
  if (!/^##\s+What version 0 builds, and what waits\s*$/.test(next ?? '')) problems.push(`${TD} Principles isn't right before "What version 0 builds, and what waits"`);
  if (found.length < 8 || found.length > 12) problems.push(`${TD} Principles holds ${found.length} lines, not 8 to 12`);
  const invariants = section('AGENTS.md', 'The four invariants')?.found ?? [];
  for (const [i, { number, text: raw }] of found.entries()) {
    const text = shown(raw);
    const at = `${TD}:${number} (Principles line ${i + 1})`;
    const plain = rendered(text);
    if ([...plain].length > 160) problems.push(`${at} is ${[...plain].length} characters, over 160`);
    const invariant = i < 4 ? invariants[i] : undefined;
    if (i < 4 && !invariant) problems.push(`${at} has no invariant ${i + 1} in AGENTS.md to match`);
    // The whole invariant, then only its link and check in parentheses, so a shorter invariant isn't a prefix match.
    else if (invariant && !(plain.startsWith(rendered(invariant.text)) && /^(?:\s+\([^()]*\))?$/.test(plain.slice(rendered(invariant.text).length)))) problems.push(`${at} doesn't hold invariant ${i + 1}, then only its link and check, as AGENTS.md:${invariant.number} has it: "${rendered(invariant.text)}"`);
    // An invariant's own sentences stand as AGENTS.md has them; anything else on a line is one sentence at most.
    const extra = sentences(text) - (invariant ? sentences(invariant.text) : 0);
    if (extra > (invariant ? 0 : 1)) problems.push(`${at} is ${sentences(text)} sentences, not ${invariant ? `invariant ${i + 1}'s ${sentences(invariant.text)}` : 'one'}`);
    if (!targets(text).some((target) => { const link = resolve(target, TD); return link?.id && DOCS.includes(link.file); })) problems.push(`${at} has no link into the design`);
    const scripts = scriptsOf(text);
    // Its name as the folder lists it, so a mis-cased name fails on a disk that ignores case, as it does on GitHub.
    for (const script of scripts) if (!script.startsWith('scripts/') || !existsSync(script) || !statSync(script).isFile() || !readdirSync(posix.dirname(script)).includes(posix.basename(script))) problems.push(`${at} names ${script}, which isn't a file under scripts/`);
    const lanes = [...text.matchAll(/(`+)(.+?)\1/g)].map((m) => m[2].trim()).filter((code) => LANES.has(code));
    if (!scripts.length && !lanes.length) problems.push(`${at} names no check: a \`scripts/…\` file or a lane of scripts/lanes.mjs, in code`);
  }
  const canvas = readFileSync(CANVAS, 'utf8').split(/\r?\n/);
  const conventions = canvas.findIndex((line) => line === `## ${CONVENTIONS}`);
  const opening = canvas.slice(conventions + 1).find((line) => line.trim() && !/^\s*(?:<a\s[^>]*>(?:\s*<\/a>)?|<!--.*-->)\s*$/i.test(line));
  const lands = HEADING.test(opening ?? '') ? [] : targets(shown(opening ?? '')).map((target) => resolve(target, CANVAS)).filter((link) => link?.file === TD && anchors(TD).get(link.id) === 'principles');
  if (conventions < 0 || lands.length !== 1) problems.push(`${CANVAS}:${conventions + 1} "${CONVENTIONS}" doesn't open with one link to ${TD}#principles`);
  return problems;
}
const unprincipled = principles();
const { issues = [], missing } = openIssues();
for (const { number, body } of issues) check(`#${number}`, null, body ?? '');

// Names the design holds, and names planned by an open issue (`<name> #<issue>` a line).
const held = new Set(DOCS.flatMap((doc) => [...names(readFileSync(doc, 'utf8'))]));
const planned = new Map();
const stale = [];
const open = new Map(issues.map(({ number, body }) => [number, names(body ?? '')]));
if (existsSync(PLANNED)) {
  for (const [i, raw] of readFileSync(PLANNED, 'utf8').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const entry = line.match(/^(.+?)\s+#(\d+)$/);
    if (!entry) stale.push(`${PLANNED}:${i + 1} isn't \`<name> #<issue>\``);
    else if (!missing && !open.get(Number(entry[2]))?.has(entry[1])) stale.push(`${PLANNED}:${i + 1} ${entry[1]} (#${entry[2]} is not an open issue that names it)`);
    else planned.set(entry[1], Number(entry[2]));
  }
}
const unheld = [];
let named = 0;
for (const [number, found] of open) {
  for (const name of found) {
    named++;
    if (!held.has(name) && !planned.has(name)) unheld.push(`#${number} names \`${name}\`, which neither design doc holds in code nor ${PLANNED} plans`);
  }
}

if (broken.length || unheld.length || stale.length || unprincipled.length) {
  console.log(`FAIL ${broken.length} links into docs/*.md land on no heading, ${unheld.length} names are not in the design, ${stale.length} planned names are stale, ${unprincipled.length} problems in the Principles section or its canvas link${missing ? `; the open issues were not read: ${missing}` : ''}`);
  for (const line of [...broken, ...unheld, ...stale, ...unprincipled]) console.log(`  ${line}`);
  process.exit(1);
}
if (missing) {
  console.log(`INCONCLUSIVE ${missing}`);
  process.exit(1);
}
console.log(`design links and names: ${checked} links checked from ${DOCS.length} docs and ${issues.length} open issues, each landing on a heading or an <a id>; ${named} \`deep\` commands and agent tools named, each in the design or planned (${planned.size} planned); the Principles section and its canvas link hold`);
