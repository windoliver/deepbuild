// A planted wrong lane for #2063's criterion 1 (tests/acceptance/2063/README-exact.md): the catalogue drift lane
// (#605) with the blind job's own small implementation of #2063's list, and one planted fault. A name in
// scripts/not-event-kinds.txt, listed beside an open issue that names it in backticks, is no event kind, and an entry
// whose issue is closed or no longer names it fails the lane.
import { existsSync, readFileSync } from 'node:fs';
import { catalogue, catalogueDrift } from '../packages/contracts/dist/index.js';
import { openIssues } from './open-issues.mjs';

const DOCS = ['docs/technical-design.md', 'docs/canvas-primitives.md'];
const LIST = 'scripts/not-event-kinds.txt';

const { issues, missing } = openIssues();
if (missing) {
  console.log(`INCONCLUSIVE ${missing}`);
  process.exit(1);
}
const open = new Map(issues.map(({ number, body }) => [number, body ?? '']));
const listed = new Set();
const stale = [];
if (existsSync(LIST)) {
  for (const [i, raw] of readFileSync(LIST, 'utf8').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const entry = line.match(/^(.+?)\s+#(\d+)$/);
    if (!entry) stale.push(`${LIST}:${i + 1} isn't \`<name> #<issue>\``);
    else if (!open.get(Number(entry[2]))?.includes(`\`${entry[1]}\``)) stale.push(`${LIST}:${i + 1} ${entry[1]} (#${entry[2]} is not an open issue that names it)`);
    else listed.add(entry[1]);
  }
}
const docs = DOCS.map((where) => ({ where, text: readFileSync(where, 'utf8') }));
const passes = (kind) => listed.has(kind);
const drift = catalogueDrift([...docs, ...issues.map(({ number, body }) => ({ where: `#${number}`, text: body ?? '' }))]).filter(({ kind }) => !passes(kind));
// The planted fault: it over-reports. Every backticked <family>.<name> in an issue that the catalogue lacks and the list
// doesn't hold is read as an event kind, whatever its family, so names in no catalogued family fail the lane too.
const kinds = new Set(catalogue().map((entry) => entry.kind));
for (const { number, body } of issues) {
  for (const [, kind] of (body ?? '').matchAll(/`([a-z][a-z_]*\.[a-z][a-z_]*)`/g)) {
    if (!kinds.has(kind) && !passes(kind) && !drift.some((d) => d.kind === kind && d.where === `#${number}`)) drift.push({ kind, where: `#${number}` });
  }
}
if (drift.length || stale.length) {
  console.log(`FAIL ${drift.length} event kinds named in backticks are not in the catalogue, ${stale.length} entries of ${LIST} are stale: ${[...drift.map((d) => `${d.kind} (${d.where})`), ...stale].join(', ')}`);
  process.exit(1);
}
console.log(`catalogue drift: ${DOCS.length} docs and ${issues.length} open issues name only catalogued event kinds (${listed.size} names listed as no event kinds)`);
