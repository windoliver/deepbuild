// AC2 #1634.1412aa03: The frame is a function of the view: the same pose reached by an orbit, by a seek, and with the
// 512 lamps created in a shuffled order gives one pixel hash on one machine, and each cluster's list is ordered by
// score bucket, then ID. A planted pass that appends lights in atomic arrival order differs between two runs and
// fails, naming the cluster.
//
// The street under its orbiting camera (helpers: `STREET.orbit`, one turn in 10 s about a point of the road, 40 m off
// and 12° up) at 960 × 540 and 30 frames a second. The pose is frame 49's (1.633 s, azimuth 58.8°): 88 lamps' ranges
// meet its frustum, in 54 score buckets, the fullest cluster holding at most 24, and no score within 1e-3 of a bucket's
// edge. A run is one process drawing three legs: the orbit played from frame 0 to 49; a session opened at frame 150
// and sought to 49; and the street whose lamps were created in a seeded shuffled order, opened at 49. Each leg's
// frame 49 gives its pixel hash and, with `clusters: true`, every cluster's list as its pixels walk it (README:
// Assumed surfaces 5). Two runs, each a fresh process. The check, over both:
//   - the lists are there: they name at least 80 of the 88 lamps the CPU reference scores above 0 and none it scores
//     0, and at least 20 clusters hold two lights or more;
//   - each cluster's list is in the CPU reference's order: score bucket (power ÷ max(d², radius²) from the eye, eight
//     buckets a stop), then ID, no light twice;
//   - in the first run, the seek and the shuffled street have the orbit's pixel hash and its lists, cluster by cluster;
//   - the second run's legs have the first's pixel hashes and lists.
// A failure names its cluster as `cluster [tile column, tile row, slice]`; one between the two runs starts
// `two runs differ at cluster […]`.
// Wrong programs: the base (no cluster lists in the reply); `--planted cluster_arrival_order`, whose two runs must
// differ, the failure naming the cluster; a list ordered by score alone, by the lamps' order in the document or by
// their place in a buffer; a list carried from the frame before.
import { describe, expect, it } from 'vitest';
import {
  AC, STREET, TIMEOUT, failsNaming, frameAt, framesOf, none, orbitView, requireMetal, runGpu, shuffled, streetDoc, streetLamps, streetLook, useDir, useGpu,
  view3dCall, writeJson, type Cluster, type Planted, type Size, type Target,
} from './helpers.ts';
import { ordered } from './reference.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();
const SIZE: Size = [960, 540];
const FPS = 30;
const T = 49;
const SEEK_FROM = 150;
const LEGS = ['the orbit played from frame 0', 'the seek from frame 150', 'the street created in a shuffled order'];

interface Leg { name: string; hash: string | null; clusters: Cluster[] | null }
/** One run: the three legs' frame 49, in one process. */
function run(planted?: Planted): Leg[] {
  const out = dir();
  const street = writeJson(out, 'street', streetDoc('street-orbit', { camera: 'orbit', size: SIZE }));
  const reordered = writeJson(out, 'street-shuffled', streetDoc('street-orbit', { camera: 'orbit', size: SIZE, created: shuffled(Array.from({ length: STREET.lamps }, (_, k) => k), 1634) }));
  const common = { look: streetLook(), size: SIZE, fps: FPS, capture: [T], targets: ['final'] as Target[], clusters: true };
  const replies = runGpu(bin(), out, [
    view3dCall({ ...common, doc: street, frames: T + 1 }),
    view3dCall({ ...common, doc: street, from: SEEK_FROM, frames: 2, seeks: [{ after: SEEK_FROM, to: T }] }),
    view3dCall({ ...common, doc: reordered, from: T, frames: 1 }),
  ], planted ? { planted } : {});
  return replies.map((r, i) => {
    const f = frameAt(framesOf(out, r, SIZE, LEGS[i]!), T, LEGS[i]!);
    return { name: LEGS[i]!, hash: f.pixelHash, clusters: f.clusters };
  });
}
const listed = (c: Cluster): string => c.lights.map((l) => l.light).join(' ');
/** The first cluster whose list differs between two legs, with both lists; null when none does. */
function firstDifference(a: Leg, b: Leg): string | null {
  const [mine, theirs] = [a, b].map((leg) => new Map((leg.clusters ?? []).map((c) => [c.name, listed(c)])));
  const name = [...new Set([...mine!.keys(), ...theirs!.keys()])].find((n) => mine!.get(n) !== theirs!.get(n));
  return name === undefined ? null : `${name}: [${(mine!.get(name) ?? '').slice(0, 200)}] against [${(theirs!.get(name) ?? '').slice(0, 200)}]`;
}

