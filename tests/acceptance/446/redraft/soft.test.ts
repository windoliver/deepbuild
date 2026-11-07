// AC1 #446.0ba58c87, blind redraft: "Soft shadows harden where objects touch and widen with the light's size, and a still
// frame reached by seeking equals the played one on the same machine's pixel hash, with no noise seeded by the frame".
//
// Written from the issue, the design (Light policy: soft shadows; Units and axes), this suite's README and helpers.ts,
// with no implementation and without the first draft's soft.test.ts. Every view is helpers.ts's `ortho` from +Z, 80 px/m
// over the plate z = 0, and a width is `penumbraWidth`, read against `diskWidth`, a uniform disk's, in a 40% band; a disk
// under 8 px isn't held to the band (README: Readings). A light's penumbra at a receiver from an edge is the light's
// diameter × (blocker to receiver ÷ light to blocker).
//
// Test 1, the sun: `bladeDoc`'s blade, whose side edge y = 1.5 throws the shadow's edge y = 1.5 along −X. At s m from the
// foot the edge is √2 s away along the ray, so a disk of radius √2 s tan(angle ÷ 2) × 80 px, with 3° and 9° suns, at
// s = 0.25, 1.25 and 2.5. Each profile runs ±0.6 m across the edge (9°'s half-width is 0.28 m at 2.5 m) and stops short
// of the shadow's tip, whose penumbra starts at s = 3.4. The blade's strip |x| ≤ 0.05 is all the view sees of it.
//
// Test 1, the spot: not `plankDoc`, whose plank lies over the shadow's edge in this view, straight between the camera and
// the half of the penumbra under it. Here the ledge x ∈ [0, 4], top at z = 3, stands right of the edge x = 0, and the
// lamp stands 0.8 m to the right of that edge at z = 6, so the edge falls at x = −0.8 on the open plate, left of the
// ledge: light to blocker 3 m, blocker to receiver 3 m, the penumbra 2r across, a disk of radius r × 80 px: 8 and 24 px
// at r = 0.1 and 0.3 m. The profile runs x ∈ [−1.5, −0.1], lit to dark, and a reading is taken as a share of the unshaded
// ρ I cos θ ÷ (π d²), I = lm ÷ 4π: the lamp aims at the edge, within its 20° inner cone, with `range` 200 m.
//
// Harden: at 0.25 m the width is under 0.35 of the one at 2.5 m, it grows from s to s, and it grows by at least 0.3 of
// what the disk's grows by (a fixed filter's jitter can't pass). Widen: 9° is 2 to 4 times 3° at 2.5 m (3.0 by the disk),
// r = 0.3 is 2 to 4 times r = 0.1 (3.0), each within the band. `soft.method: 'pcf'`, a fixed 9-tap filter, is the wrong
// program and fails naming both.
//
// Test 2: the blade under a 9° sun, with contact shadows on, plus a tall box sliding along x over the first 0.6 s (10 fps:
// frame 3 moves, frames 6 on are still) past a shadowed spot, so each frame holds both soft filters. Frames 3 and 12
// sought equal the played ones by pixel hash, sought after the play in one process and sought cold in another, 12 first.
// Frames 7 to 12 are one picture. `--planted soft_noise_from_frame` keeps seeking equal, since frame n's noise is the
// same however it's reached, and fails on the still run, naming "still frames". How far contact shadows darken isn't read
// (README: Not tested), so this holds that their presence doesn't break the equalities, not that they draw.

import { describe, it } from 'vitest';
import {
  AC, DARK_SKY, SOFT, bladeDoc, box, diskWidth, failsNaming, frameAt, framesOf, hashOf, linearChannel, matte, none, only, ortho, orthoPoint, orthoProject, penumbraWidth, rad, readLinear,
  requireMetal, runGpu, sessionDoc, shadowsOf, spot, useDir, useGpu, view3dCall, writeJson, type GpuPlanted, type JsonObject, type Linear, type V3,
} from '../helpers.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();

const PCSS: JsonObject = { soft: { method: 'pcss', max_penumbra: 128 } };
const PCF: JsonObject = { soft: { method: 'pcf' } };
const ANGLES = [3, 9] as const;
const RADII = [0.1, 0.3] as const;
/** Distances from the foot, along the shadow, m. */
const FOOT = 0.25; const MID = 1.25; const FAR = 2.5;
/** The sun's shadow edge y, and how far its profile runs to each side, m. */
const EDGE_Y = 1.5; const REACH = 0.6;
/** A profile's sample is the mean of 9 lines along the edge, which reads through the disk's per-pixel rotation. */
const LINES = 4;
/** The samples at each end of a profile that read the lit plate and the full shadow. */
const ENDS = 6;
const BAND = 0.4;
const BANDED_PX = 8;

