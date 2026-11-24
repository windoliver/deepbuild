// The #3035 acceptance tests' model (README: The fixtures and their numbers): the fixtures' numbers as their files
// write them, in the file's units (metres, radians, kilograms, Z up, right-handed), and every expected value worked
// from them in closed form in f64, under a change of axes that is one rotation R applied to every pose, axis and
// inertia: a point p becomes R·p, a link's orientation Q becomes R·Q·Rᵀ, an axis a becomes R·a and an inertia tensor
// I becomes R·I·Rᵀ. No value here was read from a run, and nothing here parses a robot description or stands in for
// the conversion: the tests hold the conversion's own output to these values, and the model's worlds are only the
// control a measure is proved on before it judges a conversion.

export type Vec3 = [number, number, number];
/** A rotation matrix, by rows. */
export type Mat3 = [Vec3, Vec3, Vec3];
export type Quat = [number, number, number, number];
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const RAD = Math.PI / 180;
export const IDENTITY: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// ---------------------------------------------------------------------------------------------------
// Vectors and rotations, f64

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const far = (a: Vec3, b: Vec3): number => norm(sub(a, b));
export const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a));
export const apply = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
export const transpose = (m: Mat3): Mat3 => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
export function mul(a: Mat3, b: Mat3): Mat3 {
  const t = transpose(b);
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => dot(a[i]!, t[j]!))) as Mat3;
}
/** The largest difference between two matrices' entries. */
export const apart = (a: Mat3, b: Mat3): number => Math.max(...[0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => Math.abs(a[i]![j]! - b[i]![j]!))));
/** A turn of `deg` about the unit axis `a`, by the right-hand rule (Rodrigues). */
export function about(a: Vec3, deg: number): Mat3 {
  const [x, y, z] = unit(a);
  const c = Math.cos(deg * RAD); const s = Math.sin(deg * RAD); const k = 1 - c;
  return [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ];
}
const X: Vec3 = [1, 0, 0]; const Y: Vec3 = [0, 1, 0]; const Z: Vec3 = [0, 0, 1];
/** A unit quaternion `[x, y, z, w]` as a matrix; it is normalized first, as the physics module normalizes one. */
export function fromQuat(q: Quat): Mat3 {
  const n = Math.hypot(...q);
  const [x, y, z, w] = q.map((c) => c / n) as Quat;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}
/** A rotation matrix as a unit quaternion `[x, y, z, w]` with w ≥ 0. */
export function toQuat(m: Mat3): Quat {
  const t = m[0][0] + m[1][1] + m[2][2];
  let q: Quat;
  if (t > 0) {
    const s = 2 * Math.sqrt(t + 1);
    q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]);
    q = [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]);
    q = [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]);
    q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s];
  }
  return (q[3] < 0 ? q.map((c) => -c) : q) as Quat;
}
/** The file's `rpy`, radians: roll about X, then pitch about Y, then yaw about Z, in fixed axes. */
export const rpy = (r: Vec3): Mat3 => mul(about(Z, r[2] / RAD), mul(about(Y, r[1] / RAD), about(X, r[0] / RAD)));

const numbers = (v: Json | undefined, n: number): number[] | null =>
  (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null);
export const vec3 = (v: Json | undefined): Vec3 | null => numbers(v, 3) as Vec3 | null;

/**
 * A `rot` as the documents write one (Body `body@1`: `rot: quat | deg`): four numbers are a quaternion `[x, y, z, w]`,
 * three are degrees about X, then Y, then Z, and none written is no turn. The design composes the three in fixed axes
 * (R = Rz·Ry·Rx) and the base's backend about the axes the turns before left (Rx·Ry·Rz); the two agree whenever at most
 * one of the three is not 0, and a `rot` on which they differ can't be read here: `INCONCLUSIVE:`.
 */
