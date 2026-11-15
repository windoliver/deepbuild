// #2077 production boundary: a replay is supervised, and its own live reading stops the next model turn.
import { afterAll, expect, it } from 'vitest';
import { cleanup, coveredVersions, install, sleep, tempDir } from '../../../tests/acceptance/159/helpers.ts';
import { openWorld, room } from '../../../tests/acceptance/159/world.ts';

afterAll(cleanup);
it('owns replay processes and uses their rate-limit readings at the next reserve checkpoint', async () => {
  const bin = tempDir();
  install(bin, { version: coveredVersions().at(-1)! });
  const w = await openWorld({ loginPath: `${bin}:/usr/bin:/bin` });
  try {
    await room(w);
    let passedReserve = false;
    let beforeRuns = new Set<string>();
    const reset = Math.floor((w.clock.now() + 3 * 3600_000) / 1000);
    const event = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.95, resetsAt: reset } });
    const job = await w.runner.submit({ kind: 'eval', agent: 'claude-code', prompt: 'Evaluate removal', deadline_ms: 60_000 }, async (c) => {
      beforeRuns = new Set((await w.events('process.starting')).map((e) => (e.data as { run: string }).run));
      await c.execute({ argv: ['/bin/sh', '-c', `printf '%s\\n' '${event}' '{"type":"result","subtype":"success","is_error":false,"result":"done"}'`], cwd: c.folder, env: { PATH: '/usr/bin:/bin' } }, {}, '', Date.now() + 30_000);
      await c.checkpoint('claude-code');
      passedReserve = true;
      return 'must wait';
    });
    for (let i = 0; i < 500; i++) {
      const current = await w.runner.status(job.job);
      if (current.blocked?.cause === 'plan window' || ['finished', 'refused', 'stopped'].includes(current.state)) break;
      await sleep(10);
    }
    const held = await w.runner.status(job.job);
    expect(held.blocked?.cause, JSON.stringify(held)).toBe('plan window');
    expect(passedReserve).toBe(false);
    const started = await w.events('process.starting');
    const runs = started.filter((e) => !beforeRuns.has((e.data as { run: string }).run));
    expect(runs).toHaveLength(1);
    const run = (runs[0]!.data as { run: string }).run;
    expect((await w.events('run.cleaned')).some((e) => (e.data as { run?: string; left?: string[] }).run === run && (e.data as { left: string[] }).left.length === 0)).toBe(true);
    await w.runner.cancel(job.job);
    expect((await w.runner.wait(job.job)).state).toBe('stopped');
  } finally { await w.close(); }
}, 120_000);