/** What is wrong with two runs' legs, each failure naming its cluster where it has one. */
function problems(runs: [Leg[], Leg[]]): string[] {
  const failures: string[] = [];
  const key = new Map(ordered(orbitView(T, FPS, SIZE), streetLamps()).map((s) => [s.id, s.bucket]));
  const orbit = runs[0][0]!;
  if (!orbit.clusters) return [`${orbit.name} reports no cluster lists (clusters: true)`];
  const named = new Set(orbit.clusters.flatMap((c) => c.lights.map((l) => l.light)));
  const strangers = [...named].filter((id) => !key.has(id));
  if (strangers.length) failures.push(`the lists name ${strangers.length} lights the CPU reference scores 0 at this view, ${strangers.slice(0, 3).join(', ')} first`);
  if (named.size - strangers.length < 80) failures.push(`the lists name ${named.size - strangers.length} of the ${key.size} lamps whose ranges meet the frustum, fewer than 80`);
  if (orbit.clusters.filter((c) => c.lights.length >= 2).length < 20) failures.push('fewer than 20 clusters hold two lights or more');
  runs.forEach((legs, r) => legs.forEach((leg) => {
    const where = `run ${r + 1}, ${leg.name}`;
    if (!leg.clusters) { failures.push(`${where} reports no cluster lists`); return; }
    for (const c of leg.clusters) {
      for (let k = 1; k < c.lights.length; k++) {
        const [a, b] = [c.lights[k - 1]!.light, c.lights[k]!.light];
        const [ka, kb] = [key.get(a) ?? Infinity, key.get(b) ?? Infinity];
        if (ka > kb || (ka === kb && a >= b)) { failures.push(`${c.name}'s list is out of order in ${where}: ${a} (bucket ${ka}) comes before ${b} (bucket ${kb})`); break; }
      }
    }
  }));
  for (const leg of runs[0].slice(1)) {
    const at = firstDifference(orbit, leg);
    if (at) failures.push(`${leg.name} differs from the orbit at ${at}`);
    if (leg.hash === null || leg.hash !== orbit.hash) failures.push(`${leg.name} has pixel hash ${String(leg.hash).slice(0, 16)}… where the orbit has ${String(orbit.hash).slice(0, 16)}…`);
  }
  runs[0].forEach((leg, i) => {
    const again = runs[1][i]!;
    const at = firstDifference(leg, again);
    if (at) failures.push(`two runs differ at ${at}, in ${leg.name}`);
    if (again.hash === null || again.hash !== leg.hash) failures.push(`two runs differ in pixel hash, in ${leg.name}: ${String(leg.hash).slice(0, 16)}… and ${String(again.hash).slice(0, 16)}…`);
  });
  return failures;
}

describe(`${ID} the frame is a function of the view`, () => {
  it(`${ID} the pose at 1.633 s reached by the orbit, by a seek and with the 512 lamps created in a shuffled order gives one pixel hash, in two runs, and each cluster's list is ordered by score bucket, then ID`, () => {
    requireMetal();
    const runs: [Leg[], Leg[]] = [run(), run()];
    expect(runs[0]![0]!.hash, 'the orbit\'s frame has a pixel hash').toMatch(/^[0-9a-f]{64}$/);
    none(problems(runs), 'the street\'s frame as a function of its view');
  }, TIMEOUT);

  it(`${ID} a planted pass that appends lights in atomic arrival order (--planted cluster_arrival_order) differs between two runs and fails, naming the cluster`, () => {
    requireMetal();
    const failures = problems([run('cluster_arrival_order'), run('cluster_arrival_order')]);
    console.log(`${ID} --planted cluster_arrival_order: ${failures.slice(0, 4).join('; ').slice(0, 2000)}`);
    failsNaming(failures, [/^two runs differ at cluster \[\d+, \d+, \d+\]/], '--planted cluster_arrival_order');
  }, TIMEOUT);
});
