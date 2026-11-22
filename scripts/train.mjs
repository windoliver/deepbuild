// A merge train for the affected suite (#3018; docs/parallel-proof.md, section 6a): one affected.mjs run over several
// PRs that have each passed their proof lanes, so they build once and take one test grant between them.
//
//   node scripts/train.mjs <pr>@<sha> ... [--wide] [--timed] [--slow]
//   node scripts/train.mjs --read <record>
//
// Each PR is pinned to its head, a full SHA, in the order they are to merge. The train fetches origin's main and each
// PR's head, merges them in that order onto the main commit in git's object store, and stops, naming the PR, at the
// first that doesn't merge, before a file of the checkout changes. A train that merges is checked out as a temporary
// branch, affected.mjs runs once over every path it changes, and the checkout goes back to where it was. The record,
// ~/.deepbuild/trains/<train tree>.json, names the main commit, each PR and its head, the train tree, and each
// affected file's result with the PRs whose own changes selected it. --read says what a record stands for now: a green
// train is each PR's result only while main is still its main commit and every PR is still at its pinned head, and
// INCONCLUSIVE otherwise. Nothing merges by itself, and nothing is pushed.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants, homedir, hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// The train's merge commits are its own, never pushed, so they name no person.
const IDENTITY = { GIT_AUTHOR_NAME: 'deepbuild train', GIT_AUTHOR_EMAIL: 'train@deepbuild.invalid', GIT_COMMITTER_NAME: 'deepbuild train', GIT_COMMITTER_EMAIL: 'train@deepbuild.invalid' };
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 2 ** 28, env: { ...process.env, ...IDENTITY } });
const must = (...args) => {
  const result = git(...args);
  if (result.status !== 0) throw Error(`git ${args[0]} failed: ${result.error?.message ?? result.stderr.trim().split('\n').at(-1)}`);
  return result.stdout.trim();
};
const headRef = (number) => `refs/pull/${number}/head`;
const GREEN = ['PASS', 'NO NEW FAILURES'];
// The run's child and the signal that stopped the train, if one did: a stop ends it 128 plus the signal, however it ends.
let child = null, stopped = null;

/**
 * What a record stands for now, a line for each PR, and the exit status: the record's own state only for a green train
 * whose main commit is still origin's main and whose PRs are all still at their pinned heads.
 */
function read(record) {
  // A record that names no PR, or no files, says nothing for any PR, so it never reads as passing.
  if (!Array.isArray(record.prs) || !record.prs.length || !Array.isArray(record.files) || !record.files.length) return console.log('INCONCLUSIVE train: the record names no PR or no files'), 2;
  const seen = git('ls-remote', 'origin', 'refs/heads/main', ...record.prs.map(({ number }) => headRef(number)));
  const now = seen.status === 0 ? new Map(seen.stdout.split('\n').filter(Boolean).map((line) => line.split('\t').reverse())) : null;
  const moved = now && record.prs.find(({ number, head }) => now.get(headRef(number)) !== head);
  const why = !now ? "origin can't be read"
    : now.get('refs/heads/main') !== record.main ? `main moved from ${record.main} to ${now.get('refs/heads/main') ?? 'nothing'}`
    : moved ? `#${moved.number}'s head moved from ${moved.head} to ${now.get(headRef(moved.number)) ?? 'nothing'}` : null;
  const lines = record.prs.map(({ number, head }) => {
    const failing = record.files.filter((file) => file.state === 'FAIL' && file.prs.includes(number)).map(({ file }) => file);
    if (GREEN.includes(record.state)) return why ? `INCONCLUSIVE #${number} ${head}: ${why}` : `${record.state} #${number} ${head}`;
    return failing.length ? `FAIL #${number} ${head}: ${failing.join(' ')}` : `INCONCLUSIVE #${number} ${head}: the train read ${record.state}`;
  });
  for (const line of lines) console.log(line);
  return lines.some((line) => line.startsWith('FAIL')) ? 1 : lines.some((line) => line.startsWith('INCONCLUSIVE')) ? 2 : 0;
}

/** The train's commits: each PR merged onto the last, with the paths its merge changed. Throws at the first that doesn't merge. */
function merge(main, prs) {
  let at = main;
  return prs.map(({ number, head }, index) => {
    const merged = git('merge-tree', '--write-tree', '--name-only', '--no-messages', at, head);
    const [tree, ...conflicts] = merged.stdout.trim().split('\n');
    if (merged.status !== 0 && merged.status !== 1) throw Error(`git merge-tree failed: ${merged.error?.message ?? merged.stderr.trim().split('\n').at(-1)}`);
    if (merged.status === 1) {
      const after = index ? prs.slice(0, index).map((pr) => `#${pr.number}`).join(', ') : `main ${main}`;
      throw Error(`#${number} doesn't merge after ${after}: conflict in ${conflicts.join(' ')}`);
    }
    const commit = must('commit-tree', tree, '-p', at, '-p', head, '-m', `Train: #${number} at ${head}`);
    const paths = must('diff', '--name-only', '--no-renames', '-z', at, commit).split('\0').filter(Boolean);
    at = commit;
    return { number, head, commit, paths };
  });
}

