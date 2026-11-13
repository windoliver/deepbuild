// `deep job rule`: the command that sends job.rule, the most a run of a paid tool may cost with no ask, which the hub
// takes only from your own terminal (#1922). #1922's world is reused by path: a job kind installed, and a paid tool.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { asks, BASE_PARAMS, done, input, kindWorld, lastPos, mustInstall, runJob, toolPlugin } from '../../../tests/acceptance/1922/helpers.ts';
import { deep } from './hub.js';

const PAID = 'upper-paid@1.0.0';

it('deep job rule lets a paid tool run under its price with no ask', async () => {
  const w = await kindWorld();
  await mustInstall(w, toolPlugin(join(w.tmp, 'paid'), { id: 'test/upper-paid', tool: 'upper-paid', cost: { usd: 0.02 } }));
  expect((await runJob(w, PAID, BASE_PARAMS, input(w, 'in.txt', 'abc'))).outcome.value.status, 'with no rule a paid run is held').toBe('held');

  const ruled = await deep(w.home, w.project, ['job', 'rule', PAID, '0.05']);
  expect(ruled.code, ruled.stderr).toBe(0);
  expect(ruled.stdout).toContain(PAID);
  const from = await lastPos(w);
  const ran = await runJob(w, PAID, BASE_PARAMS, input(w, 'other.txt', 'xyz'));
  expect(done(ran.outcome), `under the rule a paid run on another input is done: ${ran.outcome.text.slice(0, 600)}`).toBe(true);
  expect(await asks(w, from), 'and asks nothing').toEqual([]);
}, 900_000);

it('deep job with arguments it cannot read prints its usage, exits 2 and reaches no hub', async () => {
  const home = mkdtempSync(join(tmpdir(), 'deep-job-'));
  try {
    for (const args of [[], ['rule'], ['rule', PAID], ['rule', PAID, '--free'], ['cap', PAID, '1']]) {
      const ran = await deep(home, home, ['job', ...args]);
      expect(ran.code, `deep job ${args.join(' ')}: ${ran.stderr}`).toBe(2);
      expect(ran.stderr).toContain('Usage: deep job rule <tool@version> <usd>');
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 120_000);
