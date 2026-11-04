// The CPU references #433's criteria are held to, as reviewed test code (design: the parity suite): the reference
// library's geometry, world matrix, camera and light rules, ported from three.js at the pinned commit below, and
// Godot's rotation order from its pinned release. Each port keeps only what decides a vertex's position or a
// matrix coefficient, in the source's own order of operations, and names the file it comes from. Nothing here reads
// the program under test.
//
// three.js is MIT licensed: Copyright © 2010-2026 three.js authors. Godot Engine is MIT licensed: Copyright (c)
// 2014-present Godot Engine contributors; Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur.

export type V3 = [number, number, number];
export type V2 = [number, number];
/** A 3 × 4 affine matrix by rows: [R·S | t]. */
export type M34 = [[number, number, number, number], [number, number, number, number], [number, number, number, number]];
export interface Box { min: V3; max: V3 }
export type Params = Record<string, unknown>;

/** The pinned reference library: the oracle page's three.js commit (package.json 0.186.0, REVISION '187dev'). */
export const THREE = { repo: 'mrdoob/three.js', commit: '65c4864bb3bd4309257d41c6e54f4403dc57f255', version: '0.186.0' } as const;
/** The pinned Godot release whose rotation order the godot@1 fixture uses. */
export const GODOT = { repo: 'godotengine/godot', tag: '4.5.1-stable' } as const;

export const rad = (deg: number): number => (deg * Math.PI) / 180;
export const deg = (r: number): number => (r * 180) / Math.PI;
export const fmt = (x: number, digits = 6): string => (Number.isFinite(x) ? Number(x.toPrecision(digits)).toString() : String(x));
export const fmtV = (v: readonly number[], digits = 6): string => `(${v.map((x) => fmt(x, digits)).join(', ')})`;
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: V3): number => Math.sqrt(dot(a, a));
export const unit = (a: V3): V3 => { const l = length(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The axis-aligned box of `points`, each coordinate first rounded to f32 as three.js's Float32BufferAttribute holds it. */
export function boundsOf(points: readonly V3[]): Box {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      const x = Math.fround(p[k]!);
      if (x < min[k]!) min[k] = x;
      if (x > max[k]!) max[k] = x;
    }
  }
  return { min, max };
}

// ---------------------------------------------------------------------------------------------------
// three.js geometry at the pin, positions only. Angles arrive in degrees (README: readings) and become the
// radians the source works in; every other parameter keeps the source's name and default.

const n = (p: Params, k: string, d: number): number => (p[k] === undefined ? d : (p[k] as number));
const a = (p: Params, k: string, d: number): number => (p[k] === undefined ? d : rad(p[k] as number));
const b = (p: Params, k: string, d: boolean): boolean => (p[k] === undefined ? d : (p[k] as boolean));

/** src/geometries/BoxGeometry.js: six buildPlane grids. */
function boxPoints(width: number, height: number, depth: number, ws: number, hs: number, ds: number): V3[] {
  const out: V3[] = [];
  const plane = (u: number, v: number, w: number, udir: number, vdir: number, wd: number, ht: number, dp: number, gx: number, gy: number): void => {
    const sw = wd / gx, sh = ht / gy;
    for (let iy = 0; iy < gy + 1; iy++) {
      const y = iy * sh - ht / 2;
      for (let ix = 0; ix < gx + 1; ix++) {
        const x = ix * sw - wd / 2;
        const vec: V3 = [0, 0, 0];
        vec[u] = x * udir; vec[v] = y * vdir; vec[w] = dp / 2;
        out.push(vec);
      }
    }
  };
  const [X, Y, Z] = [0, 1, 2];
  ws = Math.floor(ws); hs = Math.floor(hs); ds = Math.floor(ds);
  plane(Z, Y, X, -1, -1, depth, height, width, ds, hs);
  plane(Z, Y, X, 1, -1, depth, height, -width, ds, hs);
  plane(X, Z, Y, 1, 1, width, depth, height, ws, ds);
  plane(X, Z, Y, 1, -1, width, depth, -height, ws, ds);
  plane(X, Y, Z, 1, -1, width, height, depth, ws, hs);
  plane(X, Y, Z, -1, -1, width, height, -depth, ws, hs);
  return out;
}

