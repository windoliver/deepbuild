// #166.59c5001c: "A buoyant body pushed by an input entry at 5 s gives the same pixel hash at 20 s seeked and played, its
// wake read from the physics output kept that far back; and a wake behind an item a logic array moves is refused at
// check, naming the item"
//
// The physics module (#97) isn't in the base, so the body is #419's stand-in for it, `fixture.world@1` (baked at check
// from step 0 through its span; each body drawn as the sphere `<world>#<body>` at the bake's position at t, lerped
// between steps, so the drawing reads the physics output and never steps the world), with the two fields this criterion
// needs added (README): `buoyancy` (the world's fluid plane and density; each body's `density`) and `inputs` (input
// track entries `{step, kind: "poke", target, data: {push}}`).
//
// Clause 1 (320 × 180): the world `harbour-world` (120 Hz, span 25 s, so its output is kept back past 20 s − 8 s) holds
// the body `skiff` (radius 0.4 m, density 500 kg/m³) dropped at x = −6 m onto the water's plane y = 0 (fluid density
// 1,000 kg/m³, the lake's floor 10 m down), and an entry at step 600 (5 s) pokes it to 0.6 m/s along +X. The lake's
// material carries STEEP_WAVES, foam at 0.6 and `wake: {item: "harbour-world#skiff", span: 8}`. Frame 600 (20 s at 30
// fps) played from frame 0 and opened cold by a seek have one pixel hash. Not vacuous: at 20 s the same world without the
// entry, the same world without buoyancy (the body sinks), and the same lake with no wake each draw another frame.
// Clause 2: a skiff `skiff` (a box) whose x a driver reads from the logic item `pilot`'s array `pilot.x`, with the
// lake's wake behind `skiff`: the view3d call is refused at check (a `code`), and the refusal names `skiff`. The same
// lake with the skiff keyed on a channel instead (no driver, no logic item) is drawn, so it is the logic array that is
// refused. Wrong programs: a wake read from earlier frames (a cold seek has none), a wake that reads a logic array's
// earlier steps, a refusal that names no item.
import { describe, expect, it } from 'vitest';
import {
  AC, type JsonObject, STEEP_WAVES, type Water, answered, box, camera, channel, hashAt, look3d, material, plate, requireGpu, runGpu, sceneDoc, shown,
  sun, DAY_SKY, useGpu, useOut, view3d, waterMaterial, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [320, 180];
const LOOK = look3d('physics-166');
const AT = 600;

function shore(id: string, water: Water, extra: Record<string, JsonObject>, docExtra: JsonObject = {}): JsonObject {
  return sceneDoc(id, SIZE, {
    cam: camera([0, 3, 14], [0, 0.3, 0], 50), sky: DAY_SKY, sun: sun(3, [-35, 30, 0]),
    'lake-water': waterMaterial(water, { roughness: 0.05 }), 'hull-white': material({ base_color: [0.9, 0.9, 0.88, 1], roughness: 0.4 }),
    lake: plate([40, 40], [256, 256], [0, 0, 0], 'lake-water'), ...extra,
  }, docExtra);
}
function world(opts: { poke: boolean; buoyant: boolean }): JsonObject {
  const params: JsonObject = {
    step_hz: 120, span: '25s', gravity: -9.81, floor: -10, restitution: 0,
    bodies: { skiff: { radius: 0.4, pos: [-6, 0.6, 1], vel: [0, 0, 0], density: 500 } },
  };
  if (opts.buoyant) params['buoyancy'] = { level: 0, density: 1000 };
  if (opts.poke) params['inputs'] = [{ step: 600, kind: 'poke', target: 'skiff', data: { push: [0.6, 0, 0] } }];
  return { kind: 'fixture.world@1', params, material: 'hull-white' };
}
const WAKE: Water = { waves: STEEP_WAVES, foam: { threshold: 0.6 }, wake: { item: 'harbour-world#skiff', span: 8 } };

describe(`${AC[9]} a wake behind a floating body reads the physics output; one behind a logic array is refused`, () => {
  it(`${AC[9]} a buoyant body poked at 5 s gives one pixel hash at 20 s seeked and played, its wake read from the physics output`, () => {
    requireGpu();
    const dir = out();
    const doc = writeJson(dir, 'float', shore('float', WAKE, { 'harbour-world': world({ poke: true, buoyant: true }) }));
    const at20 = (name: string, d: JsonObject) => view3d({ doc: writeJson(dir, name, d), look: LOOK, size: SIZE, from: AT, frames: 1, fps: 30 });
    const [played, seeked, unpoked, sunk, unwoken] = runGpu(bin(), dir, [
      view3d({ doc, look: LOOK, size: SIZE, frames: AT + 1, fps: 30 }), view3d({ doc, look: LOOK, size: SIZE, from: AT, frames: 1, fps: 30 }),
      at20('unpoked', shore('unpoked', WAKE, { 'harbour-world': world({ poke: false, buoyant: true }) })),
      at20('sunk', shore('sunk', WAKE, { 'harbour-world': world({ poke: true, buoyant: false }) })),
      at20('unwoken', shore('unwoken', { ...WAKE, wake: 'none' }, { 'harbour-world': world({ poke: true, buoyant: true }) })),
    ]);
    const p = hashAt(played!, AT, 'the played film');
    expect(hashAt(seeked!, AT, 'the seek to 20 s'), 'the frame seeked to 20 s equals the one played to 20 s').toBe(p);
    expect(hashAt(unpoked!, AT, 'the world without the entry'), 'the entry at 5 s moves the body: without it 20 s differs').not.toBe(p);
    expect(hashAt(sunk!, AT, 'the world without buoyancy'), 'the body floats: without buoyancy 20 s differs').not.toBe(p);
    expect(hashAt(unwoken!, AT, 'the lake with no wake'), 'the wake shows: without it 20 s differs').not.toBe(p);
  });

  it(`${AC[9]} a wake behind an item a logic array moves is refused at check, naming the item`, () => {
    requireGpu();
    const dir = out();
    const wake: Water = { waves: STEEP_WAVES, foam: { threshold: 0.6 }, wake: { item: 'skiff', span: 8 } };
    const steered = shore('steered', wake, {
      skiff: box([1.8, 0.5, 0.7], [-6, 0.15, 1], 'hull-white'),
      pilot: { kind: 'logic@1', params: { program: 'a'.repeat(64), step_rate: 60, reads: [], writes: { x: { type: 'f64', count: 1, interpolate: 'linear' } } } },
    }, { requires: { modules: { scene3d: '^1', logic: '^1' } }, drivers: { steer: { target: 'items/skiff/at/pos/0', expr: 'x', vars: { x: 'pilot.x' } } } });
    const keyed = shore('keyed', wake, { skiff: box([1.8, 0.5, 0.7], [-6, 0.15, 1], 'hull-white') }, { channels: { sail: channel('items/skiff/at/pos/0', [[0, -6], [20, 6]]) } });
    const [refused, drawn] = runGpu(bin(), dir, [
      view3d({ doc: writeJson(dir, 'steered', steered), look: LOOK, size: SIZE, frames: 1, fps: 30 }),
      view3d({ doc: writeJson(dir, 'keyed', keyed), look: LOOK, size: SIZE, frames: 1, fps: 30 }),
    ]);
    answered(drawn!, 'the wake behind the channel-keyed skiff');
    expect(refused!['code'], `the wake behind the logic-steered skiff is refused at check: ${shown(refused)}`).toBeDefined();
    expect(refused!['code'], 'refused, not reported as a platform gap').not.toBe('unsupported_platform');
    expect(JSON.stringify(refused), `the refusal names the item skiff: ${shown(refused)}`).toMatch(/\bskiff\b/);
  });
});
