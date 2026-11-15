// AC4 #1946.b7aba9e2: a unit edited by hand after setup is kept by Remove it, with a backup and the undo reported
// partial, naming the unit.
//
// Each world is on dh-ubuntu (README, The worlds), a throwaway user there with lingering on. helpers.ts's judgeEdited:
// a remote run as you writes the user unit dh1946-<id>-edit.service, its change recorded with its undo; one line of it
// (Description=) is edited by hand as your user; `deep host remove dh-ubuntu`. The unit must still hold the edit, the
// backup the record names (host.undone's stopped.backup) must hold it too, and `deep host remove` and the record must
// report the undo partial, naming the unit. The planted Remove remove-overwrites-edit (DEEP_HUB_PLANT on that world's
// hub and every deep command) must fail it for not keeping the edit.
import { describe, expect, test } from 'vitest';
import { AC, judgeEdited, openWorld, proof, redact } from './helpers.ts';

describe(AC[4], () => {
  test('Remove it keeps a unit edited by hand after setup, saves a backup of it and reports the undo partial, naming the unit', async () => {
    const w = await openWorld('deep-ubuntu');
    const { failures, seen } = await judgeEdited(w);
    proof('ac4-edited.json', { failures, seen, answered: w.answered });
    expect(failures.map(redact), 'the judge finds nothing wrong').toEqual([]);
  }, 1_800_000);

  test('the planted Remove that writes the recorded version over the edit fails the judge', async () => {
    const w = await openWorld('deep-ubuntu', { plant: 'remove-overwrites-edit' });
    const { failures, seen } = await judgeEdited(w);
    proof('ac4-plant-remove-overwrites-edit.json', { failures, seen });
    const words = failures.map(redact);
    expect(words.filter((f) => f.startsWith(`Remove it didn't keep your edit to dh1946-${w.id}-edit.service`)), `the judge fails the planted Remove for not keeping the edit: ${JSON.stringify(words)}`).not.toEqual([]);
  }, 1_800_000);
});
