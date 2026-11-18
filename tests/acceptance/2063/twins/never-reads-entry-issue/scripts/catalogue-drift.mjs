// A planted wrong lane for #2063's criteria 2 and 3 (tests/acceptance/2063/twins/README.md): the catalogue drift lane
// (#605) with the blind job's own small implementation of #2063's list, and one planted fault. A name in
// scripts/not-event-kinds.txt, listed beside an open issue that names it in backticks, is no event kind, and an entry
// whose issue is closed or no longer names it fails the lane.
import { existsSync, readFileSync } from 'node:fs';
import { catalogueDrift } from '../packages/contracts/dist/index.js';
import { openIssues } from './open-issues.mjs';

const DOCS = ['docs/technical-design.md', 'docs/canvas-primitives.md'];
const LIST = 'scripts/not-event-kinds.txt';

const { issues, missing } = openIssues();
if (missing) {
  console.log(`INCONCLUSIVE ${missing}`);
  process.exit(1);
}
const listed = new Set();
const stale = [];
if (existsSync(LIST)) {
  for (const [i, raw] of readFileSync(LIST, 'utf8').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const entry = line.match(/^(.+?)\s+#(\d+)$/);
    if (!entry) stale.push(`${LIST}:${i + 1} isn't \`<name> #<issue>\``);
    // The planted fault: a listed name passes without its entry's issue being read, open or closed, naming it or not.
    else listed.add(entry[1]);
  }
}
const docs = DOCS.map((where) => ({ where, text: readFileSync(where, 'utf8') }));
const passes = (kind) => listed.has(kind);
const drift = catalogueDrift([...docs, ...issues.map(({ number, body }) => ({ where: `#${number}`, text: body ?? '' }))]).filter(({ kind }) => !passes(kind));
if (drift.length || stale.length) {
  console.log(`FAIL ${drift.length} event kinds named in backticks are not in the catalogue, ${stale.length} entries of ${LIST} are stale: ${[...drift.map((d) => `${d.kind} (${d.where})`), ...stale].join(', ')}`);
  process.exit(1);
}
console.log(`catalogue drift: ${DOCS.length} docs and ${issues.length} open issues name only catalogued event kinds (${listed.size} names listed as no event kinds)`);
