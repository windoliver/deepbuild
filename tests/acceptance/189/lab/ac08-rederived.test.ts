// Criterion 8: "A lab with a world and logic, saved at step 1,800 and opened in a test build whose physics
// implementation differs, so its runtime digest differs, with the same layout, content and module set, shows one
// notice naming the physics implementation, re-derives the save by replaying its track headless, writes a new save
// while the old one's bytes stay, and over the next 600 steps gives the full-state hashes of a fresh run of the same
// track in that build; opening the new save again shows no notice; and a planted restore that loads the old world's
// bytes into the new build fails that comparison, naming the save and the implementation; and a planted build whose
// physics change kills the hero during the replay shows the notice naming the first array that differs, doesn't open
// the re-derived save by itself, and leaves the slot's saves in place"
//
// The lab (helpers: labWorld, the logic program) is saved at step 1,800 by `deep-show` in the full set. "A test build
// whose physics implementation differs" is #1920's mechanism, a test feature of deep-show: `full` with
// `test-physics-rapier-patch-drift`, whose physics implementation's record pins its backend at another patch (so the
// runtime digest moves) and whose world steps under its gravity times 1.000001 (so the world's bytes differ while the
// hero's grounded reading, and with it the logic state, stays the same). "A planted build whose physics change kills
// the hero" is `full` with `test-physics-rapier-patch-heavy`, the same record and twice the gravity: the hero's launch
// falls short of the pit's far side and it dies. The planted restore is `--planted restore_loads_old_world`. Each
// open is a process of its own on a copy of the saves folder the full build wrote; the viewer hands it the entries
// after the save only, so a re-derivation replays the save's own track (README: open_save).
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  AC, ALIVE, LOGIC, SAVE_STEP, TIMEOUT, WORLD, arr, caughtNaming, canonical, copyOf, freshRun, hashAt, headerOf, judgeRederived, labDoc,
  namesImplementation, none, obj, oneNotice, openSave, openedOf, saveFiles, show, str, useBuilds, useFolders, writeSave,
  type JsonObject, type JsonValue, type Opened, type Plan, type Run, type Written,
} from './helpers.ts';

const bins = useBuilds(['full', 'drift', 'heavy']);
const folder = useFolders();

// Computed once, on first use, and shared by the tests: one evidence store, the lab's document, the save the full build
// wrote at step 1,800, a fresh run of the track in the drift build, and the real open there.
let evidence = '';
const store = (): string => (evidence ||= folder());
let document: JsonObject | undefined;
const lab = (): JsonObject => (document ??= labDoc(bins('full'), store()));
let written: Written | undefined;
const saved = (): Written => (written ??= writeSave(bins('full'), store(), lab(), folder(), 'the lab saved in the full build'));
let freshDrift: { plan: Plan; run: Run } | undefined;
const fresh = (): { plan: Plan; run: Run } => (freshDrift ??= freshRun(bins('drift'), store(), lab(), 'a fresh run of the track in the drift build'));
let realOpen: { plan: Plan; opened: Opened; dir: string } | undefined;
function rederived(): { plan: Plan; opened: Opened; dir: string } {
  if (realOpen) return realOpen;
  const dir = copyOf(saved().dir, join(folder(), 'saves'));
  const o = openSave(bins('drift'), store(), lab(), dir, 'the open in the drift build');
  realOpen = { plan: o.plan, opened: openedOf(o.reply, 'the open in the drift build'), dir };
  return realOpen;
}

