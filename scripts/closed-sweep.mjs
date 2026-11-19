// The closed-issue sweep (#2047). An issue's text can change after its tests were written, and the trace lane
// (scripts/proof.mjs) reads it once, when its change lands. This reads every issue closed as completed that has
// acceptance criteria, computes each criterion's ID from the live text as the trace lane does, and holds a criterion
// when a test on main names its ID; in a suite under tests/acceptance/<issue>/ that names no criterion ID at all, a test
// holds the criterion whose `AC<n>` it names. An unheld criterion reopens its issue with one comment naming each by ID
// and first words, and a later run comments only on what no earlier comment of the sweep named. A test naming an ID no
// live criterion has is listed as stale; a criterion line another issue took over, ending `(moved to #n)`, as moved; an
// issue an open pull request closes, as pending, until that pull request merges or closes. An issue it can't read is
// BLOCKED and the run fails. It runs no test and no model, and reads and writes issues with your `gh` sign-in.
//
//   node scripts/closed-sweep.mjs     run in the repository whose tests it reads; main is its origin/main
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { testPaths } from './lanes.mjs';

const MAIN = 'origin/main';
const PAGE = 100;
/** How the sweep's comments start, so a later run finds what it already named. */
const SAID = 'Closed-issue sweep:';
const ID = /#(\d+)\.[0-9a-f]{8}\b/g;

const call = (command, args) => spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 30 });
const why = (r) => (r.error?.message ?? `${r.stderr ?? ''}${r.stdout ?? ''}`).trim().split('\n').slice(-2).join(' ').slice(0, 300) || `exit ${r.status}`;
const json = (r) => {
  if (r.status !== 0) return { why: why(r) };
  try {
    return { value: JSON.parse(r.stdout) };
  } catch (error) {
    return { why: `unreadable JSON: ${error.message}` };
  }
};

