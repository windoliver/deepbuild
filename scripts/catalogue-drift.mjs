// The catalogue drift lane (#605): every event kind the design docs or an open issue name in backticks
// is in the event catalogue (canvas-primitives.md, The event catalogue). It reads the open issues once a
// run (scripts/open-issues.mjs); without them the lane is INCONCLUSIVE, never PASS. A name that is no event kind,
// such as a planned check, passes while scripts/not-event-kinds.txt holds it beside an open issue that names it (#2063).
import { readFileSync } from 'node:fs';
import { catalogueDrift } from '../packages/contracts/dist/index.js';
import { openIssues } from './open-issues.mjs';

const DOCS = ['docs/technical-design.md', 'docs/canvas-primitives.md'];
const LIST = 'scripts/not-event-kinds.txt';

const { issues, missing } = openIssues();
if (missing) {
  console.log(`INCONCLUSIVE ${missing}`);
  process.exit(1);
}
const docs = DOCS.map((where) => ({ where, text: readFileSync(where, 'utf8') }));
// The listed names (`<name> #<issue>` a line); an entry counts only while its issue is open and names it in backticks.
const listed = new Set();
const stale = [];
for (const [i, raw] of readFileSync(LIST, 'utf8').split(/\r?\n/).entries()) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const [, name, issue] = line.match(/^(\S+)\s+#(\d+)$/) ?? [];
  if (!name) stale.push(`line ${i + 1} isn't \`<name> #<issue>\``);
  else if (!issues.some(({ number, body }) => number === Number(issue) && body?.includes(`\`${name}\``))) stale.push(`${name} (#${issue} is not an open issue that names it: remove the entry)`);
  else listed.add(name);
}
const drift = catalogueDrift([...docs, ...issues.map(({ number, body }) => ({ where: `#${number}`, text: body ?? '' }))]).filter(({ kind }) => !listed.has(kind));
// A doc's drift names the lines that hold the kind; an issue's names the issue.
const where = ({ kind, where }) => {
  const doc = docs.find((d) => d.where === where);
  if (!doc) return where;
  const lines = doc.text.split('\n').flatMap((line, i) => (line.includes(`\`${kind}\``) ? [i + 1] : []));
  return `${where}:${lines.join(',')}`;
};
if (drift.length || stale.length) {
  const problems = [
    drift.length && `${drift.length} event kinds named in backticks are not in the catalogue, nor in ${LIST}: ${drift.map((d) => `${d.kind} (${where(d)})`).join(', ')}`,
    stale.length && `${stale.length} entries of ${LIST} are stale: ${stale.join(', ')}`,
  ];
  console.log(`FAIL ${problems.filter(Boolean).join('; ')}`);
  process.exit(1);
}
console.log(`catalogue drift: ${DOCS.length} docs and ${issues.length} open issues name only catalogued event kinds, or names ${LIST} holds (${listed.size} listed)`);
