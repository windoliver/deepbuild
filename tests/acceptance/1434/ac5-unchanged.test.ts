// Criterion 5 (README: Criteria to tests): the #140 color check and the #377 handoff fixture still pass. Each runs
// unchanged, as its own suite runs it, and every test in it must pass: none failed, skipped or left todo.
//   - tests/acceptance/377/handoff.test.ts, all of `#377.756c6dce the surface handoff passes
//     parity/gpu/surface-handoff.scene against the copy path on this machine` (its planted `divides_alpha` and
//     `releases_before_completion` among them);
//   - tests/acceptance/140/gpu/color.live.test.ts, AC5, AC9 and AC19 (the live window), with DEEP_140_LIVE=1, so this
//     half runs only with DEEP_1434_LIVE=1 and fails INCONCLUSIVE otherwise.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, requireLive, requireMacos } from './helpers.ts';

interface Assertion { fullName: string; status: string }
function suite(root: string, file: string, env: NodeJS.ProcessEnv = {}): Assertion[] {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1434-ac5-'));
  try {
    const out = join(dir, 'report.json');
    const args = [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--root', root, '--no-file-parallelism', '--reporter=json', `--outputFile=${out}`, file];
    const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 7_000_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
    const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: { assertionResults: Assertion[] }[] };
    const all = report.testResults.flatMap((t) => t.assertionResults);
    expect(all.length, `${root}/${file} ran its tests (exit ${r.status}): ${(r.stderr ?? '').slice(-1500)}`).toBeGreaterThan(0);
    return all;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const notPassed = (all: Assertion[]): string[] => all.filter((a) => a.status !== 'passed').map((a) => `${a.status}: ${a.fullName}`);

describe('#1434 AC5 the #140 color check and the #377 handoff fixture still pass', () => {
  it('AC5 tests/acceptance/377/handoff.test.ts passes unchanged, every test in it', () => {
    requireMacos();
    const all = suite('tests/acceptance/377', 'handoff.test.ts');
    expect(all.some((a) => a.fullName.startsWith('#377.756c6dce the surface handoff passes parity/gpu/surface-handoff.scene')), 'it is the handoff fixture\'s suite').toBe(true);
    expect(notPassed(all), 'the handoff fixture\'s tests').toEqual([]);
  }, 7_200_000);

  it('AC5 tests/acceptance/140/gpu/color.live.test.ts passes unchanged on the live window, every test in it', () => {
    requireLive('#140\'s color check');
    const all = suite('tests/acceptance/140/gpu', 'color.live.test.ts', { DEEP_140_LIVE: '1' });
    expect(all.some((a) => a.fullName.startsWith('AC5 status color swatches read back from the surface')), 'it is the color check\'s suite').toBe(true);
    expect(notPassed(all), 'the color check\'s tests').toEqual([]);
  }, 1_800_000);
});