/** src/geometries/SphereGeometry.js */
function spherePoints(p: Params): V3[] {
  const radius = n(p, 'radius', 1);
  const ws = Math.max(3, Math.floor(n(p, 'widthSegments', 32)));
  const hs = Math.max(2, Math.floor(n(p, 'heightSegments', 16)));
  const phiStart = a(p, 'phiStart', 0), phiLength = a(p, 'phiLength', Math.PI * 2);
  const thetaStart = a(p, 'thetaStart', 0), thetaLength = a(p, 'thetaLength', Math.PI);
  const out: V3[] = [];
  for (let iy = 0; iy <= hs; iy++) {
    const theta = thetaStart + (iy / hs) * thetaLength;
    const y = radius * Math.cos(theta);
    const ring = Math.sqrt(radius * radius - y * y);
    for (let ix = 0; ix <= ws; ix++) {
      const phi = phiStart + (ix / ws) * phiLength;
      out.push([-ring * Math.cos(phi), y, ring * Math.sin(phi)]);
    }
  }
  return out;
}

/** src/geometries/CylinderGeometry.js (ConeGeometry.js is radiusTop = 0, radiusBottom = radius). */
function cylinderPoints(radiusTop: number, radiusBottom: number, height: number, radialSegments: number, heightSegments: number, openEnded: boolean, thetaStart: number, thetaLength: number): V3[] {
  radialSegments = Math.floor(radialSegments); heightSegments = Math.floor(heightSegments);
  const half = height / 2;
  const out: V3[] = [];
  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const radius = v * (radiusBottom - radiusTop) + radiusTop;
    for (let x = 0; x <= radialSegments; x++) {
      const theta = (x / radialSegments) * thetaLength + thetaStart;
      out.push([radius * Math.sin(theta), -v * height + half, radius * Math.cos(theta)]);
    }
  }
  const cap = (top: boolean): void => {
    const radius = top ? radiusTop : radiusBottom;
    const sign = top ? 1 : -1;
    for (let x = 1; x <= radialSegments; x++) out.push([0, half * sign, 0]);
    for (let x = 0; x <= radialSegments; x++) {
      const theta = (x / radialSegments) * thetaLength + thetaStart;
      out.push([radius * Math.sin(theta), half * sign, radius * Math.cos(theta)]);
    }
  };
  if (!openEnded) {
    if (radiusTop > 0) cap(true);
    if (radiusBottom > 0) cap(false);
  }
  return out;
}

/** src/geometries/TorusGeometry.js */
function torusPoints(p: Params): V3[] {
  const radius = n(p, 'radius', 1), tube = n(p, 'tube', 0.4);
  const rs = Math.floor(n(p, 'radialSegments', 12)), ts = Math.floor(n(p, 'tubularSegments', 48));
  const arc = a(p, 'arc', Math.PI * 2), thetaStart = a(p, 'thetaStart', 0), thetaLength = a(p, 'thetaLength', Math.PI * 2);
  const out: V3[] = [];
  for (let j = 0; j <= rs; j++) {
    const v = thetaStart + (j / rs) * thetaLength;
    for (let i = 0; i <= ts; i++) {
      const u = (i / ts) * arc;
      out.push([(radius + tube * Math.cos(v)) * Math.cos(u), (radius + tube * Math.cos(v)) * Math.sin(u), tube * Math.sin(v)]);
    }
  }
  return out;
}

/** src/geometries/CapsuleGeometry.js (radius, height, capSegments, radialSegments, heightSegments). */
function capsulePoints(p: Params): V3[] {
  const radius = n(p, 'radius', 1);
  const height = Math.max(0, n(p, 'height', 1));
  const capSegments = Math.max(1, Math.floor(n(p, 'capSegments', 4)));
  const radialSegments = Math.max(3, Math.floor(n(p, 'radialSegments', 8)));
  const heightSegments = Math.max(1, Math.floor(n(p, 'heightSegments', 1)));
  const half = height / 2;
  const out: V3[] = [];
  for (let iy = 0; iy <= capSegments * 2 + heightSegments; iy++) {
    let y: number, r: number;
    if (iy <= capSegments) {
      const angle = ((iy / capSegments) * Math.PI) / 2;
      y = -half - radius * Math.cos(angle); r = radius * Math.sin(angle);
    } else if (iy <= capSegments + heightSegments) {
      y = -half + ((iy - capSegments) / heightSegments) * height; r = radius;
    } else {
      const angle = (((iy - capSegments - heightSegments) / capSegments) * Math.PI) / 2;
      y = half + radius * Math.sin(angle); r = radius * Math.cos(angle);
    }
    for (let ix = 0; ix <= radialSegments; ix++) {
      const theta = (ix / radialSegments) * Math.PI * 2;
      out.push([-r * Math.cos(theta), y, r * Math.sin(theta)]);
    }
  }
  return out;
}