/** The spot's fixture: see the header. */
const LEDGE = { lamp: [0.8, 0, 6] as V3, aim: [0, 15, 0] as V3, power: 1600, rho: 0.8, from: -1.5, to: -0.1 };
function ledgeDoc(radius: number, policy: JsonObject): JsonObject {
  return sessionDoc(`ledge-${radius}`, SOFT.size, {
    cam: ortho(SOFT.target, SOFT.width), sky: DARK_SKY, grey: matte(LEDGE.rho),
    plate: box([9, 7, 0.1], [-1.5, 0, -0.05], { material: 'grey' }),
    ledge: box([4, 8, 0.1], [2, 0, 2.95], { material: 'grey' }),
    lamp: spot(LEDGE.power, LEDGE.lamp, LEDGE.aim, { radius, shadow: true, inner: 20, outer: 25, range: 200 }),
  }, { light_policy: { ...policy, shadowed: { spots: 1 } } });
}
/** The plate's reading at (x, y) with nothing in the lamp's way. */
function ledgeLit(x: number, y: number): number {
  const [lx, ly, lz] = LEDGE.lamp;
  const d2 = (x - lx) ** 2 + (y - ly) ** 2 + lz ** 2;
  return (LEDGE.rho * (LEDGE.power / (4 * Math.PI)) * (lz / Math.sqrt(d2))) / (Math.PI * d2);
}

const frame = (p: readonly number[]): [number, number] => orthoProject(SOFT.target, SOFT.width, SOFT.size, p);
/** Across the sun's edge at s m from the foot, lit to dark, as a share of the lit plate. */
function sunProfile(l: Linear, s: number): number[] {
  const [column, top] = frame([-s, EDGE_Y + REACH]);
  const [, bottom] = frame([-s, EDGE_Y - REACH]);
  const profile: number[] = [];
  for (let y = Math.round(top); y < Math.round(bottom); y++) {
    let sum = 0;
    for (let d = -LINES; d <= LINES; d++) sum += l.at(Math.floor(column) + d, y);
    profile.push(sum / (2 * LINES + 1) / SOFT.lit);
  }
  return profile;
}
/** Across the ledge's shadow edge, lit to dark, each pixel as a share of its own unshaded reading. */
function spotProfile(l: Linear): number[] {
  const [left, row] = frame([LEDGE.from, 0]);
  const [right] = frame([LEDGE.to, 0]);
  const profile: number[] = [];
  for (let x = Math.round(left); x < Math.round(right); x++) {
    let sum = 0;
    for (let d = -LINES; d <= LINES; d++) {
      const y = Math.floor(row) + d;
      const [wx, wy] = orthoPoint(SOFT.target, SOFT.width, SOFT.size, x, y);
      sum += l.at(x, y) / ledgeLit(wx, wy);
    }
    profile.push(sum / (2 * LINES + 1));
  }
  return profile;
}
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
/** A profile's width, from its own lit and dark ends; ends that aren't lit and dark are a problem, not a width. */
function widthOf(profile: readonly number[], what: string, found: string[]): number {
  const lit = mean(profile.slice(0, ENDS));
  const dark = mean(profile.slice(-ENDS));
  if (!(Math.abs(lit - 1) <= 0.05 && Math.abs(dark) <= 0.05)) found.push(`${what} doesn't run from the lit plate to the full shadow: its ends read ${lit.toFixed(3)} and ${dark.toFixed(3)}`);
  return penumbraWidth(profile.map((v) => (v - dark) / (lit - dark)));
}
function heldToDisk(width: number, R: number, what: string, found: string[]): void {
  const disk = diskWidth(R);
  if (disk >= BANDED_PX && !(Math.abs(width / disk - 1) <= BAND)) found.push(`${what} doesn't widen as the light's size gives: ${width.toFixed(1)} px, a uniform disk's ${disk.toFixed(1)} px`);
}
const sunR = (angle: number, s: number): number => Math.SQRT2 * s * Math.tan(rad(angle) / 2) * SOFT.K;

function softProblems(policy: JsonObject): string[] {
  const out = dir();
  const call = (name: string, doc: JsonObject): JsonObject => view3dCall({ doc: writeJson(out, name, doc), size: SOFT.size, targets: ['linear'] });
  const replies = runGpu(bin(), out, [
    ...ANGLES.map((a) => call(`blade-${a}`, bladeDoc(a, { policy }))),
    ...RADII.map((r) => call(`ledge-${r}`, ledgeDoc(r, policy))),
  ]);
  const read = (i: number, what: string): Linear => readLinear(out, only(replies[i]!, what), SOFT.size, what);
  const found: string[] = [];

  const far = new Map<number, number>();
  ANGLES.forEach((angle, i) => {
    const what = `the ${angle}° sun`;
    const l = read(i, what);
    const [foot, mid, end] = [FOOT, MID, FAR].map((s) => {
      const width = widthOf(sunProfile(l, s), `${what}'s profile at ${s} m`, found);
      heldToDisk(width, sunR(angle, s), `${what}'s penumbra at ${s} m`, found);
      return width;
    }) as [number, number, number];
    far.set(angle, end);
    const growth = diskWidth(sunR(angle, FAR)) - diskWidth(sunR(angle, FOOT));
    if (!(foot < 0.35 * end)) found.push(`${what} doesn't harden at the foot: ${foot.toFixed(1)} px at ${FOOT} m, ${end.toFixed(1)} px at ${FAR} m`);
    if (!(foot < mid && mid < end && end - foot >= 0.3 * growth)) found.push(`${what}'s penumbra doesn't harden toward the foot: ${foot.toFixed(1)}, ${mid.toFixed(1)} and ${end.toFixed(1)} px at ${FOOT}, ${MID} and ${FAR} m, where the disk's grows ${growth.toFixed(1)} px`);
  });
  const angleRatio = far.get(9)! / far.get(3)!;
  if (!(angleRatio >= 2 && angleRatio <= 4)) found.push(`the sun's penumbra doesn't widen with its angle: 9° is ${angleRatio.toFixed(2)} times 3°, not 2 to 4 times`);

  const [narrow, wide] = RADII.map((radius, i) => {
    const what = `the spot of radius ${radius} m`;
    const width = widthOf(spotProfile(read(ANGLES.length + i, what)), `${what}'s profile`, found);
    heldToDisk(width, radius * SOFT.K, `${what}'s penumbra`, found);
    return width;
  }) as [number, number];
  const radiusRatio = wide / narrow;
  if (!(radiusRatio >= 2 && radiusRatio <= 4)) found.push(`the spot's penumbra doesn't widen with its radius: 0.3 m is ${radiusRatio.toFixed(2)} times 0.1 m, not 2 to 4 times`);
  return found;
}

