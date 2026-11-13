// The spine re-judged (#33 AC8; design: The verdict spine is the first exit). Once this repo is gated, each of the 25
// spine tasks is judged again at its merged commit against its issue's criteria and the tests it landed; a task that
// doesn't reach PASS reopens, naming the criterion.
//
//   node scripts/spine.mjs list                    #<issue> <merged commit>, one line per task
//   node scripts/spine.mjs judge [--issue <n>]...  one JSON line per task; exit 0 when every task is PASS, 1 otherwise
//
// The merged commit is the merge of the pull request that closed the issue, or, for a task closed with none, main's
// first-parent head when it closed. Its tests are the files of that commit tagged with one of the issue's criterion IDs
// or under tests/acceptance/<issue>/, run there in a temporary checkout (a clone sharing this repo's objects, never a
// worktree, with origin/main at this repo's) with this checkout's node_modules copied in and the workspaces and
// deep-hook built; a criterion's tests are those whose full name carries its ID or its `AC<i>`. Each test reads as the
// repo's tests say: passed, failed, BLOCKED or INCONCLUSIVE (a failure or skip whose message starts so), and a live suite, which spends plan usage and runs by hand, is not run
// here: its criteria read INCONCLUSIVE. A criterion is the highest of its tests by the verdict table's precedence, and
// INVALID with none; so is the task of its criteria. Reading the criteria and reopening use your `gh` sign-in.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readIssue } from './proof-change.mjs';
import { temporary } from './proof-runs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SLUG = 'windoliver/deepbuild';
/** The 25 spine tasks (the `spine` label) and their merged commits, read from GitHub on Nov 7, 2026. */
const SPINE = [
  [12, '4ce83187c96ce3bd92db02f6317ec664a3933d36'], [13, '7222b1696e35128335f7ef7218a5bd23add6787b'],
  [14, '554bebb6cc8e5693a887bdeac45771e046fcac5e'], [15, 'af779af3c8aed3ecf58690e214c186ff742ae91b'],
  [16, '925aa9f2d88a3b8c0f463fe4d8595230dded9570'], [17, 'e774443e7ee5c01daec128161753675b073437bc'],
  [18, '0350cf0c68e82b886bba712b37425c2b9ab52acf'], [22, 'a23eecaa674eef30ebafdad193023d9045384535'],
  [25, 'debda22a6ef976bd7ce20a92e005272406accf23'], [28, '8592ea38ae565001e7541266fb5e5364ae58d98a'],
  [29, '0966298b7a79e244aa651dfc9aacf1325e04b033'], [30, '2b7f9cddd1511300f93891c262834a99ac0df47b'],
  [31, '42f010f76bed289f711846f18f22f3813d6f5708'], [32, '588627893c214b1831d5054d40127fa737194e87'],
  [44, '5a6d09a4f83e420fa34a9edf22b5161eda749878'], [47, '3b875bf1cf956ce640f294a615df8721b75437f2'],
  [48, '366942a1507dd371ce60e3e9cf848eb1bceb7bfa'], [56, '3c4dd9d8aed45fcb7d2a0dabbba8b51ab13df9be'],
  [80, 'fcf82f4eeab72f9f271132b1fd13ddc713c366aa'], [83, '427645afc9405279d024e124f166ac96a3044974'],
  [86, '33eaad3375f422a265cd51b246281df3a2a17c74'], [236, '4d42ae41db5390efe7f94010900cb1c17f8dc966'],
  [237, '0954514d10c8b38c0d1d8ffd381263ac1b413ce5'], [303, '78b455f39d6eb8fa7499beaff88cd7b0366bbabe'],
  [304, '6a1966dc58018a69a7dfbc44cd4134726c0ef95a'],
];
const PRECEDENCE = ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE', 'PASS'];
/** How long one task's tests may run before what is left reads INCONCLUSIVE. */
const TASK_MS = 3 * 3_600_000;

