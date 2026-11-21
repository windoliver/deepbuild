// Criterion 3: the drift case of tests/acceptance/351/guide.test.ts fails on no line that names deep.registerPort: it
// passes once #2745 has landed, and until then fails only on deep.source.ask. The case is run as it is, by Vitest in a
// child process, and judged from its JSON report.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { METHOD, NODE, REPO, tempDir } from './helpers.ts';

const FILE = 'tests/acceptance/351/guide.test.ts';
const CASE = 'its drift test passes on the contract';

interface Report { testResults: { assertionResults: { title: string; fullName: string; status: string; failureMessages: string[] }[] }[] }

describe('#2790.d87e08da the drift case of tests/acceptance/351/guide.test.ts fails on no line that names deep.registerPort', () => {
  it('#2790.d87e08da the #351 drift case passes, or fails only on deep.source.ask, never on deep.registerPort', () => {
    expect(existsSync(join(REPO, FILE)), `the #351 guide suite is ${FILE}`).toBe(true);
    const out = join(tempDir('report'), 'report.json');
    const r = spawnSync(NODE, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', FILE, '-t', CASE, '--reporter=json', `--outputFile=${out}`], {
      cwd: REPO, encoding: 'utf8', timeout: 300_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', NO_COLOR: '1', CI: '1' },
    });
    expect(existsSync(out), `Vitest wrote its report of ${FILE}:\n${r.stdout}\n${r.stderr}`).toBe(true);
    const report = JSON.parse(readFileSync(out, 'utf8')) as Report;
    const ran = report.testResults.flatMap((f) => f.assertionResults).filter((a) => a.title.includes(CASE));
    expect(ran.map((a) => a.status), `the drift case ran once, passed or failed: ${JSON.stringify(ran)}`).toEqual([expect.stringMatching(/^(?:passed|failed)$/)]);
    const lines = ran[0]!.failureMessages.join('\n').split('\n');
    expect(lines.filter((line) => line.includes(METHOD)), 'the drift case fails on no line that names deep.registerPort').toEqual([]);
    if (ran[0]!.status === 'failed') {
      const named = [...new Set(lines.flatMap((line) => /FAIL guide: ([^:]+):/.exec(line)?.[1] ?? []))];
      expect(named, `the drift case fails, and then only on deep.source.ask: ${ran[0]!.failureMessages.join('\n')}`).toEqual(['deep.source.ask']);
    }
  }, 300_000);
});
