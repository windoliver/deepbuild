// #2652 AC4 #2652.e46eede4: each kept run carries the result the merge base carries for it, on #1018's suites, unchanged.
//
// Behavior that must not change, so it passes on the merge base. #1018's behavior suite, tests/acceptance/1018/hub.test.ts,
// runs as it is, through Vitest in a child process as its README runs it, and each of its 10 tests must end as it ends on
// the merge base (BASE-FAILURE.txt): one base run read as carried by four sessions, carry that follows read files, a
// shared run counted once, a flaky key read INCONCLUSIVE in both claims, a held-out variant's verdict carried and kept
// hidden, and each of its five planted runners failing. On the merge base one of them, #1018's AC1 itself, fails after
// its carry holds: its five claims edit the test file their check loads, so since #33 that check counts as the agent's
// own and each verdict is INCONCLUSIVE, not the PASS it expects. That one may pass or fail as there; any other failure
// fails here, named. Its budget files time carrying on a reference Mac and judge no carried result, so they are left out
// (README: AC4).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC4, REPO } from './helpers.ts';

interface Assertion { title: string; fullName: string; status: string; failureMessages: string[] }

/** The one failure #1018's suite has on the merge base: AC1's claims read their base run as carried, then aren't PASS. */
const AS_ON_BASE = (a: Assertion): boolean => a.fullName.includes('#1018.a7bf0857') && !a.title.includes('wrong program')
  && a.failureMessages.some((m) => /AssertionError: claim:\w+'s verdict must land as PASS, its base run proving the fix/.test(m) && m.includes("counts as the agent's own: the claim changed test/cart.test.ts"));

describe(`${AC4} each kept run carries the result the merge base carries for it, on #1018's suites, unchanged`, () => {
  it(`${AC4} tests/acceptance/1018/hub.test.ts, run as it is, ends each test as it ends on the merge base`, () => {
    const vitest = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
    expect(existsSync(vitest), 'vitest is installed (npm ci)').toBe(true);
    const dir = mkdtempSync('/tmp/dh2652-ac4-');
    try {
      const report = join(dir, 'report.json');
      const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && !k.startsWith('DEEP_') && k !== 'NODE_ENV' && k !== 'TEST'));
      const r = spawnSync(process.execPath, [vitest, 'run', '--root', 'tests/acceptance/1018', 'hub.test.ts', '--no-file-parallelism', '--testTimeout=600000', '--reporter=json', '--outputFile', report],
        { cwd: REPO, encoding: 'utf8', env, maxBuffer: 256 * 1024 * 1024, timeout: 3_400_000, killSignal: 'SIGKILL' });
      expect(existsSync(report), `vitest wrote its report (exit ${r.status}${r.signal ? `, ${r.signal}` : ''}); stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(true);
      const json = JSON.parse(readFileSync(report, 'utf8')) as { testResults: { name: string; assertionResults: Assertion[] }[] };
      const results = json.testResults.filter((t) => t.name.endsWith('hub.test.ts')).flatMap((t) => t.assertionResults);
      const lines = results.map((a) => `${a.status}: ${a.fullName}${a.failureMessages.length ? ` — ${a.failureMessages.join(' | ').slice(0, 900)}` : ''}`);
      expect(results.length, `#1018's hub.test.ts holds its five criteria's tests and their five planted runners':\n  ${lines.join('\n  ')}`).toBe(10);
      for (const tag of ['#1018.a7bf0857', '#1018.ce3898ef', '#1018.13494a7e', '#1018.9f44c904', '#1018.681b96a8']) {
        expect(results.filter((a) => a.fullName.includes(tag)).length, `the report holds ${tag}'s two tests`).toBe(2);
      }
      const changed = results.filter((a) => a.status !== 'passed' && !(a.status === 'failed' && AS_ON_BASE(a)));
      expect(changed.map((a) => `${a.status}: ${a.fullName}`), `Each kept run carries the result the merge base carries for it, on #1018's suites: each test there must end as it ends on the merge base:\n  ${lines.join('\n  ')}`).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 3_600_000);
});
