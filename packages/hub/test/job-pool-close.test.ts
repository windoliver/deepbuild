// #2732: a hub's stop closes its job pool in each of its two passes, and a build's release can still give tokens back
// after that. Once closed, the pool must leave alone the fd number its close freed, which the next open takes.
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { JobPool } from '../src/heavy.ts';

/** A closed pool, and a file opened after its close, on the fd number the close freed. */
function closedPool(dir: string): { pool: JobPool; other: number; path: string } {
  const pool = new JobPool(join(dir, 'jobserver'), 2);
  pool.close(true);
  const path = join(dir, 'other');
  writeFileSync(path, 'x');
  return { pool, other: openSync(path, 'r+'), path };
}

it('a job pool closed twice leaves the fd its first close freed to whoever opened it next', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pool-'));
  try {
    const { pool, other } = closedPool(dir);
    pool.close(true);
    let open = true;
    try { fstatSync(other); } catch { open = false; }
    if (open) closeSync(other);
    expect(open, 'the file opened after the first close is still open after the second').toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('a closed job pool reads and writes nothing through the fd its close freed, and opens nothing at its removed path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pool-'));
  try {
    const { pool, other, path } = closedPool(dir);
    let failed: unknown;
    let took = -1;
    try {
      pool.give(3);
      took = pool.take(4);
      // A heavy tick still running when the stop closes the pool may hold tokens back for memory pressure: the pipe is gone.
      pool.holdBack(2);
    } catch (error) {
      failed = error;
    }
    closeSync(other);
    expect({ failed, took, file: readFileSync(path, 'utf8') }, 'the file opened after the close, once the pool gave 3, took up to 4 and held back 2').toEqual({ failed: undefined, took: 0, file: 'x' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
