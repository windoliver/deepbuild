// #504.746e9d85: "A stage chosen at 4 s glides the camera from the pose shown at 4 s to the stage's framed pose over
// 0.8 s, starting within 1e-6 m of the pose shown and ending on the framed pose, and a stage whose shot says join: cut
// shows the framed pose on the entry's own frame"
//
// The fixture (`tour()` below), a 3D figure in metres: a perspective camera `cam` and a stages control `tour` whose
// four stages each name a stage shot (no `start`: it starts at the stage's entry) holding an explicit pose, a target
// and an orbit (Shot: "Each shot has one framed pose: its explicit pose"): `start` (the default), `mid`, `close`, and
// `snap`, whose shot says `join: cut`. The others name no join, so they glide over 0.8 s, by default. Each framed pose's
// eye is target + distance · (cos el · sin az, sin el, cos el · cos az) (Camera camera@1; #493's convention).
// The input track: mid at 3.6 s, close at 4 s, snap at 6 s; so at 4 s the camera is half way through mid's glide, a
// pose no shot frames.
//
// asserts, through `deep-motion eval` (#417's `track`, #493's `cameras.<id>` pose), at every 1/60 s frame from 3.5 s
// to 6.5 s:
//   - the pose shown at 4 s is the same document's pose at 4 s on the track without close's entry, and it lies apart
//     from start's and mid's framed poses by more than 1 mm;
//   - at 4 s, the entry's own frame, position and target within 1e-6 m of the pose shown;
//   - every frame after 4 s and before 4.8 s moves the eye and stands off close's framed pose by more than 1e-6 m;
//   - from 4.8 s until 6 s, position and target on close's framed pose within 1e-6 m;
//   - at 6 s, snap's entry's own frame, position and target on snap's framed pose within 1e-6 m.
// The planted `stage_glide_moves_target_only` (eval `planted`: a stage's glide eases the camera's target alone and puts
// its eye on the framed position at the entry) fails, naming the position at 4 s.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, box, dist, entry, envelope, evalFrames, failsNaming, fl, grid, none, orbitEye, poseOf, useBins, type Frame, type JsonObject, type V3,
} from './helpers.ts';

