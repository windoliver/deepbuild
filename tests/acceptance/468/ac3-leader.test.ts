// AC3 #468.632af807: With a lid that opens 110° while the camera orbits 90°, a label anchored to the right edge with a
// leader to lid#hinge keeps the leader's end within 0.5 px of that anchor's projection at 200 random times, has the
// same pixel hash seeked or played on one machine, and hides exactly at the times the anchor's projection leaves the
// safe frame; a 3D line with one point at lid#hinge passes through that anchor at every sampled time.
//
// Through `deep-gpu run`'s `view3d` (#378) at 480 × 320 with `safe: 24` (so the safe frame is [24, 456] × [24, 296] px),
// 120 frames a second over 4 s (frames 0 to 480). The fixture (README: Documents): a case (a 0.4 × 0.5 × 0.3 m box) and
// its lid, a 0.4 × 0.02 × 0.3 m box whose `at.pivot` and whose one named anchor `hinge` (Assumed surface 5:
// `params.anchors`) are its back bottom edge's middle, placed at H = (0.2, 0.5, −0.15) on the case's back top edge; a
// channel turns the lid about X from 0° to −110° (it opens) over the 4 s. The camera orbits (−0.2, 0.3, 0) at 1.4 m and
// 25° of elevation, 40° across the wider side, its azimuth keyed from −30° to 60°. The label `callout` is an
// `overlay.text@1` anchored to the frame's right edge with `leader: {to: "lid#hinge", …}` and `hide: off_frame`; the wire
// is a `mark.line@1` whose points are a fixed point and "lid#hinge".
//
// 200 frames drawn at random (mulberry32, seed 468) out of the 481, each read twice: from one played call (frames 0 to
// 480 in order) and from its own cold seek (`from: n`, one frame). At each, against #378's pinhole and the orbit worked
// here (the hinge stays at H, on the lid's axis): the label's `shown` (Assumed surface 4) is whether H projects inside
// the safe frame; while shown, its leader's end lies within 0.5 px of H's projection; the wire's evaluated points
// (`evaluate: ["items/wire/params/points"]`, Assumed surface 1) put its second point within 1e-6 m of H. The orbit takes
// H past the safe frame's right edge for about 1.3 s between 2 s and 3.7 s (157 of the 481 frames); the sample holds
// at least 20 frames of each state.
// Seeked and played frames have the same `pixel_hash`.
//
// Wrong programs: the base (no anchors, no leader, an anchor named on a line is refused); a leader drawn to the lid's
// origin or to where the previous frame's camera put the anchor; a label that hides only behind the eye, or by its
// own box; a seek that draws other pixels than play.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, box, focalOfFov, frameAt, framesOf, linear, linearAt, none, orbitEye, overlayOf, project, requireMetal, runGpu, sceneDoc, seeded,
  unlit, useGpu, useOut, valueAt, vec, view3d, writeJson, arr, type Frame, type JsonObject, type Pinhole, type V3,
} from './helpers.ts';

const ID = AC[3];
const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [480, 320];
const SAFE = 24;
const FPS = 120;
const LAST = 480;
const SAMPLES = 200;
const HINGE: V3 = [0.2, 0.5, -0.15];
const TARGET: V3 = [-0.2, 0.3, 0];
const DISTANCE = 1.4;
const ELEVATION = 25;
const FOV = 40;
const AZIMUTH: [number, number][] = [[0, -30], [4, 60]];
const OPEN: [number, number][] = [[0, 0], [4, -110]];
const WIRE_FROM: V3 = [-0.4, 0, 0.3];
const POINTS = 'items/wire/params/points';

function lidDoc(): JsonObject {
  const pivot: V3 = [0, -0.01, -0.15];
  return sceneDoc('lid-leader', SIZE, {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: TARGET, orbit: { azimuth: AZIMUTH[0]![1], elevation: ELEVATION, distance: DISTANCE }, fov: FOV, near: 0.05, far: 50 } },
    sky: DARK_SKY, case_mat: unlit([0.35, 0.3, 0.25]), lid_mat: unlit([0.6, 0.5, 0.35]),
    case: box([0.4, 0.5, 0.3], [0.2, 0.25, 0], 'case_mat'),
    lid: { kind: 'mark.box@1', params: { size: [0.4, 0.02, 0.3], anchors: { hinge: pivot } }, at: { pos: HINGE, rot: [0, 0, 0], pivot }, material: 'lid_mat' },
    callout: {
      kind: 'overlay.text@1', role: 'label',
      params: { anchor: 'right', role: 'caption', template: 'Hinge', size: 13, leader: { to: 'lid#hinge', line: 'ink', width: 1.5, dash: false, end: 'dot', elbow: 'none', gap: 4 }, hide: 'off_frame' },
    },
    wire: { kind: 'mark.line@1', params: { points: [WIRE_FROM, 'lid#hinge'], width: 2, paint: { fill: { role: 'ink' } } } },
  }, { channels: { orbit: linear('items/cam/params/orbit/azimuth', AZIMUTH), open: linear('items/lid/at/rot/0', OPEN) } });
}

/** The camera at frame n, as the orbit puts it. */
const cameraAt = (n: number): Pinhole => {
  const az = linearAt(AZIMUTH, n / FPS);
  return { position: orbitEye(TARGET, DISTANCE, az, ELEVATION), target: TARGET, focal: focalOfFov(FOV, SIZE), size: SIZE };
};
const inSafe = (p: [number, number]): boolean => p[0] >= SAFE && p[0] <= SIZE[0] - SAFE && p[1] >= SAFE && p[1] <= SIZE[1] - SAFE;
/** How far a projection sits from the safe frame's boundary (px): a tie there isn't judged. */
const edgeGap = (p: [number, number]): number => Math.min(Math.abs(p[0] - SAFE), Math.abs(p[0] - (SIZE[0] - SAFE)), Math.abs(p[1] - SAFE), Math.abs(p[1] - (SIZE[1] - SAFE)));

