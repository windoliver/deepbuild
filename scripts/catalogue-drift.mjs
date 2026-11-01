// The catalogue drift lane (#605): every event kind the design docs or an open issue name in backticks
// is in the event catalogue (canvas-primitives.md, The event catalogue). It reads the open issues once a
// run (scripts/open-issues.mjs); without them the lane is INCONCLUSIVE, never PASS.
import { readFileSync } from 'node:fs';
import { catalogueDrift } from '../packages/contracts/dist/index.js';
import { openIssues } from './open-issues.mjs';

const DOCS = ['docs/technical-design.md', 'docs/canvas-primitives.md'];

const { issues, missing } = openIssues();
if (missing) {
  console.log(`INCONCLUSIVE ${missing}`);
  process.exit(1);
}
const docs = DOCS.map((where) => ({ where, text: readFileSync(where, 'utf8') }));
const drift = catalogueDrift([...docs, ...issues.map(({ number, body }) => ({ where: `#${number}`, text: body ?? '' }))]);
// A doc's drift names the lines that hold the kind; an issue's names the issue.
const where = ({ kind, where }) => {
  const doc = docs.find((d) => d.where === where);
  if (!doc) return where;
  const lines = doc.text.split('\n').flatMap((line, i) => (line.includes(`\`${kind}\``) ? [i + 1] : []));
  return `${where}:${lines.join(',')}`;
};
if (drift.length) {
  console.log(`FAIL ${drift.length} event kinds named in backticks are not in the catalogue: ${drift.map((d) => `${d.kind} (${where(d)})`).join(', ')}`);
  process.exit(1);
}
console.log(`catalogue drift: ${DOCS.length} docs and ${issues.length} open issues name only catalogued event kinds`);
