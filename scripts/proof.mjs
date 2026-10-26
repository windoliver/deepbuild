// The proof lanes (#569): `node scripts/proof.mjs [--release] [lane ...]` proves the change in the git
// repository at its working folder against its issue. The guard refuses unapproved edits of tagged
// tests and of your decisions; before runs each tagged test on the merge base and its planted wrong
// programs; trace refuses `Closes #n` until every criterion has a test that ran and failed on a wrong
// program; mutation (release and on demand) mutates the lines the change adds. Lifecycle, crash and
// replay run when the change touches their paths, and lifecycle and crash in full at release.
import { Blocked, listFiles, readApprovals, readChange, readIssue } from './proof-change.mjs';
import { guard } from './proof-guard.mjs';
import { before, mutation, prepareRuns, removeTemporaries } from './proof-runs.mjs';
import { ENGINE, STORAGE, TABLES, crash, lifecycle, replay } from './proof-suites.mjs';

const LANES = ['guard', 'before', 'trace', 'mutation', 'lifecycle', 'crash', 'replay'];
const args = process.argv.slice(2);
const release = args.includes('--release');
const named = args.filter((arg) => arg !== '--release');
const unknown = named.filter((lane) => !LANES.includes(lane));
if (unknown.length) {
  console.log(`BLOCKED proof: no lane named ${unknown.join(', ')}; the lanes are ${LANES.join(', ')}\n  Fix: Name lanes from the list, or none to run every lane of the mode.`);
  process.exit(1);
}
// Named lanes run with the lanes they read: trace reads before.
const lanes = new Set(named.length ? named : LANES.filter((lane) => release || lane !== 'mutation'));
if (lanes.has('trace')) lanes.add('before');

let failed = false;
const print = (line) => console.log(line);
function say(state, lane, detail, fix) {
  print(`${state} ${lane}: ${detail}`);
  if (state !== 'PASS') {
    failed = true;
    print(`  Fix: ${fix}`);
  }
}

const root = process.cwd();
try {
  const change = readChange(root);
  const issue = readIssue(root, change);
  const approvals = readApprovals(root, change);
  if (lanes.has('guard')) guard({ root, change, issue: issue?.blocked && !issue.number ? null : issue }, approvals, say);

  if (lanes.has('before') || lanes.has('mutation')) {
    const runs = prepareRuns({ root, change, issue: issue?.number ? issue : null }, { coverage: lanes.has('mutation') });
    const kills = lanes.has('mutation') ? mutation({ root, change }, runs, say, print) : new Map();
    const proven = lanes.has('before') ? before(runs, kills, say, print) : before(runs, kills, () => {}, () => {});
    if (lanes.has('trace')) trace(issue, runs, proven);
  }

  const touched = change.whole.map(({ path }) => path);
  if (lanes.has('lifecycle')) {
    const tables = (release ? listFiles(root) : touched.filter((path) => listFiles(root).includes(path))).filter((path) => TABLES.test(path));
    if (tables.length) lifecycle(root, tables, say);
    else print(release ? 'lifecycle: no lifecycle table in the repository' : 'lifecycle: not run, the change touches no lifecycle table');
  }
  if (lanes.has('crash')) {
    if (release || touched.some(STORAGE)) crash({ root, change }, say);
    else print("crash: not run, the change touches neither packages/hub/src/vfs.ts nor packages/record/src");
  }
  if (lanes.has('replay')) {
    if (touched.some(ENGINE)) replay({ root, change }, approvals, say);
    else print('replay: not run, the change touches no verdict engine code under packages/verdicts/src');
  }
} catch (error) {
  if (!(error instanceof Blocked)) throw error;
  for (const lane of lanes) say('BLOCKED', lane, error.message, 'Fetch main so the merge base exists: git fetch origin main');
} finally {
  // A cleanup failure is printed, never thrown: it would replace the lanes' own result.
  const left = removeTemporaries();
  if (left) print(`cleanup: ${left}`);
}
process.exitCode = failed ? 1 : 0;

// A criterion is proven when one of its tagged tests ran on the change, passed, wasn't skipped, and
// failed on a wrong program in this run.
function trace(issue, runs, proven) {
  const fix = 'Tag a test with each open criterion and make it fail on a wrong program, say Part of #n instead of Closes #n, or drop the tag of a criterion the issue no longer holds.';
  if (!issue) return say('PASS', 'trace', 'the change names no issue (no Closes #n or Part of #n line)');
  if (issue.blocked) return say('BLOCKED', 'trace', issue.blocked, 'Name one issue in the change, and sign in to gh or set DEEP_PROOF_ISSUES to a folder holding <n>.md.');
  if (!issue.criteria.length) return say('BLOCKED', 'trace', `#${issue.number} lists no criterion as a - [ ] line under ### Acceptance criteria, so nothing can be traced`, 'Give the issue its acceptance criteria under ### Acceptance criteria.');
  const ids = new Set(issue.criteria.map(({ id }) => id));
  const prefix = `#${issue.number}.`;
  for (const path of runs.files) {
    const tags = runs.tests.filter((test) => test.path === path).flatMap(({ tags: list }) => list);
    for (const tag of new Set(tags)) if (tag.startsWith(prefix) && !ids.has(tag)) say('FAIL', 'trace', `${tag} names no criterion of #${issue.number} (${path})`, fix);
  }
  const open = issue.criteria.filter(({ id }) => !runs.tests.some((test) => test.tags.includes(id) && proven.has(test.key))).map(({ id }) => id);
  if (issue.word === 'Closes' && open.length) say('FAIL', 'trace', `Closes #${issue.number} refused: this change is Part of #${issue.number}; open: ${open.join(', ')}`, fix);
  else if (open.length) say('PASS', 'trace', `Part of #${issue.number}; open: ${open.join(', ')}`);
  else say('PASS', 'trace', `${issue.word} #${issue.number}: each of its ${issue.criteria.length} criteria has a tagged test that ran, passed and failed on a wrong program`);
}
