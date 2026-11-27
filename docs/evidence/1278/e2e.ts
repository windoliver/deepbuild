// #1278 e2e hand run: the issue's repro through the shipped `deep-gpu run`, as a person would drive it.
// One process: four plays of the 97-frame view with no capture (the issue's repro), then a fifth play that
// captures frames 0, 48 and 96 as PNGs, so the picture can be looked at. Prints each frame whose four
// pixel_hash values differ, and where the PNGs went.
//   node --experimental-transform-types docs/evidence/1278/e2e.ts <deep-gpu binary> <out dir>
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAIN_LOOK, material, sessionDoc, sun, type JsonObject } from '../../../tests/acceptance/1278/helpers.ts';

const [bin, out] = process.argv.slice(2);
if (!bin || !out) throw Error('usage: e2e.ts <deep-gpu> <out dir>');
mkdirSync(out, { recursive: true });
const SIZE: [number, number] = [320, 240];

// The suite's repro document (tests/acceptance/1278/repro-plays.test.ts, reproDoc), unchanged.
const lights: Record<string, JsonObject> = {};
for (let i = 0; i < 30; i++) {
  const a = (2 * Math.PI * i) / 30;
  const r = 3 + (i % 3) * 0.75;
  lights[`lamp${String(i).padStart(2, '0')}`] = {
    kind: 'light.point@1', params: { power: 6, color: [1, 1, 1] },
    at: { pos: [Number((r * Math.sin(a)).toFixed(4)), 1 + (i % 5) * 0.5, Number((r * Math.cos(a)).toFixed(4))] },
  };
}
const d = 1.6; const az = Math.PI / 4;
const doc = sessionDoc('repro-1278', SIZE, {
  cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 0, elevation: 15, distance: 5 }, fov: 40, near: 0.1, far: 200 } },
  boxmat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 0.3 }),
  ballmat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 0.3 }),
  box: { kind: 'mark.box@1', params: { size: [0.9, 0.9, 0.9] }, at: { pos: [Number((d * Math.sin(az)).toFixed(4)), 0.2, Number((d * Math.cos(az)).toFixed(4))], rot: [0, 45, 0] }, material: 'boxmat' },
  ball: { kind: 'ball@1', params: { radius: 1, segments: 64 }, at: { pos: [0, 0, 0] }, material: 'ballmat' },
  sun: sun(0.6, [-50, 30, 0]),
  ...lights,
}, {
  channels: {
    orbit: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '3s', value: 90, interp: 'linear' } } },
    pull: { target: 'items/cam/params/orbit/distance', type: 'f32', keys: { k0: { t: '0s', value: 5, interp: 'linear' }, k1: { t: '3s', value: 25, interp: 'linear' } } },
  },
});
const docPath = join(out, 'repro.json');
writeFileSync(docPath, JSON.stringify(doc));
const play = (extra: JsonObject = {}): JsonObject => ({ call: 'view3d', doc: docPath, look: PLAIN_LOOK, size: SIZE, frames: 97, fps: 32, ...extra });
const calls = [play(), play(), play(), play(), play({ capture: [0, 48, 96], targets: ['final'] })];

const run = spawnSync(bin, ['run'], { input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
console.log(`deep-gpu run exited ${run.status}`);
if (run.status !== 0) { console.log(run.stderr.slice(-2000)); process.exit(1); }
const answer = JSON.parse(run.stdout.trim().split('\n')[0]!);
if (answer.ok !== true) { console.log(`refused: ${JSON.stringify(answer).slice(0, 800)}`); process.exit(1); }
const frames = (answer.replies as JsonObject[]).map((r) => r['frames'] as JsonObject[]);
for (const [p, f] of frames.entries()) console.log(`play ${p + 1}: ${f.length} frames, every one with a pixel_hash: ${f.every((x) => /^[0-9a-f]{64}$/.test(String(x['pixel_hash'])))}`);
let differing = 0;
for (let n = 0; n < 97; n++) {
  const four = frames.slice(0, 4).map((f) => String(f[n]!['pixel_hash']));
  if (new Set(four).size > 1) { differing++; console.log(`frame ${n}: ${four.map((h) => h.slice(0, 12)).join(' ')}`); }
}
console.log(`${differing} of 97 frames differ across the four plays`);
const shot = frames[4]!;
for (const n of [0, 48, 96]) {
  const f = shot[n]!;
  const same = String(f['pixel_hash']) === String(frames[0]![n]!['pixel_hash']);
  console.log(`frame ${n}: PNG ${out}/${String(f['final'])}.png, the captured play's pixel_hash matches play 1: ${same}`);
}
