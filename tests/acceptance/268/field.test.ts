// #268.a0c77147: "Moving the pile 1 m between revisions changes the field's key and the field equals a clean bake; a
// pile a channel, a clip, physics or logic moves is refused at check, naming it, and a field past 2,048 × 2,048 cells at
// its `cell` is refused, naming the count"
//
// The field is read from each frame row's `shore` (call field `shore: true`, README): the water's material, the field's
// key and the field's bytes, by SHA-256. All on the pile fixture (helpers.ts `pileDoc`, `shore: {items: "pile-shore"}`).
//
// Clause 1: one `view3d` plays frames 0 and 1, the writer's patch before frame 1 moving the pile from x = 0 to 1 m (a
// new revision). Frame 1's key differs from frame 0's and so does its field (the bake moved); and frame 1's field and
// key equal those of the moved document baked clean, drawn cold in a fresh process. Wrong programs: a field kept from
// the earlier revision, a key that ignores transforms, a cache that answers the new key with the old bytes.
// Clause 2: four piles, each beside the static pile in `pile-shore`, each moved during the document's span by one
// thing: `pile-keyed` by a channel on its x; `pile-clipped` by a clip's placement on it; `harbour-world#pile-falling`,
// a body of #419's physics stand-in `fixture.world@1` (as #166's suite stands it in for the physics module), dropped
// onto the water; `pile-steered` by a driver reading the logic item `pilot`'s array `pilot.x` (as #166's suite wrote
// it). Each is refused at check, naming that pile. Not vacuous: the channel, clip and physics documents with `shore:
// "none"` are drawn, and a static `pile-still` in the collection is drawn, so what is refused is the moving item in
// `items`. The logic document has no drawn twin: the base refuses a driver variable on a logic array as
// `ref_unresolved` naming only the variable, so its refusal must be the shore check's, made before the program
// compiles, as #166's wake check is.
// Clause 3: a 250 m × 210 m plate at `cell: 0.1` needs 2,500 × 2,100 cells, past the cap: refused, naming the count
// (2,500 and 2,100, or 5,250,000, digits read with or without group separators); the same plate at `cell: 0.125`
// (2,000 × 1,680) is drawn.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, type JsonObject, PILE_SHORE, type Shore, STILL, WRITER, answered, camItem, channel, collection, cylinder, frameAt, framesOf,
  pileDoc, refusedNaming, requireGpu, runGpu, set, shoreOf, shown, look3d, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [64, 64];
const CAM: Cam = { position: [0, 12, 0], target: [0, 0, 0], fov: 60, size: SIZE };
const LOOK = look3d('field-268');
const PILE_Y = -0.95;

