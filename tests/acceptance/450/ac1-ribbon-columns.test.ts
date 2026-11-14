// AC1: "A particles item's instance columns at any time equal the played ones by evaluated-data hash, with bursts,
// bounces, turbulence and trails all on"
//
// The storm with ribbons (below): 512 particles in two bursts of 256 (at 0.1 and 0.9 s) from a 0.1 m ball, launched 2
// to 5 m/s up a cone under gravity with drag 0.8/s, bouncing in an open 3 m box (a floor y = −1 and walls x, z = ±1.5;
// restitution 0.6, at most 3 bounces, then rest), with turbulence of strength 0.15 m, drawn as ribbons of 8 segments
// over 0.2 s. `view3d` with #449's `particles` field plays frames 0 to 150 at 60 fps in one process, and fresh
// processes opened at frames 20, 61, 90 and 140 (#380's `from`) draw one frame each: each sought frame's evaluated-data
// hash, which for a ribbon covers every point of every live row's ribbon (README: view3d's particles), equals the
// played one's. Guards: the four played hashes differ and each frame has live particles; the `particles` call shows
// both bursts born, some particles bouncing and a turbulence table; and frame 90's hash (1.5 s, every live particle
// older than the ribbon's 0.2 s) is the SHA-256 this suite defines over the CPU f64 positions the `particles` call
// gives for each row at 1.5 s and at 1.5 s less 1 to 8 steps of 0.025 s, so the hash is of the ribbons as they trail
// back through earlier ages, and some row's ribbon spans more than a millimetre.

import { describe, expect, it } from 'vitest';
import {
  SPARK_LOOK, TIMEOUT, ac, camera, flicks, fmt, frameFlicks, framesOf, gap, markBox, none, particlesCall, particlesItem, passed,
  planeJson, reading, requireGpu, ribbonHash, run, sessionDoc, useBins, useDir, view3d, writeJson,
  type JsonObject, type Plane, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const FPS = 60;
const PLAYED = 150;
const SOUGHT = [20, 61, 90, 140];
const CHECKED = 90;
const RIBBON = { segments: 8, length: 0.2 } as const;
const STEP = flicks(RIBBON.length / RIBBON.segments);
const WALLS: Plane[] = [
  { normal: [0, 1, 0], offset: -1 },
  { normal: [-1, 0, 0], offset: -1.5 }, { normal: [1, 0, 0], offset: -1.5 },
  { normal: [0, 0, -1], offset: -1.5 }, { normal: [0, 0, 1], offset: -1.5 },
];
function stormDoc(): JsonObject {
  return sessionDoc('Storm with ribbons', {
    cam: camera([0, 1, 7], [0, 0, 0], 55),
    floor: markBox([3, 0.02, 3], [0, -1.01, 0], 'floor'),
    storm: particlesItem({
      count: 512, emit: { shape: 'sphere', radius: 0.1, bursts: [{ t: '0.1s', count: 256 }, { t: '0.9s', count: 256 }] }, life: [1.5, 2.5],
      motion: {
        ballistic: { v0: [2, 5], gravity: [0, -9.81, 0], drag: 0.8 },
        bounce: { planes: WALLS.map(planeJson), restitution: 0.6, friction: 0, max: 3, then: 'rest' },
      },
      turbulence: { strength: 0.15, frequency: 1, paths: 32, steps: 64, travel: 4, seed: 3 },
      ...SPARK_LOOK,
      draw: { ribbon: { segments: RIBBON.segments, length: RIBBON.length, width: 2, taper: 1, fade: 1 } },
    }),
  }, { transport: { span: '3s' } });
}

describe(`${ac(1)} a particles item's instance columns, with bursts, bounces, turbulence and ribbon trails on, sought equal played by evaluated-data hash`, () => {
  it(`${ac(1)} frames 20, 61, 90 and 140 sought in fresh processes give the played frames' evaluated-data hashes, which cover each live row's ribbon`, () => {
    requireGpu();
    const doc = writeJson(dir(), 'storm.json', stormDoc());
    const bin = bins.bin('deep-gpu');
    const [playedReply] = run(bin, dir(), [view3d({ doc, fps: FPS, from: 0, frames: PLAYED + 1, particles: ['storm'], particle_cull: 'none' })]);
    const played = new Map(framesOf(playedReply!, 'the storm, played', ['storm']).map((f) => [f.frame, f.particles.get('storm')!]));
    expect([...played.keys()], 'the played run holds frames 0 to 150').toEqual(Array.from({ length: PLAYED + 1 }, (_, n) => n));
    expect(new Set(SOUGHT.map((n) => played.get(n)!.hash)).size, 'the four frames\' evaluated data differ (the storm moves)').toBe(SOUGHT.length);
    for (const n of SOUGHT) expect(played.get(n)!.live, `frame ${n} has live particles`).toBeGreaterThan(0);

    // The hash is of the ribbons: frame 90's against the CPU f64 positions at its time and 1 to 8 ribbon steps before.
    const t = frameFlicks(CHECKED, FPS);
    const times = Array.from({ length: RIBBON.segments + 1 }, (_, j) => t - (RIBBON.segments - j) * STEP);
    const call = particlesCall({ doc, t: times });
    const [cpuReply] = run(bin, dir(), [call], { backend: 'noop' });
    const r = reading(passed(cpuReply!, call, 'the storm at frame 90 and its ribbon steps'), 'storm', 'the storm');
    expect(new Set(r.particles.map((p) => Math.round(p.born * 10))), 'both bursts are born, at 0.1 and 0.9 s').toEqual(new Set([1, 9]));
    expect(r.particles.some((p) => p.hits.length > 0), 'some particles bounce').toBe(true);
    expect(r.turbulence, 'the storm has its turbulence table').not.toBeNull();
    const at = (j: number): (V3 | null)[] => r.at[RIBBON.segments - j]!.cpu;
    const fails: string[] = [];
    const rows = at(0).map((p, row) => {
      if (p === null) return null;
      const ribbon = Array.from({ length: RIBBON.segments + 1 }, (_, j) => at(j)[row] ?? null);
      if (ribbon.some((q) => q === null)) fails.push(`particle row ${row}: live at 1.5 s but not at every ribbon step back to 1.3 s, so the guard's frame doesn't hold every ribbon whole`);
      return ribbon.map((q) => q ?? p);
    });
    none(fails, 'every particle live at frame 90 is older than its ribbon');
    expect(rows.some((rb) => rb !== null && gap(rb[0]!, rb[RIBBON.segments]!) > 1e-3), 'some live row\'s ribbon spans more than 1 mm (the ribbons trail)').toBe(true);
    expect(played.get(CHECKED)!.hash, 'frame 90\'s hash is the SHA-256 of each live row\'s ribbon of CPU f64 positions at 1.5 s and 1 to 8 steps of 0.025 s before (README: view3d\'s particles)').toBe(ribbonHash(rows));

    const seek: string[] = [];
    for (const n of SOUGHT) {
      const [reply] = run(bin, dir(), [view3d({ doc, fps: FPS, from: n, frames: 1, particles: ['storm'], particle_cull: 'none' })]);
      const sought = framesOf(reply!, `the storm, sought to frame ${n}`, ['storm']).find((f) => f.frame === n)?.particles.get('storm')?.hash;
      if (sought !== played.get(n)!.hash) seek.push(`frame ${n} (t = ${fmt(frameFlicks(n, FPS) / 705_600_000, 4)} s): seeking gives evaluated-data hash ${sought?.slice(0, 12)}, playing ${played.get(n)!.hash.slice(0, 12)}`);
    }
    none(seek, 'seek against play');
  }, TIMEOUT);
});
