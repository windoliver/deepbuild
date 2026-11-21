// Criterion 11, one leg: "Budgets, on the reference Mac in the local preflight, compared with the merge base: … re-deriving
// the lab's 1,800-step save under 5 s; …". The other legs (opening a 48-page save, logic.layout, a migration, no work
// per frame) are another job's, in tests/acceptance/189/saves/.
//
// Pinned to the reference Mac: on any other host the test fails BLOCKED before it builds or measures. On a Mac the
// limit is judged as #534's criterion 4 judges its budgets: scripts/benchmark.mjs's judgeLimit over five readings after
// a warm-up (one of the reference Macs, on mains power, Low Power Mode off, thermal state nominal, load under the core
// count); anything but PASS fails, naming the judge's reason. Each reading is one open of a fresh copy of the lab's save
// at step 1,800, written by the full build, in the drift build, whose runtime digest differs, so the open re-derives it;
// the reading is the reply's `rederive_ns` (README: open_save), in ms.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, copyOf, judgeBudget, labDoc, num, onReferenceMacOnly, openSave, openedOf, useBuilds, useFolders, writeSave } from './helpers.ts';

const bins = useBuilds(process.platform === 'darwin' ? ['full', 'drift'] : []);
const folder = useFolders();

describe(`${AC[11]} the lab's budget on the reference Mac`, () => {
  it(`${AC[11]} re-deriving the lab's 1,800-step save takes under 5 s`, async () => {
    onReferenceMacOnly('criterion 11\'s re-derivation budget');
    const evidence = folder();
    const document = labDoc(bins('full'), evidence);
    const w = writeSave(bins('full'), evidence, document, folder(), 'the lab saved in the full build');
    await judgeBudget(5000, () => {
      const o = openSave(bins('drift'), evidence, document, copyOf(w.dir, join(folder(), 'saves')), 'the open in the drift build');
      expect(openedOf(o.reply, 'the open in the drift build').via, 'the open re-derives the save').toBe('rederived');
      return num(o.reply['rederive_ns'], 'the open\'s rederive_ns') / 1e6;
    }, 're-deriving the lab\'s 1,800-step save, in ms');
  }, TIMEOUT);
});
