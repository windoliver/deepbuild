// The criteria's judges (README: Criteria to tests): pure functions of the canvas's pictures and this suite's expected
// values, each returning its failures, every one naming what it judges (the mark, the pixel, the line through the lone
// cell). Nothing here draws or reads a binary's answer but the pictures handed in.

import { FRONT, frontAt, LONE, NONE, SIDE, teamAt } from './programs.ts';
import { CELL, FRONT_CELL, MARGIN, mapId, originOf } from './fixtures.ts';
import { apart, coverageIn, distanceToHalfLevel, halfLevel, loneShare, rgbAt, rgbaAt, type Image, type Key, type Rgb } from './helpers.ts';

export const NEAREST = mapId('nearest');
export const SMOOTH = mapId('smooth');
const colorOf = (key: Key, v: number): Rgb => (v === NONE ? key.ground : key.teams[v]!);

// ---------------------------------------------------------------------------------------------------
// AC1: nearest pixel for pixel; the lone held cell drawn smooth to the half level of k(x)·k(y).

/** Nearest (grid image 0 of the grid fixture): every pixel of every cell at step `k`, exactly; a cell's first pixel
 * that differs is named. */
export function nearestFailures(im: Image, key: Key, k: number): string[] {
  const out: string[] = [];
  const [ox, oy] = originOf(0);
  for (let cy = 0; cy < SIDE; cy++) {
    for (let cx = 0; cx < SIDE; cx++) {
      const v = teamAt(cx, cy, k);
      const want = colorOf(key, v);
      cell: for (let j = 0; j < CELL; j++) {
        for (let i = 0; i < CELL; i++) {
          const [x, y] = [ox + CELL * cx + i, oy + CELL * cy + j];
          const got = rgbAt(im, x, y);
          if (apart(got, want) !== 0) { out.push(`${NEAREST}: cell (${cx}, ${cy}), value ${v}: pixel (${x}, ${y}) draws [${got.join(', ')}], not its ${v === NONE ? 'ground' : 'role'} [${want.join(', ')}]`); break cell; }
        }
      }
    }
  }
  return out;
}

/** Half a pixel at 8 px a cell, the criterion's tolerance, in cells. */
export const WITHIN = 0.5 / CELL;
/** The eight lines through the lone cell's centre (a pixel corner): each a direction and the pixels along it outward. */
const LINES: { name: string; u: [number, number]; px: (m: number, c: [number, number]) => [number, number] }[] = [
  { name: '+x axis', u: [1, 0], px: (m, [x, y]) => [x + m, y] },
  { name: '−x axis', u: [-1, 0], px: (m, [x, y]) => [x - 1 - m, y] },
  { name: '+y axis', u: [0, 1], px: (m, [x, y]) => [x, y + m] },
  { name: '−y axis', u: [0, -1], px: (m, [x, y]) => [x, y - 1 - m] },
  { name: '+x+y diagonal', u: [Math.SQRT1_2, Math.SQRT1_2], px: (m, [x, y]) => [x + m, y + m] },
  { name: '+x−y diagonal', u: [Math.SQRT1_2, -Math.SQRT1_2], px: (m, [x, y]) => [x + m, y - 1 - m] },
  { name: '−x+y diagonal', u: [-Math.SQRT1_2, Math.SQRT1_2], px: (m, [x, y]) => [x - 1 - m, y + m] },
  { name: '−x−y diagonal', u: [-Math.SQRT1_2, -Math.SQRT1_2], px: (m, [x, y]) => [x - 1 - m, y - 1 - m] },
];
export interface Lone { failures: string[]; crossings: Map<string, number | null>; held: number }
/** Smooth (grid image 1 of the grid fixture): the lone held cell at step `k` against the half level of k(x)·k(y). Along
 * each line the edge is where the pixels pass half covered by the role (in sRGB or in linear light, as the picture
 * blends), interpolated between the two pixel centres either side; every pixel more than 1 px from the half level must
 * be wholly the role inside it and the ground outside, within one level. */
