// #1901.b2add21a: the machine fingerprint names the build, the digest of the canvas core's and its modules'
// sources, so a rebuild from changed sources reads no frame, capture or final the previous binary cached,
// and a rebuild from the same sources reuses them.
//
// Three binaries of deep-show (full), copied out as each is built: `previous` from the checkout as it is;
// `changed` with one canvas module's source changed (crates/deep-canvas-loop/src/lib.rs, a comment and an
// unnamed constant appended); `same`, built again after that file is restored byte for byte. Each runs
// once over one on-disk cache (`--cache`), in that order, `previous` first, and draws the board's frame,
// capture and final at 0.5 s. `same` must read every entry `previous` cached and name its build; `changed`
// must read none and name another build. The wrong program, `--planted fingerprint_without_sources` on
// all three over a fresh cache, keys the cache by a fingerprint without the source digest: `changed` then
// serves the old frame, and the same comparison fails, naming the frame's cache entry. The base has no
// `--cache`, `fingerprint` or `draw`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MODULE_SOURCE, OUTPUTS, PLANTED_FINGERPRINT, acrossRebuilds, buildShow, entriesTable, moduleSourceState, seen, useTemp,
  withModuleSourceChanged,
} from './helpers.ts';

const ID = '#1901.b2add21a';
const temp = useTemp();

describe(`${ID} the machine fingerprint names the build: a rebuild from changed sources reads no cached frame, capture or final, a rebuild from the same sources reuses them`, () => {
  it(`${ID} after a rebuild with ${MODULE_SOURCE} changed no frame, capture or final the previous binary cached is read and the fingerprint names another build, while a rebuild from the same sources names the same build and reads every one; with ${PLANTED_FINGERPRINT} the changed build serves the old frame and the comparison fails, naming its cache entry`, () => {
    const dir = temp();
    const before = moduleSourceState();
    const cache = join(dir, 'cache');
    const plantedCache = join(dir, 'cache-planted');
    // Each process gets its own evidence store, so the cache is the only thing the three share.
    let n = 0;
    const evidence = (): string => join(dir, `evidence-${n++}`);

    const previousBin = buildShow(dir, 'previous');
    const previous = seen('the previous binary', previousBin, cache, evidence(), false);
    const previousPlanted = seen('the previous binary', previousBin, plantedCache, evidence(), true);

    let changedBin = '';
    try {
      withModuleSourceChanged(() => { changedBin = buildShow(dir, 'changed'); });
    } finally {
      const after = moduleSourceState();
      expect(after.bytes.equals(before.bytes), `${MODULE_SOURCE} is restored byte for byte`).toBe(true);
      expect(after.status, `${MODULE_SOURCE}'s git status is as it was before the test`).toBe(before.status);
    }
    const sameBin = buildShow(dir, 'same');

    const same = seen('the rebuild from the same sources', sameBin, cache, evidence(), false);
    const changed = seen(`the rebuild with ${MODULE_SOURCE} changed`, changedBin, cache, evidence(), false);
    console.log(`${ID} builds: previous ${previous.build}, same sources ${same.build}, ${MODULE_SOURCE} changed ${changed.build}\n${entriesTable([previous, same, changed])}`);
    expect(acrossRebuilds(previous, same, changed), 'no entry is read across the source change, and every one across the rebuild from the same sources').toEqual([]);

    // The wrong program: a fingerprint without the source digest serves the old frame and fails, naming the entry.
    const samePlanted = seen('the rebuild from the same sources', sameBin, plantedCache, evidence(), true);
    const changedPlanted = seen(`the rebuild with ${MODULE_SOURCE} changed`, changedBin, plantedCache, evidence(), true);
    const failures = acrossRebuilds(previousPlanted, samePlanted, changedPlanted);
    console.log(`${ID} ${PLANTED_FINGERPRINT}:\n${entriesTable([previousPlanted, samePlanted, changedPlanted])}\n${failures.join('\n')}`);
    const old = previousPlanted.drawn.frame;
    expect(changedPlanted.drawn.frame, `with ${PLANTED_FINGERPRINT}, the changed build serves the frame the previous binary cached`).toEqual({ entry: old.entry, read: true });
    expect(failures.filter((f) => f.startsWith(`${changedPlanted.binary} read the frame entry ${old.entry},`)), `with ${PLANTED_FINGERPRINT}, the comparison fails naming the frame's cache entry ${old.entry}: ${failures.join('; ')}`).toHaveLength(1);
    for (const output of OUTPUTS) expect(previousPlanted.drawn[output].read, `with ${PLANTED_FINGERPRINT}, the previous binary drew its ${output} into a fresh cache`).toBe(false);
  }, 10_800_000);
});
