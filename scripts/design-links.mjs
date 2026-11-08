// The design links and names lane (#910, #1329): every link from the design docs or an open issue into docs/*.md
// lands. The file exists, and its anchor is a heading slugged as GitHub slugs it or an explicit <a id>. And every
// `deep` command and agent tool an open issue names in code is in a design doc's code, or in scripts/planned-names.txt
// with the open issue that plans it. It reads the open issues the catalogue drift lane fetched; without them it is
// INCONCLUSIVE, never PASS.
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { openIssues } from './open-issues.mjs';

const DOCS = ['docs/technical-design.md', 'docs/canvas-primitives.md'];
const PLANNED = 'scripts/planned-names.txt';
const REPO = 'https://github.com/windoliver/deepbuild/blob/main/';

// The lines outside fenced code, numbered from 1.
function* prose(text) {
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
const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
// A heading's text as GitHub renders it: code spans, links and images by their text, without tags, entities,
// emphasis or closing hashes.
const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');

const anchorsOf = new Map();
function anchors(file) {
  if (!anchorsOf.has(file)) {
    const found = new Set();
    const headings = new Set();
    for (const { line } of prose(readFileSync(file, 'utf8'))) {
      for (const [, id] of line.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) found.add(id);
      const heading = line.match(/^ {0,3}#{1,6}\s+(.*)$/);
      if (!heading) continue;
      // A repeated slug takes the first free -1, -2, … suffix, as GitHub's does.
      const base = slug(headingText(heading[1]));
      let id = base;
      for (let n = 1; headings.has(id); n++) id = `${base}-${n}`;
      headings.add(id);
      found.add(id);
    }
    anchorsOf.set(file, found);
  }
  return anchorsOf.get(file);
}

// The link targets on a line, outside code spans: markdown links' targets, and bare links into this repo
// without the trailing punctuation GitHub leaves out of an autolink.
function targets(line) {
  const text = line.replace(/(`+).+?\1/g, '');
  const linked = [...text.matchAll(/\]\(\s*<?([^\s)>]+)/g)].map((m) => m[1]);
  const bare = text.replace(/\]\(\s*<?[^\s)>]+/g, '').split(REPO).slice(1).map((rest) => REPO + rest.match(/^[^\s)>\]"'`]*/)[0].replace(/[.,:;!?*_~]+$/, ''));
  return [...linked, ...bare];
}

// The doc file and anchor a target links to, or null for a link that isn't into docs/*.md. A doc's relative
// links resolve beside it; an issue's relative links count only as docs/<name>.md or <name>.md.
function resolve(target, from) {
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

if (broken.length || unheld.length || stale.length) {
  console.log(`FAIL ${broken.length} links into docs/*.md land on no heading, ${unheld.length} names are not in the design, ${stale.length} planned names are stale${missing ? `; the open issues were not read: ${missing}` : ''}`);
  for (const line of [...broken, ...unheld, ...stale]) console.log(`  ${line}`);
  process.exit(1);
}
if (missing) {
  console.log(`INCONCLUSIVE ${missing}`);
  process.exit(1);
}
console.log(`design links and names: ${checked} links checked from ${DOCS.length} docs and ${issues.length} open issues, each landing on a heading or an <a id>; ${named} \`deep\` commands and agent tools named, each in the design or planned (${planned.size} planned)`);
