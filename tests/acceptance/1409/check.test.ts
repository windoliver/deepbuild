// #1409 AC3: a check whose run stopped at a limit reads INCONCLUSIVE, never a product failure and never PASS. The
// command check kind (#30) runs its command only through host@1; here every run it starts goes to the supervisor with
// `limits` on its StartSpec, as limits the owner sets would reach it, and its closed run outcome is judged by the
// run family's one mapping to a verdict (README, The surface under test).
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommandCheck } from '../../../packages/checks-command/src/index.ts';
import { judge } from '../../../packages/conformance/src/index.ts';
import type { Host, StartSpec, Supervisor } from '../../../packages/supervisor/src/index.ts';
import { FIXTURES, openWorld, runId, tempDir, type Limits } from './helpers.ts';

/** host@1 as the supervisor gives it, every start carrying `limits`; everything else is the supervisor's own. */
function limited(sup: Supervisor, limits: Limits): Host {
  return new Proxy(sup, {
    get(target, key) {
      if (key === 'start') return (spec: StartSpec) => target.start({ ...spec, limits });
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('AC3 #1409 a check whose run stopped at a limit reads INCONCLUSIVE', () => {
  it('AC3 a command check whose run passes memory_mb 128 ends stopped, which reads INCONCLUSIVE', async () => {
    const checkout = tempDir('checkout');
    cpSync(join(FIXTURES, 'check'), checkout, { recursive: true });
    const w = await openWorld();
    try {
      const run = runId();
      w.runs.push(run);
      const result = await runCommandCheck({
        host: limited(w.sup, { memory_mb: 128, file_mb: 64 }), run, checkout, deadline: 120_000,
        spec: { kind: 'command', runner: 'node alloc.mjs', inputs: ['alloc.mjs'], depth: 'unit', oracle: 'code', contract: null },
      });
      const seen = `outcome ${result.outcome}, exit ${JSON.stringify(result.exit)}, failures ${JSON.stringify(result.failures.map((f) => f.message))}`;
      expect(result.outcome, `the run stopped at its limit ends stopped, not failed or passed (${seen})`).toBe('stopped');
      expect(judge('run', result.outcome).verdict, 'a run stopped at a limit reads INCONCLUSIVE').toBe('INCONCLUSIVE');
    } finally {
      await w.close();
    }
  }, 300_000);
});
