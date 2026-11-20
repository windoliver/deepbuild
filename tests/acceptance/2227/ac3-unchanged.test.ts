// AC3 #2227.de8c9b23: A run stopped at a limit still reads INCONCLUSIVE: `tests/acceptance/1409/check.test.ts` and
// `packages/gate/test/claim.test.ts` pass unchanged.
//
// Not a copy of either file: both run as they stand, in a child Vitest from this checkout's root with the root config,
// as the unit lane runs them, and its JSON report is read. They hold the criterion's two halves: #1409's AC3 runs a
// command check whose run passes `memory_mb: 128` under the supervisor and needs the closed outcome `stopped`, which
// reads INCONCLUSIVE; the gate's claim.test.ts judges a claim whose run is `stopped` INCONCLUSIVE. "Unchanged" is read
// from git: neither file differs from the merge base with origin/main, in a commit or in the working tree. Passing
// means both files ran, every test in them ran and passed, none was skipped, and the child Vitest exited 0.
//
// At the base this passes: the criterion keeps what works there (BASE-FAILURE.txt). Its wrong program is the twin
// limit-stop-fails (twins.json), whose command kind ends a run stopped at a limit `failed`, a product failure.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MINUTES, REPO, git, inconclusive, quoted, run } from './helpers.ts';

const NAMED = ['tests/acceptance/1409/check.test.ts', 'packages/gate/test/claim.test.ts'];
const VITEST = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');

interface Assertion { title: string; fullName?: string; status: string; failureMessages?: string[] }
interface FileResult { name: string; status: string; message?: string; assertionResults: Assertion[] }

const last = (text: string, lines = 15): string => quoted(text.trimEnd().split('\n').slice(-lines).join('\n'));

describe('#2227 a run stopped at a limit still reads INCONCLUSIVE', () => {
  it('AC3 #2227.de8c9b23 tests/acceptance/1409/check.test.ts and packages/gate/test/claim.test.ts pass unchanged', async () => {
    if (process.platform !== 'darwin') inconclusive(`tests/acceptance/1409 runs on macOS only (its README), and this is ${process.platform}`);
    if (!existsSync(VITEST)) inconclusive('node_modules/vitest is not installed in this checkout (npm ci)');
    const base = git(['merge-base', 'HEAD', 'origin/main']).trim();
    const changed = git(['diff', '--name-only', base, '--', ...NAMED]).split('\n').filter(Boolean);
    expect(changed, `the files the criterion names are unchanged from the merge base with origin/main, ${base}`).toEqual([]);

    const out = realpathSync(mkdtempSync(join(tmpdir(), 'dh2227-')));
    try {
      const report = join(out, 'report.json');
      const child = await run(process.execPath, [VITEST, 'run', '--no-file-parallelism', '--reporter=json', `--outputFile=${report}`, ...NAMED], REPO, 25 * MINUTES);
      if (!existsSync(report)) inconclusive(`the child Vitest wrote no report (exit ${child.code ?? child.signal}):\n${last(child.out)}`);
      const results = (JSON.parse(readFileSync(report, 'utf8')) as { testResults: FileResult[] }).testResults;
      const failures: string[] = [];
      for (const path of NAMED) {
        const r = results.find((x) => x.name.endsWith(`/${path}`));
        if (!r) { failures.push(`${path}: didn't run`); continue; }
        if (!r.assertionResults.length) failures.push(`${path}: ran no test (${r.status}${r.message ? `: ${quoted(r.message).slice(0, 600)}` : ''})`);
        for (const a of r.assertionResults) {
          if (a.status !== 'passed') failures.push(`${path}: "${a.fullName ?? a.title}" ${a.status}${a.failureMessages?.length ? `: ${quoted(a.failureMessages.join('\n')).slice(0, 800)}` : ''}`);
        }
      }
      for (const r of results) if (!NAMED.some((path) => r.name.endsWith(`/${path}`))) failures.push(`${r.name}: ran, but the criterion doesn't name it`);
      expect(failures, `the two files, run unchanged:\n  ${failures.join('\n  ')}`).toEqual([]);
      expect(child.code, `the child Vitest exits 0; it said:\n${last(child.out)}`).toBe(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 30 * MINUTES);
});
