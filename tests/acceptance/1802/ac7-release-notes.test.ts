// #1802.9400be12: "The generated release notes name every entry promoted, removed or extended, and each shipped demo
// that names a preview entry is listed with it. A planted note that drops one fails, naming the entry"
//
// asserts: deep.rise, deep.fall and deep.wait are previews since R1 whose `decide_by` is R3, in the fixture releases R1
// and R2; two shipped demos, demos/wait-board and demos/wait-film, name deep.wait in `requires.preview` (README:
// contracts/shipped.json). In the candidate R3 deep.rise is promoted, deep.fall is removed and deep.wait is extended to
// R5 by an extension on record. The step's `notes --release R3` exits 0, and the notes hold an item (a line that
// starts `- `, with the indented lines under it) that names deep.rise and says promoted, one that names deep.fall and
// says removed, and one that names deep.wait and says extended and lists both demos. The planted note, the same notes
// with the items naming one of the three dropped, fails this check, naming that entry and no other; each of the three
// is dropped in turn.
// Wrong programs: `note-drops-one`, planted in this file; the merge base, whose notes list only reviewed breaks.

import { expect, it } from 'vitest';
import {
  SHIPPED_FILE, addApi, edit, emptyTree, extensionOnRecord, failsNaming, none, notes, previewEntry, promote, record, removeApi, shown, type Tree,
} from './helpers.ts';

const RISE = 'deep.rise';
const FALL = 'deep.fall';
const WAIT = 'deep.wait';
const DEMOS = ['demos/wait-board', 'demos/wait-film'];
/** What R3 does to each entry, in the issue's words, and the shipped demos that name it. */
const CHANGES: readonly { entry: string; word: string; demos: readonly string[] }[] = [
  { entry: RISE, word: 'promoted', demos: [] },
  { entry: FALL, word: 'removed', demos: [] },
  { entry: WAIT, word: 'extended', demos: DEMOS },
];

/** The candidate R3 over the fixture releases R1 and R2. */
function candidate(): Tree {
  const t = emptyTree('notes');
  for (const method of [RISE, FALL, WAIT]) addApi(t, previewEntry(method, { preview_since: 'R1', decide_by: 'R3' }));
  edit(t, SHIPPED_FILE, (s) => { for (const piece of DEMOS) s.pieces.push({ piece, calls: [WAIT], requires: { preview: [WAIT] } }); });
  record(t, 'R1');
  record(t, 'R2');
  promote(t, RISE);
  removeApi(t, FALL);
  extensionOnRecord(t, WAIT, { from: 'R3', to: 'R5', reason: 'Its replacement lands in R5.', ask: 'ask:01JD1802A00000000000000002' });
  return t;
}

/** The notes cut into blocks: an item is a line that starts `- ` with the indented lines under it; every other line stands alone. */
function blocks(text: string): { item: boolean; text: string }[] {
  const out: { item: boolean; text: string }[] = [];
  for (const line of text.split('\n')) {
    const last = out.at(-1);
    if (line.startsWith('- ')) out.push({ item: true, text: line });
    else if (last?.item && /^\s+\S/.test(line)) last.text += `\n${line}`;
    else out.push({ item: false, text: line });
  }
  return out;
}
/** The criterion's check on a release's notes: each entry promoted, removed or extended has its item, with each shipped demo that names it. */
function notesFailures(text: string): string[] {
  const items = blocks(text).filter((b) => b.item).map((b) => b.text);
  const failures: string[] = [];
  for (const { entry, word, demos } of CHANGES) {
    const item = items.find((i) => i.includes(entry) && new RegExp(`\\b${word}\\b`, 'i').test(i));
    if (item === undefined) {
      failures.push(`the notes have no item that names ${entry} and says ${word}`);
      continue;
    }
    for (const demo of demos) if (!item.includes(demo)) failures.push(`the notes' item for ${entry} doesn't list ${demo}, a shipped demo that names it`);
  }
  return failures;
}
/** The planted note: the same notes with every item that names `entry` dropped. */
const dropping = (text: string, entry: string): string => blocks(text).filter((b) => !(b.item && b.text.includes(entry))).map((b) => b.text).join('\n');

/** The step's generated notes for R3. */
function generated(): string {
  const r = notes(candidate(), 'R3');
  expect(r.code, `notes --release R3 exits 0\n${shown(r)}`).toBe(0);
  return r.stdout;
}

it('#1802.9400be12 the generated release notes name every entry promoted, removed or extended, and list each shipped demo that names a preview entry with it', () => {
  none(notesFailures(generated()), 'the notes generated for R3');
}, 120_000);

it('#1802.9400be12 a planted note that drops one fails, naming the entry', () => {
  const text = generated();
  none(notesFailures(text), 'the generated notes, held to the same check first');
  for (const { entry } of CHANGES) {
    const failures = notesFailures(dropping(text, entry));
    failsNaming(failures, [entry], `the note that drops ${entry}`);
    expect(failures.filter((f) => !f.includes(entry)), `the note that drops ${entry} fails naming no other entry`).toEqual([]);
  }
}, 120_000);