/** The criterion's ID: `#504.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#504.746e9d85';

const bin = useBins(['motion']);

interface Framed { target: V3; azimuth: number; elevation: number; distance: number }
const POSES: Record<string, Framed & { join?: string }> = {
  start: { target: [0, 0.5, 0], azimuth: 0, elevation: 15, distance: 6 },
  mid: { target: [0.5, 0.6, 0], azimuth: 50, elevation: 20, distance: 5 },
  close: { target: [1, 0.4, 0], azimuth: -40, elevation: 25, distance: 3 },
  snap: { target: [-1, 0.6, 0.5], azimuth: 70, elevation: 10, distance: 4, join: 'cut' },
};
const eyeOf = (p: Framed): V3 => orbitEye(p.target, p.azimuth, p.elevation, p.distance);

function tour(): JsonObject {
  const stages: JsonObject = {};
  const shots: JsonObject = {};
  for (const [id, p] of Object.entries(POSES)) {
    stages[id] = { label: id, shot: `${id}-shot` };
    shots[`${id}-shot`] = { camera: 'cam', move: 'hold', target: p.target, orbit: { azimuth: p.azimuth, elevation: p.elevation, distance: p.distance }, ...(p.join ? { join: p.join } : {}) };
  }
  return envelope('stage-tour', 'figure', [1920, 1080], [
    { id: 'cam', kind: 'camera@1', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 120, elevation: 40, distance: 9 }, fov: 40 } },
    box('floor', [0, -0.05, 0], [6, 0.1, 6], 'muted'),
    box('crate', [1, 0.4, 0], [0.8, 0.8, 0.8], 'accent'),
    box('lamp', [-1, 0.6, 0.5], [0.3, 1.2, 0.3], 'ink'),
  ], {
    transport: { span: '8s', frame_rate: [60, 1] },
    controls: { tour: { kind: 'stages', class: 'document', label: 'Tour', role: 'group', default: 'start', stages } },
    shots,
  });
}

const MID = entry(3.6, 'tour', 'mid');
const CLOSE = entry(4, 'tour', 'close');
const SNAP = entry(6, 'tour', 'snap');
const TIMES = grid(60, 3.5, 6.5);
const k4 = TIMES.indexOf(fl(4));

function glideFailures(full: Frame[], shownAt4: Frame, what: string): string[] {
  const failures: string[] = [];
  const pose = (f: Frame) => poseOf(f, 'cam', what);
  const shown = pose(shownAt4);
  const close = { position: eyeOf(POSES['close']!), target: POSES['close']!.target };
  const snap = { position: eyeOf(POSES['snap']!), target: POSES['snap']!.target };
  for (const name of ['start', 'mid'] as const) {
    if (dist(shown.position, eyeOf(POSES[name]!)) <= 1e-3) failures.push(`${what}: the pose shown at 4 s is ${name}'s framed pose, so the fixture doesn't test the glide's start`);
  }
  full.forEach((f, k) => {
    const s = f.t / fl(1);
    const p = pose(f);
    if (k === k4) {
      if (dist(p.position, shown.position) > 1e-6) failures.push(`${what}: at 4 s the position is ${dist(p.position, shown.position)} m from the pose shown, not within 1e-6 m`);
      if (dist(p.target, shown.target) > 1e-6) failures.push(`${what}: at 4 s the target is ${dist(p.target, shown.target)} m from the pose shown, not within 1e-6 m`);
    } else if (s > 4 && s < 4.8 - 1e-9) {
      if (dist(p.position, close.position) <= 1e-6) failures.push(`${what}: at ${s} s the eye is already on close's framed pose, before the 0.8 s glide ends`);
      if (dist(p.position, pose(full[k - 1]!).position) <= 1e-9) failures.push(`${what}: at ${s} s the eye didn't move from the frame before: the glide isn't gliding`);
    } else if (s >= 4.8 - 1e-9 && s < 6) {
      if (dist(p.position, close.position) > 1e-6 || dist(p.target, close.target) > 1e-6) failures.push(`${what}: at ${s} s the camera (eye ${dist(p.position, close.position)} m, target ${dist(p.target, close.target)} m off) isn't on close's framed pose`);
    } else if (Math.abs(s - 6) < 1e-9) {
      if (dist(p.position, snap.position) > 1e-6 || dist(p.target, snap.target) > 1e-6) failures.push(`${what}: at 6 s, snap's own frame, the camera (eye ${dist(p.position, snap.position)} m, target ${dist(p.target, snap.target)} m off) isn't on its framed pose: join: cut didn't cut`);
    }
  });
  return failures;
}

function run(planted?: string): string[] {
  const p = planted ? { planted } : {};
  const full = evalFrames(bin('motion'), { doc: tour(), times: TIMES, track: [MID, CLOSE, SNAP], ...p }, `the tour${planted ? ` (planted ${planted})` : ''}`);
  const [shownAt4] = evalFrames(bin('motion'), { doc: tour(), times: [fl(4)], track: [MID], ...p }, 'the tour without close\'s entry, at 4 s');
  return glideFailures(full, shownAt4!, planted ? 'the planted glide' : 'the tour');
}

describe(`${ID} a stage's shot glides from the pose shown at its entry, or cuts when its shot says join: cut`, () => {
  it(`${ID} close, chosen at 4 s mid-glide, glides from the pose shown to its framed pose over 0.8 s; snap cuts on its entry's frame; a planted glide that moves only the target fails, naming the position`, () => {
    expect(k4, 'the frames hold 4 s').toBeGreaterThan(0);
    none(run(), 'the stage glide and the cut');
    failsNaming(run('stage_glide_moves_target_only'), ['at 4 s the position'], 'the planted glide that moves only the target');
  }, TIMEOUT);
});
