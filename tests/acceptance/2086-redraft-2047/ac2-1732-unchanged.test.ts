// AC2 #2086.a865933b: "An operator's error still reaches its issue with what the operator found: #1732's suite passes
// unchanged"
//
// Behavior that must not change: #1732 gave an operator's error what the operator found (the relations an arrangement
// still misses), and #2086 shrinks that error under clippy's Err size limit. #1732's suite is the criterion's own check:
// its six-chairs refusal reads the found relations off the revision's issue.
//
// asserts:
//   - unchanged: every file of tests/acceptance/1732/ but its prose (.md, .txt) and the cache a vitest run with --root
//     leaves under node_modules, no more and no fewer, is byte for byte the base's (c52dc3e73), by SHA-256;
//   - passes: the suite run as its README runs it (vitest with --root at its folder, one file at a time), read from
//     vitest's JSON report, reports the base's 9 tests in its 5 files, and every one passed. A file that reports no
//     test or fails outside its tests, a test skipped, todo, missing or failed, fails this test, naming each.
// A child test that failed with a message starting `INCONCLUSIVE:`, or whose message says the machine stopped it (its
// deep-show build killed, a full disk, no toolchain), makes this test INCONCLUSIVE, never PASS; a failure outranks it.
// This file names no criterion of #1732, so the closed-issue sweep never reads it as holding #1732's criteria.
// Wrong program (twins.json): `found-dropped`, the scheduler turning an operator's error into its issue without what
// the operator found: #1732's six-chairs refusal names no missed relation, so its test fails and this one with it. An
// edited, added or removed suite file fails the unchanged assertion; twins can't replace test files.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC2, REPO, cargoEnv, inconclusive, none, worldLine } from './helpers.ts';

