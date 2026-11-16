// AC3 #451.9c598890: "Particles with `along.curves: <field>#streams` on the field (−y, x) stay within 1e-4 of their
// stream's sub-path at 100 sampled times, seeking equal to playing by hash; a planted emitter that moves them along the
// field's arrows instead leaves the streams and fails, naming the item"
//
// The field `field` (vector_field@1, fn (−y, x), no scales, so its coordinates are document u) with four streams from
// (1, 0), (1.5, 0), (2, 0) and (2.5, 0), integrated by RK4 at step 0.005 for time 6.2, pad 4, max_points 2048; and the
// 2D particles item `flow`: 64 rows, life 3 s, born 16 a second, `motion.along.curves: ["field#streams"]` at 0.5 to
// 1 u/s, so a particle travels at most 3 u, short of every stream's length (6.2 × its radius). Each stream's sub-path,
// `field#s<i>`, is the polyline of its points; the test integrates the same RK4 steps itself (`stream` below) as the
// reference. At step 0.005 that polyline lies within 8e-6 of the circle it follows, so a particle on the polyline and
// one on the circle both hold 1e-4.
//
// The 100 sampled times are frames 105 to 299 at 30 fps (3.5 s to 10 s), drawn by mulberry32 from seed 4513, where all
// 48 particles a 3 s life holds are live. At each: 48 live particles, each one's particle moving along one of
// `field#s0` to `field#s3`, within 1e-4 of that stream's polyline. Guards: every stream carries particles, each particle
// is further along its stream at each later time it is read, and at least 80% of the places read are 0.1 u or more along
// their stream (there a straight line along the arrow at the birth point is 2e-3 u or more off the circle). The planted
// emitter `deep-gpu run --planted particles_follow_arrows` (README: The planted program) moves each particle in a straight
// line along the field's arrow at its birth point instead; the same judge must fail on it, naming `flow`.
//
// Seeking equal to playing by hash (helpers.ts: seekEqualsPlay): `film2d` plays the film from frame 0 to 299 in one
// process, and fresh processes open it at frames 120, 211 and 288; at each of the 100 frames the played frame's
// evaluated-data hash of `flow` is the hash of the evaluation's places there, and each sought frame's the played one's.

import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, ac, doc2d, dots, failsNaming, frameT, liveAt, nearest, none, particlesCall, pickFrames, reading2d, requireGpu, run,
  seekEqualsPlay, useBins, useDir, writeJson,
  type JsonObject, type P2, type Planted, type Reading2,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const RADII = [1, 1.5, 2, 2.5] as const;
const STEP = 0.005;
const TIME = 6.2;
const LIVE = 48;
const FRAMES = pickFrames(4513, 100, 105, 299);
const TIMES = FRAMES.map(frameT);
const TOLERANCE = 1e-4;

const streamsDoc = (): JsonObject => doc2d('streams', 'Particles on the streams of (-y, x)', [640, 480], {
  field: { kind: 'vector_field@1', params: { fn: { x: '-y', y: 'x' }, streams: { starts: { points: RADII.map((r) => [r, 0, 0]) }, step: STEP, time: TIME, pad: 4, max_points: 2048 } } },
  flow: { kind: 'particles@1', params: { dimensions: 2, count: 64, life: 3, emit: { rate: 16 }, motion: { along: { curves: ['field#streams'], speed: [0.5, 1] } }, ...dots('accent', 3) } },
});

