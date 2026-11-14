// The proof's own judges, with no hub: each fails the planted wrong program the criterion names (#1820 AC1: a fetch that
// keeps a mismatched file; AC4: a hub that fetches under another pack's standing rule) and passes the right one.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { A, judgeNotKept, judgeOtherPack } from './pack.ts';

describe('#1820 the judges tell a planted wrong program from the right one', () => {
  it('fails a planted fetch that keeps the mismatched file, naming the asset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dh1820-plant-'));
    try {
      writeFileSync(join(dir, 'kept.bin'), A.corrupt.served);
      const failures = judgeNotKept(dir, A.corrupt.served, false, A.corrupt.path);
      expect(failures.join(' ')).toContain(A.corrupt.path);
      expect(judgeNotKept(dir, A.corrupt.served, true, A.corrupt.path).length).toBe(2);
      rmSync(join(dir, 'kept.bin'));
      expect(judgeNotKept(dir, A.corrupt.served, false, A.corrupt.path)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('fails a hub that fetches under another pack\'s standing rule, naming the pack', () => {
    const planted = judgeOtherPack('acme/sounds', 'acme/voices', [{ method: 'GET', path: '/acme/voices/voices/voice.bin' }], []);
    expect(planted.length).toBe(2);
    expect(planted.join(' ')).toContain('acme/voices');
    expect(judgeOtherPack('acme/sounds', 'acme/voices', [], ['Fetch voices/voice.bin from acme/voices?'])).toEqual([]);
  });
});
