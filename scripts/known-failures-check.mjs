// The lint lane's check on scripts/known-failures.json (#1333): a listed failure reads as no new failure, so each entry
// of `failures` names the open issue that fixes it and the date it was added, `(#<issue>, added <YYYY-MM-DD>)` at its
// end, and lapses 14 days after that date. An entry with no issue, whose issue isn't open, or older than that fails,
// named by its test ID. It imports only node: built-ins, since a fresh checkout of main has no node_modules.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('./known-failures.json', import.meta.url));
const DAYS = 14;
const SUFFIX = /\(#(\d+), added (\d{4}-\d{2}-\d{2})\)$/;

const { failures = {} } = JSON.parse(readFileSync(FILE, 'utf8'));
const problems = [], issues = new Map();
for (const [id, note] of Object.entries(failures)) {
  const [, issue, added] = note.match(SUFFIX) ?? [];
  if (!issue) problems.push(`FAIL known-failures.json: ${id} names no issue and date: end it with "(#<issue>, added <YYYY-MM-DD>)"`);
  else if (!(Date.now() - Date.parse(`${added}T00:00:00Z`) <= DAYS * 86_400_000)) problems.push(`FAIL known-failures.json: ${id} was added ${added}, more than ${DAYS} days ago: fix it, or take it out and let it fail`);
  else issues.set(issue, [...issues.get(issue) ?? [], id]);
}
for (const [issue, ids] of issues) {
  const gh = spawnSync('gh', ['issue', 'view', issue, '--json', 'state', '-q', '.state'], { encoding: 'utf8' });
  const state = gh.status === 0 ? gh.stdout.trim() : null;
  if (state === null) problems.push(...ids.map((id) => `INCONCLUSIVE known-failures.json: ${id}: could not read issue #${issue}: ${(gh.error?.message ?? gh.stderr).trim().split('\n')[0]}`));
  else if (state !== 'OPEN') problems.push(...ids.map((id) => `FAIL known-failures.json: ${id} names issue #${issue}, which is ${state.toLowerCase()}, not open`));
}
for (const problem of problems) console.log(problem);
console.log(`${problems.length ? `${problems.length} of` : 'all'} ${Object.keys(failures).length} known failures ${problems.length ? 'fail' : 'name an open issue, added within the last 14 days'}`);
process.exitCode = problems.length ? 1 : 0;
