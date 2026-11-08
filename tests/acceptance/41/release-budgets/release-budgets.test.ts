// AC8 #41.3f039c53: "The release preflight runs every recorded budget task on the release commit and on the last
// release's and fails any whose p50 rose more than the set margin, naming the task and both commits; a candidate
// whose projection rebuild is 30% slower than the last release, though every change stayed within its merge-base
// margin, fails, naming the task."
// AC11 #41.7e92e81e: "A release fails when hook overhead or the hub's idle CPU is worse than the last release's by
// more than the set margin."
//
// Surface assumed (the issue and design name no code surface, so this is the one the tests pin):
//   node scripts/release-budgets.mjs --candidate <sha> [--last-release <sha>] [--tasks a,b] [--rounds n] [--repo <dir>]
//   - --repo is the git repository whose commits are measured; it defaults to the checkout the script lives in.
//   - Each task is a budget task recorded in that repository's benchmarks/budgets.json (the same shape perf and
//     scripts/benchmark.mjs read: id, command run from the tree's root, margin, limits, initialReason), and runs on
//     each commit's own tree, through the harness scripts/benchmark.mjs measures with. Without --tasks every recorded
//     task runs; --tasks a,b runs only those ids. --rounds n is the number of timed rounds a side.
//   - The release margin is budgets.json's top-level `release.margin`, a fraction, not a task's merge-base `margin`.
//   - A task fails when its p50 on the candidate rose more than the release margin over its p50 on the last release.
//     hub-idle fails when the hub's idle CPU got worse by more than that margin (its wall time does not move), and
//     deep-hook-overhead when the hook overhead did; how the CPU and the overhead are read (the task's last stdout
//     JSON line, or the CPU time of the measured command) is the harness's choice.
//   - Each failing task gets one output line containing "FAIL", the task id, and both commits (the full sha or a
//     prefix of at least 7 hex digits); a p50 failure's line also says "p50" with both p50s. Any FAIL exits non-zero;
//     no FAIL line and exit 0 when every task stays within the margin.
//   - Without --last-release, the last release is the commit of the git tag release/<version> with the highest
//     version, compared as numbers part by part (release/0.10.0 is newer than release/0.9.0), whatever the tags'
//     dates or their text order. With no release/* tag it refuses: non-zero, saying "no last release", measuring
//     nothing.
// The tests build a throwaway git repository with three tiny fake tasks named after the real ones
// (record-learn-rebuild-10k, the projection rebuild; deep-hook-overhead; hub-idle) and pass it with --repo.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compare } from '../../../../scripts/benchmark.mjs';

const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const script = join(root, 'scripts/release-budgets.mjs');
const RUN_MS = 300_000;
const MARGIN = 0.2;
const REBUILD = 'record-learn-rebuild-10k';
const OVERHEAD = 'deep-hook-overhead';
const IDLE = 'hub-idle';

// The fake tasks read what they do from work.json, so budgets.json stays byte-identical on every commit, as a frozen
// budget is: only the code's behavior changes between commits.
const FAKE = `import { readFileSync } from 'node:fs';
const work = JSON.parse(readFileSync(new URL('work.json', import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mode = process.argv[2];
if (mode === 'rebuild') {
  // The projection rebuild: its wall time is the work.
  const t = performance.now();
  await sleep(work.rebuildMs);
  console.log(JSON.stringify({ rebuildMs: performance.now() - t }));
} else if (mode === 'overhead') {
  // Ten hook calls, each taking hookMs.
  const each = [];
  for (let i = 0; i < 10; i++) { const t = performance.now(); await sleep(work.hookMs); each.push(performance.now() - t); }
  each.sort((a, b) => a - b);
  console.log(JSON.stringify({ overheadP95Ms: each[Math.ceil(each.length * 0.95) - 1] }));
} else if (mode === 'idle') {
  // The hub left idle for a fixed 300 ms window, using idleCpuMs of CPU in it: the wall time doesn't move with the CPU.
  const start = performance.now();
  const before = process.cpuUsage();
  const used = () => { const u = process.cpuUsage(before); return (u.user + u.system) / 1000; };
  while (used() < work.idleCpuMs) {}
  await sleep(Math.max(0, 300 - (performance.now() - start)));
  console.log(JSON.stringify({ idleCpuPercent: (used() / (performance.now() - start)) * 100 }));
} else process.exit(2);
`;

