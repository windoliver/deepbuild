// The three wrong conversions issue #3035's criteria name (README: The planted programs), each as what it does to a
// right conversion's `document` and `report`, as JSON text in and out. A planted tool runs the right tool and then
// one of these on what it wrote (tool.mjs.fixture), and the tests run the same function on the right conversion's
// output to read, on evaluated data, what the planted conversion makes of the fixture. Each one is wrong about one
// named thing of its criterion's fixture and leaves every other output as it was, byte for byte.

/** The planted programs, by name. */
export const PLANTED = ['flips_one_joint_axis', 'copies_poses_as_written', 'drops_one_silently'];
/** The joint whose axis `flips_one_joint_axis` flips. */
export const FLIPPED = 'elbow';
/** The link by which `copies_poses_as_written` knows its fixture: it copies the poses of a world that holds this body. */
export const MOVED = 'mast';
/** The element whose row `drops_one_silently` leaves out of `dropped`. */
export const UNLISTED = 'transmission';

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const numbers = (v, n) => (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? v : null);
const tidy = (x) => (Math.abs(x) < 1e-15 ? 0 : x);

// Rotations as matrices by rows.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const transpose = (m) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i]));
const mul = (a, b) => { const t = transpose(b); return [0, 1, 2].map((i) => [0, 1, 2].map((j) => dot(a[i], t[j]))); };
const apply = (m, v) => m.map((row) => dot(row, v));
function turn(axis, deg) {
  const c = Math.cos((deg * Math.PI) / 180); const s = Math.sin((deg * Math.PI) / 180);
  const [i, j] = [(axis + 1) % 3, (axis + 2) % 3];
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  m[axis][axis] = 1; m[i][i] = c; m[i][j] = -s; m[j][i] = s; m[j][j] = c;
  return m;
}
function fromQuat(q) {
  const n = Math.hypot(...q);
  const [x, y, z, w] = q.map((c) => c / n);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}
function toQuat(m) {
  const t = m[0][0] + m[1][1] + m[2][2];
  let q;
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
  return q[3] < 0 ? q.map((c) => -c) : q;
}
/** A `rot` as a matrix: a quaternion [x, y, z, w], or degrees about X, then Y, then Z in fixed axes; none is no turn; null when it is neither. */
function rotOf(v) {
  if (v === undefined) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const q = numbers(v, 4);
  if (q) return Math.hypot(...q) > 1e-9 ? fromQuat(q) : null;
  const d = numbers(v, 3);
  return d ? mul(turn(2, d[2]), mul(turn(1, d[1]), turn(0, d[0]))) : null;
}

/** A value as JSON text laid out as `like` is: its indentation, and its last line's end. */
function written(value, like) {
  const indent = /\n([ \t]+)"/.exec(like)?.[1];
  return `${JSON.stringify(value, null, indent)}${like.endsWith('\n') ? '\n' : ''}`;
}
const parsed = (text) => { try { return JSON.parse(text); } catch { return undefined; } };
const worldsOf = (document) => (isObject(document) && isObject(document.worlds) ? Object.values(document.worlds).filter(isObject) : []);

/**
 * `flips_one_joint_axis`: the joint `elbow`'s axis with the other sign in both of its frames, as if the file's
 * `<axis>` were written negated. Nothing else changes, and a document with no such joint is left as it is.
 */
function flipsOneJointAxis(outputs) {
  const document = parsed(outputs.document);
  let changed = false;
  for (const world of worldsOf(document)) {
    const joint = isObject(world.joints) ? world.joints[FLIPPED] : undefined;
    if (!isObject(joint)) continue;
    const flip = (v) => v.map((x) => tidy(-x));
    joint.frame_a = { ...(isObject(joint.frame_a) ? joint.frame_a : {}), axis: flip(numbers(joint.frame_a?.axis, 3) ?? [1, 0, 0]) };
    if (isObject(joint.frame_b) && numbers(joint.frame_b.axis, 3)) joint.frame_b = { ...joint.frame_b, axis: flip(joint.frame_b.axis) };
    changed = true;
  }
  return changed ? { ...outputs, document: written(document, outputs.document) } : outputs;
}

/**
 * `copies_poses_as_written`: in a world that holds the body `mast`, every body's pose is the one the file writes
 * for its link, the report's stated rotation R undone on it alone (position Rᵀ·p, orientation Rᵀ·Q·R, written as a
 * quaternion), while every anchor, axis, inertia and shape stays as converted. A body the rotation leaves where it
 * was keeps its pose as written, and a document with no such world, or a report that states no rotation, is left as
 * it is.
 */
function copiesPosesAsWritten(outputs) {
  const document = parsed(outputs.document);
  const report = parsed(outputs.report);
  const r = isObject(report) && report.rotation !== undefined ? rotOf(report.rotation) : null;
  if (!r) return outputs;
  const back = transpose(r);
  let changed = false;
  for (const world of worldsOf(document)) {
    if (!isObject(world.bodies) || !isObject(world.bodies[MOVED])) continue;
    for (const body of Object.values(world.bodies)) {
      if (!isObject(body)) continue;
      const pose = isObject(body.pose) ? body.pose : {};
      const pos = numbers(pose.pos, 3) ?? [0, 0, 0];
      const rot = rotOf(pose.rot);
      if (!rot) continue;
      const moved = apply(back, pos);
      const turned = mul(back, mul(rot, r));
      const same = moved.every((x, i) => Math.abs(x - pos[i]) <= 1e-9) && turned.every((row, i) => row.every((x, j) => Math.abs(x - rot[i][j]) <= 1e-9));
      if (same) continue;
      body.pose = { ...pose, pos: moved.map(tidy), rot: toQuat(turned).map(tidy) };
      changed = true;
    }
  }
  return changed ? { ...outputs, document: written(document, outputs.document) } : outputs;
}

/**
 * `drops_one_silently`: the report's `dropped` without its `transmission` rows, so the transmission is neither
 * converted nor listed. Nothing else changes, and a report with no such row is left as it is.
 */
function dropsOneSilently(outputs) {
  const report = parsed(outputs.report);
  if (!isObject(report) || !Array.isArray(report.dropped)) return outputs;
  const kept = report.dropped.filter((row) => !(isObject(row) && row.element === UNLISTED));
  if (kept.length === report.dropped.length) return outputs;
  return { ...outputs, report: written({ ...report, dropped: kept }, outputs.report) };
}

/** What the planted program `name` makes of a right conversion's outputs `{document, report}`; any other name leaves them as they are. */
export function spoil(name, outputs) {
  if (name === 'flips_one_joint_axis') return flipsOneJointAxis(outputs);
  if (name === 'copies_poses_as_written') return copiesPosesAsWritten(outputs);
  if (name === 'drops_one_silently') return dropsOneSilently(outputs);
  return outputs;
}