/** src/geometries/PlaneGeometry.js: the XY plane, facing +Z. */
function planePoints(p: Params): V3[] {
  const width = n(p, 'width', 1), height = n(p, 'height', 1);
  const gx = Math.floor(n(p, 'widthSegments', 1)), gy = Math.floor(n(p, 'heightSegments', 1));
  const out: V3[] = [];
  for (let iy = 0; iy < gy + 1; iy++) {
    const y = iy * (height / gy) - height / 2;
    for (let ix = 0; ix < gx + 1; ix++) out.push([ix * (width / gx) - width / 2, -y, 0]);
  }
  return out;
}

/** src/geometries/CircleGeometry.js: the centre, then the arc. */
function circlePoints(p: Params): V3[] {
  const radius = n(p, 'radius', 1), segments = Math.max(3, n(p, 'segments', 32));
  const thetaStart = a(p, 'thetaStart', 0), thetaLength = a(p, 'thetaLength', Math.PI * 2);
  const out: V3[] = [[0, 0, 0]];
  for (let s = 0; s <= segments; s++) {
    const t = thetaStart + (s / segments) * thetaLength;
    out.push([radius * Math.cos(t), radius * Math.sin(t), 0]);
  }
  return out;
}

/** src/geometries/RingGeometry.js */
function ringPoints(p: Params): V3[] {
  const inner = n(p, 'innerRadius', 0.5), outer = n(p, 'outerRadius', 1);
  const ts = Math.max(3, n(p, 'thetaSegments', 32)), ps = Math.max(1, n(p, 'phiSegments', 1));
  const thetaStart = a(p, 'thetaStart', 0), thetaLength = a(p, 'thetaLength', Math.PI * 2);
  const out: V3[] = [];
  let radius = inner;
  const step = (outer - inner) / ps;
  for (let j = 0; j <= ps; j++) {
    for (let i = 0; i <= ts; i++) {
      const t = thetaStart + (i / ts) * thetaLength;
      out.push([radius * Math.cos(t), radius * Math.sin(t), 0]);
    }
    radius += step;
  }
  return out;
}

const PHI = (1 + Math.sqrt(5)) / 2;
/** The base solids' vertices and faces: Tetrahedron-, Octahedron-, Icosahedron- and DodecahedronGeometry.js. */
const SOLIDS: Record<string, { v: number[]; f: number[] }> = {
  tetrahedron: { v: [1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1], f: [2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1] },
  octahedron: { v: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1], f: [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2] },
  icosahedron: {
    v: [-1, PHI, 0, 1, PHI, 0, -1, -PHI, 0, 1, -PHI, 0, 0, -1, PHI, 0, 1, PHI, 0, -1, -PHI, 0, 1, -PHI, PHI, 0, -1, PHI, 0, 1, -PHI, 0, -1, -PHI, 0, 1],
    f: [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1],
  },
  dodecahedron: (() => {
    const r = 1 / PHI;
    return {
      v: [-1, -1, -1, -1, -1, 1, -1, 1, -1, -1, 1, 1, 1, -1, -1, 1, -1, 1, 1, 1, -1, 1, 1, 1, 0, -r, -PHI, 0, -r, PHI, 0, r, -PHI, 0, r, PHI, -r, -PHI, 0, -r, PHI, 0, r, -PHI, 0, r, PHI, 0, -PHI, 0, -r, PHI, 0, -r, -PHI, 0, r, PHI, 0, r],
      f: [3, 11, 7, 3, 7, 15, 3, 15, 13, 7, 19, 17, 7, 17, 6, 7, 6, 15, 17, 4, 8, 17, 8, 10, 17, 10, 6, 8, 0, 16, 8, 16, 2, 8, 2, 10, 0, 12, 1, 0, 1, 18, 0, 18, 16, 6, 10, 2, 6, 2, 13, 6, 13, 15, 2, 16, 18, 2, 18, 3, 2, 3, 13, 18, 1, 9, 18, 9, 11, 18, 11, 3, 4, 14, 12, 4, 12, 0, 4, 0, 8, 11, 9, 5, 11, 5, 19, 11, 19, 7, 19, 5, 14, 19, 14, 4, 19, 4, 17, 1, 12, 14, 1, 14, 5, 1, 5, 9],
    };
  })(),
};