export function rotOf(v: Json | undefined, what: string): Mat3 | string {
  if (v === undefined) return IDENTITY;
  const q = numbers(v, 4);
  if (q) return Math.hypot(...q) > 1e-9 ? fromQuat(q as Quat) : `${what} is a quaternion of length 0: ${JSON.stringify(v)}`;
  const d = numbers(v, 3);
  if (!d) return `${what} is neither a quaternion [x, y, z, w] nor degrees [x, y, z]: ${JSON.stringify(v)}`;
  const fixed = mul(about(Z, d[2]!), mul(about(Y, d[1]!), about(X, d[0]!)));
  const turned = mul(about(X, d[0]!), mul(about(Y, d[1]!), about(Z, d[2]!)));
  if (apart(fixed, turned) > 1e-9) {
    return `INCONCLUSIVE: ${what} is ${JSON.stringify(v)} degrees about more than one axis, which the design reads in fixed axes (Rz·Ry·Rx) and the base's backend about turned ones (Rx·Ry·Rz); write it as a quaternion; this is not a pass`;
  }
  return fixed;
}

// ---------------------------------------------------------------------------------------------------
// The change of axes (Units and axes: 3D is metres, right-handed, +Y up; the issue: one stated rotation)

/** How far a rotation is from taking the file's +Z onto our +Y: 0 when it does. */
export const upError = (r: Mat3): number => far(apply(r, Z), Y);
/** The control's rotation, −90° about X: the file's (x, y, z) is our (x, z, −y), the design's own way from +Z up to +Y up. */
export const R0: Mat3 = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
/** A wrong twin of it: +90° about X takes the file's +Z onto −Y. */
export const R_DOWN: Mat3 = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];

/** A link's three moments about its own axes after the change of axes, and the largest product the change leaves. */
export function movedInertia(moments: Vec3, r: Mat3): { moments: Vec3; product: number } {
  const i: Mat3 = [[moments[0], 0, 0], [0, moments[1], 0], [0, 0, moments[2]]];
  const m = mul(r, mul(i, transpose(r)));
  return { moments: [m[0][0], m[1][1], m[2][2]], product: Math.max(Math.abs(m[0][1]), Math.abs(m[0][2]), Math.abs(m[1][2])) };
}

// ---------------------------------------------------------------------------------------------------
// The fixtures, as their files write them (fixtures/*.urdf): metres, radians, kilograms, the file's axes.

export interface LinkData {
  name: string; mass: number;
  /** The inertial's origin: the centre of mass in the link's frame. */
  com: Vec3;
  /** ixx, iyy, izz; every product is written 0. */
  moments: Vec3;
  /** The collision: its origin in the link's frame, and a box's three sizes or a sphere's radius. */
  at: Vec3; box?: Vec3; sphere?: number;
}
export interface JointData {
  name: string; type: 'revolute' | 'continuous' | 'prismatic' | 'fixed'; parent: string; child: string;
  /** The joint's origin in its parent link's frame. */
  xyz: Vec3; rpy: Vec3;
  /** In the joint's own frame, which is its child link's. */
  axis?: Vec3; lower?: number; upper?: number;
}
export interface Robot { name: string; file: string; links: LinkData[]; joints: JointData[] }

const BASE: LinkData = { name: 'base', mass: 5, com: [0, 0, 0], moments: [0.05, 0.05, 0.05], at: [0, 0, 0], box: [0.2, 0.2, 0.2] };
const bar = (name: string): LinkData => ({ name, mass: 1, com: [0.25, 0, 0], moments: [0.0004, 0.021, 0.021], at: [0.25, 0, 0], box: [0.5, 0.05, 0.05] });

