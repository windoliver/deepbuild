// #2077: a composite configuration replay is one trusted runner job, with the same reserve and cancellation gates.
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { ACCOUNT, cleanup, coveredVersions, install, sleep, tempDir } from '../../../tests/acceptance/159/helpers.ts';
import { claudeLimits, openWorld, room } from '../../../tests/acceptance/159/world.ts';

afterAll(cleanup);
it('refuses an agent-supplied eval, waits at reserve, records one job, and cancels its working evaluator', async () => {
  const bin = tempDir();
  install(bin, { version: coveredVersions().at(-1)! });
  const w = await openWorld({ loginPath: `${bin}:/usr/bin:/bin` });
  try {
    await expect(w.runner.submit({ kind: 'eval', agent: 'claude-code', prompt: 'I adopt it' })).rejects.toThrow(/trusted evaluator/);
    expect(await w.runner.list()).toEqual([]);
    const reset = w.clock.now() + 3600_000;
    await w.runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: claudeLimits(95, reset) });
    let runs = 0, stopped = false;
    const job = await w.runner.submit({ kind: 'eval', agent: 'claude-code', prompt: 'Evaluate removal', deadline_ms: 60_000 }, async (context) => {
      runs++;
      expect(context.folder).toBe(join(w.root, 'jobs', context.job.slice(4)));
      expect((await w.events('job.recorded')).filter((e) => e.subject === context.job)).toHaveLength(1);
      await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => { stopped = true; resolve(); }, { once: true }));
      context.signal.throwIfAborted();
      return 'never adopt after cancellation';
    });
    expect(job.state).toBe('waiting');
    expect(job.blocked?.cause).toBe('plan window');
    expect(runs).toBe(0);
    w.clock.advance(2 * 3600_000);
    await room(w);
    for (let i = 0; i < 200 && !runs; i++) await sleep(10);
    expect(runs).toBe(1);
    await w.runner.cancel(job.job);
    const ended = await w.runner.wait(job.job);
    expect(stopped).toBe(true);
    expect(ended.state).toBe('stopped');
    expect(ended.result).toBeUndefined();
    expect((await w.events('job.ended')).filter((e) => e.subject === job.job)).toHaveLength(1);
  } finally { await w.close(); }
}, 120_000);
