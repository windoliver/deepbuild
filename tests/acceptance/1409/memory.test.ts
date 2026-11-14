// #1409 AC1: a run whose child allocates 512 MiB against `memory_mb: 128` is stopped within 1 s of passing it, with its
// recorded event naming the limit and the reading. The Proof's planted allocator, run through the supervisor on
// macOS as the child of a parent that does nothing itself, so only memory summed over the run's tree passes the limit.
import { describe, expect, it } from 'vitest';
import { catalogue } from '../../../packages/contracts/src/index.ts';
import { beat, openWorld, runPlanted, stamp, STOP, tempDir } from './helpers.ts';

describe('AC1 #1409 memory_mb stops a run whose child passes it', () => {
  it('AC1 a child allocating 512 MiB against memory_mb 128 is stopped within 1 s of passing it, and the stop names the limit and the reading', async () => {
    const dir = tempDir('alloc');
    const w = await openWorld();
    try {
      // The child holds what it allocated for 10 s: only a stop ends it sooner.
      const ran = await runPlanted(w, { dir, args: ['alloc', dir, '512', '128', '10000', '0'], limits: { memory_mb: 128, file_mb: 64 } });
      expect(ran.exit, 'the run ended').not.toBe('running');

      // When the child's own memory passed 128 MiB, and its last sign of life. A stop that came before its own count
      // passed 128 MiB (the parent's and its own runtime count too) leaves no `passed` stamp: it lived 0 ms past it.
      const last = beat(dir);
      expect(last, 'the child started allocating (its heartbeat)').toBeDefined();
      const passed = stamp(dir, 'passed');
      const lived = passed === undefined ? 0 : last!.ms - passed;
      expect(lived, `the run was stopped within 1 s of passing 128 MiB: the child's last heartbeat came ${lived} ms after it passed, holding ${last!.mib} MiB`).toBeLessThanOrEqual(1000);

      const [stop] = await w.stops(ran.run, 3000);
      expect(stop, `the run's limit stop is on the record as ${STOP}`).toBeDefined();
      expect(catalogue().map((e) => e.kind), `${STOP} is in the event catalogue`).toContain(STOP);
      const data = stop!.data as { run: string; limit: string; max: number; reading: number };
      expect(data, 'the stop names the run and the limit it passed, as its start set it').toMatchObject({ run: ran.run, limit: 'memory_mb', max: 128 });
      expect(data.reading, 'the stop names the reading, in MiB, past the limit').toBeGreaterThan(128);
      expect(data.reading, 'the reading is the run\'s memory, at most what the child allocated and the two processes\' own').toBeLessThan(1024);
    } finally {
      await w.close();
    }
  }, 300_000);
});