/** src/geometries/PolyhedronGeometry.js: each face subdivided `detail` times (subdivideFace), then put on the sphere (applyRadius). */
function polyhedronPoints(solid: string, p: Params): V3[] {
  const { v, f } = SOLIDS[solid]!;
  const radius = n(p, 'radius', 1), detail = n(p, 'detail', 0);
  const vert = (i: number): V3 => [v[3 * i]!, v[3 * i + 1]!, v[3 * i + 2]!];
  const out: V3[] = [];
  for (let i = 0; i < f.length; i += 3) {
    const [A, B, C] = [vert(f[i]!), vert(f[i + 1]!), vert(f[i + 2]!)];
    const cols = detail + 1;
    const grid: V3[][] = [];
    for (let r = 0; r <= cols; r++) {
      grid[r] = [];
      const aj = lerp3(A, C, r / cols), bj = lerp3(B, C, r / cols);
      const rows = cols - r;
      for (let j = 0; j <= rows; j++) grid[r]![j] = j === 0 && r === cols ? aj : lerp3(aj, bj, j / rows);
    }
    for (let r = 0; r < cols; r++) {
      for (let j = 0; j < 2 * (cols - r) - 1; j++) {
        const k = Math.floor(j / 2);
        if (j % 2 === 0) out.push(grid[r]![k + 1]!, grid[r + 1]![k]!, grid[r]![k]!);
        else out.push(grid[r]![k + 1]!, grid[r + 1]![k + 1]!, grid[r + 1]![k]!);
      }
    }
  }
  return out.map((q) => { const u = unit(q); return [u[0] * radius, u[1] * radius, u[2] * radius] as V3; });
}

/**
 * src/geometries/TubeGeometry.js along a two-point path. The fixture's path is two points, which three.js's
 * CatmullRomCurve3 joins by the straight segment, so getPointAt(u) is the point at u of the way and every tangent
 * is the segment's direction; the first frame is Curve.js's computeFrenetFrames (the smallest tangent component
 * picks the normal), carried unchanged along a straight path.
 */
function tubePoints(p: Params): V3[] {
  const path = p['path'] as V3[];
  if (path.length !== 2) throw Error('reference: the tube fixture is a two-point path');
  const ts = n(p, 'tubularSegments', 64), radius = n(p, 'radius', 1), rs = n(p, 'radialSegments', 8);
  const T = unit(sub(path[1]!, path[0]!));
  let min = Number.MAX_VALUE;
  let normal: V3 = [0, 0, 0];
  const [tx, ty, tz] = T.map(Math.abs) as V3;
  if (tx <= min) { min = tx; normal = [1, 0, 0]; }
  if (ty <= min) { min = ty; normal = [0, 1, 0]; }
  if (tz <= min) normal = [0, 0, 1];
  const vec = unit(cross(T, normal));
  const N = cross(T, vec), B = cross(T, N);
  const out: V3[] = [];
  for (let i = 0; i <= ts; i++) {
    const P = lerp3(path[0]!, path[1]!, i / ts);
    for (let j = 0; j <= rs; j++) {
      const v = (j / rs) * Math.PI * 2;
      const sin = Math.sin(v), cos = -Math.cos(v);
      const d = unit([cos * N[0] + sin * B[0], cos * N[1] + sin * B[1], cos * N[2] + sin * B[2]]);
      out.push([P[0] + radius * d[0], P[1] + radius * d[1], P[2] + radius * d[2]]);
    }
  }
  return out;
}

/** src/geometries/LatheGeometry.js: x = p.x sin φ, z = p.x cos φ. */
function lathePoints(p: Params): V3[] {
  const pts = (p['points'] as V2[] | undefined) ?? [[0, -0.5], [0.5, 0], [0, 0.5]];
  const segments = Math.floor(n(p, 'segments', 12));
  const phiStart = a(p, 'phiStart', 0);
  const phiLength = Math.min(Math.max(a(p, 'phiLength', Math.PI * 2), 0), Math.PI * 2);
  const out: V3[] = [];
  for (let i = 0; i <= segments; i++) {
    const phi = phiStart + i * (1.0 / segments) * phiLength;
    for (const q of pts) out.push([q[0] * Math.sin(phi), q[1], q[0] * Math.cos(phi)]);
  }
  return out;
}

