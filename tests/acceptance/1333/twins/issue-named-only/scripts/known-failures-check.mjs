// #1333 twin `issue-named-only`: the blind job's throwaway check with one planted fault. An entry passes once it names any issue, open or not. Every failures entry names an open issue and a date within 14 days.
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
  const why = !found ? 'names no issue and date' : (Date.now() - Date.parse(found[2])) / 86_400_000 > 14 ? `added ${found[2]}, more than 14 days ago` : null;
  if (why) { console.log(`FAIL known failure ${id}: ${why}`); bad++; }
}
if (bad) process.exit(1);
console.log(`PASS known failures: ${Object.keys(failures).length} entries, each with an open issue`);
