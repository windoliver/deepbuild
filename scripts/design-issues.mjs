// The design's headings with the issues filed against them (#2340). Each link an open issue or an issue closed as
// completed makes into the design docs lands on a heading, as the design links lane reads it (an <a id> on the
// heading that follows it), and each heading is one row: the closed issues and the open issues that link it, each
// once, and one word for what the tracker shows. `closed` when only closed issues link it, `mixed` when both do,
// `open` when only open issues do, and `unlinked` when none does. A `closed` heading has no open work filed against
// it; that doesn't make it complete. An issue closed as not planned or as a duplicate isn't read. An issue list it
// can't read in full is BLOCKED, with no table. `--json <file>` writes the same rows and summary to the file.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { DOCS, anchors, prose, resolve, targets } from './doc-links.mjs';
import { openIssues } from './open-issues.mjs';

const PAGE = 100;

// The issues closed as completed, from the REST issues list a page at a time; it lists pull requests too, and marks
// them. A page it can't read returns what is missing.
function closedIssues() {
  const issues = [];
  for (let page = 1; ; page++) {
    const call = `repos/{owner}/{repo}/issues?state=closed&per_page=${PAGE}&page=${page}`;
    const gh = spawnSync('gh', ['api', call], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const missing = `could not read page ${page} of the closed issues, gh api ${call}`;
    if (gh.status !== 0) return { missing: `${missing}: ${(gh.error?.message ?? gh.stderr).trim().replaceAll('\n', ' ')}` };
    let listed;
    try {
      listed = JSON.parse(gh.stdout);
    } catch (error) {
      return { missing: `${missing}: ${error.message}` };
    }
    if (!Array.isArray(listed)) return { missing: `${missing}: gh gave no list` };
    issues.push(...listed.filter((item) => !item.pull_request && item.state_reason === 'completed'));
    if (listed.length < PAGE) return { issues };
  }
}

const [flag, json, ...rest] = process.argv.slice(2);
if ((flag && (flag !== '--json' || !json)) || rest.length) {
  console.error('usage: node scripts/design-issues.mjs [--json <file>]');
  process.exit(2);
}

const closed = closedIssues();
const open = closed.missing ? {} : openIssues();
const missing = closed.missing ?? open.missing;
if (missing) {
  console.log(`BLOCKED ${missing}`);
  process.exit(1);
}

// One row per heading of the design docs, in doc order.
const rows = DOCS.flatMap((file) => [...new Set(anchors(file).values())].map((anchor) => ({ file, anchor, closed: new Set(), open: new Set() })));
const byHeading = new Map(rows.map((row) => [`${row.file}#${row.anchor}`, row]));
for (const [side, issues] of [['closed', closed.issues], ['open', open.issues]]) {
  for (const { number, body } of issues) {
    for (const { line } of prose(body ?? '')) {
      for (const target of targets(line)) {
        const link = resolve(target, null);
        if (link && DOCS.includes(link.file)) byHeading.get(`${link.file}#${anchors(link.file).get(link.id)}`)?.[side].add(number);
      }
    }
  }
}

const numbers = (set) => [...set].sort((a, b) => a - b);
const word = (row) => (row.closed.size ? (row.open.size ? 'mixed' : 'closed') : row.open.size ? 'open' : 'unlinked');
const listed = rows.map((row) => ({ file: row.file, anchor: row.anchor, closed: numbers(row.closed), open: numbers(row.open), reads: word(row) }));
const reading = (reads) => listed.filter((row) => row.reads === reads).length;
const summary = {
  linked: listed.length - reading('unlinked'),
  closed: reading('closed'),
  mixed: reading('mixed'),
  open: reading('open'),
  unlinked: reading('unlinked'),
  issues: { read: closed.issues.length + open.issues.length, closed: closed.issues.length, open: open.issues.length },
};

if (json) writeFileSync(json, `${JSON.stringify({ rows: listed, summary }, null, 2)}\n`);
const cell = (list) => list.map((number) => `#${number}`).join(' ');
console.log('| Heading | Closed | Open | Reads |\n|---|---|---|---|');
for (const row of listed) console.log(`| ${row.file}#${row.anchor} | ${cell(row.closed)} | ${cell(row.open)} | ${row.reads} |`);
console.log(`design issues: ${summary.linked} headings linked: ${summary.closed} closed, ${summary.mixed} mixed, ${summary.open} open; ${summary.unlinked} unlinked; ${summary.issues.read} issues read: ${summary.issues.closed} closed, ${summary.issues.open} open`);
