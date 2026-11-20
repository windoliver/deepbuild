// A planted wrong program for tests/acceptance/2047 (twins/README.md): the throwaway sweep with one fault. An issue gh fails to read is skipped, unnamed.
// The closed-issue sweep (#2047; design: Closed issues stay proven). Every issue closed as completed that has acceptance
// criteria keeps a test on main naming each criterion's ID, computed from the live text as the trace lane does.
//
//   node scripts/closed-sweep.mjs
//
// Run in the repository whose tests it reads; main is that repository's origin/main as it stands. A criterion is held
// when a file under the test paths on main names its ID, or, in a suite under tests/acceptance/<issue>/ that names no
// criterion ID at all, its AC<n>. An unheld criterion reopens its issue with one comment naming each unheld criterion
// by ID and first words, unless an earlier comment of the sweep's named it. A closed issue an open pull request closes
// is pending and isn't read. A criterion line ending `(moved to #n)` is moved, never unheld. An issue it can't read is
// BLOCKED, and the run exits 1. One line per issue with a find, then one summary line. Reads issues with your gh sign-in.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { testPaths } from './lanes.mjs';

const cwd = process.cwd();
const run = (command, args, input) => spawnSync(command, args, { cwd, input, encoding: input === undefined ? 'utf8' : undefined, maxBuffer: 1 << 30 });
const MARK = 'Closed-issue sweep:';
const ID = /#(\d+)\.[0-9a-f]{8}\b/g;
const testPattern = RegExp(`^(?:${testPaths.map((glob) => glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*/g, (wild) => ({ '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*' })[wild])).join('|')})$`);
const idOf = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
const words = (text) => { const all = text.trim().split(/\s+/); return all.slice(0, 8).join(' ') + (all.length > 8 ? '…' : ''); };
const why = (r) => (`${r.error?.message ?? ''} ${r.stderr ?? ''}`.trim().split('\n').filter(Boolean).at(-1) ?? `exit ${r.status}`);
const blocked = (what) => { console.log(`BLOCKED closed issues: ${what}`); process.exit(1); };

// Main's tests: each file under the test paths at origin/main, with its text.
const main = run('git', ['rev-parse', '--verify', '-q', 'refs/remotes/origin/main']).stdout.trim();
if (!main) blocked('this repository has no origin/main to read its tests on');
const tree = run('git', ['ls-tree', '-r', '-z', main]);
if (tree.status !== 0) blocked(`git ls-tree ${main}: ${why(tree)}`);
const blobs = tree.stdout.split('\0').filter(Boolean).map((entry) => { const [meta, path] = entry.split('\t'); const [, type, oid] = meta.split(' '); return { type, oid, path }; })
  .filter(({ type, path }) => type === 'blob' && testPattern.test(path));
