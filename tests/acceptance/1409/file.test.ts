// #1409 AC2: a run that writes a 32 MiB file against `file_mb: 8` is stopped, with its recorded event naming the
// limit. The Proof's planted writer, run through the supervisor on macOS as the child of a parent that does nothing
// itself, so the limit must reach the run's children.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIB, openWorld, runPlanted, STOP, tempDir } from './helpers.ts';

describe('AC2 #1409 file_mb stops a run whose child writes past it', () => {
  it('AC2 a child writing a 32 MiB file against file_mb 8 is stopped at the limit, and the stop names the limit', async () => {
    const dir = tempDir('write');
    const w = await openWorld();
    try {
      const ran = await runPlanted(w, { dir, args: ['write', dir, 'big.bin', '32', '0'], limits: { memory_mb: 1024, file_mb: 8 } });
      expect(ran.exit, 'the run ended').not.toBe('running');
      const size = statSync(join(dir, 'big.bin')).size;
      expect(size, `the writer was stopped at the limit: its file never grew past 8 MiB (${size} bytes)`).toBeLessThanOrEqual(8 * MIB);

      const [stop] = await w.stops(ran.run, 3000);
      expect(stop, `the run's limit stop is on the record as ${STOP}`).toBeDefined();
      expect(stop!.data, 'the stop names the run and the limit, as its start set it').toMatchObject({ run: ran.run, limit: 'file_mb', max: 8 });
    } finally {
      await w.close();
    }
  }, 300_000);
});
