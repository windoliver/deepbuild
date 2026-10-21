// The catalogue drift lane (#605): every event kind the design docs or an open issue name in backticks
// is in the event catalogue (canvas-primitives.md, The event catalogue). The open issues are fetched once
// per preflight: this run keeps them in target/open-issues.json, and perf hands that file to its copies
// through DEEP_OPEN_ISSUES, so they read the same issues without fetching again. Without the issues the
// lane is INCONCLUSIVE, never PASS.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { catalogueDrift } from '../packages/contracts/dist/index.js';

const DOCS = ['docs/technical-design.md', 'docs/canvas-primitives.md'];
// Far above the open issue count; a list this long may have been cut, so it isn't read as all of them.
const LIMIT = 5000;

function openIssues() {
  if (process.env.DEEP_OPEN_ISSUES) {
    try {
      return { issues: JSON.parse(readFileSync(process.env.DEEP_OPEN_ISSUES, 'utf8')) };
    } catch (error) {
      return { missing: `could not read the cached open issues: ${error.message}` };
    }
  }
  const gh = spawnSync('gh', ['issue', 'list', '--state', 'open', '--limit', String(LIMIT), '--json', 'number,body'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (gh.status !== 0) return { missing: `could not fetch the open issues: ${(gh.error?.message ?? gh.stderr).trim().replaceAll('\n', ' ')}` };
  const issues = JSON.parse(gh.stdout);
  if (issues.length >= LIMIT) return { missing: `gh listed ${issues.length} open issues, the most it was asked for, so some may be unread` };
  mkdirSync('target', { recursive: true });
  writeFileSync('target/open-issues.json', JSON.stringify(issues));
  return { issues };
}

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
