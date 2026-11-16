// #251.74b37407: "Shown to you: screenshots of the vehicle at rest on its springs, the steering fixture and the course
// lap, taken by the check run from the renderer's own output, with a recording of the lap, are attached to the PR and
// shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// Three scenes (README: The taste call), each a scene document listing its world as `lab`, the chassis drawn by a box
// and each wheel by a cylinder on its hub, both moved by the world's own pose outputs (`to` an item's `at`): the car
// set down on its springs (screenshot at 3 s), the steering fixture rolling at 3 m/s with steer 15° (at 4 s), and the
// course lap (at 6 s), each world's track given to `view3d` as `tracks` (README). The screenshots are `view3d` frames'
// final targets at 640 × 360 as the renderer wrote them (#378's PNGs, kept byte for byte); the recording is the lap's
// final PNGs at 320 × 180 and 15 fps over its 10 s, put into one animated PNG unchanged (#252's apng). They are kept in
// DEEPBUILD_EVIDENCE_DIR (else a folder under the temporary folder) and their paths printed, for the PR and the session.
// The taste call is a file you record, named by DEEPBUILD_TASTE_251: {"criterion": "#251.74b37407", "by": "you",
// "screenshots": [sha256 × 3], "recordings": [sha256], "call": "looks_right" | "looks_wrong"}. With no record, or one on
// other files, the test fails as INCONCLUSIVE; looks_wrong fails it. No other test in this suite reads a picture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOOK, apng, cleanBuilds, forGpu, gpu, readPng, sha256 } from '../524/helpers.ts';
import {
  CRITERIA, HALF, LAP_TRACK, RADIUS, REST_Y, SETTLED_Y, TIMEOUT, WHEEL_NAMES, arr, ask, baked, carWorld, inconclusive, kart, lapWorld,
  num, obj, prebuild, sceneBake, steer, useTemp, vehicleInputs, type JsonObject,
} from './helpers.ts';

prebuild();
cleanBuilds();
const temp = useTemp();

const ID = CRITERIA[10];
const FPS = 30;
const SHOT: [number, number] = [640, 360];
const REC: [number, number] = [320, 180];
const REC_FPS = 15;
const LAP_S = 10;

/** A scene in the agent's form listing `w` as `lab`, the chassis and wheels drawn from its pose outputs. */
function sceneOf(title: string, span: number, w: JsonObject, camera: { position: number[]; target: number[] }): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', ...camera, fov: 50, near: 0.1, far: 400 } },
    floor: { kind: 'mark.box@1', params: { size: [200, 0.2, 200] }, at: { pos: [0, -0.1, 0] } },
    body: { kind: 'mark.box@1', params: { size: HALF.map((h) => 2 * h) } },
  };
  const outputs: JsonObject = { body: { from: 'kart', read: 'pose', to: 'items/body/at' } };
  for (const n of WHEEL_NAMES) {
    items[`hub_${n}`] = { kind: 'mark.box@1', params: { size: [0.04, 0.04, 0.04] } };
    items[`tyre_${n}`] = { kind: 'mark.cylinder@1', parent: `hub_${n}`, params: { size: [2 * RADIUS, 0.25, 2 * RADIUS] }, at: { rot: [0, 0, 90] } };
    outputs[`hub_${n}`] = { from: `kart#${n}`, read: 'pose', to: `items/hub_${n}/at` };
  }
  const withIds: JsonObject = {};
  Object.entries(items).forEach(([id, item], i) => { withIds[id] = { id, name: id, order: `a${String(i).padStart(3, '0')}`, ...item }; });
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #251 acceptance fixture.`, size: SHOT, camera: 'cam',
    transport: { span: `${span}s`, frame_rate: [FPS, 1] }, requires: { modules: { scene3d: '^1' } },
    worlds: { lab: { ...w, inputs: vehicleInputs({ reset: true }), outputs } }, items: withIds,
  };
}
const SCENES: { name: string; span: number; at: number; track: JsonObject[]; doc: JsonObject }[] = [
  { name: 'at-rest', span: 4, at: 3, track: [], doc: sceneOf('Car at rest on its springs', 4, carWorld(kart([0, REST_Y, 0], { sleep: false })), { position: [4.5, 2.2, 5.5], target: [0, 0.5, 0] }) },
  { name: 'steering', span: 6, at: 4, track: [steer(0, 15)], doc: sceneOf('Steering at 15 degrees', 6, carWorld(kart([0, SETTLED_Y, 0], { sleep: false, velocity: { linear: [0, 0, 3] } })), { position: [9.3, 24, -14], target: [9.3, 0, -1] }) },
  { name: 'lap', span: LAP_S, at: 6, track: LAP_TRACK, doc: sceneOf('Course lap', LAP_S, lapWorld({ on: false }), { position: [0, 95, 0.01], target: [0, 0, 0] }) },
];

