// The design links and names lane (#910, #1329): every link from the design docs or an open issue into docs/*.md
// lands. The file exists, and its anchor is a heading slugged as GitHub slugs it or an explicit <a id>. And every
// `deep` command and agent tool an open issue names in code is in a design doc's code, or in scripts/planned-names.txt
// with the open issue that plans it. It reads the open issues the catalogue drift lane fetched; without them it is
// INCONCLUSIVE, never PASS. It also reads the design's Principles section (#2339): see principles() below.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { DOCS, anchors, prose, resolve, targets } from './doc-links.mjs';
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
// `scripts/…` file or a lane of scripts/lanes.mjs's checks, in code. And the canvas reference's "Conventions every
// primitive uses" opens with a link to the section.
const TD = 'docs/technical-design.md';
const CANVAS = 'docs/canvas-primitives.md';
const CONVENTIONS = 'Conventions every primitive uses';
const LANES = new Set(checks.map(({ name }) => name));
// A line as GitHub renders it: links by their label, code spans by their text, without tags, emphasis or extra space.
const rendered = (text) => text.replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '').replace(/\s+/g, ' ').trim();
// The list items under a heading until the next heading, each with its line number and its continuation lines joined.
function items(lines, from) {
  const found = [];
  for (let i = from; i < lines.length && !/^ {0,3}#{1,6}\s/.test(lines[i]); i++) {
    const item = lines[i].match(/^ {0,3}(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) found.push({ number: i + 1, text: item[1] });
    else if (found.length && /^\s+\S/.test(lines[i])) found.at(-1).text += ` ${lines[i].trim()}`;
  }
  return found;
}
function principles() {
  const problems = [];
  const lines = readFileSync(TD, 'utf8').split(/\r?\n/);
  const heading = lines.findIndex((line) => /^##\s+Principles\s*$/.test(line));
  const next = lines.findIndex((line, i) => i > heading && /^ {0,3}#{1,6}\s/.test(line));
  if (heading < 0) return [`${TD} has no \`## Principles\` section before "What version 0 builds, and what waits"`];
  if (!/^##\s+What version 0 builds, and what waits\s*$/.test(lines[next] ?? '')) problems.push(`${TD}:${heading + 1} Principles isn't right before "What version 0 builds, and what waits"`);
  const section = items(lines, heading + 1);
  if (section.length < 8 || section.length > 12) problems.push(`${TD}:${heading + 1} Principles holds ${section.length} lines, not 8 to 12`);
  const agents = readFileSync('AGENTS.md', 'utf8').split(/\r?\n/);
  const invariants = items(agents, agents.findIndex((line) => /^##\s+The four invariants\s*$/.test(line)) + 1);
  for (const [i, { number, text }] of section.entries()) {
    const at = `${TD}:${number} (Principles line ${i + 1})`;
    const plain = rendered(text);
    if ([...plain].length > 160) problems.push(`${at} is ${[...plain].length} characters, over 160`);
    const invariant = i < 4 ? invariants[i] : undefined;
    if (i < 4 && !invariant) problems.push(`${at} has no invariant ${i + 1} in AGENTS.md to match`);
    else if (invariant && !plain.startsWith(rendered(invariant.text))) problems.push(`${at} doesn't start with invariant ${i + 1} as AGENTS.md:${invariant.number} has it: "${rendered(invariant.text)}"`);
    const ends = text.replace(/(`+).+?\1/g, '').match(/[.!?]["')\]]*(?=\s|$)/g) ?? [];
    if (!invariant && ends.length > 1) problems.push(`${at} is ${ends.length} sentences, not one`);
    if (!targets(text).some((target) => resolve(target, TD)?.id)) problems.push(`${at} has no link into the design`);
    const named = [...text.matchAll(/(`+)(.+?)\1/g)].map((m) => m[2].trim());
    const scripts = named.map((code) => code.split(/\s/)[0]).filter((code) => code.startsWith('scripts/'));
    for (const script of scripts) if (!existsSync(script) || !statSync(script).isFile()) problems.push(`${at} names ${script}, which isn't a file`);
    if (!scripts.length && !named.some((code) => LANES.has(code))) problems.push(`${at} names no check: a \`scripts/…\` file or a lane of scripts/lanes.mjs, in code`);
  }
  const canvas = readFileSync(CANVAS, 'utf8').split(/\r?\n/);
  const conventions = canvas.findIndex((line) => line === `## ${CONVENTIONS}`);
  const opening = canvas.slice(conventions + 1).find((line) => line.trim() && !/^\s*<a\s[^>]*>(?:\s*<\/a>)?\s*$/i.test(line));
  const lands = (opening ?? '').match(/^ {0,3}#/) ? [] : targets(opening ?? '').map((target) => resolve(target, CANVAS)).filter((link) => link?.file === TD && anchors(TD).get(link.id) === 'principles');
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