const task = (id: string, mode: string) => ({
  id,
  command: ['node', 'benchmarks/fake.mjs', mode],
  margin: 0.5,
  limits: {},
  initialReason: `Fake ${id} for the #41 release-budget acceptance tests.`,
});
const BUDGETS = `${JSON.stringify({
  release: { margin: MARGIN, initialReason: 'Fake release margin for the #41 release-budget acceptance tests.' },
  tasks: [task(REBUILD, 'rebuild'), task(OVERHEAD, 'overhead'), task(IDLE, 'idle')],
}, null, 2)}\n`;
const PACKAGE = `${JSON.stringify({ name: 'fake-release', version: '0.0.0', private: true, scripts: { build: 'true' } }, null, 2)}\n`;
const LOCK = `${JSON.stringify({ name: 'fake-release', version: '0.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'fake-release', version: '0.0.0' } } }, null, 2)}\n`;
// The last release's behavior. 25 ms hook calls; 60 ms of CPU in the 300 ms idle window (20%).
const RELEASED = { rebuildMs: 300, hookMs: 25, idleCpuMs: 60 };

const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(): { dir: string; git: (...args: string[]) => string; commit: (work: object, message: string, extra?: Record<string, string>) => string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-release-budgets-41-')));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'user.name=DeepBuild test', '-c', 'user.email=test@example.invalid', ...args], { cwd: dir, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const commit = (work: object, message: string, extra: Record<string, string> = {}) => {
    write('benchmarks/budgets.json', BUDGETS);
    write('benchmarks/fake.mjs', FAKE);
    write('benchmarks/work.json', `${JSON.stringify(work)}\n`);
    write('package.json', PACKAGE);
    write('package-lock.json', LOCK);
    for (const [path, content] of Object.entries(extra)) write(path, content);
    git('add', '-A');
    git('commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  return { dir, git, commit };
}

function release(args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env, timeout: RUN_MS - 20_000, maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { status: result.status, output, shown: `exit ${result.status} ${result.error ? `(${result.error.message})` : ''}\n${output}` };
}
const failLines = (output: string, id: string) => output.split('\n').filter((line) => line.includes('FAIL') && line.includes(id));
const naming = (output: string, id: string, a: string, b: string) => failLines(output, id).filter((line) => line.includes(a.slice(0, 7)) && line.includes(b.slice(0, 7)));

describe('AC8 #41.3f039c53 AC11 #41.7e92e81e release budgets against the last release', () => {
  let r: ReturnType<typeof repo>;
  const sha: Record<string, string> = {};

  beforeAll(() => {
    r = repo();
    // 0.9.0: an older release whose rebuild was already slow.
    sha.q = r.commit({ ...RELEASED, rebuildMs: 420 }, 'release 0.9.0');
    // 0.10.0, the last release.
    sha.last = r.commit(RELEASED, 'release 0.10.0');
    // Annotated tags whose dates and text order both point at 0.9.0: only a version order picks 0.10.0.
    const tag = (name: string, commit: string, date: string) => execFileSync('git', ['-c', 'tag.gpgsign=false', '-c', 'user.name=DeepBuild test', '-c', 'user.email=test@example.invalid', 'tag', '-a', name, '-m', name, commit], { cwd: r.dir, env: { ...env, GIT_COMMITTER_DATE: date } });
    tag('release/0.10.0', sha.last, '2026-01-01T00:00:00Z');
    tag('release/0.9.0', sha.q, '2026-02-01T00:00:00Z');
    // A candidate that changes nothing measured.
    sha.unchanged = r.commit(RELEASED, 'docs only', { 'README.md': 'A docs-only change.\n' });
    // The projection rebuild slowed in two changes, each well within its 50% merge-base margin: 300 → 360 → 420 ms.
    r.git('checkout', '-q', '--detach', sha.last);
    sha.slower1 = r.commit({ ...RELEASED, rebuildMs: 360 }, 'rebuild step 1');
    sha.slower = r.commit({ ...RELEASED, rebuildMs: 420 }, 'rebuild step 2');
    // Hook overhead and the hub's idle CPU worse; the hub-idle window's wall time is unchanged.
    r.git('checkout', '-q', '--detach', sha.last);
    sha.hooks = r.commit({ ...RELEASED, hookMs: 60, idleCpuMs: 150 }, 'hook and idle worse');
  }, 60_000);

  it('AC8 #41.3f039c53 an unchanged candidate passes every recorded task against the last release', () => {
    expect(existsSync(script), 'scripts/release-budgets.mjs exists').toBe(true);
    const run = release(['--repo', r.dir, '--candidate', sha.unchanged, '--last-release', sha.last, '--rounds', '7']);
    expect(run.output.split('\n').filter((line) => line.includes('FAIL')), run.shown).toEqual([]);
    expect(run.status, run.shown).toBe(0);
  }, RUN_MS);

  it('AC8 #41.3f039c53 a projection rebuild 30% slower than the last release fails, naming the task and both commits, though each change stayed within its merge-base margin', () => {
    expect(existsSync(script), 'scripts/release-budgets.mjs exists').toBe(true);
    // The premise, through the merge-base comparison perf uses: each change, and even the whole slowdown taken as one
    // change, is within the task's 50% merge-base margin.
    const budget = task(REBUILD, 'rebuild');
    for (const [now, then] of [[360, 300], [420, 360], [420, 300]]) expect(compare(budget, { p50Ms: now }, { p50Ms: then }, ['p50Ms'])).toEqual({ status: 'PASS' });

    const run = release(['--repo', r.dir, '--candidate', sha.slower, '--last-release', sha.last, '--rounds', '7']);
    expect(run.status, run.shown).not.toBe(0);
    const lines = naming(run.output, REBUILD, sha.slower, sha.last);
    expect(lines, `a FAIL line naming ${REBUILD}, ${sha.slower} and ${sha.last}\n${run.shown}`).not.toEqual([]);
    expect(lines.some((line) => /p50/i.test(line)), run.shown).toBe(true);
    // The tasks that didn't change don't fail.
    expect(failLines(run.output, OVERHEAD), run.shown).toEqual([]);
    expect(failLines(run.output, IDLE), run.shown).toEqual([]);
  }, RUN_MS);

  it('AC11 #41.7e92e81e a release fails when hook overhead and the hub idle CPU are worse than the last release by more than the margin, naming each', () => {
    expect(existsSync(script), 'scripts/release-budgets.mjs exists').toBe(true);
    const run = release(['--repo', r.dir, '--candidate', sha.hooks, '--last-release', sha.last, '--rounds', '7']);
    expect(run.status, run.shown).not.toBe(0);
    expect(naming(run.output, OVERHEAD, sha.hooks, sha.last), `a FAIL line naming ${OVERHEAD} and both commits\n${run.shown}`).not.toEqual([]);
    expect(naming(run.output, IDLE, sha.hooks, sha.last), `a FAIL line naming ${IDLE} and both commits\n${run.shown}`).not.toEqual([]);
    expect(failLines(run.output, REBUILD), run.shown).toEqual([]);
  }, RUN_MS);

  it('AC8 #41.3f039c53 without --last-release the last release is the highest release/* tag by version', () => {
    expect(existsSync(script), 'scripts/release-budgets.mjs exists').toBe(true);
    // release/0.10.0 (rebuild 300 ms) is the last release; release/0.9.0 (rebuild 420 ms, as the candidate's) is
    // newer by tag date and by text order, and comparing with it would pass.
    const run = release(['--repo', r.dir, '--candidate', sha.slower, '--tasks', REBUILD, '--rounds', '7']);
    expect(run.status, run.shown).not.toBe(0);
    expect(naming(run.output, REBUILD, sha.slower, sha.last), `a FAIL line naming ${REBUILD}, ${sha.slower} and release/0.10.0's ${sha.last}\n${run.shown}`).not.toEqual([]);
  }, RUN_MS);
});

describe('AC8 #41.3f039c53 no last release', () => {
  it('AC8 #41.3f039c53 refuses, saying there is no last release, when no release/* tag exists', () => {
    expect(existsSync(script), 'scripts/release-budgets.mjs exists').toBe(true);
    const r = repo();
    const head = r.commit(RELEASED, 'first');
    r.git('tag', 'v1.0.0', head);
    const run = release(['--repo', r.dir, '--candidate', head, '--rounds', '1']);
    expect(run.status, run.shown).not.toBe(0);
    expect(run.output, run.shown).toMatch(/no last release/i);
    expect(run.output, run.shown).not.toMatch(/\bPASS\b/);
  }, 60_000);
});
