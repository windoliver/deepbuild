// AC9: selection never appears in the document's bytes, a revision or the record, checked by hash before and after
// (README, AC9).
import { describe, expect, it } from 'vitest';
import { canonical, carets, center, copyFailure, doc, jsonDifference, type Obj, Replica, SESSION, sha256, TAG, textOf, useDrive } from './helpers.ts';

useDrive();

const NOTE = doc('note');
const TEXT = textOf(NOTE, 'dd-note');
const FROM = TEXT.indexOf('rose');
const TO = TEXT.indexOf('held') + 'held'.length;

/** The document's entry in `stored`, its canonical bytes held to its hash and to the note it is. */
function entry(stored: { documents: Obj[] }, id: string, failures: string[], when: string): Obj | undefined {
  const found = stored.documents.filter((d) => d.doc === id);
  if (found.length !== 1) {
    failures.push(`${when}, stored lists ${found.length} documents ${id}`);
    return undefined;
  }
  const d = found[0]!;
  if (typeof d.canonical !== 'string' || sha256(d.canonical) !== d.hash) failures.push(`${when}, ${id}'s hash isn't the SHA-256 of its canonical bytes`);
  else if ((JSON.parse(d.canonical) as Obj).items?.['dd-note']?.params?.text !== TEXT) failures.push(`${when}, ${id}'s canonical bytes aren't the note shown`);
  if (!Array.isArray(d.revisions) || d.revisions.length === 0) failures.push(`${when}, ${id} lists no revisions`);
  return d;
}

describe(`${TAG.ac9} AC9: selection never appears in the document's bytes, a revision or the record`, () => {
  it('the document, its revisions and the record hash the same before and after you select and copy', async () => {
    const r = await Replica.launch();
    const shown = await r.show(SESSION.note, NOTE);
    await r.openSession(SESSION.note);
    await r.visible({ item: 'dd-note' }, 'the note');
    await r.wait(1_000);
    const failures: string[] = [];
    const before = await r.stored();
    const doc0 = entry(before, shown.doc, failures, 'before the selection');
    if (doc0 && doc0.hash !== shown.hash) failures.push(`show answered hash ${shown.hash} but stored holds ${String(doc0.hash)}`);

    // A text selection, then an item selection, each live: your ⌘C copies it.
    const range = await carets(r, 'dd-note', FROM, 'dd-note', TO);
    await r.mark('dd1498-ac9-range');
    await r.drag(range.from, range.to, 'hid', ['alt']);
    const rangeFailure = copyFailure('⌥-drag across part of the note, then ⌘C', TEXT.slice(FROM, TO), await r.copy('hid', 'dd1498-ac9-range'));
    if (rangeFailure) failures.push(rangeFailure);
    await r.mark('dd1498-ac9-item');
    await r.click(center((await r.probe({ item: 'dd-note' }, 'the note')).box), 'hid');
    const itemFailure = copyFailure('a click on the note, then ⌘C', TEXT, await r.copy('hid', 'dd1498-ac9-item'));
    if (itemFailure) failures.push(itemFailure);

    const after = await r.stored();
    const doc1 = entry(after, shown.doc, failures, 'after the selection');
    if (doc0 && doc1) {
      for (const field of ['hash', 'canonical', 'rev'] as const) {
        if (doc0[field] !== doc1[field]) failures.push(`the document's ${field} changed: ${String(doc0[field]).slice(0, 80)} before, ${String(doc1[field]).slice(0, 80)} after`);
      }
      const revisions = jsonDifference(doc0.revisions, doc1.revisions);
      if (revisions) failures.push(`the document's revisions changed at ${revisions}`);
    }
    const [record0, record1] = [sha256(canonical(before.events)), sha256(canonical(after.events))];
    if (record0 !== record1) failures.push(`the record's hash changed from ${record0} to ${record1}: ${jsonDifference(before.events, after.events)}`);

    expect(failures).toEqual([]);
  });
});