/** The file's limit of both arms' revolute joints, rad, and each link's length, m. */
export const LIMIT_RAD = 1.5708;
export const LINK = 0.5;
/** fixtures/arm.urdf: `base`, then `upper` on `shoulder`, `fore` on `elbow` and `tip` on the fixed `flange`, along the file's +X. */
export const ARM: Robot = {
  name: 'two_link_arm', file: 'arm.urdf',
  links: [BASE, bar('upper'), bar('fore'), { name: 'tip', mass: 0.1, com: [0, 0, 0], moments: [0.0001, 0.0001, 0.0001], at: [0, 0, 0], sphere: 0.02 }],
  joints: [
    { name: 'shoulder', type: 'revolute', parent: 'base', child: 'upper', xyz: [0, 0, 0], rpy: [0, 0, 0], axis: [0, -1, 0], lower: -LIMIT_RAD, upper: LIMIT_RAD },
    { name: 'elbow', type: 'revolute', parent: 'upper', child: 'fore', xyz: [LINK, 0, 0], rpy: [0, 0, 0], axis: [0, -1, 0], lower: -LIMIT_RAD, upper: LIMIT_RAD },
    { name: 'flange', type: 'fixed', parent: 'fore', child: 'tip', xyz: [LINK, 0, 0], rpy: [0, 0, 0] },
  ],
};
/** The slab's turn about the file's Z, rad: 30°, written to the digits of π ÷ 6. */
export const YAW_RAD = 0.5235987755982988;
/** fixtures/axes.urdf: `mast` 1 m up the file's Z on the fixed `post`; `slab`, 2 kg, on the fixed `bracket`. */
export const AXES: Robot = {
  name: 'axes_rig', file: 'axes.urdf',
  links: [
    BASE,
    { name: 'mast', mass: 1, com: [0, 0, 0], moments: [0.01, 0.01, 0.002], at: [0, 0, 0], box: [0.1, 0.1, 0.3] },
    { name: 'slab', mass: 2, com: [0, 0, 0], moments: [0.02, 0.06, 0.07], at: [0, 0, 0], box: [0.6, 0.3, 0.1] },
  ],
  joints: [
    { name: 'post', type: 'fixed', parent: 'base', child: 'mast', xyz: [0, 0, 1], rpy: [0, 0, 0] },
    { name: 'bracket', type: 'fixed', parent: 'base', child: 'slab', xyz: [0.4, 0.3, 0.5], rpy: [0, 0, YAW_RAD] },
  ],
};
/** The prismatic joint's limit, m. */
export const TRAVEL = 0.2;
/** fixtures/lift.urdf: `sled` on the prismatic `rail` along the file's +Z, and `hand` on the revolute `wrist` about the file's +Y. */
export const LIFT: Robot = {
  name: 'lift', file: 'lift.urdf',
  links: [
    BASE,
    { name: 'sled', mass: 1, com: [0, 0, 0], moments: [0.002, 0.002, 0.002], at: [0, 0, 0], box: [0.1, 0.1, 0.1] },
    { name: 'hand', mass: 0.5, com: [0.1, 0, 0], moments: [0.0002, 0.002, 0.002], at: [0.1, 0, 0], box: [0.2, 0.04, 0.04] },
  ],
  joints: [
    { name: 'rail', type: 'prismatic', parent: 'base', child: 'sled', xyz: [0, 0, 0.1], rpy: [0, 0, 0], axis: [0, 0, 1], lower: 0, upper: TRAVEL },
    { name: 'wrist', type: 'revolute', parent: 'sled', child: 'hand', xyz: [0.1, 0, 0], rpy: [0, 0, 0], axis: [0, 1, 0], lower: -LIMIT_RAD, upper: LIMIT_RAD },
  ],
};
/** fixtures/gripper.urdf: what has no place, each by its element and its name, and the joints that are kept with their kinds. */
export const GRIPPER = {
  file: 'gripper.urdf',
  dropped: [{ element: 'joint', name: 'mirror' }, { element: 'sensor', name: 'eye' }, { element: 'transmission', name: 'squeeze' }],
  kept: { links: ['palm', 'finger_a', 'knob', 'pad'], hinge: 'pinch', turning: 'spin', fixed: 'glue' },
} as const;

const fmt = (x: number): string => String(x);
const triple = (v: Vec3): string => v.map(fmt).join(' ');
/**
 * What a fixture's file must hold for this model to be about it: each link's and joint's tags, with their numbers
 * as written. A test lists the ones the file lacks, so the model and the file can't drift apart unseen.
 */
