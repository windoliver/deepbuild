// AC16 #19.26a372c6 `deep doctor` exits 1 with one failed item, 3 with only an item not checked, 1 with both, 0
// with every item ok, and 2 for an unknown flag, having checked nothing; `deep status` with the hub down and no
// database exits 3. A command that exits 0 for an item not checked fails this test, naming the command and the item.
// (The contract half, every command through the one enum, is contract.test.ts.)
//
// The worlds (README: Every item ok, AC16):
//   every item ok      the all-ok world, `deep doctor --prompt` (so the test prompt runs and its item is ok)
//   one failed item    the same with DeepBuild's stop-hold entry at 60 s against the 60 s hold (#18's broken relation)
//   only not checked   the all-ok world with Claude Code's telemetry off, so #42's telemetry item has nothing to
//                      read (not_checked), and no --prompt, so the test-prompt item didn't run either; nothing fails
//   both               the failed relation and the telemetry off, no --prompt
//   unknown flag       `deep doctor --dh19-no-such-flag`, the hub stopped: no item, no stand-in called, no file written

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, deep, doctor, itemsShown, makeHome, notOk, rootOf, setStopTimeout, shown, tree, world, type Doctored } from './helpers.ts';

afterAll(cleanup, 60_000);

const failed = (d: Doctored) => d.items.filter((i) => i.level === 'fail');
const unrun = (d: Doctored) => d.items.filter((i) => i.code === 'not_checked');

/** Only items not checked, nothing failed: the doctor must exit 3. Throws naming the command and the item when it exits 0. */
async function onlyNotChecked(plant?: string): Promise<void> {
  const w = await world({ telemetry: false, ...(plant ? { plant } : {}) });
  const d = await doctor(w.h);
  if (failed(d).length) throw Error(`AC16 the "only not checked" world must have no failed item, yet: ${itemsShown(failed(d))}`);
  if (!unrun(d).length) throw Error(`AC16 with Claude Code's telemetry off and no --prompt, an item must read not checked: ${shown(d.ran)}`);
  if (d.ran.code === 0) throw Error(`AC16 deep doctor exited 0 with an item not checked: ${unrun(d).map((i) => `${i.item} (${i.code})`).join(', ')}; it must exit 3`);
  if (d.ran.code !== 3) throw Error(`AC16 deep doctor must exit 3 with only items not checked (${unrun(d).map((i) => i.item).join(', ')}): ${shown(d.ran)}`);
}

describe('AC16 #19.26a372c6 `deep doctor` exits 1 with one failed item, 3 with only an item not checked, 1 with both, 0 with every item ok, and 2 for an unknown flag, having checked nothing; `deep status` with the hub down and no database exits 3', () => {
  it('AC16 #19.26a372c6 every item ok: deep doctor --prompt shows every item ok and exits 0', async () => {
    const w = await world();
    const d = await doctor(w.h, ['--prompt']);
    expect(d.items.length, `AC16 deep doctor --json lists its items: ${shown(d.ran)}`).toBeGreaterThan(0);
    expect(notOk(d.items), `AC16 in the world where everything is right, every item is ok: ${shown(d.ran)}`).toEqual([]);
    expect(d.ran.code, `AC16 deep doctor exits 0 with every item ok: ${shown(d.ran)}`).toBe(0);
  }, 600_000);

  it('AC16 #19.26a372c6 one failed item (the stop-hold relation at 60 s against 60 s): deep doctor --prompt exits 1', async () => {
    const w = await world({ after: (h) => setStopTimeout(h, 60) });
    const d = await doctor(w.h, ['--prompt']);
    expect(failed(d).length, `AC16 the stop-hold relation reads failed: ${shown(d.ran)}`).toBeGreaterThan(0);
    expect(d.ran.code, `AC16 deep doctor exits 1 with a failed item: ${shown(d.ran)}`).toBe(1);
  }, 600_000);

  it('AC16 #19.26a372c6 only an item not checked (telemetry off, no --prompt): deep doctor exits 3, never 0', async () => {
    await onlyNotChecked();
  }, 600_000);

  it('AC16 #19.26a372c6 both a failed item and one not checked: deep doctor exits 1', async () => {
    const w = await world({ telemetry: false, after: (h) => setStopTimeout(h, 60) });
    const d = await doctor(w.h);
    expect(failed(d).length && unrun(d).length, `AC16 the world has a failed item and an item not checked: ${shown(d.ran)}`).toBeTruthy();
    expect(d.ran.code, `AC16 when both 1 and 3 apply, deep doctor exits 1: ${shown(d.ran)}`).toBe(1);
  }, 600_000);

  it('AC16 #19.26a372c6 an unknown flag: deep doctor exits 2, having checked nothing (no item, no agent called, no file written)', async () => {
    const w = await world({ hubDown: true });
    const before = tree(w.h.tmp);
    for (const args of [['--dh19-no-such-flag'], ['--prompt', '--dh19-no-such-flag']]) {
      const d = await doctor(w.h, args);
      expect(d.ran.code, `AC16 deep doctor --json ${args.join(' ')} is a usage error: exit 2: ${shown(d.ran)}`).toBe(2);
      expect(d.items, `AC16 a usage error shows no item: ${shown(d.ran)}`).toEqual([]);
      expect(d.calls, 'AC16 a usage error checks nothing: no agent stand-in or system tool was called').toEqual([]);
    }
    expect([...tree(w.h.tmp)].filter(([p, v]) => before.get(p) !== v).map(([p]) => p), 'AC16 a usage error writes nothing').toEqual([]);
  }, 600_000);

  it('AC16 #19.26a372c6 deep status with the hub down and no database exits 3', async () => {
    const h = makeHome();
    expect(existsSync(join(rootOf(h.home), 'ledger.db')), 'the home has no database').toBe(false);
    const r = await deep(h, ['status']);
    expect(r.code, `AC16 deep status with the hub down and no database reads no hub: exit 3: ${shown(r)}`).toBe(3);
  }, 600_000);

  it('AC16 #19.26a372c6 (wrong program) a doctor that exits 0 with only an item not checked (not-checked-exits-0) fails this test, naming the command and the item', async () => {
    await expect(onlyNotChecked('not-checked-exits-0')).rejects.toThrow(/AC16 deep doctor exited 0 with an item not checked: \S+ \(not_checked\)/);
  }, 600_000);
});