export function loneJudge(im: Image, key: Key, k: number): Lone {
  const [ox, oy] = originOf(1);
  const centre: [number, number] = [ox + CELL * LONE.x + CELL / 2, oy + CELL * LONE.y + CELL / 2];
  const role = key.teams[teamAt(LONE.x, LONE.y, k)]!;
  const cells = (x: number, y: number): [number, number] => [(x + 0.5 - centre[0]) / CELL, (y + 0.5 - centre[1]) / CELL];
  const near: Rgb[] = [];
  for (let y = centre[1] - 2 * CELL; y < centre[1] + 2 * CELL; y++) for (let x = centre[0] - 2 * CELL; x < centre[0] + 2 * CELL; x++) near.push(rgbAt(im, x, y));
  const covered = coverageIn(near, role, key.ground);
  const f = (x: number, y: number): number => covered(rgbAt(im, x, y));
  const out: string[] = [];
  const crossings = new Map<string, number | null>();
  let held = 0;
  for (let y = centre[1] - 2 * CELL; y < centre[1] + 2 * CELL; y++) for (let x = centre[0] - 2 * CELL; x < centre[0] + 2 * CELL; x++) if (f(x, y) >= 0.5) held++;
  if (held === 0) {
    out.push(`${SMOOTH}: the lone held cell (${LONE.x}, ${LONE.y}) draws nothing: no pixel within 2 cells of its centre (${centre.join(', ')}) is nearer its role than the ground, where k(x)·k(y) passes 1/2 out to 0.545 cells`);
    for (const l of LINES) crossings.set(l.name, null);
    return { failures: out, crossings, held };
  }
  for (const l of LINES) {
    const pts = Array.from({ length: 2 * CELL }, (_, m) => {
      const [x, y] = l.px(m, centre);
      const [sx, sy] = cells(x, y);
      return { t: sx * l.u[0] + sy * l.u[1], o: -sx * l.u[1] + sy * l.u[0], f: f(x, y) };
    });
    const want = halfLevel(l.u[0], l.u[1], pts[0]!.o);
    const last = pts.findIndex((p) => p.f < 0.5);
    if (last <= 0) {
      crossings.set(l.name, null);
      out.push(`${SMOOTH}: along the ${l.name} the lone cell's role ${last === 0 ? 'is not drawn at its centre' : 'never gives way to the ground'}; its edge should cross ${want.toFixed(3)} cells from the centre`);
      continue;
    }
    const [a, b] = [pts[last - 1]!, pts[last]!];
    const t = a.t + ((a.f - 0.5) / (a.f - b.f)) * (b.t - a.t);
    crossings.set(l.name, t);
    if (Math.abs(t - want) > WITHIN) {
      out.push(`${SMOOTH}: along the ${l.name} the lone cell's edge crosses ${t.toFixed(3)} cells from its centre, not ${want.toFixed(3)} (where k(x)·k(y) passes 1/2), ${(Math.abs(t - want) * CELL).toFixed(2)} px off; 0.5 px allowed`);
    }
  }
  for (let y = centre[1] - 2 * CELL; y < centre[1] + 2 * CELL; y++) {
    for (let x = centre[0] - 2 * CELL; x < centre[0] + 2 * CELL; x++) {
      const [sx, sy] = cells(x, y);
      const d = distanceToHalfLevel(sx, sy) * CELL;
      if (d <= 1) continue;
      const inside = loneShare(sx, sy) > 0.5;
      const want = inside ? role : key.ground;
      const got = rgbAt(im, x, y);
      if (apart(got, want) > 1) out.push(`${SMOOTH}: pixel (${x}, ${y}), ${d.toFixed(2)} px ${inside ? 'inside' : 'outside'} the half level of k(x)·k(y), draws [${got.join(', ')}], not ${inside ? 'the lone cell\'s role' : 'the ground'} [${want.join(', ')}]`);
    }
  }
  return { failures: out, crossings, held };
}

// ---------------------------------------------------------------------------------------------------
// AC2: three roles at a corner of four cells, two of them one role.

export const CORNER_ITEM = 'corner_map';
/** The corner fixture's corner, in px. */
export const CORNER_PX: [number, number] = [MARGIN + (FRONT / 2) * FRONT_CELL, MARGIN + (FRONT / 2) * FRONT_CELL];
const decode = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** p's weights on the basis's four colors (they sum to 1), solved in sRGB or in linear light. */
function weights(p: Rgb, basis: Rgb[], linear: boolean): number[] {
  const f = linear ? decode : (c: number) => c / 255;
  const cols = basis.map((c) => c.map(f));
  const m = [0, 1, 2].map((ch) => [...cols.map((c) => c[ch]!), f(p[ch]!)]);
  m.push([1, 1, 1, 1, 1]);
  for (let c = 0; c < 4; c++) {
    let best = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[best]![c]!)) best = r;
    [m[c], m[best]] = [m[best]!, m[c]!];
    const pivot = m[c]!;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const row = m[r]!;
      const ratio = row[c]! / pivot[c]!;
      for (let j = c; j < 5; j++) row[j] = row[j]! - ratio * pivot[j]!;
    }
  }
  return m.map((row, i) => row[4]! / row[i]!);
}
/** Every pixel of the 4 × 4 cells round the corner must be a blend of the three roles (in sRGB or in linear light, the
 * better fit) holding at most a quarter of the ground; and the four cells' centres show their own roles. */
