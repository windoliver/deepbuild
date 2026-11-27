// Criterion 4 of #3507 (#3507.f3ae7c70), the body of its test; ac4-hashes-418, -424, -428, -465 and -1637.test.mjs
// each run it for one suite, a suite a file: "On Metal, every frame of `tests/acceptance/418/`,
// `tests/acceptance/424/`, `tests/acceptance/428/`, `tests/acceptance/465/` and `tests/acceptance/1637/` hashes the
// same as on the merge base"
//
// Every frame of a suite is every `pixel_hash` a child process of the suite prints while the suite runs whole, as
// its README runs it and as #3016's suite read the same words: `vitest run --root tests/acceptance/<n>
// --no-file-parallelism`, in this checkout, with this suite's recorder beside it (record.config.mjs, record.mjs). The
// suite's files, helpers and builds are its own, unedited. Each child that prints a hash and is this checkout's own
// debug `deep-gpu` or `deep-show` is drawn once more by the merge base's build of that name (`DEEP_3507_BASE`), from
// the same command line and the same input, right after, on the same machine: so the two lists of hashes are of the
// same frames by construction, and no hash is kept in a file. Each frame must hash the same (`hashProblems`).
//
// Left out, and counted in the test's output: a suite's own planted programs (a child run with `--planted`; wrong
// programs, not the renderer); a child that isn't this checkout's `target/debug` build (a feature build or a release
// build, which the merge base's checkout holds no twin of); and the files the lanes run only under a timed grant or
// by hand (scripts/lanes-lists.mjs `timed`, `byHand`), whose frames depend on the machine's load at that moment.
// Whether the suite's own tests pass is the suite's to say, not this test's; that every other file of the suite ran
// is held, so a run that stops early is BLOCKED.
//
// That the comparison can fail is shown in the same test: a frame of this suite's own (the two walls) drawn by this
// checkout's `deep-gpu` under the base's planted `draws_black`, a renderer that changes every pixel, is paired with
// the merge base's shipped frame, and `hashProblems` must fail the pair.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO, allow, blocked, builtHere, childEnv, gpuRun, inconclusive, left, mergeBase, referenceMac, settle, tempDir, underLease } from './drive.mjs';
import { WALL, hashProblems } from './judge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TAG = 'AC4 #3507.f3ae7c70';

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

/** That the comparison sees a changed pixel: this checkout's frame under `draws_black` against the merge base's. */
async function seesAChange(base, gpu) {
  const doc = join(HERE, 'fixtures', 'two-walls.nearer-first.json');
  const look = JSON.parse(readFileSync(join(REPO, 'tests', 'acceptance', '379', 'fixtures', 'look.json'), 'utf8'));
  const call = { call: 'view3d', look, doc, size: WALL.size, frames: 1, capture: [0] };
  const hashOf = async (bin, planted, what) => {
    const dir = tempDir('walls');
    try {
      const [reply] = await gpuRun(bin, dir.dir, [call], { planted, what });
      const hash = reply.frames?.[0]?.pixel_hash;
      if (typeof hash !== 'string') throw blocked(`${what} drew the two walls with no pixel hash: ${JSON.stringify(reply).slice(0, 600)}`);
      return hash;
    } finally { dir.remove(); }
  };
  const theirs = await hashOf(join(base.debug, 'deep-gpu'), null, 'deep-gpu run (the merge base, the two walls)');
  const black = await hashOf(gpu, 'draws_black', 'deep-gpu run --planted draws_black (this checkout, the two walls)');
  const row = { file: 'the two walls', child: 0, command: 'deep-gpu', args: ['run'], kind: 'paired', own: [black], base: [theirs], note: '' };
  const { problems } = hashProblems('3507', [row]);
  if (!problems.some((p) => p.startsWith('FAIL:') && p.includes('frame 0: hashes'))) return [`INVALID: the comparison passes a renderer that draws black: the two walls hash ${black} under draws_black and ${theirs} on the merge base, and the check found ${JSON.stringify(problems)}`];
  return [];
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
  // This checkout's own builds, as `cargo build --locked --bin <name>` leaves them, copied aside before the suite runs:
  // a suite's own feature build of deep-show lands on the same path in target/debug, and is no build of the merge
  // base's to be drawn again by. The recorder knows a child as the checkout's own by these copies' bytes.
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
    const env = childEnv({
      CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0',
      DEEP_3507_FRAMES: log, DEEP_3507_OWN_BIN: own, DEEP_3507_TWIN_BIN: base.debug, DEEP_3507_LEASE_PID: String(process.pid),
    });
    const args = [vitest, 'run', '--root', `tests/acceptance/${suite}`, '--config', join(HERE, 'record.config.mjs'), '--no-file-parallelism', '--reporter=json', '--outputFile', report, ...apart.flatMap((f) => ['--exclude', f])];
    const { run, changed } = await underLease('the frames', async () => ({
      run: spawnSync(process.execPath, args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' }),
      changed: await seesAChange(base, mine['deep-gpu']),
    }));
    if (run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGKILL') throw inconclusive(`${what} hadn't ended after ${Math.round(timeoutMs / 60_000)} minutes and was stopped`);
    if (!existsSync(report)) throw blocked(`${what} wrote no report (vitest exited ${run.status}): ${String(run.stderr).slice(-2000)}`);
    const ran = new Set(JSON.parse(readFileSync(report, 'utf8')).testResults.map((r) => String(r.name)));
    // By the path's end: a report may name a file by its real path, which a checkout under a link doesn't share.
    const unrun = expected.filter((f) => ![...ran].some((name) => name.endsWith(`/tests/acceptance/${suite}/${f}`)));
    const rows = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : [];
    const { problems, frames } = hashProblems(suite, rows);
    const count = (kind) => rows.filter((r) => r.kind === kind).length;
    t.diagnostic(`tests/acceptance/${suite}/: ${frames} frames of ${count('paired')} children drawn by both builds (the merge base at ${base.commit.slice(0, 9)}); left out: ${count('planted')} planted children, ${count('other_build')} of another build, ${apart.length} files set apart (${apart.join(', ') || 'none'}); the suite's own vitest exited ${run.status}`);
    settle(`${TAG} tests/acceptance/${suite}/`, [
      ...unrun.map((f) => `BLOCKED: tests/acceptance/${suite}/${f} didn't run, so its frames weren't drawn`),
      ...changed,
      ...problems,
    ], 40);
  } finally {
    dir.remove();
    // Vitest's cache, which a run with this root leaves in the suite's folder.
    if (!hadCache) rmSync(cache, { recursive: true, force: true });
  }
}
