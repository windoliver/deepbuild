// A speed claim timed on no repeat has nothing to show: it never passes (AGENTS.md invariant 2). #87's suite always
// times five repeats a side.
import { describe, expect, it } from 'vitest';
import { checkSpeed, type Side, type Toolchain } from '../src/index.js';

const toolchain: Toolchain = { compiler: 'clang 17', driver: '550', runtime: 'cuda 12.4' };
const side = (): Side => ({ warmUp: () => undefined, flush: () => true, work: () => undefined, toolchain: () => ({ ...toolchain }), machine: () => 'mac-1' });

describe('a speed claim with no repeats to time', () => {
  for (const repeats of [0, -1]) {
    it(`reads INVALID and never passes at repeats: ${repeats}`, async () => {
      const r = await checkSpeed(
        { stated: '1.8× faster', timing: { baseline: { library: 'kernels', release: '2.1.0' }, toolchain: { baseline: toolchain, change: toolchain }, machine: 'mac-1', repeats } },
        { baseline: side(), change: side() }, { checkout: '/tmp', deadline: 10_000, now: () => Date.now() },
      );
      expect([r.outcome, r.testsRun, r.timing.outcome], JSON.stringify(r)).toEqual(['uncounted', 0, 'INVALID']);
    });
  }
});