export function cornerFailures(im: Image, key: Key): string[] {
  const out: string[] = [];
  const basis = [...key.teams, key.ground];
  for (const [cx, cy] of [[3, 3], [4, 3], [3, 4], [4, 4]] as const) {
    const [x, y] = [MARGIN + cx * FRONT_CELL + FRONT_CELL / 2, MARGIN + cy * FRONT_CELL + FRONT_CELL / 2];
    const want = key.teams[frontAt(cx, cy)]!;
    const got = rgbAt(im, x, y);
    if (apart(got, want) > 1) out.push(`${CORNER_ITEM}: pixel (${x}, ${y}), cell (${cx}, ${cy})'s centre, draws [${got.join(', ')}], not its own role ${frontAt(cx, cy)} [${want.join(', ')}]`);
  }
  for (let y = CORNER_PX[1] - 2 * FRONT_CELL; y < CORNER_PX[1] + 2 * FRONT_CELL; y++) {
    for (let x = CORNER_PX[0] - 2 * FRONT_CELL; x < CORNER_PX[0] + 2 * FRONT_CELL; x++) {
      const p = rgbAt(im, x, y);
      const [s, l] = [weights(p, basis, false), weights(p, basis, true)];
      const w = Math.min(...s.slice(0, 3)) >= Math.min(...l.slice(0, 3)) ? s : l;
      const from = `${x - CORNER_PX[0]}, ${y - CORNER_PX[1]} px from the corner`;
      if (w[3]! > 0.25) out.push(`${CORNER_ITEM}: pixel (${x}, ${y}) draws none: [${p.join(', ')}] is ${Math.round(100 * w[3]!)}% the ground (${from})`);
      else if (Math.min(...w.slice(0, 3)) < -0.1) out.push(`${CORNER_ITEM}: pixel (${x}, ${y}) draws [${p.join(', ')}], no blend of the three roles (${from})`);
    }
  }
  return out;
}
/** Whether a pixel lies within a cell of the corner fixture's corner. */
export const nearCorner = (x: number, y: number): boolean => Math.hypot(x + 0.5 - CORNER_PX[0], y + 0.5 - CORNER_PX[1]) <= FRONT_CELL;

// ---------------------------------------------------------------------------------------------------
// AC5: the smooth fixture (the grid fixture drawn smooth alone, grid image 0) by Vello CPU and by the GPU layer.

/** Every pixel, each of R, G, B and A within one level. */
export function pairFailures(cpu: Image, gpu: Image): string[] {
  const out: string[] = [];
  for (let y = 0; y < cpu.height; y++) {
    for (let x = 0; x < cpu.width; x++) {
      const [c, g] = [rgbaAt(cpu, x, y), rgbaAt(gpu, x, y)];
      if (apart(c, g) > 1) out.push(`${SMOOTH}: pixel (${x}, ${y}): the CPU render [${c.join(', ')}], the GPU draw [${g.join(', ')}], ${apart(c, g)} levels apart`);
    }
  }
  return out;
}
/** Whether the cells two either side of the cell under a pixel hold more than one value at step `k`: an edge. */
export function atEdge(x: number, y: number, k: number): boolean {
  const [ox, oy] = originOf(0);
  const [cx, cy] = [Math.floor((x - ox) / CELL), Math.floor((y - oy) / CELL)];
  if (cx < 0 || cy < 0 || cx >= SIDE || cy >= SIDE) return false;
  const seen = new Set<number>();
  for (let j = Math.max(0, cy - 2); j <= Math.min(SIDE - 1, cy + 2); j++) for (let i = Math.max(0, cx - 2); i <= Math.min(SIDE - 1, cx + 2); i++) seen.add(teamAt(i, j, k));
  return seen.size > 1;
}
/** That a picture of the smooth fixture is the grid: at the centre of every cell away from an edge, its value's role
 * (or the ground for `none`), within one level. */
export function gridCentreFailures(im: Image, key: Key, k: number, who: string): string[] {
  const out: string[] = [];
  const [ox, oy] = originOf(0);
  for (let cy = 0; cy < SIDE; cy++) {
    for (let cx = 0; cx < SIDE; cx++) {
      const [x, y] = [ox + CELL * cx + CELL / 2, oy + CELL * cy + CELL / 2];
      if (atEdge(x, y, k)) continue;
      const v = teamAt(cx, cy, k);
      const want = colorOf(key, v);
      const got = rgbAt(im, x, y);
      if (apart(got, want) > 1) out.push(`${SMOOTH} by ${who}: cell (${cx}, ${cy})'s centre (${x}, ${y}), amid cells of value ${v} alone, draws [${got.join(', ')}], not [${want.join(', ')}]`);
    }
  }
  return out;
}
/** The pixels of two pictures more than one level apart in R, G or B: their count and the first. */
export function sameFailures(a: Image, b: Image, what: string): string[] {
  let n = 0;
  let first = '';
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (apart(rgbAt(a, x, y), rgbAt(b, x, y)) <= 1) continue;
      n++;
      first ||= `pixel (${x}, ${y}): [${rgbAt(a, x, y).join(', ')}] against [${rgbAt(b, x, y).join(', ')}]`;
    }
  }
  return n ? [`${what}: ${n} pixels differ by more than one level; the first, ${first}`] : [];
}
