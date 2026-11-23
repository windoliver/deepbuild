// #2513.296f5cfc: "`tests/acceptance/1939/` and `tests/acceptance/1938/machines.test.ts` pass unchanged"
//
// Behavior that must not change (design: Proven on the base): #1939's light readings and #1938's same-machine pixel
// verdicts, as their own suites judge them, once render.exposure's measure runs on one GPU reduction.
//
// asserts:
//   - unchanged: every file of tests/acceptance/1939/ (no more, no fewer, outside the runner's node_modules cache), and
//     tests/acceptance/1938/machines.test.ts with the helpers.ts it imports, are byte for byte the base's (5330aaf29),
//     by SHA-256 (README: What "unchanged" and "pass" mean);
//   - pass: each guarded test file, run as its README runs it (vitest with --root at its folder, one file at a time,
//     a JSON report), reports as many tests as the base holds (one each), and every one of them passed. A file that
//     writes no report, a test skipped, left todo or missing, or a test that failed, fails this test, naming each;
//   - a child test that failed with a message starting `INCONCLUSIVE:` (#1939's timing off a reference Mac at rest, no
//     cargo, no GPU) makes this test INCONCLUSIVE, never PASS; a failure outranks it.
// Wrong program (twins.json): `ev-sign-flipped`, the exposure an EV100 gives with its sign flipped, in a file
// byte-equal at the base and on a later main: render.exposure reads the under-exposed fixture over-exposed, so
// #1939's ac1 fails. An edited guarded file fails the first assertion (BASE-FAILURE.txt); twins can't replace test
// files.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The criterion's ID: `#2513.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#2513.296f5cfc';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARDED_FOLDER = 'tests/acceptance/1939';

/** The guarded files at the base, 5330aaf29, by SHA-256: all of tests/acceptance/1939/, and machines.test.ts with its helpers. */
const BASE: Record<string, string> = {
  'tests/acceptance/1939/BASE-FAILURE.txt': 'e2c9f95f9f63fdb2701809449e8c546b5adad6eaaf3ef09185db640c842d73ce',
  'tests/acceptance/1939/README.md': '0f8cdce72786f177e701ff4fdde306d460c79e001b70401bf39beaa3873235a5',
  'tests/acceptance/1939/ac1-readings.test.ts': '3ba25a28bea79b9857023e5939561117eff417215495182c86b6d4ba219e5261',
  'tests/acceptance/1939/ac2-budget.test.ts': '45e4d404ac99d008f7663211f07064561b73318d00f56c9d207950674648e197',
  'tests/acceptance/1939/helpers.ts': '793de6404099ff7174bd8defa5d992c26283222c6048d60fd20c7fdd7ad48ac3',
  'tests/acceptance/1939/tsconfig.json': 'c5b0031dc2191959d86202363d79087b03e941d881587792b08e308dc9e69c0a',
  'tests/acceptance/1938/machines.test.ts': '821b38b1e476253fb1f32e79b652fc68867d7ccf969f85c46287123281e74df9',
  'tests/acceptance/1938/helpers.ts': 'e8a659bd091481d6d81a07d190e60823a9e363e6cc6c4a31b1e60c63d6f6bf65',
};

/** The guarded test files in the order the criterion names them, each with the number of tests it holds at the base
 * (their names are fixed by the pins above; they aren't written here, so this file holds no other issue's criterion). */
const RUNS = [
  { root: 'tests/acceptance/1939', file: 'ac1-readings.test.ts', tests: 1 },
  { root: 'tests/acceptance/1939', file: 'ac2-budget.test.ts', tests: 1 },
  { root: 'tests/acceptance/1938', file: 'machines.test.ts', tests: 1 },
];
/** Each child builds deep-show (an hour or more on a loaded Mac) before its tests; its own `it` timeouts run to hours. */
const CHILD_TIMEOUT = 5 * 3_600_000;

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(join(REPO, path))).digest('hex');
/** Every file under `folder`, by repo path, leaving out the cache a vitest run with --root leaves in node_modules. */
function filesUnder(folder: string): string[] {
  return readdirSync(join(REPO, folder), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(REPO, join(e.parentPath, e.name)))
    .filter((path) => !path.split('/').includes('node_modules'))
    .sort();
}

/** A child's failure messages without their stacks, so no child frame reads as this test's own; each names where it failed. */
function told(messages: string[] = []): string {
  return messages.map((m) => {
    const lines = m.split('\n');
    const at = lines.findIndex((l) => /^\s+at /.test(l));
    if (at < 0) return m;
    return `${lines.slice(0, at).join('\n')} (${lines[at]!.trim().replace(/^at /, 'from ').split(`${REPO}/`).join('')})`;
  }).join('\n').slice(0, 1500);
}