const FPS = 10;
const MOVING = 3;
const LAST = 12;
const STILL_FROM = 7;
function movingDoc(): JsonObject {
  return bladeDoc(9, {
    policy: { contact: { length: 0.3, samples: 16 }, shadowed: { spots: 1 } },
    items: {
      mover: box([0.4, 0.4, 1.2], [-4.6, -2, 0.6], { material: 'grey' }),
      lamp: spot(200, [-3.4, -1.2, 5], [0, 0, 0], { radius: 0.2, shadow: true, inner: 28, outer: 30, range: 200 }),
    },
    extra: { channels: { slide: linearChannel('items/mover/at/pos/0', -4.6, -2.6, 0.6) } },
  });
}
function reachedProblems(planted?: GpuPlanted): string[] {
  const out = dir();
  const call = { doc: writeJson(out, 'moving', movingDoc()), size: SOFT.size, fps: FPS, targets: ['final' as const] };
  const seek = (n: number): JsonObject => view3dCall({ ...call, from: n, capture: [n] });
  const [play, afterMoving, afterStill] = runGpu(bin(), out, [view3dCall({ ...call, frames: LAST + 1, capture: 'every', shadows: true }), seek(MOVING), seek(LAST)], planted);
  const [coldStill, coldMoving] = runGpu(bin(), out, [seek(LAST), seek(MOVING)], planted);
  const played = framesOf(play!, 'the play');
  const hash = (n: number): string => hashOf(frameAt(played, n, 'the play'), 'the play');
  const found: string[] = [];

  const sought: [string, number, JsonObject][] = [['after the play', MOVING, afterMoving!], ['after the play', LAST, afterStill!], ['cold', LAST, coldStill!], ['after a later seek', MOVING, coldMoving!]];
  for (const [how, n, reply] of sought) {
    const f = only(reply, `frame ${n} sought ${how}`);
    if (f.frame !== n) found.push(`the seek to frame ${n} ${how} drew frame ${f.frame}`);
    if (hashOf(f, `frame ${n} sought ${how}`) !== hash(n)) found.push(`frame ${n} sought ${how} isn't the played frame ${n} by pixel hash`);
  }
  if (hash(MOVING) === hash(LAST)) found.push(`moving frame ${MOVING} is still frame ${LAST}'s picture, so nothing moved`);
  const stillRun: string[] = [];
  for (let n = STILL_FROM; n <= LAST; n++) stillRun.push(hash(n));
  const pictures = new Set(stillRun).size;
  if (pictures !== 1) found.push(`still frames ${STILL_FROM} to ${LAST} are ${pictures} pictures, not one`);
  for (const n of [MOVING, LAST]) {
    if (!shadowsOf(frameAt(played, n, 'the play'), 'the play').maps.some((m) => m.light === 'lamp' && m.kind === 'spot')) found.push(`frame ${n} reads no shadow map of the spot`);
  }
  return found;
}

describe(`${ID} soft shadows sized by the light, the same however a frame is reached`, () => {
  it(`${ID} a sun's penumbra is thin at the foot and grows with distance, widens from 3° to 9°, a spot's widens from 0.1 to 0.3 m, each by a uniform disk's width; method pcf fails naming harden and widen`, () => {
    requireMetal();
    none(softProblems(PCSS), 'pcss');
    failsNaming(softProblems(PCF), ['harden', 'widen'], 'method pcf');
  });

  it(`${ID} frames sought equal frames played at a moving frame and a still one, with contact shadows and a shadowed spot; a run of still frames is one picture; the planted soft_noise_from_frame fails naming still frames`, () => {
    requireMetal();
    none(reachedProblems(), 'the moving scene');
    failsNaming(reachedProblems('soft_noise_from_frame'), ['still frames'], 'the planted soft_noise_from_frame');
  });
});