/** A criterion's ID: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed. */
const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
/** The issue's criteria as the trace lane reads them (`readIssue`), with the issue a moved line names. */
function criteriaOf(issue, body) {
  const section = body.split(/^###\s+Acceptance criteria\s*$/m)[1]?.split(/^#{1,6}\s/m)[0] ?? '';
  return [...section.matchAll(/^\s*- \[[ xX]\] (.+)$/gm)].map(([, text], index) => ({
    n: index + 1, id: criterionId(issue, text), text: text.trim(), moved: /\(moved to #(\d+)\)\s*$/i.exec(text)?.[1],
  }));
}
const firstWords = (text, count = 8) => {
  const words = text.split(/\s+/);
  return words.length > count ? `${words.slice(0, count).join(' ')}…` : text;
};

/**
 * The tests on main: each code file under the repo's test paths, less twins and fixtures, with the criterion IDs and the
 * `AC<n>` it names. One git grep finds their lines (its regex has no word boundary on every platform), read here.
 */
function testsOnMain() {
  const specs = testPaths.map((path) => `:(glob)${path}`);
  const r = call('git', ['-c', 'core.quotePath=false', 'grep', '-I', '-z', '-E', '#[0-9]+\\.[0-9a-f]{8}|AC[0-9]+', MAIN, '--', ...specs]);
  if (r.status > 1 || r.error) return { why: `git grep on ${MAIN} failed: ${why(r)}` };
  const files = new Map();
  for (const line of r.stdout.split('\n')) {
    const [name, text] = line.split('\0');
    if (!text) continue;
    const path = name.slice(MAIN.length + 1);
    if (!/\.(?:[cm]?[jt]sx?|rs)$/.test(path) || /(?:^|\/)(?:twins|fixtures|__fixtures__|node_modules)\//.test(path)) continue;
    const file = files.get(path) ?? files.set(path, { ids: new Set(), acs: new Set() }).get(path);
    for (const [found] of text.matchAll(/#\d+\.[0-9a-f]{8}\b|\bAC\d+\b/g)) (found.startsWith('#') ? file.ids : file.acs).add(found);
  }
  return { files };
}

/** One closed issue judged against the tests on main: its held, unheld, moved and stale lines. */
function judge(issue, criteria, files) {
  const prefix = `#${issue}.`;
  const named = new Map();
  for (const [path, { ids }] of files) for (const id of ids) if (id.startsWith(prefix)) named.set(id, [...(named.get(id) ?? []), path]);
  // A suite that names no criterion ID at all holds a criterion by its AC<n>.
  const suite = [...files].filter(([path]) => path.startsWith(`tests/acceptance/${issue}/`));
  const byNumber = suite.length && suite.every(([, { ids }]) => !ids.size) ? new Set(suite.flatMap(([, { acs }]) => [...acs])) : new Set();
  const live = new Set(criteria.map(({ id }) => id));
  return {
    moved: criteria.filter(({ moved }) => moved),
    unheld: criteria.filter(({ id, n, moved }) => !moved && !named.has(id) && !byNumber.has(`AC${n}`)),
    stale: [...named].filter(([id]) => !live.has(id)).flatMap(([id, paths]) => paths.map((path) => ({ id, path }))),
  };
}

const counts = { read: 0, held: 0, pending: 0, reopened: 0, blocked: 0 };
function blocked(what, reason) {
  counts.blocked += 1;
  console.log(`BLOCKED ${what}: ${reason}`);
}

function sweep() {
  const tests = testsOnMain();
  if (tests.why) return blocked('closed issues', tests.why);
  // Every closed issue, page by page; GitHub lists pull requests among issues, and a short page is the last.
  const closed = [];
  for (let page = 1; ; page += 1) {
    const read = json(call('gh', ['api', `repos/{owner}/{repo}/issues?state=closed&per_page=${PAGE}&page=${page}`]));
    if (read.why) return blocked('closed issues', `page ${page} wasn't read: ${read.why}`);
    closed.push(...read.value.filter((item) => !item.pull_request));
    if (read.value.length < PAGE) break;
  }
  const prs = json(call('gh', ['pr', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,closingIssuesReferences']));
  if (prs.why) return blocked('closed issues', `the open pull requests weren't read: ${prs.why}`);
  const pending = new Map();
  for (const { number, closingIssuesReferences } of prs.value) for (const { number: issue } of closingIssuesReferences ?? []) pending.set(issue, [...(pending.get(issue) ?? []), number]);

  for (const { number: issue, state_reason: reason } of closed.sort((a, b) => a.number - b.number)) {
    // Closed as not planned or as a duplicate: nothing was claimed done.
    if (reason && reason !== 'completed') continue;
    const finds = [];
    const report = () => finds.length && console.log(`#${issue}: ${finds.join('; ')}`);
    if (pending.has(issue)) {
      counts.pending += 1;
      finds.push(...pending.get(issue).map((pr) => `pending #${pr}`));
      report();
      continue;
    }
    const view = json(call('gh', ['issue', 'view', String(issue), '--json', 'body,comments']));
    if (view.why) {
      blocked(`#${issue}`, view.why);
      continue;
    }
    const criteria = criteriaOf(issue, view.value.body ?? '');
    if (!criteria.length) continue;
    counts.read += 1;
    const { moved, unheld, stale } = judge(issue, criteria, tests.files);
    finds.push(...unheld.map(({ id, text }) => `unheld ${id} "${firstWords(text)}"`), ...stale.map(({ id, path }) => `stale ${id} in ${path}`), ...moved.map(({ id, moved: to }) => `moved ${id} to #${to}`));
    if (!unheld.length) {
      counts.held += 1;
      report();
      continue;
    }
    // What the sweep's earlier comments named, by their first line; a criterion they named isn't named again.
    const said = new Set((view.value.comments ?? []).filter(({ body }) => body?.startsWith(SAID)).flatMap(({ body }) => [...body.matchAll(ID)].map(([id]) => id)));
    const fresh = unheld.filter(({ id }) => !said.has(id));
    if (!fresh.length) {
      finds.push('said before');
      report();
      continue;
    }
    const comment = `${SAID} no test on main names ${fresh.length === 1 ? 'this criterion' : 'these criteria'}, so this issue is open again (#2047).\n\n${fresh.map(({ id, text }) => `- ${id} ${firstWords(text)}`).join('\n')}\n\nA test on main that names a criterion's ID holds it, and a line another issue took over ends \`(moved to #n)\`.`;
    const r = call('gh', ['issue', 'reopen', String(issue), '--comment', comment]);
    if (r.status !== 0) {
      report();
      blocked(`#${issue}`, `the reopen naming ${fresh.map(({ id }) => id).join(', ')} failed: ${why(r)}`);
      continue;
    }
    counts.reopened += 1;
    finds.push('reopened');
    report();
  }
}

sweep();
console.log(`closed issues: read ${counts.read}, held ${counts.held}, pending ${counts.pending}, reopened ${counts.reopened}${counts.blocked ? `, blocked ${counts.blocked}` : ''}`);
process.exitCode = counts.blocked ? 1 : 0;