export function written(robot: Robot): string[] {
  const out = [`<robot name="${robot.name}"`];
  for (const l of robot.links) {
    out.push(`<link name="${l.name}">`, `<mass value="${fmt(l.mass)}"/>`, `<inertia ixx="${fmt(l.moments[0])}" ixy="0" ixz="0" iyy="${fmt(l.moments[1])}" iyz="0" izz="${fmt(l.moments[2])}"/>`);
    out.push(`<origin xyz="${triple(l.com)}" rpy="0 0 0"/>`, l.box ? `<box size="${triple(l.box)}"/>` : `<sphere radius="${fmt(l.sphere ?? NaN)}"/>`);
  }
  for (const j of robot.joints) {
    out.push(`<joint name="${j.name}" type="${j.type}">`, `<parent link="${j.parent}"/>`, `<child link="${j.child}"/>`, `<origin xyz="${triple(j.xyz)}" rpy="${triple(j.rpy)}"/>`);
    if (j.axis) out.push(`<axis xyz="${triple(j.axis)}"/>`);
    if (j.lower !== undefined && j.upper !== undefined) out.push(`<limit lower="${fmt(j.lower)}" upper="${fmt(j.upper)}"`);
  }
  return out;
}
export const missingFrom = (text: string, robot: Robot): string[] => written(robot).filter((s) => !text.includes(s));

// ---------------------------------------------------------------------------------------------------
// Where the file puts each link with every joint at 0, and what the change of axes makes of it.

export interface Pose { pos: Vec3; rot: Mat3 }
/** Each link's frame in the root link's, in the file's axes, every joint at 0: a child's is its parent's times its joint's origin. */
export function filePoses(robot: Robot): Map<string, Pose> {
  const poses = new Map<string, Pose>();
  const root = robot.links.find((l) => !robot.joints.some((j) => j.child === l.name));
  if (!root) throw Error(`${robot.name} has no root link`);
  poses.set(root.name, { pos: [0, 0, 0], rot: IDENTITY });
  for (let grew = true; grew;) {
    grew = false;
    for (const j of robot.joints) {
      const parent = poses.get(j.parent);
      if (!parent || poses.has(j.child)) continue;
      poses.set(j.child, { pos: add(parent.pos, apply(parent.rot, j.xyz)), rot: mul(parent.rot, rpy(j.rpy)) });
      grew = true;
    }
  }
  return poses;
}
/** A link's pose after the change of axes: R·p and R·Q·Rᵀ. */
export function movedPose(robot: Robot, link: string, r: Mat3): Pose {
  const p = filePoses(robot).get(link);
  if (!p) throw Error(`${robot.name} has no link ${link}`);
  return { pos: apply(r, p.pos), rot: mul(r, mul(p.rot, transpose(r))) };
}

const tidy = (x: number): number => (Math.abs(x) < 1e-15 ? 0 : x);
const tidied = (v: number[]): number[] => v.map(tidy);
/**
 * The world a conversion of `robot` under the rotation `r` would write, as this suite reads one (README: The surface
 * under test): a dynamic body a link at its link's frame, with its mass, moments, centre of mass and collision shape,
 * and a joint a joint between its parent's and its child's bodies, its anchor and axis in each body's own frame, a
 * revolute joint's limits in degrees and a prismatic one's in metres, every joint articulated. `flip` writes one
 * joint's axis with the other sign in both of its frames: the wrong twin a measure must fail.
 */
