// AC5 "#418's three occlusion tests pass with no edit to them: direct light within 0.5%, no occlusion depth from a
// see-through item, and one pixel hash for a still frame however it was reached"
//
// Reused as they are, never copied: tests/acceptance/418/ao.test.ts (#418.4d39a1c0, #418.fdc46ec6, #418.9a0b4a91) and
// the helpers it imports. The first test holds "no edit": the files are byte-for-byte as at the base commit, working
// tree included (git diff against the base). The second runs that file through vitest in a child process, as #418's
// README runs it, and reads its JSON report: exactly the three tests, each passed; skipped or missing reads as a
// failure, and a test that reports INCONCLUSIVE stays INCONCLUSIVE here. This guards the change; at the base it is
// expected to pass (README: what fails on the base).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_SHA, REPO, git, inconclusive, requireGpu } from './helpers.ts';

const FILES = ['tests/acceptance/418/ao.test.ts', 'tests/acceptance/418/helpers.ts', 'tests/acceptance/418/tsconfig.json'];
const IDS = ['#418.4d39a1c0', '#418.fdc46ec6', '#418.9a0b4a91'];

describe('AC5 #418\'s three occlusion tests, unedited, pass', () => {
  it('AC5 #418\'s ao.test.ts, its helpers and its tsconfig are byte-for-byte as at the base commit', () => {
    const known = git(['cat-file', '-e', `${BASE_SHA}^{commit}`]);
    expect(known.status, `the base commit ${BASE_SHA} is in this checkout: ${known.stderr}`).toBe(0);
    for (const f of FILES) expect(existsSync(join(REPO, f)), `${f} is present`).toBe(true);
    const d = git(['diff', '--stat', '--exit-code', BASE_SHA, '--', ...FILES]);
    expect(d.status, `#418's occlusion tests are unedited since ${BASE_SHA.slice(0, 8)}:\n${d.stdout}${d.stderr}`).toBe(0);
  });

  it('AC5 run as they are, #418\'s three occlusion tests pass: direct light within 0.5%, no occlusion depth from a see-through item, one pixel hash for a still frame', () => {
    requireGpu();
    const vitest = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
    expect(existsSync(vitest), 'vitest is installed (npm ci)').toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'deep-2516-418-'));
    try {
      const report = join(dir, 'report.json');
      const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'NODE_ENV' && k !== 'TEST'));
      const r = spawnSync(process.execPath, [vitest, 'run', '--root', 'tests/acceptance/418', 'ao.test.ts', '--no-file-parallelism', '--reporter=json', '--outputFile', report],
        { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 7_000_000, killSignal: 'SIGKILL', env: { ...env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
      expect(existsSync(report), `vitest wrote its report (exit ${r.status}); stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(true);
      const json = JSON.parse(readFileSync(report, 'utf8')) as { testResults: { name: string; assertionResults: { title: string; fullName: string; status: string; failureMessages: string[] }[] }[] };
      const results = json.testResults.filter((t) => t.name.endsWith('ao.test.ts')).flatMap((t) => t.assertionResults);
      const lines = results.map((a) => `${a.status}: ${a.title}${a.failureMessages.length ? ` — ${a.failureMessages.join(' | ').slice(0, 600)}` : ''}`);
      expect(results.length, `the report holds #418's three occlusion tests:\n  ${lines.join('\n  ')}`).toBe(3);
      for (const id of IDS) expect(results.some((a) => a.title.startsWith(id)), `the report holds ${id}`).toBe(true);
      const unjudged = results.filter((a) => a.status === 'failed' && a.failureMessages.some((m) => /INCONCLUSIVE/.test(m)));
      if (unjudged.length === results.filter((a) => a.status !== 'passed').length && unjudged.length > 0) inconclusive(`#418's tests could not be judged here:\n  ${lines.join('\n  ')}`);
      for (const a of results) expect(a.status, `${a.title}:\n  ${lines.join('\n  ')}`).toBe('passed');
      expect(r.status, `vitest exited 0; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 7_200_000);
});