/** extras/ShapeUtils.js: area and isClockWise. */
const area = (c: readonly V2[]): number => {
  let s = 0;
  for (let q = 0, r = c.length - 1; q < c.length; r = q++) s += c[r]![0] * c[q]![1] - c[q]![0] * c[r]![1];
  return s * 0.5;
};

/** src/geometries/ShapeGeometry.js: the shape's points (one polygon, no holes) at z = 0. */
function shapePoints(p: Params): V3[] {
  return (p['shape'] as V2[]).map((q) => [q[0], q[1], 0] as V3);
}

/**
 * src/geometries/ExtrudeGeometry.js, one polygon shape with no holes and no extrudePath: the contour made clockwise,
 * its bevel vectors (getBevelVec), the front bevel layers at −z, the body from 0 to depth, the back bevel layers at
 * depth + z. Every layer's points are faces' corners, so their box is the geometry's.
 */
function extrudePoints(p: Params): V3[] {
  let contour = (p['shape'] as V2[]).map((q) => [q[0], q[1]] as V2);
  const steps = n(p, 'steps', 1), depth = n(p, 'depth', 1);
  const enabled = b(p, 'bevelEnabled', true);
  let thickness = n(p, 'bevelThickness', 0.2);
  let size = p['bevelSize'] === undefined ? thickness - 0.1 : (p['bevelSize'] as number);
  let offset = n(p, 'bevelOffset', 0), segments = n(p, 'bevelSegments', 3);
  if (!enabled) { segments = 0; thickness = 0; size = 0; offset = 0; }
  if (!(area(contour) < 0)) contour = contour.reverse();
  const bevelVec = (pt: V2, prev: V2, next: V2): V2 => {
    let tx: number, ty: number, shrink: number;
    const px = pt[0] - prev[0], py = pt[1] - prev[1];
    const nx = next[0] - pt[0], ny = next[1] - pt[1];
    const plsq = px * px + py * py;
    const collinear = px * ny - py * nx;
    if (Math.abs(collinear) > Number.EPSILON) {
      const pl = Math.sqrt(plsq), nl = Math.sqrt(nx * nx + ny * ny);
      const psx = prev[0] - py / pl, psy = prev[1] + px / pl;
      const nsx = next[0] - ny / nl, nsy = next[1] + nx / nl;
      const sf = ((nsx - psx) * ny - (nsy - psy) * nx) / (px * ny - py * nx);
      tx = psx + px * sf - pt[0]; ty = psy + py * sf - pt[1];
      const lsq = tx * tx + ty * ty;
      if (lsq <= 2) return [tx, ty];
      shrink = Math.sqrt(lsq / 2);
    } else {
      let same = false;
      if (px > Number.EPSILON) { if (nx > Number.EPSILON) same = true; } else if (px < -Number.EPSILON) { if (nx < -Number.EPSILON) same = true; } else if (Math.sign(py) === Math.sign(ny)) same = true;
      if (same) { tx = -py; ty = px; shrink = Math.sqrt(plsq); } else { tx = px; ty = py; shrink = Math.sqrt(plsq / 2); }
    }
    return [tx / shrink, ty / shrink];
  };
  const L = contour.length;
  const moves = contour.map((c, i) => bevelVec(c, contour[(i + L - 1) % L]!, contour[(i + 1) % L]!));
  const scaled = (i: number, s: number): V2 => [contour[i]![0] + moves[i]![0] * s, contour[i]![1] + moves[i]![1] * s];
  const out: V3[] = [];
  for (let k = 0; k < segments; k++) {
    const t = k / segments;
    const z = thickness * Math.cos((t * Math.PI) / 2), s = size * Math.sin((t * Math.PI) / 2) + offset;
    for (let i = 0; i < L; i++) { const q = scaled(i, s); out.push([q[0], q[1], -z]); }
  }
  const s = size + offset;
  for (let i = 0; i < L; i++) { const q = enabled ? scaled(i, s) : contour[i]!; out.push([q[0], q[1], 0]); }
  for (let st = 1; st <= steps; st++) for (let i = 0; i < L; i++) { const q = enabled ? scaled(i, s) : contour[i]!; out.push([q[0], q[1], (depth / steps) * st]); }
  for (let k = segments - 1; k >= 0; k--) {
    const t = k / segments;
    const z = thickness * Math.cos((t * Math.PI) / 2), s2 = size * Math.sin((t * Math.PI) / 2) + offset;
    for (let i = 0; i < L; i++) { const q = scaled(i, s2); out.push([q[0], q[1], depth + z]); }
  }
  return out;
}

