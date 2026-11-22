// AC5 #2386.a5636b1c: `draw: [0, 32]`, `anchor: [0.5]` and `draw` beside `slice` are each refused at check, naming the
// field
//
// Through `deep-canvas-render check` (the document check, every platform), as #1653's and #536's suites read their
// refusals. Each refused document differs from one that passes by the field alone: criterion 3's tree set (`draw:
// [16, 32]`, `anchor: [0.5, 0.75]`) with `draw: [0, 32]`, then with `anchor: [0.5]`; and criterion 3's free row (`draw:
// [16, 32]`) with a `slice` beside it, written as the design writes one (Mark set: atlas tiles: a free row with columns
// `w` and `h`), where the same set without `slice` passes. A refusal names the field when an error issue names the set
// (its `ids` or its `path`) and the field: its `path` is the field's, or the field's name stands as a whole word in the
// issue's own fields, not its prose. Codes are the implementer's. README: The surface under test; Readings.
import { describe, expect, it } from 'vitest';
import { TREE_PAGE, column, figure, freeSet, treeAtlas, treeSet, type Tiles } from './fixtures.ts';
import { AC, TIMEOUT, checked, describeErrors, fieldsOf, namesItem, namesWord, putAssets, shown, useBin, useTemp, type Issue } from './helpers.ts';

const ID = AC[5];
const bin = useBin('deep-canvas-render');
const temp = useTemp();

/** An error that names set `set` and its atlas field `field`. */
const naming = (errors: Issue[], set: string, field: string): Issue | undefined =>
  errors.find((e) => namesItem(e, set) && (e.path === `items/${set}/params/atlas/${field}` || e.path.startsWith(`items/${set}/params/atlas/${field}/`) || namesWord(e, field)));
/** `good` passes the check and `bad`, which differs by the field alone, is refused by an error naming the set and the field. */
function refusedNaming(what: string, set: string, field: string, good: (asset: string) => Tiles, bad: (asset: string) => Tiles): void {
  const store = temp();
  const [asset] = putAssets(store, [treeAtlas()]);
  const [passes, refused] = checked(bin(), [figure('accepted', TREE_PAGE, [good(asset!)]), figure('refused', TREE_PAGE, [bad(asset!)])], store);
  expect(passes!.ok, `the set without ${what} passes the check: ${describeErrors(passes!.errors)}`).toBe(true);
  expect(refused!.ok, `the set with ${what} is refused at check: ${describeErrors(refused!.errors)}`).toBe(false);
  expect(naming(refused!.errors, set, field), `an error names the set ${set} and the field ${field}; the errors' own fields: ${shown(refused!.errors.map(fieldsOf))}`).toBeDefined();
}
const withAtlas = (s: Tiles, atlas: Partial<Tiles['atlas']>): Tiles => ({ ...s, atlas: { ...s.atlas, ...atlas } });
/** Criterion 3's free row as a nine-part frame: `slice`, and the box it fills in columns `w` and `h`. */
const sliced = (s: Tiles): Tiles => ({ ...s, columns: { w: column('f32', [48]), h: column('f32', [64]) }, params: { slice: { left: 4, top: 4, right: 4, bottom: 4 } } });

describe(`${ID} a draw or an anchor that can't be, and draw on a set with slice, are refused at check`, () => {
  it(`${ID} draw: [0, 32] is refused at check, naming the field`, () => {
    refusedNaming('draw: [0, 32]', 'tree', 'draw', (a) => treeSet(a), (a) => withAtlas(treeSet(a), { draw: [0, 32] }));
  }, TIMEOUT);

  it(`${ID} anchor: [0.5] is refused at check, naming the field`, () => {
    refusedNaming('anchor: [0.5]', 'tree', 'anchor', (a) => treeSet(a), (a) => withAtlas(treeSet(a), { anchor: [0.5] }));
  }, TIMEOUT);

  it(`${ID} draw beside slice is refused at check, naming the field`, () => {
    refusedNaming('slice beside its draw', 'free', 'draw', (a) => freeSet(a), (a) => sliced(freeSet(a)));
  }, TIMEOUT);
});
