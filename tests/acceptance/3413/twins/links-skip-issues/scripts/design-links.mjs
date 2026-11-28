import { existsSync, readFileSync } from 'node:fs';
import { drift } from './design-drift.mjs';
import { DOCS, anchors, prose, resolve, targets } from './doc-links.mjs';
import { LIMIT, cost, linked } from './linked-sections.mjs';
import { openIssues } from './open-issues.mjs';
import { principles } from './principles.mjs';

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

if (!missing) {
  const count = (n) => n.toLocaleString('en-US');
  const reads = [];
  for (const { number, body } of issues) {
    const { sections } = linked(body);
    if (sections.length) reads.push({ number, tokens: (await cost(sections)).tokens });
  }
  reads.sort((a, b) => a.tokens - b.tokens || a.number - b.number);
  const at = (rank) => count(reads[Math.ceil(rank) - 1].tokens);
  const said = !reads.length ? ''
    : reads[0].tokens === null ? '; tokens not counted, gpt-tokenizer is not installed (npm ci)'
      : `; median ${at(reads.length / 2)} tokens, 90th percentile ${at(reads.length * 9 / 10)}, largest ${at(reads.length)} (#${reads.at(-1).number}); ${count(reads.filter(({ tokens }) => tokens > LIMIT).length)} pass ${count(LIMIT)}`;
  console.error(`an issue's first read (design-section.mjs --issue): ${count(reads.length)} issues read${said}`);
}

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

const unprincipled = principles();
const behind = drift();
if (broken.length || unheld.length || stale.length || unprincipled.length || behind.length) {
  console.log(`FAIL ${broken.length} links into docs/*.md land on no heading, ${unheld.length} names are not in the design, ${stale.length} planned names are stale, ${unprincipled.length} principles findings, ${behind.length} places where the design is behind main${missing ? `; the open issues were not read: ${missing}` : ''}`);
  for (const line of [...broken, ...unheld, ...stale, ...unprincipled, ...behind]) console.log(`  ${line}`);
  if (unprincipled.length) console.log('  Fix: keep Principles to 8 to 12 one-sentence lines of at most 160 characters, each linking the design and naming a check that exists; edit its first four lines with AGENTS.md\'s invariants; open the canvas conventions with a link to it.');
  if (behind.length) console.log('  Fix: state in the design what main holds at each line named above, in the change that moves main.');
  process.exit(1);
}
if (missing) {
  console.log(`INCONCLUSIVE ${missing}`);
  process.exit(1);
}
console.log(`design links and names: ${checked} links checked from ${DOCS.length} docs and ${issues.length} open issues, each landing on a heading or an <a id>; ${named} \`deep\` commands and agent tools named, each in the design or planned (${planned.size} planned); the design's principles hold; the design states what main holds in each place scripts/design-drift.mjs compares`);
