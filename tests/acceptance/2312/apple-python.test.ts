// AC1: on macOS with `/usr/bin/python3` first on `PATH`, `tests/acceptance/351/guide.test.ts` passes all 6 cases,
// including the JSON-RPC worked example in the platform sandbox.
//
// The proof is #351's own file, reused as it is: neither copied nor edited. Its JSON-RPC case builds the guide's
// example on the python3 it finds first on PATH, so what this file adds is only the criterion's condition: it runs
// that one file, as #351's README runs it, with /usr/bin first on PATH, and reads the six cases' results.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPLE_PYTHON, blocked, COMMAND_LINE_TOOLS, home, needsMac, NODE, REPO, tempDir } from './helpers.ts';

const AC1 = '#2312.0690cb81';

/** #351's six cases, by the names its file gives them. */
const CASES = [
  'AC1 the TypeScript example builds, passes conformance and runs against the host',
  'AC1 the JSON-RPC example builds, passes conformance and runs against the host',
  'AC1 the guide is generated from the published contract and names both examples; its drift test passes on the contract, and the preflight runs it',
  'AC1 a method the contract publishes with no guide entry fails the drift test, naming it',
  'AC1 a slot the contract publishes with no guide entry fails the drift test, naming it',
  'AC1 a guide entry for a method the contract doesn\'t publish fails the drift test, naming it',
];
interface Report { testResults: { assertionResults: { title: string; status: string; failureMessages: string[] }[] }[] }

describe(`AC1 ${AC1} on macOS with /usr/bin/python3 first on PATH, tests/acceptance/351/guide.test.ts passes all 6 cases, including the JSON-RPC worked example in the platform sandbox`, () => {
  it('AC1 with /usr/bin/python3 first on PATH, #351\'s guide.test.ts passes its 6 cases, the JSON-RPC example in the platform sandbox among them', () => {
    needsMac();
    if (!existsSync(APPLE_PYTHON)) blocked(`${APPLE_PYTHON} isn't on this Mac`);
    if (!existsSync(COMMAND_LINE_TOOLS)) blocked(`${COMMAND_LINE_TOOLS} isn't on this Mac, so ${APPLE_PYTHON} runs no Python here`);
    const report = join(tempDir('report'), 'guide.json');
    const run = spawnSync(NODE, [
      join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', join(REPO, 'tests/acceptance/351'), '--no-file-parallelism',
      'guide.test.ts', '--reporter=json', `--outputFile=${report}`,
    ], {
      cwd: REPO, encoding: 'utf8', timeout: 1_500_000,
      // /usr/bin first, so python3 is Apple's; then this Node's folder, for the scripts the guide's drift test runs.
      env: { PATH: `/usr/bin:${dirname(NODE)}:/bin:/usr/sbin:/sbin`, HOME: home(), NO_COLOR: '1' },
    });
    expect(existsSync(report), `#351's guide.test.ts ran and reported (status ${run.status ?? run.signal}): ${run.stdout}\n${run.stderr}`).toBe(true);
    const results = (JSON.parse(readFileSync(report, 'utf8')) as Report).testResults.flatMap((file) => file.assertionResults);
    const failed = results.filter((r) => r.status !== 'passed').map((r) => `${r.title}: ${r.status}: ${r.failureMessages.join('\n').split('\n')[0] ?? ''}`);
    expect(failed, 'every case of #351\'s guide.test.ts passes').toEqual([]);
    expect(results.map((r) => r.title).sort(), '#351\'s guide.test.ts ran its 6 cases').toEqual([...CASES].sort());
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
  }, 1_600_000);
});
