// #1333 twin `no-age`: the blind job's throwaway check with one planted fault. An entry passes however long ago it was added. Every failures entry names an open issue and a date within 14 days.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openIssues } from './open-issues.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { failures = {} } = JSON.parse(readFileSync(join(root, 'scripts', 'known-failures.json'), 'utf8'));
const { issues, missing } = openIssues();
if (missing) { console.log(`INCONCLUSIVE known failures: ${missing}`); process.exit(3); }
const open = new Set(issues.map(({ number }) => number));
let bad = 0;
for (const [id, note] of Object.entries(failures)) {
  const found = note.match(/\(#(\d+), added (\d{4}-\d{2}-\d{2})\)$/);
  const why = !found ? 'names no issue and date' : !open.has(Number(found[1])) ? `#${found[1]} isn't open` : null;
  if (why) { console.log(`FAIL known failure ${id}: ${why}`); bad++; }
}
if (bad) process.exit(1);
console.log(`PASS known failures: ${Object.keys(failures).length} entries, each with an open issue`);
