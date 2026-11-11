// AC4 #1945.a75a14aa: a plan that installs a package says, before your yes, that what its install scripts did can't
// be undone.
//
// Each world (README, The worlds) is on dh-ubuntu as Lima's user, with an agent's session. The harness builds a test
// package there with dpkg-deb: its file list holds /usr/share/dh1945-<id>/listed, and its postinst writes
// /var/lib/dh1945-<id>-made/unlisted, which the list doesn't hold. The agent writes a script that installs it
// (`dpkg -i`) and proposes it with deep_root_plan, one step naming the package file and the undo an agent would give,
// `dpkg --purge`. Nothing is installed: the test reads the plan before your yes. helpers.ts's judgePackage: while the
// ask is open, `deep inbox` shows a step of its plan, naming the package, that says what its install scripts did and
// whose undo is "can't undo". The planted hub host-package-fully-undoable (DEEP_HUB_PLANT) must fail it, naming the
// package as listed fully undoable.
import { describe, expect, test } from 'vitest';
import { AC, judgePackage, openWorld, proof, redact, Session } from './helpers.ts';

describe(AC[4], () => {
  test('before your yes, the plan that installs a test package whose postinst writes a file its file list doesn\'t hold says what its install scripts did can\'t be undone', async () => {
    const w = await openWorld('deep-ubuntu', { user: 'lima', noToolWait: true });
    const s = new Session(w, `${w.tmp}/work`);
    await s.start();
    const { failures, seen } = await judgePackage(w, s);
    proof('ac4-package.json', { failures, seen, answered: w.answered });
    expect(failures.map(redact), 'the judge finds nothing wrong').toEqual([]);
  }, 1_800_000);

  test('the planted hub that lists the package as fully undoable fails the judge, naming the package', async () => {
    const w = await openWorld('deep-ubuntu', { user: 'lima', noToolWait: true, plant: 'host-package-fully-undoable' });
    const s = new Session(w, `${w.tmp}/work`);
    await s.start();
    const { failures, seen } = await judgePackage(w, s);
    proof('ac4-plant-host-package-fully-undoable.json', { failures, seen });
    const words = failures.map(redact);
    expect(words.filter((f) => f.includes(`installs dh1945-${w.id} `) && f.includes('fully undoable')), `the judge fails the planted hub for listing dh1945-${w.id} as fully undoable: ${JSON.stringify(words)}`).not.toEqual([]);
  }, 1_800_000);
});
