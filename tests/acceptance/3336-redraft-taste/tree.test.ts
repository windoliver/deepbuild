// #3336.f7adc8c8: "A unit lane run leaves `git status` clean: the tree after the lane's commands is the tree it started
// on."
// #3336.7d4ab4ab: "Whatever the run writes goes to a temp or run folder: #1941's screenshots are written outside the
// checkout, and the run names where."
//
// The issue's Proof: this suite "runs #1941's taste test from a clean copy and reads `git status` after". The taste
// files are the ones the unit lane runs in the tree under test: `tests/acceptance/1941/taste.test.ts` while it exists,
// and each test file of the redraft folder `tests/acceptance/1941-redraft-3336/` once it exists, less any file
// scripts/lanes.mjs runs by hand or in a lane of its own (`byHand`, `ownLane`), since the unit lane never runs those.
//
// One run, in beforeAll, serves both tests. The copy is made in the OS temp folder, never in this checkout: the tree
// under test's files (no `.git`, `target/`, `node_modules/` or `.claude/`) cloned copy-on-write with their times
// (macOS's `cp -c`), `target/debug/` cloned beside them so the copy's cargo build starts warm, and `node_modules` a link
// to the tree under test's. A fresh git repository in the copy commits that tree, so `git status` is clean by
// construction before the run. The taste files then run as the unit lane runs its Vitest files: Vitest from the copy's
// root with the repo's config, files one at a time, with a TMPDIR of this run's own and no CARGO_TARGET_DIR (the copy
// builds into its own `target/`). After it, f7adc8c8 reads `git status` in the copy; 7d4ab4ab reads which files the run
// wrote inside the copy (outside `.git`, `target/` and `node_modules`), and which folders outside it the run's output
// names that hold the screenshots.
//
// Only where files land and whether the tree changed are judged here, never whether #1941's own test passes.
// INCONCLUSIVE, never PASS: off macOS (the taste test draws on Metal); no taste file the unit lane runs; a run cut short
// by this file's deadline, or that ran no taste test; a run that drew no screenshot anywhere. The tree changing, or a
// file written into the copy, fails whether or not the run finished.
//
// Wrong program: the base, whose taste test writes its 28 screenshots to `docs/evidence/1941/` in the checkout
// (README.md, BASE-FAILURE.txt).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TREE_ID = '#3336.f7adc8c8';
const WHERE_ID = '#3336.7d4ab4ab';
/** The tree under test: this file is three levels below its root. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIRST_DRAFT = 'tests/acceptance/1941/taste.test.ts';
const REDRAFT = 'tests/acceptance/1941-redraft-3336/';

// The whole file runs under the lane's 20-minute cap: the child run must end 14 minutes after this file started, the
// setup hook by 15, each test reads saved results in seconds, and the copy's removal has 3 minutes.
const STARTED = Date.now();
const CHILD_ENDS_BY = STARTED + 14 * 60_000;
const SETUP_TIMEOUT = 15 * 60_000;
const TEST_TIMEOUT = 30_000;
const CLEANUP_TIMEOUT = 3 * 60_000;

interface Run {
  skip?: string; // why it can't be judged here (INCONCLUSIVE)
  files: string[]; // the taste files run, relative to the root
  status: string[]; // `git status --porcelain` lines in the copy after the run
  writtenInCopy: string[]; // files the run wrote inside the copy, relative to its root
  cutShort?: string; // why the run didn't finish
  ran: number; // taste tests that ran (passed or failed)
  named: string[]; // folders outside the copy the output names that hold PNGs
  pngsNamed: string[]; // PNGs in those folders
  pngsInTmp: string[]; // PNGs under the run's own TMPDIR
  pngsInCopy: string[]; // PNGs the run wrote inside the copy
  log: string;
}

let work = '';
let run: Run | undefined;

const inconclusive = (reason: string): never => expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
const tail = (s: string, n = 1500) => (s.length > n ? `…${s.slice(-n)}` : s);
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
const within = (p: string, root: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/** Git in the copy only: none of the caller's repository variables, hooks, signing or filesystem monitor. */
function git(cwd: string, args: string[], timeout = 300_000) {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  const r = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.fsmonitor=false',
    '-c', 'user.name=deepbuild 3336', '-c', 'user.email=3336@invalid', '-c', 'init.defaultBranch=main', ...args],
  { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout, killSignal: 'SIGKILL' });
  if (r.error || r.status !== 0) throw Error(`git ${args.join(' ')} in the copy: ${r.error?.message ?? `exit ${r.status}`} ${tail(r.stderr ?? '', 800)}`);
  return r.stdout;
}

