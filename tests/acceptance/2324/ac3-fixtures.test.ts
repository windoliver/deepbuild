// #2324 AC3: Every fixture of #531 reaches the full-state hash it reached on the old engine, on a second machine too.
// A hash that differs fails, naming the fixture and the first step.
//
// The fixtures are #531's programs, one item each, in the piece the merge base baked (fixtures/base-bake.json, with
// the programs' bytes): every step's hash, every checkpoint's full-state hash and every trap, on this Mac and on Linux
// x86_64 (the second machine #531's suite uses). The issue's title adds that a bake made on the old engine is never
// reused: each item's bake key names the engine, so it is another key than the merge base's.
import { describe, expect, it } from 'vitest';
import { AC, BASE_BAKE, L, TIMEOUT, bakeRecords, fixtureBake, hashDiffs, none, onLinux } from './helpers.ts';

L.prebuild(() => { L.logicBin(); });

describe(`${AC[3]} every fixture of #531 reaches the full-state hashes it reached on the old engine`, () => {
  it(`${AC[3]} each of #531's fixtures reaches the old engine's step hashes, full-state hashes and traps on macOS arm64 and on Linux x86_64, under a bake key that isn't the old engine's`, () => {
    const call = fixtureBake();
    const [mac] = L.onMac([call]);
    const here = bakeRecords(mac!, 'the bake on macOS arm64');
    none(hashDiffs('macOS arm64', here), 'each fixture of #531 reaches the old engine\'s hashes on macOS arm64');
    const [linux] = onLinux('deep-logic', [call]);
    none(hashDiffs('Linux x86_64', bakeRecords(linux!, 'the bake on Linux x86_64')), 'each fixture of #531 reaches the old engine\'s hashes on Linux x86_64');

    const reused = Object.entries(BASE_BAKE().items).filter(([id, r]) => here[id]?.key === r.key).map(([id]) => id);
    expect(reused, 'a bake made on the old engine is never reused: no fixture\'s bake key is the one the merge base gave it (issue title)').toEqual([]);
  }, TIMEOUT);
});