/** examples/jsm/geometries/RoundedBoxGeometry.js: a 1 m box of 2 × segments + 1 cells a side, each vertex pushed out to the rounded shell. */
function roundedBoxPoints(p: Params): V3[] {
  const width = n(p, 'width', 1), height = n(p, 'height', 1), depth = n(p, 'depth', 1);
  const segments = n(p, 'segments', 2);
  const total = segments * 2 + 1;
  const radius = Math.min(width / 2, height / 2, depth / 2, n(p, 'radius', 0.1));
  const unitBox = boxPoints(1, 1, 1, total, total, total);
  if (total === 1) return unitBox;
  const box: V3 = [width / 2 - radius, height / 2 - radius, depth / 2 - radius];
  const half = 0.5 / total;
  return unitBox.map((q) => {
    const nrm = unit([q[0] - Math.sign(q[0]) * half, q[1] - Math.sign(q[1]) * half, q[2] - Math.sign(q[2]) * half]);
    return [box[0] * Math.sign(q[0]) + nrm[0] * radius, box[1] * Math.sign(q[1]) + nrm[1] * radius, box[2] * Math.sign(q[2]) + nrm[2] * radius] as V3;
  });
}

/** The reference library's geometry for `familiar.<name>@1` with `params`, as the vertices three.js builds. */
export function threePoints(name: string, p: Params): V3[] {
  switch (name) {
    case 'box': return boxPoints(n(p, 'width', 1), n(p, 'height', 1), n(p, 'depth', 1), n(p, 'widthSegments', 1), n(p, 'heightSegments', 1), n(p, 'depthSegments', 1));
    case 'sphere': return spherePoints(p);
    case 'cylinder': return cylinderPoints(n(p, 'radiusTop', 1), n(p, 'radiusBottom', 1), n(p, 'height', 1), n(p, 'radialSegments', 32), n(p, 'heightSegments', 1), b(p, 'openEnded', false), a(p, 'thetaStart', 0), a(p, 'thetaLength', Math.PI * 2));
    case 'cone': return cylinderPoints(0, n(p, 'radius', 1), n(p, 'height', 1), n(p, 'radialSegments', 32), n(p, 'heightSegments', 1), b(p, 'openEnded', false), a(p, 'thetaStart', 0), a(p, 'thetaLength', Math.PI * 2));
    case 'torus': return torusPoints(p);
    case 'capsule': return capsulePoints(p);
    case 'plane': return planePoints(p);
    case 'circle': return circlePoints(p);
    case 'ring': return ringPoints(p);
    case 'tetrahedron': case 'octahedron': case 'icosahedron': case 'dodecahedron': return polyhedronPoints(name, p);
    case 'tube': return tubePoints(p);
    case 'lathe': return lathePoints(p);
    case 'extrude': return extrudePoints(p);
    case 'shape': return shapePoints(p);
    case 'rounded_box': return roundedBoxPoints(p);
    default: throw Error(`reference: no three.js geometry for familiar.${name}@1`);
  }
}

// ---------------------------------------------------------------------------------------------------
// Matrices.

/** Rotation by rows. */
type M3 = [[number, number, number], [number, number, number], [number, number, number]];
const mul3 = (A: M3, B: M3): M3 => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j]! + row[1] * B[1][j]! + row[2] * B[2][j]!)) as M3;
const Rx = (t: number): M3 => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const Ry = (t: number): M3 => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
const Rz = (t: number): M3 => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];

/** src/math/Matrix4.js makeRotationFromEuler, order 'XYZ' (Euler.DEFAULT_ORDER): rows of te as written there. */
function threeRotationXYZ(x: number, y: number, z: number): M3 {
  const a2 = Math.cos(x), b2 = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a2 * e, af = a2 * f, be = b2 * e, bf = b2 * f;
  return [[c * e, -c * f, d], [af + be * d, ae - bf * d, -b2 * c], [bf - ae * d, be + af * d, a2 * c]];
}