// No inherited GIT_DIR or the like (a hook's), which would point git, and the tests, in the checkout at this repo.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)$/.test(k)));
const run = (cwd, command, args, timeout = TASK_MS) => spawnSync(command, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 1 << 28, env: { ...ENV, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
const tail = (r) => `${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').slice(-3).join(' ').slice(0, 300);

/** The tests a task landed at its commit: files tagged with one of its criterion IDs, and its acceptance folder's. */
function landed(commit, issue) {
  const tagged = run(ROOT, 'git', ['grep', '-l', '-E', `#${issue}\\.[0-9a-f]{8}`, commit, '--', 'tests', 'packages', 'scripts']).stdout.split('\n').filter(Boolean).map((l) => l.slice(commit.length + 1));
  const folder = run(ROOT, 'git', ['ls-tree', '-r', '--name-only', commit, `tests/acceptance/${issue}/`]).stdout.split('\n').filter(Boolean);
  const isTest = (p) => /\.test\.(ts|js|mjs)$/.test(p) && !p.includes('/twins/') && !p.includes('/fixtures/');
  return [...new Set([...tagged, ...folder])].filter(isTest).sort();
}

/**
 * A temporary checkout of `commit` that git reads as it reads this repo at that commit: a clone sharing its objects
 * (never writing there, never a worktree of it), HEAD detached at the commit and origin/main where this repo's is, so a
 * test's `git merge-base HEAD origin/main` answers as it would here; making it runs none of your git hooks. Returns its
 * directory, or why it couldn't be made.
 */
function checkout(commit, prefix) {
  const dir = temporary(prefix);
  const main = run(ROOT, 'git', ['rev-parse', '--verify', '-q', 'refs/remotes/origin/main']).stdout.trim();
  if (!main) return { why: 'this repo has no origin/main to set in the checkout' };
  for (const [cwd, args] of [[ROOT, ['clone', '-q', '--shared', '--no-checkout', '--template=', ROOT, dir]], [dir, ['update-ref', 'refs/remotes/origin/main', main]], [dir, ['checkout', '-q', '--detach', commit]]]) {
    const r = run(cwd, 'git', ['-c', 'core.hooksPath=/dev/null', ...args]);
    if (r.status !== 0) return { why: `git ${args[0]} for the checkout of ${commit.slice(0, 12)} failed: ${tail(r)}` };
  }
  return { dir };
}

/** How a test ended, as a criterion reads it: a failure or skip the test words as BLOCKED or INCONCLUSIVE is that. */
const outcomeOf = (status, message = '') => (/^\s*(Error: )?BLOCKED/.test(message) ? 'BLOCKED' : /^\s*(Error: )?INCONCLUSIVE/.test(message) ? 'INCONCLUSIVE'
  : status === 'passed' ? 'PASS' : status === 'failed' ? 'FAIL' : 'INCONCLUSIVE');
/** Each test of the files, run at the checkout: its full name and its outcome. A live file's tests aren't run. */
function results(dir, files) {
  const out = [];
  const live = files.filter((f) => /\.live\.test\./.test(f));
  for (const f of live) out.push({ name: `${f} ${readFileSync(join(dir, f), 'utf8').match(/AC\d+\b|#\d+\.[0-9a-f]{8}/g)?.join(' ') ?? ''}`, outcome: 'INCONCLUSIVE' });
  const nodeTests = files.filter((f) => !live.includes(f) && /['"]node:test['"]/.test(readFileSync(join(dir, f), 'utf8')));
  const vitest = files.filter((f) => !live.includes(f) && !nodeTests.includes(f));
  if (vitest.length) {
    const report = join(dir, 'spine-report.json');
    run(dir, process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...vitest, '--no-file-parallelism', '--testTimeout=600000', '--reporter=json', `--outputFile=${report}`]);
    if (existsSync(report)) {
      for (const f of JSON.parse(readFileSync(report, 'utf8')).testResults ?? []) {
        for (const t of f.assertionResults ?? []) out.push({ name: t.fullName ?? t.title, outcome: outcomeOf(t.status, (t.failureMessages ?? [])[0]) });
        // A file that failed to load ran none of its tests: each criterion it names reads as its failure does.
        if (!(f.assertionResults ?? []).length && f.status === 'failed') out.push({ name: `${f.name} ${readFileSync(f.name, 'utf8').match(/AC\d+\b|#\d+\.[0-9a-f]{8}/g)?.join(' ') ?? ''}`, outcome: outcomeOf('failed', f.message) });
      }
    }
  }
  for (const f of nodeTests) {
    const r = run(dir, process.execPath, ['--test', '--test-reporter=junit', f]);
    for (const m of r.stdout.matchAll(/<testcase name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const body = (m[3] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      const said = /<(?:failure|skipped) [^>]*message="([^"]*)"/.exec(body)?.[1] ?? /\[ERR_ASSERTION\]: ([^\n]*)/.exec(body)?.[1] ?? '';
      out.push({ name: m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'), outcome: outcomeOf(/<failure/.test(body) ? 'failed' : /<skipped/.test(body) ? 'skipped' : 'passed', said) });
    }
  }
  return out;
}

/**
 * An issue split into parts (its body's `### Parts`, each line `- #n …`) closes when every part has: each part's line
 * is its criterion, by the same ID rule, and reads as that part's own verdict at the issue's commit.
 */
function parts(issue, commit) {
  const r = run(ROOT, 'gh', ['issue', 'view', String(issue), '-R', SLUG, '--json', 'body', '-q', '.body'], 120_000);
  const section = (r.stdout ?? '').split(/^###\s+Parts\s*$/m)[1]?.split(/^#{1,6}\s/m)[0] ?? '';
  return [...section.matchAll(/^\s*- (#(\d+) .+)$/gm)].map(([, text, part]) => {
    const id = `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
    const j = judge(Number(part), commit);
    return { id, outcome: j.verdict, ...(j.why ? { why: j.why } : {}) };
  });
}

/** One task judged at its commit: each criterion by its tests, and the task by the highest. */
function judge(issue, commit) {
  const read = readIssue(ROOT, { commits: [{ message: `Closes #${issue}` }] });
  if (!read || read.blocked) return { issue, commit, verdict: 'BLOCKED', criteria: [], reopen: null, why: read?.blocked ?? 'no issue' };
  if (!read.criteria.length) {
    const criteria = parts(issue, commit);
    const verdict = criteria.length ? PRECEDENCE.find((o) => criteria.some((c) => c.outcome === o)) : 'INVALID';
    const failing = criteria.find((c) => c.outcome === verdict && c.outcome !== 'PASS');
    return { issue, commit, verdict, criteria, reopen: failing ? { criterion: failing.id } : null };
  }
  const files = landed(commit, issue);
  let tests = [];
  let why = '';
  if (files.length) {
    const { dir, why: unmade } = checkout(commit, `spine-${issue}-`);
    why = unmade ?? '';
    if (dir) try {
      // A copy-on-write clone where the file system has one, a plain copy elsewhere.
      const copied = run(ROOT, 'cp', [...(process.platform === 'darwin' ? ['-c'] : ['--reflink=auto']), '-R', join(ROOT, 'node_modules'), join(dir, 'node_modules')]);
      const built = run(dir, 'npm', ['run', 'build', '--workspaces', '--if-present']);
      const hook = run(dir, 'cargo', ['build', '--locked', '-q', '-p', 'deep-hook']);
      if (copied.status !== 0) why = `node_modules wasn't copied into the checkout: ${tail(copied)}`;
      else if (built.status !== 0) why = `the workspaces didn't build at ${commit.slice(0, 12)}: ${tail(built)}`;
      else if (hook.status !== 0 && existsSync(join(dir, 'crates/deep-hook'))) why = `deep-hook didn't build at ${commit.slice(0, 12)}: ${tail(hook)}`;
      else tests = results(dir, files);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const criteria = read.criteria.map((c, i) => {
    const mine = tests.filter((t) => t.name.includes(c.id) || new RegExp(`\\bAC${i + 1}\\b`).test(t.name));
    const outcome = why ? 'BLOCKED' : !mine.length ? 'INVALID' : PRECEDENCE.find((o) => mine.some((t) => t.outcome === o));
    return { id: c.id, outcome };
  });
  const verdict = criteria.length ? PRECEDENCE.find((o) => criteria.some((c) => c.outcome === o)) : 'INVALID';
  const failing = criteria.find((c) => c.outcome === verdict && c.outcome !== 'PASS');
  return { issue, commit, verdict, criteria, reopen: failing ? { criterion: failing.id } : null, ...(why ? { why } : {}) };
}

/** A task that didn't reach PASS opens again, its comment naming the criterion and how each ended. */
function reopen(j) {
  const lines = j.criteria.filter((c) => c.outcome !== 'PASS').map((c) => `- ${c.id}: ${c.outcome}${c.why ? ` (${c.why})` : ''}`).join('\n');
  const body = `Re-judged at its merged commit ${j.commit} once this repo was gated (#33 AC8): ${j.verdict}, naming ${j.reopen.criterion}.\n\n${lines}${j.why ? `\n\n${j.why}` : ''}`;
  const r = run(ROOT, 'gh', ['issue', 'reopen', String(j.issue), '-R', SLUG, '--comment', body], 120_000);
  if (r.status !== 0) process.stderr.write(`spine: #${j.issue} wasn't reopened: ${tail(r)}\n`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'list') {
  for (const [issue, commit] of SPINE) console.log(`#${issue} ${commit}`);
} else if (command === 'judge') {
  const only = rest.flatMap((a, i) => (a === '--issue' ? [Number(rest[i + 1])] : []));
  let all = true;
  for (const [issue, commit] of SPINE.filter(([n]) => !only.length || only.includes(n))) {
    const j = judge(issue, commit);
    if (j.verdict !== 'PASS') { all = false; reopen(j); }
    console.log(JSON.stringify(j));
  }
  process.exitCode = all ? 0 : 1;
} else {
  console.error('Usage: node scripts/spine.mjs list | judge [--issue <n>]...');
  process.exitCode = 2;
}
