// #2740.90748b6c: "`tests/acceptance/1463/` passes as it does on main"
//
// The issue's Proof is the whole suite's run on main, and on a `clock` that writes UTC; its Scope, the whole suite run
// with the formatter-free `clock` and `when`, its 100 ms timing read on a fit reference Mac (README: What the test holds).
//
// asserts, in order:
//   - main's suite: every file of tests/acceptance/1463/ as git lists it (tracked, or untracked and not ignored), and
//     every file under tests/ those files import, near and far, holds main's bytes (git's blob ID at the merge base
//     with origin/main), with no file added to the folder or gone from it. Else FAIL, naming each, before any run;
//   - the whole suite run as its README runs it (vitest --root tests/acceptance/1463 --no-file-parallelism): its cases
//     listed by vitest first without running them, then read row by row from vitest's JSON report (judge.ts): every
//     listed case has its row and passed, every test file of the suite was reported, and nothing ran unlisted;
//   - a case that failed fails this test at its assertion, naming each. A case that names its own state (BLOCKED,
//     INVALID, or INCONCLUSIVE, as the 100 ms timing reads off a fit, quiet reference Mac), was skipped, left todo or
//     never ran makes this test that state, never PASS. FAIL outranks INVALID, then BLOCKED, then INCONCLUSIVE.
// Wrong program (twins.json): utc-clock, `clock` writing the hours and minutes of UTC. The suite's cases for the hub
// that isn't answering since when, the ask's default line and `deep inbox undo` read UTC, so they fail, and this test.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { blobId, differences, judgeRun, verdict, withTestImports, type Listed, type Report } from './judge.ts';

/** The criterion's ID: `#2740.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs, criterionId). */
const ID = '#2740.90748b6c';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SUITE = 'tests/acceptance/1463';
/** The suite's own test timeouts add up to about 6.6 hours; a run still going after this is stopped and reads BLOCKED. */
const RUN_MS = 7 * 3_600_000;
const LIST_MS = 10 * 60_000;

const blocked = (why: string): never => {
  throw Error(`BLOCKED: ${why}`);
};

/** git in the checkout, with no GIT_* variable from around the run choosing another repository, tree or index. */
function git(args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  const r = spawnSync('git', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) blocked(`git ${args.join(' ')} failed in ${REPO}: ${(r.error?.message ?? r.stderr ?? '').trim().slice(0, 600)}`);
  return r.stdout;
}
const readText = (path: string): string | null => {
  try {
    return readFileSync(join(REPO, path), 'utf8');
  } catch {
    return null;
  }
};
const isFile = (path: string): boolean => {
  try {
    return statSync(join(REPO, path)).isFile();
  } catch {
    return false;
  }
};

/** A command run to its end, or stopped past `ms` by its own PID: SIGTERM, so vitest stops its workers, then SIGKILL. */
function runFor(args: string[], env: NodeJS.ProcessEnv, ms: number): Promise<{ exit: number | null; stopped?: string; tail: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = (text: string): void => void (tail = (tail + text).slice(-200_000));
    child.stdout.setEncoding('utf8').on('data', keep);
    child.stderr.setEncoding('utf8').on('data', keep);
    let stopped: string | undefined;
    let hard: NodeJS.Timeout | undefined;
    // deadline: bounds the suite's run at RUN_MS, past the sum of its own test timeouts; it never waits for time to pass.
    const deadline = setTimeout(() => {
      stopped = `it was still running after ${ms / 3_600_000} hours`;
      child.kill('SIGTERM');
      // deadline: a runner that ignores SIGTERM for a minute is killed.
      hard = setTimeout(() => child.kill('SIGKILL'), 60_000);
    }, ms);
    child.on('error', (error) => keep(`\n${error.message}`));
    child.on('close', (code) => {
      clearTimeout(deadline);
      clearTimeout(hard);
      resolve({ exit: code, ...(stopped ? { stopped } : {}), tail });
    });
  });
}