async function run(prs, flags) {
  if (must('status', '--porcelain', '--untracked-files=no')) throw Error('the checkout has uncommitted changes to tracked files; a train runs in a clean checkout');
  const refs = ['main', ...prs.map(({ number }) => String(number))].map((name) => `refs/train/fetched/${name}`);
  let main, steps;
  try {
    must('fetch', '--no-tags', 'origin', `+refs/heads/main:${refs[0]}`, ...prs.map(({ number }, index) => `+${headRef(number)}:${refs[index + 1]}`));
    main = must('rev-parse', refs[0]);
    for (const [index, { number, head }] of prs.entries()) {
      const fetched = must('rev-parse', refs[index + 1]);
      if (fetched !== head) throw Error(`#${number}'s head is ${fetched}, not ${head}`);
    }
    steps = merge(main, prs);
  } finally {
    for (const ref of refs) git('update-ref', '-d', ref);
  }
  const commit = steps.at(-1).commit, tree = must('rev-parse', `${commit}^{tree}`);
  // The run's paths are what the train tree changes from main; each PR's own are for naming who selected what.
  const paths = must('diff', '--name-only', '--no-renames', '-z', main, commit).split('\0').filter(Boolean);
  // With no path, affected.mjs would read the change from the checkout instead.
  if (!paths.length) throw Error('the train changes no path from main, so it has nothing to run');
  console.log(`TRAIN ${tree}: main ${main}${steps.map(({ number, head }) => `, #${number} ${head}`).join('')}`);
  // Where the checkout was, by its full ref, so a tag that shares a branch's name doesn't send it back detached.
  const at = () => git('symbolic-ref', '-q', 'HEAD').stdout.trim() || git('rev-parse', 'HEAD').stdout.trim();
  const before = at();
  const branch = `train/${tree.slice(0, 12)}`;
  // A stop from here ends the run through the same clean-up, so the checkout goes back however the train ends. A
  // terminal's SIGINT reaches the whole group, the run too; a SIGTERM or SIGHUP sent to the train alone is passed on.
  process.on('SIGINT', () => { stopped ??= 'SIGINT'; });
  for (const signal of ['SIGTERM', 'SIGHUP']) process.on(signal, () => { stopped ??= signal; child?.kill(signal); });
  const scratch = mkdtempSync(join(tmpdir(), 'deep-train-')), results = join(scratch, 'results.json');
  let selected, out, restored;
  try {
    must('checkout', '-q', '-B', branch, commit);
    // The train tree's own affected.mjs, read once it is checked out: what each PR's paths select, then the one run.
    const { select } = await import(pathToFileURL(join(root, 'scripts/affected.mjs')).href);
    selected = steps.map((step) => {
      const { tests, crates, wide } = select(root, step.paths);
      return new Set([...tests, ...crates.map((name) => `cargo test -p ${name}`), ...flags.includes('--wide') ? wide : []]);
    });
    let status = 3;
    if (!stopped) {
      child = spawn(process.execPath, [join(root, 'scripts/affected.mjs'), `--results=${results}`, ...flags, ...paths], { cwd: root, stdio: 'inherit' });
      status = await new Promise((done) => child.on('error', () => done(3)).on('close', (code) => done(code ?? 3)));
    }
    // A run that ended before its last line wrote no results: nothing of it is read.
    const written = existsSync(results) && JSON.parse(readFileSync(results, 'utf8'));
    // Results whose state the run's exit doesn't match came from a run that failed after writing them.
    out = written && ({ FAIL: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 3 }[written.state] ?? 0) === status ? written : { state: status === 2 ? 'INCONCLUSIVE' : 'BLOCKED', files: [], other: [] };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    if (before.startsWith('refs/heads/')) git('switch', '-q', before.slice(11));
    else git('checkout', '-q', '--detach', before);
    git('branch', '-q', '-D', branch);
    // Back means on the same branch or commit, with no tracked file changed and the train's branch gone.
    const on = at();
    const dirty = git('status', '--porcelain', '--untracked-files=no').stdout.trim();
    const left = git('rev-parse', '-q', '--verify', `refs/heads/${branch}`).status === 0;
    restored = on === before && !dirty && !left;
    if (!restored) console.log(`BLOCKED train: the checkout didn't go back to ${before} clean: it is on ${on}${dirty ? ', with tracked files changed' : ''}${left ? `, and ${branch} is still there` : ''}`);
  }
  const all = prs.map(({ number }) => number);
  const record = {
    main, prs: prs.map(({ number, head }) => ({ number, head })), tree, state: out.state,
    files: out.files.map((file) => ({ ...file, prs: prs.filter((_, index) => selected[index].has(file.file)).map(({ number }) => number) })),
    // A failure no file answers for, as a build or a lint, is the whole train's.
    other: (out.other ?? []).map((failure) => ({ ...failure, prs: all })),
    host: hostname(), platform: `${process.platform}-${process.arch}`,
  };
  // Named by the tree it tested: a later train of the same tree replaces it.
  const folder = join(homedir(), '.deepbuild', 'trains'), path = join(folder, `${tree}.json`);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`RECORD ${path}`);
  const reading = read(record);
  return stopped ? 128 + constants.signals[stopped] : restored ? reading : 3;
}

async function main(args) {
  try {
    if (args[0] === '--read' && args.length === 2) return read(JSON.parse(readFileSync(args[1], 'utf8')));
    const flags = args.filter((arg) => arg.startsWith('--'));
    const prs = args.filter((arg) => !arg.startsWith('--')).map((arg) => arg.match(/^(\d+)@([0-9a-f]{40})$/));
    if (!prs.length || prs.includes(null) || flags.some((flag) => !['--wide', '--timed', '--slow'].includes(flag))) throw Error('name each PR as <number>@<its head, a full SHA>, in merge order, then any of --wide, --timed, --slow; or --read <record>');
    return await run(prs.map(([, number, head]) => ({ number: Number(number), head })), flags);
  } catch (error) {
    console.log(`BLOCKED train: ${error.message}`);
    return stopped ? 128 + constants.signals[stopped] : 3;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