/** A copy-on-write clone with times kept (macOS `cp -c`). */
function clone(from: string, to: string): void {
  const r = spawnSync('/bin/cp', ['-c', '-R', '-p', from, to], { encoding: 'utf8', timeout: 300_000, killSignal: 'SIGKILL' });
  if (r.error || r.status !== 0) throw Error(`cp -c -R -p ${from}: ${r.error?.message ?? `exit ${r.status}`} ${tail(r.stderr ?? '', 800)}`);
}

/** The taste files the unit lane runs in the tree under test. */
async function tasteFiles(): Promise<string[]> {
  const candidates = [
    ...(existsSync(join(REPO, FIRST_DRAFT)) ? [FIRST_DRAFT] : []),
    ...(existsSync(join(REPO, REDRAFT)) ? walk(join(REPO, REDRAFT), 8).map((f) => relative(REPO, f).split(sep).join('/')).filter((f) => f.endsWith('.test.ts')) : []),
  ];
  const lanes = (await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href)) as { byHand: string[]; ownLane: string[] };
  const listed = (file: string) => [...lanes.byHand, ...lanes.ownLane].some((e) => (e.endsWith('/') ? file.startsWith(e) : file === e));
  return candidates.filter((f) => !listed(f)).sort();
}

/** Every file below `dir`, links not followed, at most `budget.left` entries read. */
function walk(dir: string, depth: number, budget = { left: 50_000 }): string[] {
  if (depth < 0 || budget.left <= 0) return [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  budget.left -= entries.length;
  return entries.flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), depth - 1, budget) : e.isFile() ? [join(dir, e.name)] : []));
}
const pngs = (dir: string) => walk(dir, 8).filter((f) => f.toLowerCase().endsWith('.png'));

/** Every PID below `pid`, by `ps`. */
function descendants(pid: number): number[] {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  const kids = new Map<number, number[]>();
  for (const line of (ps.stdout ?? '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)/.exec(line);
    if (m) kids.set(Number(m[2]), [...(kids.get(Number(m[2])) ?? []), Number(m[1])]);
  }
  const out: number[] = [];
  const queue = [pid];
  while (queue.length) for (const k of kids.get(queue.shift()!) ?? []) { out.push(k); queue.push(k); }
  return out;
}

/** The child Vitest, ended by SIGKILL (it and every process below it, by PID) at the deadline. */
function child(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ log: string; code: number | null; signal: string | null; killed: boolean }> {
  return new Promise((done) => {
    const c = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    let killed = false;
    c.stdout.setEncoding('utf8').on('data', (d: string) => { if (log.length < 32e6) log += d; });
    c.stderr.setEncoding('utf8').on('data', (d: string) => { if (log.length < 32e6) log += d; });
    const timer = setTimeout(() => {
      killed = true;
      for (const p of [...descendants(c.pid!), c.pid!]) try { process.kill(p, 'SIGKILL'); } catch { /* gone */ }
    }, Math.max(0, CHILD_ENDS_BY - Date.now()));
    c.on('close', (code, signal) => { clearTimeout(timer); done({ log, code, signal, killed }); });
  });
}

/** Absolute paths (or `~/…`) the text names, as whole words: not the tail of a relative path. */
function namedPaths(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s'"`=(\[,:])((?:~|\/)[^\s'"`,;()[\]{}<>]*)/gm)) {
    let p = m[1]!.replace(/[.:]+$/, '');
    if (p.startsWith('~')) p = join(homedir(), p.slice(1));
    if (p.length > 1) found.add(p);
  }
  return [...found];
}

