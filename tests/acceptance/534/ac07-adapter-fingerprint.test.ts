// Criterion 7: "A save holding `same_machine` carried state, opened on an adapter with another fingerprint, is refused
// naming both fingerprints, and opens on the adapter that wrote it"
//
// Through `deep-logic` (README: deep-logic, Same-machine state). The piece holds a logic item `saver` that saves slot 1
// at step 30 and an item of the fixture canvas module `same_machine.counter@1`, whose carried state is same-machine
// (it counts steps on the adapter it runs on). A run's `adapter` names the adapter fingerprint it runs on; the save,
// written on adapter A, binds A. Opened on adapter B it's refused, naming A and B; opened on A it opens.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, bakeOf, logicBin, openSaveCall, openedOf, piece, prebuild, readSave, refusalOf, run, savesDir, type JsonObject } from './helpers.ts';
import { saver } from './programs.ts';
import { join } from 'node:path';

prebuild(() => { logicBin(); });

const A = 'adapter-534-a';
const B = 'adapter-534-b';
const machinePiece = (): JsonObject => piece({
  seed: 534_07,
  items: { saver: { program: saver(), writes: { request: { type: 'i32' } }, saves: { slots: 1, request: 'request' } } },
  others: { counter: { kind: 'same_machine.counter@1', params: {} } },
});

describe(`${AC[7]} a save holding same-machine carried state binds the adapter that wrote it`, () => {
  it(`${AC[7]} opened on an adapter with another fingerprint the save is refused, naming both fingerprints, and it opens on the adapter that wrote it`, () => {
    const dir = savesDir();
    const b = bakeOf(run([bakeCall(machinePiece(), { steps: 30, saves_dir: dir, adapter: A })])[0]!, 'the bake on adapter A that saves');
    const [s] = b.saves;
    expect([s?.slot, s?.step], 'slot 1 is saved at step 30').toEqual([1, 30]);
    expect(readSave(join(dir, `${s!.hash}.save`)).header['fingerprint'], 'the save binds the adapter fingerprint that wrote it').toBe(A);
    const r = refusalOf(run([openSaveCall(machinePiece(), { saves_dir: dir, slot: 1, steps: 60, adapter: B })])[0]!, 'open_save on adapter B');
    expect(r.code, 'refused').toBe('save_refused');
    const f = r.differs.find((d) => d.what === 'fingerprint');
    expect([f?.save, f?.piece], `naming both fingerprints, the save's and this adapter's: ${JSON.stringify(r.differs)}`).toEqual([A, B]);
    const o = openedOf(run([openSaveCall(machinePiece(), { saves_dir: dir, slot: 1, steps: 60, adapter: A })])[0]!, 'open_save on adapter A');
    expect([o.hash, o.step, o.via], 'on the adapter that wrote it, the save opens').toEqual([s!.hash, 30, 'straight']);
    expect(o.deep_hash, 'at the full-state hashes it recorded').toEqual(s!.deep_hash);
  }, TIMEOUT);
});
