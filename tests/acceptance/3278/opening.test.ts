import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, REPO, tempDir } from './helpers.ts';

const SUITE = 'tests/acceptance/490-redraft-2/opening.test.ts';
const SUITE_MS = 4 * 60 * 60_000;

interface Assertion { fullName: string; status: string; failureMessages?: string[] }

describe(`${AC.opening} #490's redraft-2 opening suite passes`, () => {
  it(`${AC.opening} tests/acceptance/490-redraft-2/opening.test.ts passes on main, every test in it`, () => {
    const out = join(tempDir('report'), 'report.json');
    const args = [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--no-file-parallelism', '--reporter=json', `--outputFile=${out}`, SUITE];
    const env = { ...process.env };
    delete env['DEEP_BIN_DIR'];
    const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env, timeout: SUITE_MS, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
    let report: { testResults: { name: string; assertionResults: Assertion[] }[] };
    try {
      report = JSON.parse(readFileSync(out, 'utf8'));
    } catch (error) {
      throw Error(`BLOCKED: ${SUITE} wrote no report (exit ${r.status}, ${r.signal ?? 'no signal'}): ${(error as Error).message}; ${(r.stderr ?? '').slice(-1500)}`);
    }
    const all = report.testResults.flatMap((t) => t.assertionResults);
    expect(all.some((a) => a.fullName.includes('every content key, golden and corpus snapshot of the shipped fixtures')), `it is #490's opening suite: ${all.map((a) => a.fullName).join('; ')}`).toBe(true);
    const notPassed = all.filter((a) => a.status !== 'passed').map((a) => `${a.status}: ${a.fullName}\n    ${(a.failureMessages ?? []).join('\n').split('\n').slice(0, 12).join('\n    ')}`);
    expect(notPassed, `${SUITE}'s tests that did not pass:\n  ${notPassed.join('\n  ')}`).toEqual([]);
  }, SUITE_MS + 10 * 60_000);
});