interface Assertion { fullName: string; status: string; failureMessages?: string[] }
interface Report { testResults: { name: string; status: string; message?: string; assertionResults: Assertion[] }[] }
interface Judged { failures: string[]; inconclusive: string[] }

/** One guarded file run as its suite runs it, read from vitest's JSON report. */
function judge({ root, file, tests: held }: (typeof RUNS)[number]): Judged {
  const where = `${root}/${file}`;
  const dir = mkdtempSync(join(tmpdir(), 'deep-2513-redraft-'));
  try {
    const out = join(dir, 'report.json');
    const args = [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--root', root, '--no-file-parallelism', '--testTimeout=600000', '--reporter=json', `--outputFile=${out}`, file];
    // #1939's helpers find cargo in /opt/homebrew/opt/rustup/bin themselves; #1938's take PATH's, so it's on PATH too.
    const env = { ...process.env, NO_COLOR: '1', PATH: `${process.env['PATH'] ?? ''}${delimiter}/opt/homebrew/opt/rustup/bin` };
    const r = spawnSync(process.execPath, args, { cwd: REPO, env, encoding: 'utf8', timeout: CHILD_TIMEOUT, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
    let report: Report;
    try {
      report = JSON.parse(readFileSync(out, 'utf8')) as Report;
    } catch (error) {
      return { failures: [`${where} wrote no report it finished (exit ${r.status}, ${r.signal ?? 'no signal'}${r.error ? `, ${r.error.message}` : ''}; ${String(error)}): ${(r.stderr ?? '').slice(-1500)}`], inconclusive: [] };
    }
    const failures: string[] = [];
    const inconclusive: string[] = [];
    for (const t of report.testResults) {
      if (t.status === 'failed' && t.assertionResults.every((a) => a.status !== 'failed')) failures.push(`${where} failed outside its tests: ${(t.message ?? '').slice(0, 1500)}`);
    }
    const tests = report.testResults.flatMap((t) => t.assertionResults);
    if (tests.length !== held) failures.push(`${where} reported ${tests.length} tests (${tests.map((a) => a.fullName.slice(0, 120)).join('; ')}), where the base holds ${held}`);
    for (const a of tests) {
      if (a.status === 'passed') continue;
      const first = (a.failureMessages ?? []).join('\n').split('\n')[0] ?? '';
      if (a.status === 'failed' && /^(?:[\w$]*Error: )?INCONCLUSIVE: /.test(first)) inconclusive.push(`${where}: ${a.fullName.slice(0, 200)}: ${first.slice(0, 600)}`);
      else failures.push(`${where}: ${a.fullName.slice(0, 200)} is ${a.status}: ${told(a.failureMessages)}`);
    }
    return { failures, inconclusive };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe(`${ID} #1939's suite and #1938's machines.test.ts pass unchanged`, () => {
  it(`${ID} tests/acceptance/1939/ and tests/acceptance/1938/machines.test.ts are the base's files, and every test in them passes`, () => {
    // Unchanged: the base's files, byte for byte, and no file added to or gone from #1939's folder.
    const now = new Set([...filesUnder(GUARDED_FOLDER), ...Object.keys(BASE).filter((path) => existsSync(join(REPO, path)))]);
    const changed = [...new Set([...Object.keys(BASE), ...now])].sort().flatMap((path) => {
      if (!(path in BASE)) return [`${path} is new`];
      if (!now.has(path)) return [`${path} is gone`];
      const sha = sha256(path);
      return sha === BASE[path] ? [] : [`${path} is ${sha}, not the base's ${BASE[path]}`];
    });
    expect(changed, `the guarded files are the base's (5330aaf29), unchanged:\n  ${changed.join('\n  ')}`).toEqual([]);

    // Pass: each guarded file in turn, as its suite runs it. A failure ends the run; INCONCLUSIVE reads on.
    const inconclusive: string[] = [];
    for (const run of RUNS) {
      const judged = judge(run);
      console.log(`PROOF #2513 ${run.root}/${run.file}: ${JSON.stringify(judged)}`);
      inconclusive.push(...judged.inconclusive);
      const failures = [...judged.failures, ...inconclusive.map((line) => `(and INCONCLUSIVE) ${line}`)];
      expect(judged.failures, `${run.root}/${run.file} passes unchanged, every test in it:\n  ${failures.join('\n  ')}`).toEqual([]);
    }
    if (inconclusive.length) expect.fail(`INCONCLUSIVE: a guarded test can't be judged on this machine, so this is not a pass:\n  ${inconclusive.join('\n  ')}`);
  }, RUNS.length * CHILD_TIMEOUT + 600_000);
});
