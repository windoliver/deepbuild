// #2669.a691df86: "`tests/acceptance/83/redraft-319/status.test.ts` passes"
//
// The criterion as amended (issue comment 7150789468): #83's blind redraft for #319 of its status tests passes. That
// file is run here once, as its own README runs it (vitest with --root at its folder, one file at a time, no colour),
// in a child process through the repo's own vitest.
//
// asserts:
//   - the CLI and deep-hook the suite drives (#83's helpers.ts `CURRENT`) are built, or this is BLOCKED, never a pass;
//   - the child vitest exits 0;
//   - its summary reports one test file and at least one test, every test passed, and none failed, was skipped or left
//     todo (nothing unrun passes: AGENTS.md, the four invariants).
// Wrong programs (twins.json): `status-never-asked` (verdict-chat.ts reads no prompt as a status question) and
// `needs-you-counts-queued` (core.ts counts an ask still waiting for its batch in Needs you). Each makes the redraft
// fail at its own expect, and this test at its exit and summary assertions (BASE-FAILURE.txt).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CURRENT } from '../83/helpers.ts';

const ID = '#2669.a691df86';
const ROOT = 'tests/acceptance/83/redraft-319';
const FILE = 'status.test.ts';
/** The redraft's README: about 15 s, up to 4 minutes more just before a batch time. The proof lanes stop a file at 20 minutes. */
const CHILD_TIMEOUT = 17 * 60_000;

/** vitest's summary line for `label` ("Tests  3 failed | 2 passed (5)"), as counts by word. */
function counts(summary: string, label: string): Record<string, number> | undefined {
  const line = summary.split('\n').find((l) => new RegExp(`^\\s*${label}\\s+\\S`).test(l));
  if (!line) return undefined;
  const out: Record<string, number> = {};
  for (const m of line.replace(/\([^)]*\)\s*$/, '').matchAll(/(\d+)\s+(passed|failed|skipped|todo)/g)) out[m[2]!] = Number(m[1]);
  const total = /\((\d+)\)\s*$/.exec(line);
  out['total'] = total ? Number(total[1]) : NaN;
  return out;
}

describe(`${ID} tests/acceptance/83/redraft-319/status.test.ts passes`, () => {
  it(`${ID} tests/acceptance/83/redraft-319/status.test.ts, run once through the repo's vitest as its README runs it, exits 0 with tests run, every one passed and none failed or skipped`, () => {
    for (const [what, path] of [['the built CLI', CURRENT.cli], ['deep-hook', CURRENT.hook]] as const) {
      if (!existsSync(path)) expect.fail(`BLOCKED: ${what} the suite drives is missing at ${path}; build it first (npm run build --workspaces; cargo build -p deep-hook)`);
    }
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    delete env['FORCE_COLOR'];
    const args = [join(CURRENT.root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--root', ROOT, '--no-file-parallelism', '--testTimeout=600000', FILE];
    const r = spawnSync(process.execPath, args, { cwd: CURRENT.root, env, encoding: 'utf8', timeout: CHILD_TIMEOUT, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
    const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
    console.log(`PROOF ${ID} ${ROOT}/${FILE}: exit ${r.status}${r.signal ? ` (${r.signal})` : ''}\n${output.slice(-6000)}`);
    const tail = output.slice(-4000);

    expect(r.error?.message, `${ROOT}/${FILE} ran to its end (not killed at ${CHILD_TIMEOUT / 60_000} minutes):\n${tail}`).toBeUndefined();
    expect(r.status, `${ROOT}/${FILE} exits 0 under the repo's vitest:\n${tail}`).toBe(0);
    const files = counts(output, 'Test Files');
    const tests = counts(output, 'Tests');
    expect(files, `vitest reports its test files for ${ROOT}/${FILE}:\n${tail}`).toEqual({ passed: 1, total: 1 });
    expect(tests?.['total'], `vitest reports tests ran in ${ROOT}/${FILE}:\n${tail}`).toBeGreaterThan(0);
    expect(tests, `every test in ${ROOT}/${FILE} passed, none failed, skipped or todo:\n${tail}`).toEqual({ passed: tests?.['total'], total: tests?.['total'] });
  }, CHILD_TIMEOUT + 60_000);
});
