// AC4 #1456.6799dc51: "`992/agree` holds". #992's suite file, tests/acceptance/992/agree.test.ts, run as it is in a
// vitest process of its own: it must exit 0 with its one test passed and none failed. It replays twelve recorded sessions
// and holds `deep status` and the app's row to the same state for each (README, AC4).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ID, REPO } from './helpers.ts';

describe(ID.agree, () => {
  test(`${ID.agree}: 992/agree holds`, async () => {
    const out = await new Promise<{ code: number | null; text: string }>((resolve) => {
      const child = spawn(process.execPath, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', 'tests/acceptance/992', '--no-file-parallelism', 'agree.test.ts'], { cwd: REPO, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.setEncoding('utf8').on('data', (d: string) => (text += d));
      child.stderr.setEncoding('utf8').on('data', (d: string) => (text += d));
      // Its own limit is 40 minutes; past 45 the child is stopped, by the PID this test started.
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_700_000);
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, text }); });
    });
    const summary = /Tests\s+([^\n]+)/.exec(out.text)?.[1] ?? 'no summary';
    console.log(`tests/acceptance/992 agree.test.ts: exit ${out.code}, ${summary}`);
    expect(out.code === 0 && /\b1 passed\b/.test(summary) && !/failed|skipped/.test(summary), `tests/acceptance/992's agree.test.ts must pass as it is: exit ${out.code}, ${summary}\n${out.text.slice(-4000)}`).toBe(true);
  }, 2_800_000);
});
