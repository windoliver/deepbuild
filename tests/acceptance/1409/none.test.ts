// #1409 AC4: a run with no `limits` behaves as before. The planted allocator and writer, each under its parent, with
// no `limits` on their StartSpecs: as at the base, each runs to its end, prints what it did, exits 0, writes its whole
// file, and no limit stop is recorded. This one passes on the base by design (README, Base run).
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIB, openWorld, runPlanted, tempDir } from './helpers.ts';

describe('AC4 #1409 a run with no limits behaves as before', () => {
  it('AC4 with no limits the 512 MiB allocator and the 32 MiB writer each run to their end, and no limit stop is recorded', async () => {
    const w = await openWorld();
    try {
      const allocDir = tempDir('alloc');
      const alloc = await runPlanted(w, { dir: allocDir, args: ['alloc', allocDir, '512', '128', '2000', '0'] });
      expect(alloc.exit, 'the allocator\'s run ended').not.toBe('running');
      expect(alloc.exit, 'the allocator\'s run ended on its own, exit 0').toMatchObject({ code: 0, signal: null });
      expect(alloc.stdout).toMatch(/^allocated 512 MiB, sum [0-9a-f]{16}\n$/);
      expect(alloc.stderr).toBe('alloc: held 2000 ms\n');

      const writeDir = tempDir('write');
      const write = await runPlanted(w, { dir: writeDir, args: ['write', writeDir, 'big.bin', '32', '0'] });
      expect(write.exit, 'the writer\'s run ended').not.toBe('running');
      expect(write.exit, 'the writer\'s run ended on its own, exit 0').toMatchObject({ code: 0, signal: null });
      expect(write.stdout).toMatch(/^wrote 32 MiB, sum [0-9a-f]{16}\n$/);
      expect(statSync(join(writeDir, 'big.bin')).size, 'the writer wrote its whole file').toBe(32 * MIB);

      expect(await w.stops(alloc.run, 500), 'no limit stop for the allocator').toEqual([]);
      expect(await w.stops(write.run), 'no limit stop for the writer').toEqual([]);
    } finally {
      await w.close();
    }
  }, 300_000);
});