/** R·S with t, as a 3 × 4. */
const affine = (R: M3, s: V3, t: V3): M34 => [0, 1, 2].map((i) => [R[i]![0] * s[0], R[i]![1] * s[1], R[i]![2] * s[2], t[i]!]) as M34;

/**
 * three.js's matrixWorld for an object at the root with `position`, `rotation` (degrees here; Euler order 'XYZ'),
 * `scale` and `pivot`: Matrix4.compose(position, quaternion, scale), then Object3D.updateMatrix's pivot step,
 * te[12 + i] += pivot_i − Σ_j te[4j + i] pivot_j, which maps the pivot to position + pivot.
 */
export function threeWorld(position: V3, rotationDeg: V3, scale: V3, pivot: V3): M34 {
  const m = affine(threeRotationXYZ(rad(rotationDeg[0]), rad(rotationDeg[1]), rad(rotationDeg[2])), scale, position);
  for (let i = 0; i < 3; i++) m[i]![3] += pivot[i]! - (m[i]![0] * pivot[0] + m[i]![1] * pivot[1] + m[i]![2] * pivot[2]);
  return m;
}

/** Ours (canvas primitives: Units and axes): R = Rz·Ry·Rx about fixed axes, angles in degrees. */
export const oursRotation = (rotDeg: V3): M3 => mul3(mul3(Rz(rad(rotDeg[2])), Ry(rad(rotDeg[1]))), Rx(rad(rotDeg[0])));

/** Our angles for a rotation matrix: the R = Rz·Ry·Rx decomposition with y in [−90°, 90°]. */
export function oursAngles(R: M3): V3 {
  return [deg(Math.atan2(R[2][1], R[2][2])), deg(Math.asin(-R[2][0])), deg(Math.atan2(R[1][0], R[0][0]))];
}
export const rotationOf = (m: M34, s: V3): M3 => [0, 1, 2].map((i) => [m[i]![0] / s[0], m[i]![1] / s[1], m[i]![2] / s[2]]) as M3;

/**
 * Godot's Node3D transform at the pinned release: core/math/basis.cpp set_euler with EulerOrder::YXZ (Node3D's
 * default rotation_order) is ymat · xmat · zmat, radians; the basis then scales its columns by `scale`.
 */
export function godotWorld(position: V3, rotationRad: V3, scale: V3): M34 {
  return affine(mul3(mul3(Ry(rotationRad[1]), Rx(rotationRad[0])), Rz(rotationRad[2])), scale, position);
}

/** Matrix applied to a point. */
export const apply = (m: M34, q: V3): V3 => [0, 1, 2].map((i) => m[i]![0] * q[0] + m[i]![1] * q[1] + m[i]![2] * q[2] + m[i]![3]) as V3;

// ---------------------------------------------------------------------------------------------------
// Camera and light rules.

/**
 * Ours across the wider side (Camera camera@1: `fov` "across the wider side") from three.js's vertical fov
 * (src/cameras/PerspectiveCamera.js: fov is "from bottom to top of view, in degrees"; updateProjectionMatrix's
 * width = aspect × height): 2·atan(aspect·tan(fov/2)) when the frame is wider than tall, the fov itself otherwise.
 */
export const oursFov = (verticalDeg: number, aspect: number): number =>
  aspect > 1 ? deg(2 * Math.atan(aspect * Math.tan(rad(verticalDeg) / 2))) : verticalDeg;

/** three.js's camera looks along its local −Z (Object3D.lookAt for cameras; the criterion's forward). */
export function threeForward(rotationDeg: V3): V3 {
  const R = threeRotationXYZ(rad(rotationDeg[0]), rad(rotationDeg[1]), rad(rotationDeg[2]));
  return [-R[0][2], -R[1][2], -R[2][2]];
}

/**
 * Illuminance on a point or spot light's axis at d metres from our power (canvas primitives: Light, "a spot's
 * `power` counts the whole sphere, as a point light's does: lm = 4π × cd"): E = power ÷ 4π ÷ d².
 */
export const axisLux = (powerLm: number, d: number): number => powerLm / (4 * Math.PI) / (d * d);