const SUITE = 'tests/acceptance/1732';
/** The suite's files at the base, c52dc3e73, by SHA-256. */
const BASE: Record<string, string> = {
  'tests/acceptance/1732/ac1-room.test.ts': '4aac2372a7ce7c2d5cf5180eb47fcd9baf537c3cb4a516fafe90c090697af6c6',
  'tests/acceptance/1732/ac2-stacked.test.ts': 'b0330f65b89efb5fc7b1928c79fba8cb9d18de1c0f1a446f539c3f8b2184337c',
  'tests/acceptance/1732/ac3-six-chairs.test.ts': '34ac71ab2b223be28c34d171de3c804974954a1f7ca0c563aec7b5fbf87fca76',
  'tests/acceptance/1732/ac4-no-solve-per-frame.test.ts': '6a3a8b2a648fff530044456130a8e5a90a19fd114e3b2ee6dd8b7dd9c563c623',
  'tests/acceptance/1732/ac5-break-out.test.ts': '12d707e43c9897147408d9f5fe56c4cff2e177e1fc82902bff83cb0587c02b07',
  'tests/acceptance/1732/helpers.ts': 'f5818c8ab725f83a4ae10a3d253e561f7c3643421dca463306f5f59cd28e79ed',
  'tests/acceptance/1732/tsconfig.json': '5d625241c741d480e7c662c1af14ea3031735dcb844684145f77ef65167308f1',
};
/** The tests each file holds at the base (the pins fix their names, which this file doesn't write). */
const TESTS: Record<string, number> = { 'ac1-room.test.ts': 2, 'ac2-stacked.test.ts': 2, 'ac3-six-chairs.test.ts': 1, 'ac4-no-solve-per-frame.test.ts': 2, 'ac5-break-out.test.ts': 2 };
/** The suite builds deep-show before its tests (an hour or more cold on a loaded Mac); its own limits run to 30 min a test. */
const CHILD_LIMIT = 5 * 3_600_000;

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(join(REPO, path))).digest('hex');
/** The suite's files by repo path, leaving out its prose and the cache a vitest run with --root leaves in node_modules. */
const suiteFiles = (): string[] => readdirSync(join(REPO, SUITE), { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => relative(REPO, join(e.parentPath, e.name)))
  .filter((path) => !path.split('/').includes('node_modules') && !/\.(?:md|txt)$/.test(path))
  .sort();

/** A child's failure messages without their stacks, so no child frame reads as this test's own. */
const told = (messages: string[] = []): string => messages.map((m) => m.split('\n').filter((l) => !/^\s+at /.test(l)).join('\n')).join('\n').slice(0, 1500);

interface Assertion { fullName: string; status: string; failureMessages?: string[] }
interface Report { testResults: { name: string; status: string; message?: string; assertionResults: Assertion[] }[] }

describe(`${AC2} an operator's error still reaches its issue with what the operator found`, () => {
  it(`${AC2} #1732's suite is the base's, unchanged, and every one of its 9 tests passes`, () => {
    const now = suiteFiles();
    const changed = [...new Set([...Object.keys(BASE), ...now])].sort().flatMap((path) => {
      if (!(path in BASE)) return [`${path} is new`];
      if (!existsSync(join(REPO, path))) return [`${path} is gone`];
      const sha = sha256(path);
      return sha === BASE[path] ? [] : [`${path} is ${sha}, not the base's ${BASE[path]}`];
    });
    none(changed, `#1732's suite is the base's (c52dc3e73), unchanged`);

    const dir = mkdtempSync(join(tmpdir(), 'deep-2086-redraft-'));
    try {
      const out = join(dir, 'report.json');
      const args = [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--root', SUITE, '--no-file-parallelism', '--testTimeout=600000', '--hookTimeout=600000', '--reporter=json', `--outputFile=${out}`];
      // As the suite's README runs it, with no toolchain installed or downloaded and no caller's rustc flags.
      const env = { ...cargoEnv(), CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
      const run = spawnSync(process.execPath, args, { cwd: REPO, env, encoding: 'utf8', timeout: CHILD_LIMIT, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
      let report: Report;
      try {
        report = JSON.parse(readFileSync(out, 'utf8')) as Report;
      } catch (error) {
        if (run.status === null || run.error) inconclusive(`#1732's suite didn't run to its end (${run.signal ?? run.error?.message})`);
        expect.fail(`#1732's suite wrote no report (exit ${run.status}; ${String(error)}): ${(run.stderr ?? '').slice(-1500)}`);
      }

      const failures: string[] = [];
      const unsure: string[] = [];
      const ran = new Map<string, number>();
      for (const file of report.testResults) {
        const name = relative(join(REPO, SUITE), file.name);
        ran.set(name, file.assertionResults.length);
        if (file.status === 'failed' && file.assertionResults.every((a) => a.status !== 'failed')) failures.push(`${name} failed outside its tests: ${(file.message ?? '').slice(0, 1500)}`);
        for (const a of file.assertionResults) {
          if (a.status === 'passed') continue;
          const message = (a.failureMessages ?? []).join('\n');
          const machine = worldLine(message);
          if (a.status === 'failed' && (/^(?:[\w$]*Error: )?INCONCLUSIVE: /.test(message) || machine)) unsure.push(`${name}: ${a.fullName.slice(0, 200)}: ${machine ?? message.split('\n')[0]!.slice(0, 600)}`);
          else failures.push(`${name}: ${a.fullName.slice(0, 200)} is ${a.status}: ${told(a.failureMessages)}`);
        }
      }
      for (const [file, held] of Object.entries(TESTS)) if (ran.get(file) !== held) failures.push(`${file} reported ${ran.get(file) ?? 'no'} tests, where the base holds ${held}`);
      console.log(`PROOF #2086 ${SUITE}: ${JSON.stringify({ ran: Object.fromEntries(ran), failures, unsure })}`);
      // A failure outranks a test that can't be judged here.
      if (failures.length) none([...failures, ...unsure.map((line) => `(and INCONCLUSIVE) ${line}`)], `#1732's suite passes unchanged, every test in it`);
      if (unsure.length) inconclusive(`a test of #1732's suite can't be judged on this machine:\n  ${unsure.join('\n  ')}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, CHILD_LIMIT + 600_000);
});