const texts = new Map();
if (blobs.length) {
  const cat = run('git', ['cat-file', '--batch'], `${blobs.map(({ oid }) => oid).join('\n')}\n`);
  if (cat.status !== 0) blocked(`git cat-file: ${why({ ...cat, stderr: String(cat.stderr) })}`);
  let at = 0;
  for (const { path } of blobs) {
    const end = cat.stdout.indexOf(10, at);
    const size = Number(cat.stdout.subarray(at, end).toString().split(' ')[2]);
    texts.set(path, cat.stdout.subarray(end + 1, end + 1 + size).toString('utf8'));
    at = end + 1 + size + 1;
  }
}
// The IDs main's tests name, with the files naming each; each acceptance folder's AC numbers, and whether it names an ID.
const named = new Map(), suites = new Map();
for (const [path, text] of texts) {
  for (const [id] of text.matchAll(ID)) named.set(id, [...new Set([...(named.get(id) ?? []), path])]);
  const folder = Number(path.match(/^tests\/acceptance\/(\d+)\//)?.[1]);
  if (!folder) continue;
  const suite = suites.get(folder) ?? { ids: false, acs: new Set() };
  if (/#\d+\.[0-9a-f]{8}\b/.test(text)) suite.ids = true;
  for (const [, n] of text.matchAll(/\bAC(\d+)\b/g)) suite.acs.add(Number(n));
  suites.set(folder, suite);
}

// The open pull requests, and the issues each closes.
const prs = run('gh', ['pr', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,closingIssuesReferences']);
if (prs.status !== 0) blocked(`gh pr list: ${why(prs)}`);
const pending = new Map();
for (const pr of JSON.parse(prs.stdout)) for (const { number } of pr.closingIssuesReferences ?? []) pending.set(number, [...(pending.get(number) ?? []), pr.number]);

// Every closed issue, page by page.
const slug = run('git', ['remote', 'get-url', 'origin']).stdout.trim().match(/[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
if (!slug) blocked("origin names no GitHub repository");
const closed = [];
for (let page = 1; ; page++) {
  const r = run('gh', ['api', `repos/${slug}/issues?state=closed&per_page=100&page=${page}`]);
  if (r.status !== 0) blocked(`gh api, page ${page} of the closed issues: ${why(r)}`);
  const items = JSON.parse(r.stdout);
  closed.push(...items);
  if (items.length < 100) break;
}

const count = { read: 0, held: 0, pending: 0, reopened: 0, blocked: 0 };
for (const item of closed) {
  if (item.pull_request || item.state_reason !== 'completed') continue;
  const n = item.number;
  if (pending.has(n)) {
    count.pending++;
    console.log(`#${n}: ${pending.get(n).map((pr) => `pending #${pr}`).join('; ')}`);
    continue;
  }
  const view = run('gh', ['issue', 'view', String(n), '--json', 'body,comments']);
  let issue;
  try {
    if (view.status !== 0) throw new Error(why(view));
    issue = JSON.parse(view.stdout);
  } catch (error) {
    continue;
  }
  const section = (issue.body ?? '').split(/^###\s+Acceptance criteria\s*$/m)[1]?.split(/^#{1,6}\s/m)[0] ?? '';
  const criteria = [...section.matchAll(/^\s*- \[[ xX]\] (.+)$/gm)].map(([, text]) => text.trim());
  if (!criteria.length) continue;
  count.read++;
  const suite = suites.get(n);
  const finds = [], unheld = [], live = new Set();
  criteria.forEach((text, i) => {
    const id = idOf(n, text);
    live.add(id);
    const moved = text.match(/\(moved to #(\d+)\)\s*$/);
    if (moved) return void finds.push(`moved ${id} to #${moved[1]}`);
    if (named.has(id) || (suite && !suite.ids && suite.acs.has(i + 1))) return;
    unheld.push({ id, text });
  });
  for (const [id, paths] of named) if (id.startsWith(`#${n}.`) && !live.has(id)) for (const path of paths) finds.push(`stale ${id} in ${path}`);
  const said = new Set((issue.comments ?? []).filter(({ body }) => body.startsWith(MARK)).flatMap(({ body }) => [...body.matchAll(ID)].map(([id]) => id)));
  const fresh = unheld.filter(({ id }) => !said.has(id));
  finds.unshift(...unheld.map(({ id, text }) => `unheld ${id} "${words(text)}"`));
  if (fresh.length) {
    const comment = `${MARK} no test on main names ${fresh.length === 1 ? 'this acceptance criterion' : 'these acceptance criteria'}, so the issue is open again.\n\n${fresh.map(({ id, text }) => `- ${id} ${words(text)}`).join('\n')}\n`;
    const r = run('gh', ['issue', 'reopen', String(n), '--comment', comment]);
    if (r.status !== 0) {
      count.blocked++;
      console.log(`BLOCKED #${n}: gh couldn't reopen it: ${why(r)}`);
      continue;
    }
    count.reopened++;
    finds.push('reopened');
  } else if (unheld.length) finds.push('said before');
  else count.held++;
  if (finds.length) console.log(`#${n}: ${finds.join('; ')}`);
}
console.log(`closed issues: read ${count.read}, held ${count.held}, pending ${count.pending}, reopened ${count.reopened}${count.blocked ? `, blocked ${count.blocked}` : ''}`);
process.exitCode = count.blocked ? 1 : 0;