describe(`${AC[4]} the shore field is keyed by its items, baked clean, and refused when they move or it is too large`, () => {
  it(`${AC[4]} moving the pile 1 m between revisions changes the field's key, and the field equals a clean bake`, () => {
    requireGpu();
    const dir = out();
    const doc = pileDoc('pile-move', SIZE, camItem(CAM), { ...STILL, shore: PILE_SHORE });
    const moved = JSON.parse(JSON.stringify(doc)) as JsonObject;
    (((moved['items'] as Record<string, JsonObject>)['pile']!['at'] as JsonObject))['pos'] = [1, PILE_Y, 0];
    const [played] = runGpu(bin(), dir, [view3d({
      doc: writeJson(dir, 'move', doc), look: LOOK, size: SIZE, frames: 2, fps: 30, capture: [0, 1], shore: true,
      patches: [{ frame: 1, writer: WRITER, ops: [set('pile', 'at/pos', [1, PILE_Y, 0])] }],
    })]);
    const [clean] = runGpu(bin(), dir, [view3d({ doc: writeJson(dir, 'moved', moved), look: LOOK, size: SIZE, frames: 1, fps: 30, capture: [0], shore: true })]);
    const frames = framesOf(played!, 'the pile moved by a revision');
    const before = shoreOf(dir, frameAt(frames, 0, 'the first revision'), 'the first revision');
    const after = shoreOf(dir, frameAt(frames, 1, 'the revision that moved the pile'), 'the revision that moved the pile');
    const fresh = shoreOf(dir, frameAt(framesOf(clean!, 'the moved document, fresh'), 0, 'the moved document'), 'the moved document baked clean');
    expect([before.material, after.material, fresh.material], 'the field is the water material pile-water\'s').toEqual(['pile-water', 'pile-water', 'pile-water']);
    expect(after.key, 'moving the pile 1 m changes the field\'s key').not.toBe(before.key);
    expect(after.field, 'moving the pile 1 m changes the field').not.toBe(before.field);
    expect(after.field, 'the field after the move equals a clean bake of the moved document, byte for byte').toBe(fresh.field);
    expect(after.key, 'and has its key').toBe(fresh.key);
  });

  it(`${AC[4]} a pile a channel, a clip, physics or logic moves is refused at check, naming it`, () => {
    requireGpu();
    const dir = out();
    const movers: { name: string; extra: Record<string, JsonObject>; docExtra: JsonObject; member: string }[] = [
      { name: 'pile-keyed', member: 'pile-keyed', extra: { 'pile-keyed': cylinder([2, 2.1, 2], [5, PILE_Y, 5], 'pile-wood') },
        docExtra: { channels: { nudge: channel('items/pile-keyed/at/pos/0', [[0, 5], [10, 6]]) } } },
      { name: 'pile-clipped', member: 'pile-clipped', extra: { 'pile-clipped': cylinder([2, 2.1, 2], [5, PILE_Y, 5], 'pile-wood') },
        docExtra: {
          clips: { sway: { slots: { target: { type: 'mark.cylinder@1', required: true } }, span: 'auto', channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 5, interp: 'linear' }, k1: { t: '10s', value: 6, interp: 'linear' } } } } } },
          placements: { p: { clip: 'sway', slots: { target: 'pile-clipped' }, start: '0s' } },
        } },
      { name: 'harbour-world#pile-falling', member: 'harbour-world#pile-falling', docExtra: {}, extra: {
        'harbour-world': { kind: 'fixture.world@1', material: 'pile-wood', params: { step_hz: 120, span: '30s', gravity: -9.81, floor: -2, restitution: 0, bodies: { 'pile-falling': { radius: 1, pos: [5, 3, -5], vel: [0, 0, 0] } } } },
      } },
      { name: 'pile-steered', member: 'pile-steered', extra: {
        'pile-steered': cylinder([2, 2.1, 2], [5, PILE_Y, 5], 'pile-wood'),
        pilot: { kind: 'logic@1', params: { program: 'a'.repeat(64), step_rate: 60, reads: [], writes: { x: { type: 'f64', count: 1, interpolate: 'linear' } } } },
      }, docExtra: { requires: { modules: { scene3d: '^1', logic: '^1' } }, drivers: { steer: { target: 'items/pile-steered/at/pos/0', expr: 'x', vars: { x: 'pilot.x' } } } } },
    ];
    const docOf = (k: number, shore: Shore | 'none'): JsonObject => {
      const m = movers[k]!;
      return pileDoc(`moved-${k}`, SIZE, camItem(CAM), { ...STILL, shore }, { extra: m.extra, docExtra: m.docExtra, collections: { 'pile-shore': collection(['pile', m.member]) } });
    };
    const still = pileDoc('still', SIZE, camItem(CAM), { ...STILL, shore: PILE_SHORE }, { extra: { 'pile-still': cylinder([2, 2.1, 2], [5, PILE_Y, 5], 'pile-wood') }, collections: { 'pile-shore': collection(['pile', 'pile-still']) } });
    const call = (name: string, doc: JsonObject) => view3d({ doc: writeJson(dir, name, doc), look: LOOK, size: SIZE, frames: 1, fps: 30 });
    // The base resolves no driver variable on a logic array (`ref_unresolved`), so the logic mover has no drawn control:
    // its refusal is the shore check's, run before the program compiles, as #166's wake check is.
    const drawable = movers.length - 1;
    const replies = runGpu(bin(), dir, [
      ...movers.map((_, k) => call(`shore-${k}`, docOf(k, PILE_SHORE))),
      ...movers.slice(0, drawable).map((_, k) => call(`plain-${k}`, docOf(k, 'none'))),
      call('still', still),
    ]);
    answered(replies[movers.length + drawable]!, 'the static pile-still in the shore\'s collection');
    movers.slice(0, drawable).forEach((m, k) => answered(replies[movers.length + k]!, `${m.name} with shore none (the document is otherwise drawn)`));
    movers.forEach((m, k) => refusedNaming(replies[k]!, m.name, `the shore whose items hold ${m.name}`));
  });

  it(`${AC[4]} a field past 2,048 × 2,048 cells at its cell is refused at check, naming the count`, () => {
    requireGpu();
    const dir = out();
    const big = (cell: number) => pileDoc(`big-${cell}`, SIZE, camItem(CAM), { ...STILL, shore: { ...PILE_SHORE, cell } }, { plateSize: [250, 210] });
    const [past, under] = runGpu(bin(), dir, [
      view3d({ doc: writeJson(dir, 'past', big(0.1)), look: LOOK, size: SIZE, frames: 1, fps: 30 }),
      view3d({ doc: writeJson(dir, 'under', big(0.125)), look: LOOK, size: SIZE, frames: 1, fps: 30 }),
    ]);
    answered(under!, 'the 250 m × 210 m plate at cell 0.125 (2,000 × 1,680 cells)');
    expect(past!['code'], `the 250 m × 210 m plate at cell 0.1 is refused at check: ${shown(past)}`).toBeDefined();
    expect(past!['code'], 'refused, not reported as a platform gap').not.toBe('unsupported_platform');
    const text = JSON.stringify(past).replace(/(\d)[,   _'](?=\d{3}(?!\d))/g, '$1');
    const has = (n: string) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(text);
    expect((has('2500') && has('2100')) || has('5250000'), `the refusal names the count, 2,500 × 2,100 cells: ${shown(past)}`).toBe(true);
  });
});