beforeAll(async () => {
  if (process.platform !== 'darwin') { run = blank(`#1941's taste test draws its scenes on macOS's Metal device; this is ${process.platform}`); return; }
  const files = await tasteFiles();
  if (!files.length) { run = blank(`the unit lane runs no #1941 taste file in this tree (neither ${FIRST_DRAFT} nor a test file under ${REDRAFT})`); return; }

  work = mkdtempSync(join(tmpdir(), 'deep-3336-'));
  const copy = join(work, 'copy');
  const runTmp = join(work, 'tmp');
  const report = join(work, 'report.json');
  mkdirSync(copy);
  mkdirSync(runTmp);
  try {
    for (const name of readdirSync(REPO)) if (!['.git', 'target', 'node_modules', '.claude'].includes(name)) clone(join(REPO, name), join(copy, name));
    const target = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
    if (existsSync(join(target, 'debug'))) {
      mkdirSync(join(copy, 'target', 'debug'), { recursive: true });
      for (const name of readdirSync(join(target, 'debug'))) if (name !== 'incremental') clone(join(target, 'debug', name), join(copy, 'target', 'debug', name));
    }
    if (existsSync(join(REPO, 'node_modules'))) symlinkSync(real(join(REPO, 'node_modules')), join(copy, 'node_modules'));
    git(copy, ['init', '-q']);
    writeFileSync(join(copy, '.git', 'info', 'exclude'), '/node_modules\n/target/\n');
    git(copy, ['add', '-A']);
    git(copy, ['commit', '-q', '--no-verify', '-m', 'the tree under test']);
    const before = git(copy, ['status', '--porcelain', '--untracked-files=all']);
    if (before.trim()) throw Error(`the copy is not clean before the run:\n${before}`);
  } catch (e) {
    run = blank(`the clean copy could not be made: ${(e as Error).message}`);
    return;
  }

  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(VITEST|TINYPOOL|GIT_)/.test(k) && k !== 'CARGO_TARGET_DIR') env[k] = v;
  Object.assign(env, { TMPDIR: runTmp, NO_COLOR: '1', FORCE_COLOR: '0', CARGO_INCREMENTAL: env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' });
  const stamp = join(work, 'stamp');
  writeFileSync(stamp, '');
  const c = await child(copy, [join(copy, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--no-file-parallelism', ...files,
    '--reporter=verbose', '--reporter=json', `--outputFile.json=${report}`], env);
  writeFileSync(join(work, 'child.log'), c.log);

  const status = git(copy, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter((l) => l !== '');
  const found = spawnSync('/usr/bin/find', [copy, '(', '-path', join(copy, '.git'), '-o', '-path', join(copy, 'target'), '-o', '-path', join(copy, 'node_modules'), ')', '-prune',
    '-o', '-type', 'f', '-newer', stamp, '-print'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  const writtenInCopy = (found.stdout ?? '').split('\n').filter((l) => l !== '').map((f) => relative(copy, f).split(sep).join('/')).sort();

  let ran = 0;
  let reportText = '';
  if (existsSync(report)) {
    reportText = readFileSync(report, 'utf8');
    const json = JSON.parse(reportText) as { testResults?: { assertionResults?: { status: string }[] }[] };
    ran = (json.testResults ?? []).flatMap((f) => f.assertionResults ?? []).filter((a) => a.status === 'passed' || a.status === 'failed').length;
  }
  const cutShort = c.killed ? `the run was stopped at this file's deadline, ${Math.round((CHILD_ENDS_BY - STARTED) / 60_000)} minutes after it started`
    : !existsSync(report) ? `the child Vitest wrote no report (exit ${c.code ?? c.signal}): ${tail(c.log)}`
      : c.signal ? `the child Vitest ended on ${c.signal}` : undefined;

  const copyReal = real(copy);
  const named = namedPaths(`${c.log}\n${reportText}`).filter((p) => existsSync(p)).map((p) => real(statSync(p).isDirectory() ? p : dirname(p)))
    .filter((p) => !within(p, copyReal) && !within(copyReal, p) && !within(p, real(REPO)) && !within(real(REPO), p) && p.split(sep).length > 3 && p !== real(tmpdir()) && p !== real(homedir()))
    .filter((p, i, all) => all.indexOf(p) === i && pngs(p).length > 0).sort();
  run = {
    files, status, writtenInCopy, ...(cutShort ? { cutShort } : {}), ran, named,
    pngsNamed: [...new Set(named.flatMap(pngs).map(real))].sort(),
    pngsInTmp: pngs(runTmp).map(real).sort(),
    pngsInCopy: writtenInCopy.filter((f) => f.toLowerCase().endsWith('.png')),
    log: c.log,
  };
  console.log(`#3336: ran ${files.join(', ')} in a clean copy; ${ran} taste test(s) ran${cutShort ? `; ${cutShort}` : ''}\n` +
    `  git status after: ${status.length ? `\n    ${status.join('\n    ')}` : 'clean'}\n` +
    `  written inside the copy: ${writtenInCopy.length ? `\n    ${writtenInCopy.join('\n    ')}` : 'nothing'}\n` +
    `  folders the run names outside the copy, with PNGs: ${named.length ? named.join(', ') : 'none'}; PNGs under the run's TMPDIR: ${run.pngsInTmp.length}`);
}, SETUP_TIMEOUT);

afterAll(async () => {
  if (!work) return;
  // Asynchronous, so a multi-GB copy under load doesn't block the worker; bounded by the hook's timeout.
  await new Promise<void>((done) => spawn('/bin/rm', ['-rf', work], { stdio: 'ignore' }).on('close', () => done()));
  work = '';
}, CLEANUP_TIMEOUT);

function blank(skip: string): Run {
  return { skip, files: [], status: [], writtenInCopy: [], ran: 0, named: [], pngsNamed: [], pngsInTmp: [], pngsInCopy: [], log: '' };
}
function judged(): Run {
  if (!run) throw Error('the run never happened');
  if (run.skip) inconclusive(run.skip);
  return run;
}
/** No screenshot anywhere: inside the copy, under the run's TMPDIR, or in a folder the run names. */
const drewNothing = (r: Run) => !r.pngsInCopy.length && !r.pngsInTmp.length && !r.pngsNamed.length;

describe("#3336 a unit lane run of #1941's taste test, from a clean copy", () => {
  it(`${TREE_ID} after the unit lane runs #1941's taste test in a clean copy, git status there is clean: the tree is the tree it started on`, () => {
    const r = judged();
    expect(r.status, `git status in the copy after the unit lane ran ${r.files.join(', ')}: these paths changed`).toEqual([]);
    if (r.cutShort) inconclusive(`the tree is unchanged so far, but ${r.cutShort}`);
    if (!r.ran) inconclusive(`no taste test ran: ${tail(r.log)}`);
    if (drewNothing(r)) inconclusive(`the run drew no screenshot, so it never reached the writes this criterion is about: ${tail(r.log)}`);
  }, TEST_TIMEOUT);

  it(`${WHERE_ID} #1941's screenshots are written outside the checkout, to a temp or run folder the run names, and nothing is written inside it`, () => {
    const r = judged();
    expect(r.writtenInCopy, `files the unit lane's run of ${r.files.join(', ')} wrote inside the checkout (outside .git, target/ and node_modules)`).toEqual([]);
    if (r.cutShort) inconclusive(`nothing was written inside the checkout so far, but ${r.cutShort}`);
    if (!r.ran) inconclusive(`no taste test ran: ${tail(r.log)}`);
    if (drewNothing(r)) inconclusive(`the run drew no screenshot anywhere: ${tail(r.log)}`);
    expect(r.named, `the run names a folder outside the checkout that holds its screenshots (PNGs under its TMPDIR: ${r.pngsInTmp.length})`).not.toEqual([]);
    const unnamed = r.pngsInTmp.filter((p) => !r.named.some((d) => within(p, d)));
    expect(unnamed, `screenshots written to the run's temp folder in no folder its output names (named: ${r.named.join(', ')})`).toEqual([]);
  }, TEST_TIMEOUT);
});
