// #429.df16a202: a material operator whose red is t ÷ 2 s, on an item inside a recipe instance reversed over 2 s,
// shows red 0.25 at parent time 1.5 s, as the item's own channels read child time 0.5 s.
//
// The material operator `redt` emits (t ÷ 2, 0, 0) over a black base color, so the linear target (#378's, before
// exposure) holds its red. The material `redm` attaches it (`material.op`). The test pack test/remap
// (fixtures/packs) has one recipe, remap.cube@1: a 1 m box with material `redm` whose own channel keys its width
// from 1 m at 0 s to 3 m at 2 s. The document's instance `inst` of it is reversed by a time remap (`time_remaps:
// {rev: {target: inst, map: reverse}}`, over the document's 2 s span: child time = 2 s − parent time), and a
// control box `ctl` outside it carries the same material. Through `view3d` with two fields this suite adds
// (README): `packs`, installed before the document's check, and `evaluate`, the paths whose evaluated values each
// frame reports. At parent time 1.5 s (frame 90 at 60 fps): the instance's box reads red 0.25 and width 1.5 m
// (child time 0.5 s), the control reads red 0.75. At the base no item can be a GPU operator and nothing remaps time.
import { describe, expect, it } from 'vitest';
import { LOOK, asItem, box, camera, fixturePath, frameOf, linearAt, num, requireGpu, run1, sceneDoc, useBins, useOut, view3dFrames, writeJson, type JsonObject } from './helpers.ts';

const bins = useBins();
const out = useOut();
const SIZE: [number, number] = [128, 64];

const REDT: JsonObject = {
  id: 'redt', kind: 'material', origin: 'composed', about: 'Emits red t ÷ 2 s over a black base color.', inputs: {},
  steps: {
    tt: { op: 't@1', args: {} },
    r: { op: 'div@1', args: { a: 'tt', b: 2 } },
    z: { op: 'const@1', args: { value: 0, type: 'f32' } },
    e: { op: 'compose@1', args: { x: 'r', y: 'z', z: 'z' } },
    k: { op: 'const@1', args: { value: [0, 0, 0], type: 'vec3' } },
  },
  outputs: { emission: 'e', base_color: 'k' }, cost: { ns_per_px: 50 },
};

describe('#429.df16a202 a material operator inside a reversed recipe instance reads the item\'s child time', () => {
  it('#429.df16a202 at parent time 1.5 s the instance\'s box shows red 0.25 and its own channel reads child time 0.5 s, while a box outside it shows red 0.75', () => {
    requireGpu();
    const dir = out();
    const doc = sceneDoc('remap-429', {
      cam: camera([0, 0, 6]),
      redt: asItem(REDT),
      redm: { kind: 'material@1', params: { op: 'redt' } },
      inst: { kind: 'remap.cube@1', params: {}, at: { pos: [-1.2, 0, 0] } },
      ctl: box([1.2, 0, 0], { material: 'redm' }),
    }, { transport: { span: '2s' }, packs: ['test/remap@1.0.0'], time_remaps: { rev: { target: 'inst', map: 'reverse' } } });
    const frames = view3dFrames(run1(bins.bin(), dir, {
      call: 'view3d', doc: writeJson(dir, 'remap.json', doc), look: LOOK, size: SIZE, fps: 60, from: 90, frames: 1, targets: ['linear'], capture: 'every',
      packs: [{ id: 'test/remap', dir: fixturePath('packs', 'test-remap-1.0.0') }], evaluate: ['items/inst.box/params/size/0'],
    }), 'view3d at frame 90');
    const f = frameOf(frames, 90, 'view3d');
    expect(num(f.values['items/inst.box/params/size/0'], 'the instance box\'s width'), 'its own channel reads child time 0.5 s: width 1 + 0.5 × 2 ÷ 2 = 1.5 m').toBeCloseTo(1.5, 5);
    const [ir, ig, ib] = linearAt(dir, f.linear, SIZE, 40, 32, 'the instance box');
    expect(ir, 'the instance box shows red t ÷ 2 at child time 0.5 s').toBeCloseTo(0.25, 2);
    expect(Math.max(Math.abs(ig), Math.abs(ib)), 'and no green or blue').toBeLessThan(0.005);
    const [cr] = linearAt(dir, f.linear, SIZE, 88, 32, 'the control box');
    expect(cr, 'the box outside the instance shows red t ÷ 2 at parent time 1.5 s').toBeCloseTo(0.75, 2);
  }, 1_800_000);
});