describe(`${ID} tests/acceptance/1463/ passes as it does on main`, () => {
  test(`${ID} tests/acceptance/1463/ is main's, and run whole as its README runs it, every case it lists runs and passes`, async () => {
    // Main's suite: the folder and the test files it imports, byte for byte, against the merge base with origin/main.
    const base = git(['merge-base', 'HEAD', 'origin/main']).trim();
    const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', SUITE]).split('\0').filter((path) => path && isFile(path));
    if (!files.length) blocked(`git lists no file under ${SUITE}`);
    const reached = withTestImports(files, readText);
    const here = new Map(reached.map((path) => [path, blobId(readFileSync(join(REPO, path)))]));
    const main = new Map(git(['ls-tree', '-r', '-z', base, '--', SUITE, ...reached.filter((path) => !path.startsWith(`${SUITE}/`))])
      .split('\0').filter(Boolean).map((entry) => {
        const [meta = '', path = ''] = entry.split('\t');
        return [path, meta.split(' ')[2] ?? ''] as const;
      }));
    const changed = differences(here, main);
    console.log(`PROOF #2740 main's suite: ${reached.length} files against merge base ${base}; ${changed.length} differ`);
    expect(changed, `FAIL: ${SUITE}/ and the test files it imports must be main's (merge base ${base}), byte for byte:\n  ${changed.join('\n  ')}`).toEqual([]);

    const scratch = mkdtempSync(join(tmpdir(), 'deep-2740-'));
    try {
      const vitest = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
      const env = { ...process.env, NO_COLOR: '1' };
      // The cases vitest finds, collected without running them (a static parse can't read names built from constants).
      const listFile = join(scratch, 'list.json');
      const list = spawnSync(process.execPath, [vitest, 'list', '--root', SUITE, '--staticParse=false', `--json=${listFile}`],
        { cwd: REPO, env, encoding: 'utf8', timeout: LIST_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
      let listed: Listed[] | string;
      try {
        listed = list.status === 0 ? (JSON.parse(readFileSync(listFile, 'utf8')) as Listed[]) : `exit ${list.status ?? list.signal}: ${`${list.stderr ?? ''}${list.stdout ?? ''}`.slice(-1500)}`;
      } catch (error) {
        listed = `${(error as Error).message}; ${(list.stderr ?? '').slice(-1500)}`;
      }

      // The whole suite, as its README runs it, with vitest's JSON report beside its usual output.
      const reportFile = join(scratch, 'report.json');
      const started = Date.now();
      const ran = await runFor([vitest, 'run', '--root', SUITE, '--no-file-parallelism', '--reporter=default', '--reporter=json', `--outputFile.json=${reportFile}`], env, RUN_MS);
      console.log(`PROOF #2740 the suite ran ${((Date.now() - started) / 60_000).toFixed(1)} min, exit ${ran.exit}${ran.stopped ? `, stopped: ${ran.stopped}` : ''}\n${ran.tail.slice(-3000)}`);
      let report: Report | string;
      try {
        report = JSON.parse(readFileSync(reportFile, 'utf8')) as Report;
      } catch (error) {
        report = `${(error as Error).message}; its output ends: ${ran.tail.slice(-1500)}`;
      }

      const tests = files.filter((path) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path));
      const { findings, cases } = judgeRun(REPO, { files: tests, listed, report, exit: ran.exit, ...(ran.stopped ? { stopped: ran.stopped } : {}) });
      for (const c of cases) console.log(`PROOF #2740 ${c.state} ${c.key}${c.why ? `: ${c.why}` : ''}`);
      const state = verdict(findings);
      console.log(`PROOF #2740 ${state}: ${cases.length} cases, ${cases.filter((c) => c.state === 'PASS').length} passed, ${findings.length} findings`);
      const fails = findings.filter((f) => f.state === 'FAIL').map((f) => f.line);
      const besides = findings.filter((f) => f.state !== 'FAIL').map((f) => `(${f.state}) ${f.line}`);
      expect(fails, `FAIL: ${SUITE}/ must pass whole, every case:\n  ${fails.join('\n  ')}${besides.length ? `\nand besides:\n  ${besides.join('\n  ')}` : ''}`).toEqual([]);
      if (state !== 'PASS') throw Error(`${state}: ${SUITE}/ can't be judged a pass here:\n  ${besides.join('\n  ')}`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, RUN_MS + LIST_MS + 15 * 60_000);
});