/** The 200 sampled frames, distinct, in a seeded order. */
function sampled(): number[] {
  const rnd = seeded(468);
  const picked = new Set<number>();
  while (picked.size < SAMPLES) picked.add(Math.floor(rnd() * (LAST + 1)));
  return [...picked];
}

/** One process: the played call, then a cold seek to each sampled frame. */
function draw(): { played: Map<number, Frame>; seeked: Map<number, Frame>; frames: number[] } {
  const dir = out();
  const doc = writeJson(dir, 'lid', lidDoc());
  const frames = sampled();
  const common = { doc, size: SIZE, fps: FPS, overlays: true, evaluate: [POINTS] };
  const replies = runGpu(bin(), dir, [view3d({ ...common, from: 0, frames: LAST + 1 }), ...frames.map((n) => view3d({ ...common, from: n, frames: 1 }))]);
  const played = new Map(framesOf(replies[0]!, 'played').map((f) => [f.frame, f]));
  const seeked = new Map(frames.map((n, k) => [n, frameAt(framesOf(replies[k + 1]!, `seek to ${n}`), n, `seek to ${n}`)]));
  return { played, seeked, frames };
}

/** What a frame shows against the reference: the label's state, its leader's end, the wire's anchored point. */
function frameFailures(f: Frame, n: number, side: string): string[] {
  const failures: string[] = [];
  const at = `frame ${n} (${(n / FPS).toFixed(4)} s, ${side})`;
  const p = project(cameraAt(n), HINGE);
  expect(p, `${at}: the hinge is in front of the eye`).not.toBeNull();
  const want: [number, number] = [p![0], p![1]];
  const o = overlayOf(f, 'callout', at);
  if (edgeGap(want) > 1e-3) {
    const shownWant = inSafe(want);
    if (o.shown !== shownWant) failures.push(`${at}: callout is ${o.shown ? 'shown' : 'hidden'} with lid#hinge projecting to (${want[0].toFixed(2)}, ${want[1].toFixed(2)}), ${shownWant ? 'inside' : 'outside'} the safe frame`);
    if (shownWant && o.shown) {
      if (!o.leader) failures.push(`${at}: callout is shown with no leader`);
      else {
        const off = Math.hypot(o.leader.to[0] - want[0], o.leader.to[1] - want[1]);
        if (!(off <= 0.5)) failures.push(`${at}: callout's leader ends at (${o.leader.to.map((v) => v.toFixed(2)).join(', ')}), ${off.toFixed(3)} px from lid#hinge's projection (${want.map((v) => v.toFixed(2)).join(', ')})`);
      }
    }
  }
  const pts = arr(valueAt(f, POINTS, at), `${at}: ${POINTS}`);
  expect(pts.length, `${at}: the wire has its two points`).toBe(2);
  const anchored = vec(pts[1], 3, `${at}: the wire's point at lid#hinge`);
  const miss = Math.hypot(...anchored.map((v, k) => v - HINGE[k]!));
  if (!(miss <= 1e-6)) failures.push(`${at}: wire's point lid#hinge is at (${anchored.join(', ')}), ${miss.toExponential(2)} m from the hinge (${HINGE.join(', ')})`);
  const fixed = vec(pts[0], 3, `${at}: the wire's fixed point`);
  if (Math.hypot(...fixed.map((v, k) => v - WIRE_FROM[k]!)) > 1e-6) failures.push(`${at}: wire's fixed point moved to (${fixed.join(', ')})`);
  return failures;
}

describe(`${ID} a label's leader and a 3D line anchored to lid#hinge while the lid opens and the camera orbits`, () => {
  // One test: the pixel hashes count only on frames that draw the leader and the anchored line the other clauses read
  // (the base draws neither, and its frames already seek as they play).
  it(`${ID} at 200 random times, played and seeked: the leader ends within 0.5 px of lid#hinge's projection, the label hides exactly while that projection is outside the safe frame, the wire passes through the hinge, and the pixel hash is the same seeked as played`, () => {
    requireMetal();
    const { played, seeked, frames } = draw();
    const states = frames.map((n) => inSafe(project(cameraAt(n), HINGE)!.slice(0, 2) as [number, number]));
    console.log(`${ID}: of the ${frames.length} sampled frames, lid#hinge projects inside the safe frame at ${states.filter(Boolean).length} and outside at ${states.filter((s) => !s).length}`);
    expect(states.filter(Boolean).length, 'the sample holds at least 20 frames with the hinge inside the safe frame').toBeGreaterThanOrEqual(20);
    expect(states.filter((s) => !s).length, 'the sample holds at least 20 frames with the hinge outside the safe frame').toBeGreaterThanOrEqual(20);
    const failures: string[] = [];
    for (const n of frames) {
      const p = played.get(n);
      expect(p, `the played call drew frame ${n}`).toBeDefined();
      failures.push(...frameFailures(p!, n, 'played'));
      failures.push(...frameFailures(seeked.get(n)!, n, 'seeked'));
      const a = p!.pixel_hash; const b = seeked.get(n)!.pixel_hash;
      if (a === null || b === null) failures.push(`frame ${n}: no pixel hash (played ${a}, seeked ${b})`);
      else if (a !== b) failures.push(`frame ${n} (${(n / FPS).toFixed(4)} s): seeked ${b} differs from played ${a}`);
    }
    none(failures, `${ID}: the leader, the hiding, the anchored line and seek against play`);
  });
});