describe(`${AC[8]} a lab with a world and logic, opened after only its runtime digest changed, is re-derived from its own track`, () => {
  it(`${AC[8]} opened in a test build whose physics implementation differs, the save shows one notice naming the implementation, is re-derived and written as a new save beside the old one's unchanged bytes, gives a fresh run's full-state hashes over the next 600 steps, and opened again shows no notice`, () => {
    const w = saved();
    expect(w.header['runtime'], 'the save carries the runtime digest of the build that wrote it (schedule\'s runtime_digest)').toBe(w.plan.runtime);
    const f = fresh();
    expect(f.plan.runtime, 'the drift build\'s runtime digest differs from the full build\'s').not.toBe(w.plan.runtime);
    expect(f.plan.set, 'the drift build seals the same module set (set_digest)').toBe(w.plan.set);
    // The fixture as the README defines the drift build: the world steps to other bytes, the logic state is the same.
    const [drift, full] = [(id: string): string => hashAt(f.run.checkpoints, id, SAVE_STEP, 'the drift build\'s fresh run'), (id: string): string => hashAt(w.run.checkpoints, id, SAVE_STEP, 'the full build\'s run')];
    expect(drift(WORLD), `the drift build's physics differs: a fresh run's ${WORLD} full-state hash at step ${SAVE_STEP} isn't the full build's`).not.toBe(full(WORLD));
    expect(drift(LOGIC), `and the logic state is the same: a fresh run's ${LOGIC} full-state hash at step ${SAVE_STEP} is the full build's`).toBe(full(LOGIC));

    const { plan, opened, dir } = rederived();
    expect(plan.runtime, 'the open ran in the drift build').toBe(f.plan.runtime);
    expect([opened.via, opened.from, opened.step], 'the save is re-derived and the result opened at the save\'s step, from the old save').toEqual(['rederived', w.hash, SAVE_STEP]);
    expect(opened.hash, 'it opens a new save').not.toBe(w.hash);
    const n = oneNotice(opened.notices, 'the open');
    expect([n['kind'], n['save'], n['replays']], `the notice: ${show(n)}`).toEqual(['runtime_changed', w.hash, 'same']);
    namesImplementation(n, plan.physics, 'the open');

    const files = saveFiles(dir);
    expect([...files.keys()].sort(), 'the slot holds the old save and the new one').toEqual([w.hash, opened.hash].sort());
    expect(files.get(w.hash)?.equals(w.bytes), 'the old save\'s bytes stay as they were').toBe(true);
    const h = headerOf(files.get(opened.hash)!, 'the new save');
    expect(h['runtime'], 'the new save is bound to the drift build\'s runtime digest').toBe(plan.runtime);
    expect(h['step'], 'at the old save\'s step').toBe(SAVE_STEP);
    for (const k of ['layout', 'content', 'modules']) expect(canonical(h[k]), `the new save binds the old one's ${k}`).toBe(canonical(w.header[k]));
    none(judgeRederived(opened.checkpoints, f.run.checkpoints, w.hash, plan.physics), `over the next 600 steps the re-derived save gives a fresh run's full-state hashes in the drift build`);

    const again = openSave(bins('drift'), store(), lab(), dir, 'the new save opened again');
    const o2 = openedOf(again.reply, 'the new save opened again');
    expect([o2.via, o2.hash], 'the new save opens straight').toEqual(['straight', opened.hash]);
    expect(o2.notices as JsonValue, 'opening the new save again shows no notice').toEqual([]);
    expect([...saveFiles(dir).keys()].sort(), 'and writes no save').toEqual([w.hash, opened.hash].sort());
    none(judgeRederived(o2.checkpoints, f.run.checkpoints, opened.hash, plan.physics), 'opened again, it still gives the fresh run\'s full-state hashes');
  }, TIMEOUT);

  it(`${AC[8]} a planted restore that loads the old world's bytes into the new build (restore_loads_old_world) fails the comparison with a fresh run, naming the save and the implementation`, () => {
    const w = saved();
    const f = fresh();
    const real = rederived();
    none(judgeRederived(real.opened.checkpoints, f.run.checkpoints, w.hash, real.plan.physics), 'the judge passes the real re-derivation');
    const dir = copyOf(w.dir, join(folder(), 'saves'));
    const p = openSave(bins('drift'), store(), lab(), dir, 'the planted restore', 'restore_loads_old_world');
    const planted = openedOf(p.reply, 'the planted restore');
    caughtNaming(judgeRederived(planted.checkpoints, f.run.checkpoints, w.hash, p.plan.physics), [w.hash, p.plan.physics], 'the planted restore against a fresh run');
  }, TIMEOUT);

  it(`${AC[8]} a planted build whose physics change kills the hero during the replay shows the notice naming the first array that differs, doesn't open the re-derived save by itself, and leaves the slot's saves in place`, () => {
    const w = saved();
    const h = freshRun(bins('heavy'), store(), lab(), 'a fresh run of the track in the heavy build');
    expect(h.plan.runtime, 'the heavy build\'s runtime digest differs from the full build\'s').not.toBe(w.plan.runtime);
    expect(w.run.arrays(SAVE_STEP - 1, ALIVE), `the hero is alive at step ${SAVE_STEP - 1} in the full build`).toEqual([1]);
    expect(h.run.arrays(SAVE_STEP - 1, ALIVE), `and dead by then in the heavy build, whose physics change kills it`).toEqual([0]);

    const dir = copyOf(w.dir, join(folder(), 'saves'));
    const o = openSave(bins('heavy'), store(), lab(), dir, 'the open in the heavy build');
    const r = o.reply;
    expect([r['ok'], r['code'], r['save']], `the re-derived save isn't opened by itself: ${show(r, 2500)}`).toEqual([false, 'replays_differently', w.hash]);
    expect(r['opened'], 'nothing is opened').toBeUndefined();
    const n = oneNotice(arr(r['notices'], 'the reply\'s notices').map((x, i) => obj(x, `notices[${i}]`)), 'the open in the heavy build');
    expect([n['kind'], n['save'], n['replays'], n['array']], `the notice says the game replays differently, naming the first array that differs: ${show(n)}`).toEqual(['runtime_changed', w.hash, 'differently', ALIVE]);
    expect(str(n['text'], 'the notice\'s text'), 'its words name the array').toContain('alive');
    namesImplementation(n, o.plan.physics, 'the open in the heavy build');
    const files = saveFiles(dir);
    expect([...files.keys()], 'the slot\'s saves are left in place: only the old one').toEqual([w.hash]);
    expect(files.get(w.hash)?.equals(w.bytes), 'with its bytes as they were').toBe(true);
  }, TIMEOUT);
});
