// AC2: a drag across three labels gives three lines in reading order, also when their draw order differs; a planted
// copy in draw order fails (README, AC2).
import { describe, expect, it } from 'vitest';
import { carets, copyFailure, doc, Replica, SESSION, TAG, textOf, useDrive } from './helpers.ts';

useDrive();

const LABELS = doc('labels');
type Item = { id: string; y: number; order: string };
const item = (id: string): Item => ({ id, y: LABELS.items[id].at.pos[1] as number, order: LABELS.items[id].order as string });
/** Reading order: top to bottom by the label's place, as the design reads rows off a grid (README, Readings). */
const reading = (ids: string[]): string[] => ids.map(item).sort((a, b) => a.y - b.y).map((i) => i.id);
/** Draw order: by order key (one writer layer), ties by ID. */
const drawn = (ids: string[]): string[] => ids.map(item).sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1)).map((i) => i.id);
const lines = (ids: string[]): string => ids.map((id) => textOf(LABELS, id)).join('\n');

// The first column is drawn in the order it reads; the second is drawn, keyed and listed in other orders.
const SAME = reading(['lbl-p', 'lbl-q', 'lbl-r']);
const OTHER = reading(['lbl-z', 'lbl-a', 'lbl-m']);

async function onLabels(plant?: string): Promise<Replica> {
  const r = await Replica.launch(plant);
  await r.show(SESSION.labels, LABELS);
  await r.openSession(SESSION.labels);
  for (const id of [...SAME, ...OTHER]) await r.visible({ item: id }, `the label ${id}`);
  return r;
}

/** Your ⌥-drag from the start of the column's top label to the end of its bottom one, then your ⌘C. */
async function copyColumn(r: Replica, ids: string[], marker: string): Promise<string | null> {
  const last = ids[ids.length - 1]!;
  const at = await carets(r, ids[0]!, 0, last, textOf(LABELS, last).length);
  await r.mark(marker);
  await r.drag(at.from, at.to, 'hid', ['alt']);
  return r.copy('hid', marker);
}

describe(`${TAG.ac2} AC2: a drag across three labels gives three lines in reading order`, () => {
  it('copies each column top to bottom, the one drawn in another order too', async () => {
    expect(drawn(SAME), 'the fixture\'s first column is drawn in reading order').toEqual(SAME);
    expect(drawn(OTHER), 'the fixture\'s second column is drawn in another order').not.toEqual(OTHER);
    expect([...OTHER].sort(), 'the fixture\'s second column\'s IDs sort in another order too').not.toEqual(OTHER);
    const r = await onLabels();
    const failures: string[] = [];
    for (const [name, ids] of [['the column drawn in reading order', SAME], ['the column drawn in another order', OTHER]] as const) {
      const copied = await copyColumn(r, [...ids], `dd1498-ac2-${ids[0]}`);
      const failure = copyFailure(`a drag across ${name} (${ids.join(', ')}), then ⌘C`, lines([...ids]), copied);
      if (failure) failures.push(failure);
    }
    expect(failures).toEqual([]);
  });

  it('a planted copy in draw order fails', async () => {
    const r = await onLabels('copies-draw-order');
    const copied = await copyColumn(r, OTHER, 'dd1498-ac2-planted');
    expect(copied, 'the planted replica copies the column in draw order').toBe(lines(drawn(OTHER)));
    expect(copyFailure('a drag across the column drawn in another order, then ⌘C', lines(OTHER), copied), 'the judge fails it').not.toBeNull();
  });
});
