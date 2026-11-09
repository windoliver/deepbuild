// AC3: "The unknown-license model is BLOCKED at fetch with one unblock ask, and no item can name it. A planted fill
// that reports it as CC0 fails, because the license is read from the fixture's own record, naming the row."
//
// asserts: the search's row for shelf-armchair (the library's own record: Shelf Standard License, no SPDX ID) reads
// the license that record states; two fetches of it are each BLOCKED and raise exactly one unblock ask and no
// authority ask, with no file request and none of its files in the store; and `deep show --check` of an asset.game@1
// item `from: {asset: <its file's sha256>}` refuses that item. The same judge fails the planted fill `reports-cc0`,
// naming the row and the record.
import { describe, expect, it } from 'vitest';
import { LIB, gameDoc, judgeUnknown, must, onWorld, openWorld, proof, refusedItem, show, shown } from './helpers.ts';
import { fileHash } from './library.ts';

const ID = 'shelf-armchair';

describe('#1731.0d3831dc The unknown-license model is BLOCKED at fetch with one unblock ask, and no item can name it. A planted fill that reports it as CC0 fails, because the license is read from the fixture\'s own record, naming the row.', () => {
  it('the unknown-license armchair is BLOCKED at fetch with one unblock ask, and an asset.game@1 item naming it is refused', async () => {
    const w = await onWorld();
    const failures = await judgeUnknown(w, ID);
    proof('ac3-unknown.json', { failures, requests: w.library.log });
    expect(failures).toEqual([]);
    const { ran, reply } = await show(w, gameDoc('armchair', fileHash(ID)));
    proof('ac3-show.json', reply ?? { ran });
    expect(reply, `deep show --check --json printed a reply: ${shown(ran)}`).toBeDefined();
    expect(refusedItem(reply, 'armchair'), `the item naming the unknown-license model is refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBe(true);
  }, 900_000);

  it('the planted fill that reports it as CC0 fails, naming the row, because the license is read from the library\'s own record', async () => {
    const w = await openWorld('reports-cc0');
    // A hub whose own kit refused the plant at install has failed it too, if its reason names the license and the record.
    if (w.install.code !== 0) {
      expect(w.install.stderr, 'the install refused the planted fill, naming the license and the record').toMatch(/licen[cs]e[\s\S]*record|record[\s\S]*licen[cs]e/i);
      return;
    }
    await must(w, 'library.on', { library: LIB });
    const failures = await judgeUnknown(w, ID);
    proof('ac3-planted-reports-cc0.json', failures);
    expect(failures.filter((f) => f.includes(`row ${ID}`) && f.includes('own record')), `the judge fails the plant naming the row: ${JSON.stringify(failures)}`).toHaveLength(1);
  }, 900_000);
});
