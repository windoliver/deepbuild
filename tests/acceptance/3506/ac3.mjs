// Criterion 3 of #3506 (#3506.55c33ada), the body of its four suite tests; ac3-hashes-1637, -468, -419 and
// -971.test.mjs each run it for one suite, a suite a file: "On Metal, every frame of `tests/acceptance/1637/`,
// `tests/acceptance/468/`, `tests/acceptance/419/` and `tests/acceptance/971/` hashes the same as on the merge base"
//
// Read as #3507's suite and #3016's read the same words: every frame of a suite is every `pixel_hash` a child process
// of the suite prints while the suite runs whole, as its README runs it: `vitest run --root tests/acceptance/<n>
// --no-file-parallelism`, in this checkout, with #3507's recorder beside it (`../3507/record.config.mjs`,
// `../3507/record.mjs`, used as they are). Each child that prints a hash and is this checkout's own debug `deep-gpu`
// or `deep-show` is drawn once more by the merge base's build of that name (`DEEP_3506_BASE`'s target/debug), from
// the same command line and input, right after, on the same machine, and each frame must hash the same (#3507's
// `hashProblems`). Left out, and counted in the test's output: a suite's own planted programs (a child run with
// `--planted`), a child of another build, and the files the lanes run only under a timed grant or by hand
// (scripts/lanes-lists.mjs `timed`, `byHand`). Every other file of the suite must have run, or the test is BLOCKED.
// That the comparison fails a renderer that draws otherwise is ac3-planted-dof.test.mjs's.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashProblems } from '../3507/judge.mjs';
import { REPO, allow, blocked, builtHere, childEnv, inconclusive, left, mergeBase, referenceMac, settle, tempDir, underLease } from './drive.mjs';
import { AC } from './judge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TAG = `AC3 ${AC[3]}`;

/** Every `*.test.ts` under a folder, by its path from that folder. */
function testFiles(dir, under = '') {
  const out = [];
  for (const e of readdirSync(join(dir, under), { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const path = under ? `${under}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...testFiles(dir, path));
    else if (e.name.endsWith('.test.ts')) out.push(path);
  }
  return out.sort();
}

/** The suite's files the lanes run only under a timed grant or by hand, by their paths from the suite's folder. */
async function setApart(suite, files) {
  const lists = await import(pathToFileURL(join(REPO, 'scripts', 'lanes-lists.mjs')).href);
  const entries = [...lists.timed, ...lists.byHand];
  const listed = (path) => entries.some((e) => e === path || (e.endsWith('/') && path.startsWith(e)));
  return files.filter((f) => listed(`tests/acceptance/${suite}/${f}`));
}

/** The test of one suite; `t` is node:test's context, for what it prints. */
export async function sameFrames(suite, t) {
  allow(8 * 60);
  await referenceMac('a pixel hash');
  const base = mergeBase(['deep-gpu', 'deep-show']);
  const folder = join(REPO, 'tests', 'acceptance', suite);
  const files = testFiles(folder);
  const apart = await setApart(suite, files);
  const expected = files.filter((f) => !apart.includes(f));
  if (expected.length === 0) throw blocked(`tests/acceptance/${suite}/ holds no test file to run`);
  const vitest = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
  if (!existsSync(vitest)) throw blocked('vitest is not installed in this checkout (npm ci)');
  // This checkout's own builds, copied aside before the suite runs: the recorder knows a child as one of them by its bytes.
  const mine = builtHere();
  const dir = tempDir(`frames-${suite}`);
  const cache = join(folder, 'node_modules');
  const hadCache = existsSync(cache);
  try {
    const own = join(dir.dir, 'own');
    mkdirSync(own);
    for (const [name, path] of Object.entries(mine)) copyFileSync(path, join(own, name));
    const log = join(dir.dir, 'frames.jsonl');
    const report = join(dir.dir, 'report.json');
    const what = `the run of tests/acceptance/${suite}/`;
    const timeoutMs = left(what);
    // #3507's recorder reads its wiring from these four, which carry paths and a process ID and select no program.
    const env = childEnv({
      CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0',
      DEEP_3507_FRAMES: log, DEEP_3507_OWN_BIN: own, DEEP_3507_TWIN_BIN: base.debug, DEEP_3507_LEASE_PID: String(process.pid),
    });
    const config = join(HERE, '..', '3507', 'record.config.mjs');
    const args = [vitest, 'run', '--root', `tests/acceptance/${suite}`, '--config', config, '--no-file-parallelism', '--reporter=json', '--outputFile', report, ...apart.flatMap((f) => ['--exclude', f])];
    const run = await underLease('the frames', async () => spawnSync(process.execPath, args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' }));
    if (run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGKILL') throw inconclusive(`${what} hadn't ended after ${Math.round(timeoutMs / 60_000)} minutes and was stopped`);
    if (!existsSync(report)) throw blocked(`${what} wrote no report (vitest exited ${run.status}): ${String(run.stderr).slice(-2000)}`);
    const ran = new Set(JSON.parse(readFileSync(report, 'utf8')).testResults.map((r) => String(r.name)));
    const unrun = expected.filter((f) => ![...ran].some((name) => name.endsWith(`/tests/acceptance/${suite}/${f}`)));
    const rows = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : [];
    const { problems, frames } = hashProblems(suite, rows);
    const count = (kind) => rows.filter((r) => r.kind === kind).length;
    t.diagnostic(`tests/acceptance/${suite}/: ${frames} frames of ${count('paired')} children drawn by both builds (the merge base at ${base.commit.slice(0, 9)}); left out: ${count('planted')} planted children, ${count('other_build')} of another build, ${apart.length} files set apart (${apart.join(', ') || 'none'}); the suite's own vitest exited ${run.status}`);
    settle(`${TAG} tests/acceptance/${suite}/`, [
      ...unrun.map((f) => `BLOCKED: tests/acceptance/${suite}/${f} didn't run, so its frames weren't drawn`),
      ...problems,
    ], 40);
  } finally {
    dir.remove();
    // Vitest's cache, which a run with this root leaves in the suite's folder.
    if (!hadCache) rmSync(cache, { recursive: true, force: true });
  }
}
