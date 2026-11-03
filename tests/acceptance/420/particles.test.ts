// AC1: "Particles seeked to a time equal particles played to it, on the same machine's pixel hash"
//
// Four documents, one per motion of `particles@1` (ballistic, along a curve, orbit, drift), each with a different
// draw (dot, streak, spark, puff) and its own emitter shape, under a still camera, so only the particles move.
// Played: frames 0 … 120 at 60 fps in one `view3d` call. Sought: a fresh process opening the document at frame 17,
// 45, 90 and 120 (`from`, #380), drawing that frame first. Each sought frame's pixel hash equals the played frame's
// on this machine; a second play equals the first at frame 120; the four frames differ from one another (the
// particles move, so a frame drawn for the wrong time shows); and each differs from the same document with the
// particles item removed (they draw). The planted `particles_integrate` (a mutant: the compute operator steps each
// particle from the previous frame's state instead of its closed form in age, index and seed) must fail, naming
// the document and a sought frame. Pixels come from the GPU layer on Metal: INCONCLUSIVE off macOS.

import { describe, expect, it } from 'vitest';
import {
  AC, clone, failsNaming, frameAt, look, none, obj, requireGpu, runGpu, sessionDoc, useBins, useDir, view3Reply, view3d, writeJson,
  type JsonObject, type Startup,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const FPS = 60;
const LAST = 120;
const SOUGHT = [17, 45, 90, 120];
const SIZE: [number, number] = [320, 240];

const box = (pos: [number, number, number], role: string): JsonObject => ({ kind: 'mark.box@1', params: { size: [0.3, 0.3, 0.3], paint: { fill: { role } } }, at: { pos } });
const common = { count: 4096, life: [0.6, 1.4], size: 3, opacity: 1, color: [{ at: 0, role: 'spark-a' }, { at: 1, role: 'spark-b' }] };
/** One particles item per motion, with its draw and emitter. */
const MOTIONS: Record<string, JsonObject> = {
  ballistic: { ...common, emit: { anchor: 'src', shape: 'sphere', rate: 900, span: 3 }, motion: { ballistic: { v0: [1, 3], gravity: [0, -9.8, 0], drag: 0.3 } }, draw: 'dot' },
  along: { ...common, emit: { anchor: 'src', shape: 'point', rate: 600, span: 3 }, motion: { along: { curve: 'path', speed: 1.5 } }, draw: 'streak' },
  orbit: { ...common, emit: { anchor: 'src', shape: 'disk', rate: 700, span: 3 }, motion: { orbit: { axis: [0, 1, 0], rate: 120 } }, draw: 'spark' },
  drift: { ...common, emit: { anchor: 'src', shape: 'sphere', rate: 500, span: 3 }, motion: { drift: { amplitude: 0.4, frequency: 0.7 } }, draw: 'puff', resolution: 'half' },
};

function particlesDoc(motion: string, withParticles = true): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 2, 9], target: [0, 1.2, 0], fov: 45 } },
    floor: { kind: 'mark.box@1', params: { size: [12, 0.1, 12], paint: { fill: { role: 'floor' } } }, at: { pos: [0, -0.05, 0] } },
    src: box([0, 1, 0], 'lamp'),
    path: { kind: 'curve@1', params: { points: [[-3, 1, 0], [-1, 2.5, 0], [1, 2.5, 0], [3, 1, 0]], mode: 'catmull_rom' } },
  };
  if (withParticles) items['sparks'] = { kind: 'particles@1', params: clone(MOTIONS[motion]!), at: { pos: [0, 1.2, 0] } };
  return sessionDoc(`Particles ${motion}${withParticles ? '' : ' bare'}`, items, {
    size: SIZE, camera: 'cam', seed: 7, transport: { span: '3s' }, requires: { modules: { scene3d: '^1', effects: '^1' } },
  });
}

function hashes(doc: JsonObject, name: string, from: number, frames: number, startup: Startup = {}): Map<number, string> {
  const path = writeJson(dir(), `${name}.json`, doc);
  const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [view3d({ doc: path, look: look(), size: SIZE, fps: FPS, from, frames })], startup);
  const frames3 = view3Reply(reply!, name);
  const want = Array.from({ length: frames }, (_, i) => from + i);
  expect(frames3.map((f) => f.frame), `${name}: the frames from ${from}, in order`).toEqual(want);
  return new Map(want.map((n) => { const f = frameAt(frames3, n, name); expect(f.pixel_hash, `${name}: frame ${n} has a pixel hash`).not.toBeNull(); return [n, f.pixel_hash!]; }));
}

/** Seek against play for one motion; each failure names the motion and the frame. */
function seekProblems(motion: string, startup: Startup = {}): string[] {
  const out: string[] = [];
  const doc = particlesDoc(motion);
  const play = hashes(doc, `${motion}-play`, 0, LAST + 1, startup);
  const again = hashes(doc, `${motion}-again`, 0, LAST + 1, startup);
  const bare = hashes(particlesDoc(motion, false), `${motion}-bare`, 0, LAST + 1, startup);
  const seen = new Set(SOUGHT.map((n) => play.get(n)));
  if (seen.size !== SOUGHT.length) out.push(`${motion}: frames ${SOUGHT.join(', ')} aren't all different, so the particles don't move and seeking can't be told from playing`);
  for (const n of SOUGHT) {
    if (play.get(n) === bare.get(n)) out.push(`${motion}: frame ${n} is the same with and without the particles, so they draw nothing there`);
    const sought = hashes(doc, `${motion}-seek-${n}`, n, 1, startup).get(n);
    if (sought !== play.get(n)) out.push(`${motion}: seeking to frame ${n} draws ${sought?.slice(0, 12)}, playing to it ${play.get(n)?.slice(0, 12)}`);
  }
  if (again.get(LAST) !== play.get(LAST)) out.push(`${motion}: two plays differ at frame ${LAST}`);
  return out;
}

describe(`${AC[1]} particles seeked to a time equal particles played to it`, () => {
  for (const motion of Object.keys(MOTIONS)) {
    it(`${AC[1]} ${motion} particles (${String(obj(MOTIONS[motion], 'the motion')['draw'])}): seeking to frames ${SOUGHT.join(', ')} equals playing to them on this machine's pixel hash`, () => {
      requireGpu();
      none(seekProblems(motion), `${motion} particles, seek against play`);
    }, 1_800_000);
  }

  it(`${AC[1]} the planted particles_integrate (a mutant that steps particles from the last frame) fails seek against play, naming the frame`, () => {
    requireGpu();
    failsNaming(seekProblems('ballistic', { planted: 'particles_integrate' }), ['ballistic', 'seeking to frame'], 'the planted particles_integrate');
  }, 1_800_000);
});