export function modelWorld(robot: Robot, r: Mat3, flip?: string): JsonObject {
  const shapes: JsonObject = {}; const bodies: JsonObject = {}; const joints: JsonObject = {};
  for (const l of robot.links) {
    const inertia = movedInertia(l.moments, r);
    if (inertia.product > 1e-12) throw Error(`the rotation leaves ${l.name}'s inertia with products`);
    const half = l.box ? apply(r.map((row) => row.map(Math.abs)) as Mat3, scale(l.box, 0.5)) : null;
    shapes[l.name] = half ? { kind: 'box', half: tidied(half) } : { kind: 'sphere', radius: l.sphere ?? 0 };
    const pose = movedPose(robot, l.name, r);
    bodies[l.name] = {
      kind: 'dynamic', pose: { pos: tidied(pose.pos), rot: tidied(toQuat(pose.rot)) }, mass: l.mass, inertia: tidied(inertia.moments),
      centre_of_mass: tidied(apply(r, l.com)), shapes: [{ shape: l.name, offset: { pos: tidied(apply(r, l.at)) } }],
    };
  }
  for (const j of robot.joints) {
    const sign = j.name === flip ? -1 : 1;
    const axis = j.axis ? scale(j.axis, sign) : null;
    const kind = j.type === 'fixed' ? 'fixed' : j.type === 'prismatic' ? 'slider' : 'hinge';
    const limits = j.lower === undefined || j.upper === undefined || j.type === 'continuous' ? null
      : j.type === 'prismatic' ? { min: j.lower, max: j.upper } : { min: j.lower / RAD, max: j.upper / RAD };
    joints[j.name] = {
      kind, a: j.parent, b: j.child, articulated: true,
      frame_a: { anchor: tidied(apply(r, j.xyz)), ...(axis ? { axis: tidied(apply(r, apply(rpy(j.rpy), axis))) } : {}) },
      frame_b: { anchor: [0, 0, 0], ...(axis ? { axis: tidied(apply(r, axis)) } : {}) },
      ...(limits ? { limits } : {}),
    };
  }
  const n = robot.links.length;
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: [0, -9.81, 0], mode: 'dynamic',
    capacity: { bodies: n, shapes: n, joints: robot.joints.length, contacts: 4 * n, particles: 0 },
    shapes, bodies, joints,
  };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1's numbers, in closed form.

/** ±1.5708 rad in degrees: ±90.00021045914971°, 0.00021° from ±90.000°. */
export const LIMIT_DEG = LIMIT_RAD / RAD;
/** "±90.000° within 0.001°". */
export const ANGLE_TOLERANCE = 0.001;
/** "With both joints at 30°". */
export const BENT = 30;
/** "within 1e-6 m". */
export const TIP_TOLERANCE = 1e-6;
/**
 * The tip from the base in the arm's plane, m, with the shoulder at `s` and the elbow at `e`, degrees: the upper
 * link turns s from the file's +X toward its +Z and the fore link s + e, so the tip is at
 * 0.5 × (cos s + cos(s + e)) along +X and 0.5 × (sin s + sin(s + e)) along +Z.
 */
export const tipInPlane = (s: number, e: number): [number, number] =>
  [LINK * (Math.cos(s * RAD) + Math.cos((s + e) * RAD)), LINK * (Math.sin(s * RAD) + Math.sin((s + e) * RAD))];
/** The same tip in our axes from the base's origin: the file's (x, 0, z) under the rotation. */
export function tipAt(r: Mat3, s: number, e: number): Vec3 {
  const [x, z] = tipInPlane(s, e);
  return apply(r, [x, 0, z]);
}
/** A point from the base's origin in our axes, as the arm's plane reads it: along the file's +X and +Z, and off the plane. */
export function inPlane(r: Mat3, p: Vec3): { along: number; up: number; off: number } {
  return { along: dot(p, apply(r, X)), up: dot(p, apply(r, Z)), off: dot(p, apply(r, Y)) };
}
/** The wrong twin of `tipInPlane`: a sampler that turns the fore link by the elbow's angle alone, as if it were measured from the file's +X. */
export const tipTwin = (s: number, e: number): [number, number] =>
  [LINK * (Math.cos(s * RAD) + Math.cos(e * RAD)), LINK * (Math.sin(s * RAD) + Math.sin(e * RAD))];
