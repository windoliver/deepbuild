// #268.a0c77147, the blind redraft of one clause: "a pile a channel, a clip, physics or logic moves is refused at check,
// naming it" (criterion 4; README).
//
// Four movers, each a pile in the shore's collection `pile-shore` beside the static `pile`, each moved during the
// document's span by one thing:
// - `pile-keyed`: a channel on its x, 5 to 6 m over 10 s;
// - `pile-clipped`: a clip `sway`'s placement on it, the same x;
// - `harbour-world#pile-falling`: a body of #419's physics stand-in `fixture.world@1`, dropped onto the water;
// - `pile-fleet`: an `instance@1` of piles whose columns read the `logic@1` item `pilot`'s arrays (Instance
//   `instance@1`: logic columns): `pos` from `pilot.pos`, `live` from `pilot.live`, `gen` from `pilot.gen`, so where
//   each element stands is what the logic step wrote. The prototype `pile-proto` is hidden and not in the collection.
// Each is refused at check, naming it (for the instancer, its ID or an element's address `pile-fleet#<slot>.<gen>`).
//
// Not vacuous, each control a correct program can pass:
// - each of the four documents with `shore: "none"` is drawn (the base draws all four: the instancer whose columns read
//   arrays has no literal rows there, so it draws no element, and nothing at the base refuses it; README);
// - a static `pile-still` in the collection, with the shore on, is drawn;
// - a static instancer `pile-rows` (literal `pos` rows, no logic) in the collection, with the shore on, is drawn, so
//   what refuses `pile-fleet` is that logic moves it, not that it is an instancer.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, type JsonObject, PILE_SHORE, type Shore, STILL, answered, camItem, channel, collection, cylinder, look3d,
  pileDoc, refusedNaming, requireGpu, runGpu, shown, useGpu, useOut, view3d, writeJson,
} from '../268/helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [64, 64];
const CAM: Cam = { position: [0, 12, 0], target: [0, 0, 0], fov: 60, size: SIZE };
const LOOK = look3d('field-268-redraft');
const PILE_Y = -0.95;
const LOGIC = { scene3d: '^1', logic: '^1' };

/** A hidden pile, the prototype the instancers place (read for its instancers, drawn by none of its own). */
const proto = (): JsonObject => ({ ...cylinder([2, 2.1, 2], [0, PILE_Y, 0], 'pile-wood'), visible: false });

interface Mover { name: string; member: string; extra: Record<string, JsonObject>; docExtra: JsonObject }
/** The logic mover named: the instancer's ID, or one element's address `<instancer>#<slot>.<gen>`, as a whole ID. */
const FLEET = /(^|[^A-Za-z0-9_#-])pile-fleet(#[0-9]+(\.[0-9]+)?)?(?![A-Za-z0-9_#-])/;

const MOVERS: Mover[] = [
  { name: 'pile-keyed', member: 'pile-keyed',
    extra: { 'pile-keyed': cylinder([2, 2.1, 2], [5, PILE_Y, 5], 'pile-wood') },
    docExtra: { channels: { nudge: channel('items/pile-keyed/at/pos/0', [[0, 5], [10, 6]]) } } },
  { name: 'pile-clipped', member: 'pile-clipped',
    extra: { 'pile-clipped': cylinder([2, 2.1, 2], [5, PILE_Y, 5], 'pile-wood') },
    docExtra: {
      clips: { sway: { slots: { target: { type: 'mark.cylinder@1', required: true } }, span: 'auto', channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 5, interp: 'linear' }, k1: { t: '10s', value: 6, interp: 'linear' } } } } } },
      placements: { p: { clip: 'sway', slots: { target: 'pile-clipped' }, start: '0s' } },
    } },
  { name: 'harbour-world#pile-falling', member: 'harbour-world#pile-falling', docExtra: {},
    extra: { 'harbour-world': { kind: 'fixture.world@1', material: 'pile-wood', params: { step_hz: 120, span: '30s', gravity: -9.81, floor: -2, restitution: 0, bodies: { 'pile-falling': { radius: 1, pos: [5, 3, -5], vel: [0, 0, 0] } } } } } },
  { name: 'pile-fleet', member: 'pile-fleet',
    extra: {
      'pile-proto': proto(),
      'pile-fleet': { kind: 'instance@1', params: {
        of: ['pile-proto'],
        pos: { array: 'pilot.pos' }, live: { array: 'pilot.live', as: 'bool' }, gen: { array: 'pilot.gen', as: 'u32' },
      } },
      pilot: { kind: 'logic@1', params: { program: 'a'.repeat(64), step_rate: 60, reads: [], writes: {
        pos: { type: 'vec3', count: 1, interpolate: 'linear' }, live: { type: 'bool', count: 1 }, gen: { type: 'i32', count: 1 },
      } } },
    },
    docExtra: { requires: { modules: LOGIC } } },
];

describe(`${AC[4]} (redraft) a pile a channel, a clip, physics or logic moves is refused at check, naming it`, () => {
  it(`${AC[4]} a pile a channel, a clip, physics or logic moves is refused at check, naming it`, () => {
    requireGpu();
    const dir = out();
    const docOf = (k: number, shore: Shore | 'none'): JsonObject => {
      const m = MOVERS[k]!;
      return pileDoc(`moved-${k}`, SIZE, camItem(CAM), { ...STILL, shore }, { extra: m.extra, docExtra: m.docExtra, collections: { 'pile-shore': collection(['pile', m.member]) } });
    };
    const still = pileDoc('still', SIZE, camItem(CAM), { ...STILL, shore: PILE_SHORE }, {
      extra: { 'pile-still': cylinder([2, 2.1, 2], [5, PILE_Y, 5], 'pile-wood') }, collections: { 'pile-shore': collection(['pile', 'pile-still']) },
    });
    const rows = pileDoc('rows', SIZE, camItem(CAM), { ...STILL, shore: PILE_SHORE }, {
      extra: { 'pile-proto': proto(), 'pile-rows': { kind: 'instance@1', params: { of: ['pile-proto'], pos: [[5, 0, 5], [-5, 0, 5]] } } },
      collections: { 'pile-shore': collection(['pile', 'pile-rows']) },
    });
    const call = (name: string, doc: JsonObject) => view3d({ doc: writeJson(dir, name, doc), look: LOOK, size: SIZE, frames: 1, fps: 30 });
    const n = MOVERS.length;
    const replies = runGpu(bin(), dir, [
      ...MOVERS.map((_, k) => call(`shore-${k}`, docOf(k, PILE_SHORE))),
      ...MOVERS.map((_, k) => call(`plain-${k}`, docOf(k, 'none'))),
      call('still', still),
      call('rows', rows),
    ]);
    answered(replies[2 * n]!, 'the static pile-still in the shore\'s collection, shore on');
    answered(replies[2 * n + 1]!, 'the static instancer pile-rows (literal rows, no logic) in the shore\'s collection, shore on');
    MOVERS.forEach((m, k) => {
      answered(replies[n + k]!, `${m.name}'s document with shore none (the document is otherwise drawn)`);
      const r = replies[k]!;
      if (m.name === 'pile-fleet') {
        expect(r['code'], `the shore whose items hold pile-fleet is refused at check: ${shown(r)}`).toBeDefined();
        expect(r['code'], 'refused, not reported as a platform gap').not.toBe('unsupported_platform');
        expect(JSON.stringify(r), `the refusal names pile-fleet (or an element pile-fleet#<slot>.<gen>): ${shown(r)}`).toMatch(FLEET);
      } else {
        refusedNaming(r, m.name, `the shore whose items hold ${m.name}`);
      }
    });
  });
});
