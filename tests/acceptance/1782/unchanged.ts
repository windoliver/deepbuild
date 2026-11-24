// AC8's second sentence compares frames with the base's: "With `hidden` unset and `material` false, each of #1640's
// fixtures draws the same frame by pixel hash as before this change". This file is the list of those frames, shared
// by unchanged.test.ts, which draws them and compares, and record-base.ts, which drew them once at the base and
// wrote their hashes to fixtures/base-frames.json. It has no vitest call of its own, so plain node can load it.
//
// #1640's fixtures, as its tests draw them, with #1640's own document builders and look:
// - AC1 and AC2: `fixtures/parity/geometry/crease-edges.scene` (the cube, cylinder, ball and plane with their lines).
// - AC4: the crease cube in its three-quarter view, solid, with a screen dash of 8 px and with a world dash of 0.1 m.
// - AC3: the folded sheet's orbit, 600 frames at 60 fps, of which frames 0, 150, 300 and 450 are drawn.
// The canary is the AC4 cube with no line at all: no mesh edge draws in it, so this change can't alter it, and a
// machine that draws it differently from the recording one can't be compared with the recording.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANGLE, ORBIT, creaseEdges, edgeLine, fixture, look, sessionDoc, view3d, writeFile, type JsonObject, type LineSpec,
} from '../1640/helpers.ts';
import { foldedSheet, gltf } from '../1640/reference.ts';

/** The base commit the hashes were recorded at. */
export const BASE = '16dc5eab0';
/** fixtures/base-frames.json: `{base, frames: {name → pixel_hash}}`, the canary among the frames. */
export const BASE_FRAMES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'base-frames.json');
export const CANARY = 'canary: the cube with no line';
const SIZE: [number, number] = [640, 480];
const ORBIT_FRAMES = [0, 150, 300, 450];

const CUBE_CAMERA: JsonObject = { kind: 'camera@1', params: { projection: 'perspective', position: [2.4, 1.9, 3.2], target: [0, 0.25, 0], fov: 35, near: 0.1 } };
const CUBE: JsonObject = { kind: 'slab@1', params: { size: [1, 1, 1] }, at: { pos: [0, 0, 0] } };
/** #1640's AC4 lines: solid, a screen dash, a world dash. */
const CUBE_LINES: Record<string, Omit<LineSpec, 'edges'>> = {
  'cube, solid': { width: 3, size_space: 'screen' },
  'cube, screen dash': { width: 3, size_space: 'screen', dash: [8, 8] },
  'cube, world dash': { width: 0.02, size_space: 'world', dash: [0.1, 0.1] },
};

export interface NamedCall { name: string; call: JsonObject }
/** Every frame's `view3d` call, the canary first; its documents and the sheet's glTF are written under `dir`. */
export function baseCalls(dir: string): NamedCall[] {
  const one = (name: string, file: string, doc: JsonObject, more: JsonObject = {}): NamedCall =>
    ({ name, call: { ...view3d({ doc: writeFile(dir, file, doc), look: look(), size: SIZE, frames: 1 }), ...more } });
  const calls = [
    one(CANARY, 'canary.json', sessionDoc('Canary cube', { cam: CUBE_CAMERA, cube: CUBE })),
    one('crease-edges.scene', 'crease-edges.json', sessionDoc('Crease edges', fixture('parity', 'geometry', 'crease-edges.scene')['items'] as Record<string, JsonObject>)),
  ];
  Object.entries(CUBE_LINES).forEach(([name, spec], i) => {
    calls.push(one(name, `cube-${i}.json`, sessionDoc('Crease cube', { cam: CUBE_CAMERA, cube: CUBE, crease: edgeLine({ edges: creaseEdges('cube'), ...spec }) })));
  });
  const sheet = gltf(foldedSheet());
  const asset = writeFile(dir, `${sheet.sha}.gltf`, sheet.bytes);
  const orbit = sessionDoc('Crease orbit', {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.5, 0], orbit: { azimuth: 0, elevation: 35, distance: 9 }, fov: 40, near: 0.1 } },
    sheet: { kind: 'mesh.asset@1', params: { sha256: sheet.sha, node: 0 }, at: { pos: [0, 0, 0] } },
    sheet_crease: edgeLine({ edges: creaseEdges('sheet', ANGLE, false), width: 2 }),
  }, {
    transport: { span: `${ORBIT.seconds}s` },
    channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: `${ORBIT.seconds}s`, value: 360 } } } },
  });
  for (const frame of ORBIT_FRAMES) calls.push(one(`orbit, frame ${frame}`, 'orbit.json', orbit, { fps: ORBIT.fps, from: frame, assets: { [sheet.sha]: asset } }));
  return calls;
}

/** The one frame's `pixel_hash` in a `view3d` reply, or why there is none. */
export function hashOf(reply: JsonObject): { hash: string } | { why: string } {
  if (reply['code'] !== undefined) return { why: `refused: ${JSON.stringify(reply).slice(0, 300)}` };
  const frames = reply['frames'];
  const frame = Array.isArray(frames) && frames.length === 1 ? frames[0] : undefined;
  const hash = frame !== null && typeof frame === 'object' && !Array.isArray(frame) ? frame['pixel_hash'] : undefined;
  return typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash) ? { hash } : { why: `no pixel hash in ${JSON.stringify(reply).slice(0, 300)}` };
}
