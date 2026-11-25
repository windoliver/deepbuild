// #1412: a restart from the hub's state folder that can't read a layer file, or reads one whose bytes changed,
// stops that one document with a named issue and shows no revision past the last one it can prove; the other
// document in the same state folder, and every document of a clean restart, restores whole.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, MISMATCH, MISSING, changeLayerFile, commitBoth, damagedFailures, deleteLayerFile, ownFiles, recordedHashes, restart, useBinary, useFolders,
  wholeFailures, type Before,
} from './helpers.ts';

useBinary();
const { evidence, state } = useFolders();

/** A's revision 2 names a layer file no other event names; damaging it leaves revision 1 the last A can prove. */
const DAMAGED_REV = 2;
const LAST_GOOD = 1;

function damaged(how: 'delete' | 'change'): { before: Before; after: ReturnType<typeof restart>; file: string } {
  const before = commitBoth(evidence(), state());
  const file = ownFiles(before.logged, DOC.a, DAMAGED_REV)[0]!;
  if (how === 'delete') deleteLayerFile(state(), file);
  else changeLayerFile(state(), file);
  return { before, after: restart(evidence(), state()), file };
}

describe(`${AC.deleted} with one layer file deleted before restart, that document reports a named issue and no revision past the last one it can prove`, () => {
  it(`${AC.deleted} with A's revision-2 layer file deleted, the restarted A reports ${MISSING} and shows and lists no revision past 1`, () => {
    const { before, after, file } = damaged('delete');
    expect(damagedFailures(after.a, before.a, MISSING, LAST_GOOD), `A after its layer file ${file} was deleted`).toEqual([]);
  });
});

describe(`${AC.changed} with one layer file's bytes changed, the same`, () => {
  it(`${AC.changed} with A's revision-2 layer file's bytes changed in place, the restarted A reports ${MISMATCH} and shows and lists no revision past 1`, () => {
    const { before, after, file } = damaged('change');
    expect(damagedFailures(after.a, before.a, MISMATCH, LAST_GOOD), `A after its layer file ${file}'s bytes changed`).toEqual([]);
  });
});

describe(`${AC.other} a second document in the same state folder restores whole in both cases`, () => {
  for (const how of ['delete', 'change'] as const) {
    it(`${AC.other} with A's layer file ${how === 'delete' ? 'deleted' : 'changed'}, B restores whole: revision 3 at its hash, revisions 0 to 3 at the hashes before and in its events, and no damage issue`, () => {
      const { before, after } = damaged(how);
      expect(wholeFailures(after.b, before.b, recordedHashes(before.logged, DOC.b)), 'B after the restart').toEqual([]);
    });
  }
});

describe(`${AC.clean} a clean restart gives the same revisions and hashes as before it`, () => {
  it(`${AC.clean} restarted on an untouched state folder, A and B each show revision 3 at the hash before, list revisions 0 to 3 at the hashes before, and each hash is the one its doc.patched event carries`, () => {
    const before = commitBoth(evidence(), state());
    const after = restart(evidence(), state());
    expect({
      a: wholeFailures(after.a, before.a, recordedHashes(before.logged, DOC.a)),
      b: wholeFailures(after.b, before.b, recordedHashes(before.logged, DOC.b)),
    }, 'A and B after a clean restart').toEqual({ a: [], b: [] });
  });
});
