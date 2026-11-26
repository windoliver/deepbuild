// AC4 #1456.6799dc51: `992/agree` holds. #992's tests/acceptance/992/agree.test.ts, run as it is in a vitest process of
// its own, as #1463's words.test.ts runs it: it must pass, one test passed and none failed. It holds at the merge base
// (a regression guard); its wrong program is the twin `waiting-as-working` (README: Planted programs), #992's own.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { AC4, REPO } from './helpers.ts';

describe(AC4, () => {
  test(`${AC4}: 992/agree holds`, async () => {
    const out = await new Promise<{ code: number | null; text: string }>((resolve) => {
      const child = spawn(process.execPath, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', 'tests/acceptance/992', '--no-file-parallelism', 'agree.test.ts'], { cwd: REPO, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.setEncoding('utf8').on('data', (d: string) => (text += d));
      child.stderr.setEncoding('utf8').on('data', (d: string) => (text += d));
      // Stopped by its PID at the limit.
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_700_000);
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, text }); });
    });
    const summary = /Tests\s+([^\n]+)/.exec(out.text)?.[1] ?? 'no summary';
    console.log(`tests/acceptance/992 agree.test.ts: exit ${out.code}, ${summary}`);
    expect(out.code === 0 && /\b1 passed\b/.test(summary) && !/failed/.test(summary), `tests/acceptance/992's agree.test.ts must pass as it is: exit ${out.code}, ${summary}\n${out.text.slice(-4000)}`).toBe(true);
  }, 2_800_000);
});