/** Stream i of (−y, x) from (r, 0): classic RK4 at the field's step for its time, every point from the start. */
function stream(r: number): P2[] {
  const f = (p: P2): P2 => [-p[1], p[0]];
  const out: P2[] = [[r, 0]];
  let p: P2 = [r, 0];
  for (let k = 0; k < Math.round(TIME / STEP); k++) {
    const k1 = f(p);
    const k2 = f([p[0] + (STEP / 2) * k1[0], p[1] + (STEP / 2) * k1[1]]);
    const k3 = f([p[0] + (STEP / 2) * k2[0], p[1] + (STEP / 2) * k2[1]]);
    const k4 = f([p[0] + STEP * k3[0], p[1] + STEP * k3[1]]);
    p = [p[0] + (STEP / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), p[1] + (STEP / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
    out.push(p);
  }
  return out;
}
const STREAMS = new Map(RADII.map((r, i) => [`field#s${i}`, stream(r)]));

/** What AC3 holds of a reading: 48 live, each within 1e-4 of its own stream. Each failure names the item `flow`. */
function streamProblems(r: Reading2, what: string): string[] {
  const out: string[] = [];
  r.at.forEach((s, k) => {
    const live = liveAt(r, k);
    const at = `${(s.t / FLICKS).toFixed(4)} s`;
    if (live.length !== LIVE) out.push(`flow ${what} at ${at}: ${live.length} particles live, not ${LIVE}`);
    for (const l of live) {
      if (l.particle === null) { out.push(`flow ${what} at ${at}: row ${l.row} is live but no particle in the list holds it`); continue; }
      const line = STREAMS.get(l.particle.curve);
      if (!line) { out.push(`flow ${what} at ${at}: row ${l.row} moves along ${l.particle.curve}, none of field#s0 to field#s3`); continue; }
      const d = nearest(line, l.at).d;
      if (!(d <= TOLERANCE)) out.push(`flow ${what} at ${at}: row ${l.row} at (${l.at[0].toFixed(6)}, ${l.at[1].toFixed(6)}) is ${d.toExponential(2)} from its stream ${l.particle.curve}, more than 1e-4`);
    }
  });
  return out;
}

/** Guards: every stream carried, each particle moving on along its stream, and most places 0.1 u or more along it. */
function travelProblems(r: Reading2): string[] {
  const out: string[] = [];
  const carried = new Set<string>();
  const track = new Map<string, number>();
  let places = 0; let far = 0;
  r.at.forEach((s, k) => {
    for (const l of liveAt(r, k)) {
      const line = l.particle && STREAMS.get(l.particle.curve);
      if (!l.particle || !line) continue;
      carried.add(l.particle.curve);
      const along = nearest(line, l.at).s;
      places++;
      if (along >= 0.1) far++;
      const key = `${l.particle.row}@${l.particle.born}`;
      const before = track.get(key);
      if (before !== undefined && !(along > before)) out.push(`flow: the particle in row ${l.row} born at ${l.particle.born} s is ${along.toFixed(5)} u along ${l.particle.curve} at ${(s.t / FLICKS).toFixed(4)} s, not past ${before.toFixed(5)} u where it was read before`);
      track.set(key, along);
    }
  });
  for (const id of STREAMS.keys()) if (!carried.has(id)) out.push(`flow: no particle moves along ${id}`);
  if (far < 0.8 * places) out.push(`flow: only ${far} of ${places} places read are 0.1 u or more along their stream`);
  return out;
}

describe(`${ac(3)} particles on a vector field's streams`, () => {
  it(`${ac(3)} particles with along.curves field#streams on (−y, x) stay within 1e-4 of their stream's sub-path at 100 sampled times; the planted emitter that follows the arrows fails naming flow`, () => {
    // The reference: each RK4 polyline within 8e-6 of its circle, so the sub-path and the circle agree within 1e-4.
    for (const [id, line] of STREAMS) {
      const r = Math.hypot(...line[0]!);
      expect(Math.max(...line.map((p) => Math.abs(Math.hypot(p[0], p[1]) - r))), `${id}'s points lie on their circle`).toBeLessThan(1e-9);
    }
    const path = writeJson(dir(), 'streams.json', streamsDoc());
    const call = particlesCall({ doc: path, t: TIMES, items: ['flow'] });
    const read = (planted?: Planted): Reading2 => {
      const reply = run(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop', ...(planted ? { planted } : {}) })[0]!;
      return reading2d(reply, 'flow', TIMES, planted ? `flow under --planted ${planted}` : 'flow');
    };
    const honest = read();
    none(streamProblems(honest, 'on the streams'), 'every particle within 1e-4 of its stream\'s sub-path');
    none(travelProblems(honest), 'the particles move along every stream');
    failsNaming(streamProblems(read('particles_follow_arrows'), 'following the arrows'), ['flow'], 'the planted emitter that moves particles along the field\'s arrows');
  }, TIMEOUT);

  it(`${ac(3)} seeking equals playing by hash: at the 100 sampled times the played frames' evaluated data are the evaluation's, and frames opened alone are the played ones`, () => {
    requireGpu();
    const doc = streamsDoc();
    none(seekEqualsPlay(bins.bin('deep-gpu'), dir(), [{ name: 'the streams film', doc, path: writeJson(dir(), 'streams.json', doc) }], 'flow', FRAMES, [120, 211, 288]), 'seeking the particles equals playing them');
  }, 2 * TIMEOUT);
});