describe(`${ID} one taste call on the renderer's own screenshots of the car at rest, steering and on the lap, and a recording of the lap`, () => {
  it(`${ID} the three screenshots and the lap's recording, from the renderer's own frames, and the recorded taste call says they look right`, () => {
    // Each scene's world bakes in its scene on the physics module (#1918's call) before anything is drawn.
    const bakes = ask(SCENES.map((s) => sceneBake(s.doc, 'lab', s.span * 120, { track: s.track, frame_rate: '120/1', read: ['kart'] })), undefined, 'the scenes\' worlds');
    bakes.forEach((b, i) => baked(b, `the ${SCENES[i]!.name} scene's world`));
    if (process.platform !== 'darwin') inconclusive(`the renderer draws its frames on macOS's Metal device; this is ${process.platform}`);
    const out = temp();
    const docs = SCENES.map((s) => { const p = join(out, `${s.name}.json`); writeFileSync(p, JSON.stringify(forGpu(s.doc, `${s.name}-251`))); return p; });
    const lap = SCENES.length - 1;
    const calls: JsonObject[] = SCENES.map((s, i) => ({ call: 'view3d', look: LOOK, doc: docs[i]!, size: SHOT, fps: FPS, from: s.at * FPS, frames: 1, capture: [s.at * FPS], targets: ['final'], tracks: { lab: s.track } }));
    calls.push({ call: 'view3d', look: LOOK, doc: docs[lap]!, size: REC, fps: REC_FPS, from: 0, frames: LAP_S * REC_FPS, capture: 'every', targets: ['final'], tracks: { lab: LAP_TRACK } });
    const replies = gpu(out, calls);
    const framesOf = (reply: JsonObject, what: string): JsonObject[] => {
      if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
      expect(reply['code'], `${what} is drawn, not refused: ${JSON.stringify(reply).slice(0, 800)}`).toBeUndefined();
      return arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
    };
    const keep = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-251-taste');
    mkdirSync(keep, { recursive: true });
    const screenshots = SCENES.map((s, i) => {
      const shot = framesOf(replies[i]!, `${s.name}: the screenshot`).find((f) => f['frame'] === s.at * FPS);
      expect(shot, `${s.name}: the screenshot's frame ${s.at * FPS} is in the reply`).toBeDefined();
      const png = readPng(out, shot!['final'], `${s.name}: the screenshot`);
      const file = join(keep, `${s.name}-${sha256(png)}.png`);
      writeFileSync(file, png);
      console.log(`for the taste call: ${file}`);
      return sha256(png);
    });
    const frames = framesOf(replies[SCENES.length]!, 'the lap: the recording');
    expect(frames.map((f) => num(f['frame'], 'a recording frame')), `the recording holds frames 0 to ${LAP_S * REC_FPS - 1}`).toEqual(Array.from({ length: LAP_S * REC_FPS }, (_, i) => i));
    const anim = apng(frames.map((f) => readPng(out, f['final'], `the lap: recording frame ${String(f['frame'])}`)), REC_FPS, 'the lap: the recording');
    const recFile = join(keep, `lap-${sha256(anim)}.apng`);
    writeFileSync(recFile, anim);
    console.log(`for the taste call: ${recFile}`);
    const recordings = [sha256(anim)];
    const path = process.env['DEEPBUILD_TASTE_251'];
    const files = `screenshots ${screenshots.join(', ')}; recording ${recordings.join(', ')}`;
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these files (${files}); record yours in a file named by DEEPBUILD_TASTE_251`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; recordings?: string[]; call?: string };
    const same = (a: string[] | undefined, b: string[]): boolean => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
    if (record.criterion !== ID || record.by !== 'you' || !same(record.screenshots, screenshots) || !same(record.recordings, recordings)) {
      inconclusive(`the recorded taste call at ${path} isn't yours on these files (${files})`);
    }
    expect(record.call, 'your taste call').toBe('looks_right');
  }, 4 * TIMEOUT);
});
