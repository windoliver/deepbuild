// AC4: "Emitted points lie inside (volume) or on (surface) each shape, their counts per region pass a fixed
// chi-squared bound at 99%, and adding a particle moves no other (parity/vfx/emit-shapes.film)"
//
// The parity fixture `fixtures/parity/vfx/emit-shapes.film` holds ten emitters, each bursting 4,096 particles at 0 s
// that hold still where they are born (no velocity, gravity or drag): a disk and a ring on volume, and a sphere, a
// box, a cylinder and a capsule each on volume and on surface. The `particles` call reads every row's CPU f64 position
// at 1 s, which is its birth point. Each point, less its item's position, must lie inside its shape (volume) or on it
// (surface) within 1e-9 m; the points' counts over 24 or 32 regions of known share (equal volumes, equal areas, or
// areas weighted as the faces are) must give a Pearson statistic under the fixed 99% bound for their degrees of
// freedom; and the same film with each burst's count raised to 4,097 must leave rows 0 to 4,095 exactly where they
// were, bit for bit, while row 4,096 holds the new particle. The criterion names no planted program.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, ac, chi2Bound99, chiSquared, emitShapes, flicks, fmt, fmtV, none, obj, passed, particleIds, particlesCall, reading,
  runGpu, sub, useBins, useDir, withBursts, writeJson, type JsonObject, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const AT = flicks(1);
const N = 4096;
/** "Inside" and "on" in f64, m. */
const EPS = 1e-9;

const TAU = 2 * Math.PI;
const sector = (x: number, z: number, n: number): number => Math.min(n - 1, Math.floor(((((Math.atan2(z, x) % TAU) + TAU) % TAU) / TAU) * n));
const band = (u: number, n: number): number => Math.max(0, Math.min(n - 1, Math.floor(u * n)));
const rho = (p: V3): number => Math.hypot(p[0], p[2]);

/** One shape as the fixture declares it: why a local point isn't inside or on it (null when it is), its region, and each region's share. */
interface Shape { why: (p: V3) => string | null; region: (p: V3) => number; probs: number[] }
const even = (n: number): number[] => Array.from({ length: n }, () => 1 / n);

function disk(R: number): Shape {
  return {
    why: (p) => (Math.abs(p[1]) > EPS ? `off the disk's plane by ${p[1]} m` : rho(p) > R + EPS ? `${rho(p)} m from its axis, past r ${R}` : null),
    region: (p) => band((rho(p) / R) ** 2, 4) * 8 + sector(p[0], p[2], 8),
    probs: even(32),
  };
}
function ring(r: number, inner: number): Shape {
  return {
    why: (p) => (Math.abs(p[1]) > EPS ? `off the ring's plane by ${p[1]} m` : rho(p) > r + EPS || rho(p) < inner - EPS ? `${rho(p)} m from its axis, outside [${inner}, ${r}]` : null),
    region: (p) => band((rho(p) ** 2 - inner ** 2) / (r ** 2 - inner ** 2), 4) * 8 + sector(p[0], p[2], 8),
    probs: even(32),
  };
}
function ball(R: number): Shape {
  const len = (p: V3): number => Math.hypot(...p);
  return {
    why: (p) => (len(p) > R + EPS ? `${len(p)} m from the centre, past r ${R}` : null),
    region: (p) => band((len(p) / R) ** 3, 4) * 8 + (p[0] >= 0 ? 1 : 0) + (p[1] >= 0 ? 2 : 0) + (p[2] >= 0 ? 4 : 0),
    probs: even(32),
  };
}
function sphere(R: number): Shape {
  const len = (p: V3): number => Math.hypot(...p);
  // On a sphere, area is uniform in height (Archimedes), so equal bands in y hold equal areas.
  return {
    why: (p) => (Math.abs(len(p) - R) > EPS ? `${len(p)} m from the centre, not on r ${R}` : null),
    region: (p) => band((p[1] / R + 1) / 2, 4) * 8 + sector(p[0], p[2], 8),
    probs: even(32),
  };
}
function boxVolume(s: V3): Shape {
  const h = s.map((x) => x / 2) as V3;
  return {
    why: (p) => ([0, 1, 2].some((k) => Math.abs(p[k]!) > h[k]! + EPS) ? `outside the box's half extents ${fmtV(h, 3)}` : null),
    region: (p) => (band(p[0] / s[0] + 0.5, 4) * 4 + band(p[1] / s[1] + 0.5, 4)) * 2 + band(p[2] / s[2] + 0.5, 2),
    probs: even(32),
  };
}
function boxSurface(s: V3): Shape {
  const h = s.map((x) => x / 2) as V3;
  const faceArea = [s[1] * s[2], s[0] * s[2], s[0] * s[1]];
  const total = 2 * (faceArea[0]! + faceArea[1]! + faceArea[2]!);
  const face = (p: V3): number => [0, 1, 2].reduce((best, k) => (h[k]! - Math.abs(p[k]!) < h[best]! - Math.abs(p[best]!) ? k : best), 0);
  return {
    why: (p) => {
      if ([0, 1, 2].some((k) => Math.abs(p[k]!) > h[k]! + EPS)) return `outside the box's half extents ${fmtV(h, 3)}`;
      const k = face(p);
      return h[k]! - Math.abs(p[k]!) > EPS ? `${h[k]! - Math.abs(p[k]!)} m inside the box, on no face` : null;
    },
    region: (p) => {
      const k = face(p);
      const [u, v] = [0, 1, 2].filter((a) => a !== k) as [number, number];
      return (k * 2 + (p[k]! > 0 ? 0 : 1)) * 4 + (p[u]! >= 0 ? 1 : 0) + (p[v]! >= 0 ? 2 : 0);
    },
    probs: [0, 1, 2].flatMap((k) => Array.from({ length: 8 }, () => faceArea[k]! / 4 / total)),
  };
}
function cylinderVolume(r: number, hh: number): Shape {
  return {
    why: (p) => (rho(p) > r + EPS ? `${rho(p)} m from the axis, past r ${r}` : Math.abs(p[1]) > hh / 2 + EPS ? `${p[1]} m along the axis, past h/2 ${hh / 2}` : null),
    region: (p) => (band((rho(p) / r) ** 2, 2) * 4 + sector(p[0], p[2], 4)) * 4 + band(p[1] / hh + 0.5, 4),
    probs: even(32),
  };
}
function cylinderSurface(r: number, hh: number): Shape {
  const side = 2 * Math.PI * r * hh; const cap = Math.PI * r * r; const total = side + 2 * cap;
  const onSide = (p: V3): boolean => Math.abs(rho(p) - r) <= EPS && Math.abs(p[1]) <= hh / 2 + EPS;
  const onCap = (p: V3): boolean => Math.abs(Math.abs(p[1]) - hh / 2) <= EPS && rho(p) <= r + EPS;
  return {
    why: (p) => (onSide(p) || onCap(p) ? null : `${rho(p)} m from the axis at ${p[1]} m along it: on neither its side nor a cap`),
    region: (p) => (onSide(p) && Math.abs(p[1]) < hh / 2 - EPS
      ? band(p[1] / hh + 0.5, 4) * 4 + sector(p[0], p[2], 4)
      : 16 + (p[1] > 0 ? 0 : 8) + band((rho(p) / r) ** 2, 2) * 4 + sector(p[0], p[2], 4)),
    probs: [...Array.from({ length: 16 }, () => side / 16 / total), ...Array.from({ length: 16 }, () => cap / 8 / total)],
  };
}
function capsuleVolume(r: number, hh: number): Shape {
  const cyl = Math.PI * r * r * hh; const half = (2 / 3) * Math.PI * r ** 3; const total = cyl + 2 * half;
  const end = (p: V3): number => Math.hypot(p[0], Math.abs(p[1]) - hh / 2, p[2]);
  return {
    why: (p) => (Math.abs(p[1]) <= hh / 2 ? (rho(p) > r + EPS ? `${rho(p)} m from the axis in its cylinder, past r ${r}` : null) : end(p) > r + EPS ? `${end(p)} m from its end's centre, past r ${r}` : null),
    region: (p) => (Math.abs(p[1]) <= hh / 2
      ? (band((rho(p) / r) ** 2, 2) * 4 + sector(p[0], p[2], 4)) * 2 + (p[1] >= 0 ? 1 : 0)
      : 16 + (p[1] > 0 ? 0 : 8) + band((end(p) / r) ** 3, 2) * 4 + sector(p[0], p[2], 4)),
    probs: [...Array.from({ length: 16 }, () => cyl / 16 / total), ...Array.from({ length: 16 }, () => half / 8 / total)],
  };
}
function capsuleSurface(r: number, hh: number): Shape {
  const side = 2 * Math.PI * r * hh; const cap = 2 * Math.PI * r * r; const total = side + 2 * cap;
  const end = (p: V3): number => Math.hypot(p[0], Math.abs(p[1]) - hh / 2, p[2]);
  return {
    why: (p) => (Math.abs(p[1]) <= hh / 2 ? (Math.abs(rho(p) - r) > EPS ? `${rho(p)} m from the axis on its side, not r ${r}` : null) : Math.abs(end(p) - r) > EPS ? `${end(p)} m from its end's centre, not r ${r}` : null),
    // A hemisphere's area is uniform in height above its centre, as a sphere's is.
    region: (p) => (Math.abs(p[1]) <= hh / 2
      ? band(p[1] / hh + 0.5, 4) * 4 + sector(p[0], p[2], 4)
      : 16 + (p[1] > 0 ? 0 : 8) + band((Math.abs(p[1]) - hh / 2) / r, 2) * 4 + sector(p[0], p[2], 4)),
    probs: [...Array.from({ length: 16 }, () => side / 16 / total), ...Array.from({ length: 16 }, () => cap / 8 / total)],
  };
}

/** The fixture's ten shapes, as its items declare them. */
const SHAPES: Record<string, Shape> = {
  'disk-volume': disk(1),
  'ring-volume': ring(1, 0.5),
  'sphere-volume': ball(1),
  'sphere-surface': sphere(1),
  'box-volume': boxVolume([2, 1, 0.5]),
  'box-surface': boxSurface([2, 1, 0.5]),
  'cylinder-volume': cylinderVolume(0.5, 2),
  'cylinder-surface': cylinderSurface(0.5, 2),
  'capsule-volume': capsuleVolume(0.5, 1),
  'capsule-surface': capsuleSurface(0.5, 1),
};

function points(doc: JsonObject, name: string, ids: string[]): Map<string, (V3 | null)[]> {
  const call = particlesCall({ doc: writeJson(dir(), `${name}.json`, doc), t: [AT] });
  const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop' });
  const c = passed(reply!, call, name);
  return new Map(ids.map((id) => [id, reading(c, id, name).at[0]!.cpu]));
}

describe(`${ac(4)} emitted points lie inside or on each shape, pass a chi-squared bound at 99% per region, and adding a particle moves no other`, () => {
  it(`${ac(4)} on parity/vfx/emit-shapes.film: every point inside (volume) or on (surface) its shape within 1e-9 m, its counts per region under the fixed 99% chi-squared bound, and a 4,097th particle moves none of the first 4,096`, () => {
    const film = emitShapes();
    const ids = particleIds(film);
    expect(ids.sort(), 'the fixture holds the ten emitters this test knows').toEqual(Object.keys(SHAPES).sort());
    const items = obj(film['items'], 'the film\'s items');
    const base = points(film, 'emit-shapes', ids);
    const more = points(withBursts(film, N + 1), 'emit-shapes-plus-one', ids);
    const fails: string[] = [];
    for (const id of ids) {
      const shape = SHAPES[id]!;
      const pos = obj(obj(items[id], id)['at'], `${id}.at`)['pos'] as V3;
      const rows = base.get(id)!;
      const live = rows.flatMap((p, i) => (p === null ? [] : [[i, sub(p, pos)] as const]));
      if (live.length !== N) { fails.push(`${id}: ${live.length} of its ${N} particles are live at 1 s, born by its burst at 0 s`); continue; }
      const off = live.filter(([, p]) => shape.why(p) !== null);
      if (off.length) fails.push(`${id}: ${off.length} points aren't ${id.endsWith('surface') ? 'on' : 'inside'} the shape, first row ${off[0]![0]} at ${fmtV(off[0]![1], 9)} (local): ${shape.why(off[0]![1])}`);
      const counts = shape.probs.map(() => 0);
      for (const [, p] of live) counts[shape.region(p)]! += 1;
      const stat = chiSquared(counts, shape.probs);
      const bound = chi2Bound99(shape.probs.length - 1);
      if (!(stat < bound)) fails.push(`${id}: chi-squared ${fmt(stat, 3)} over ${shape.probs.length} regions is past the 99% bound ${fmt(bound, 3)} (df ${shape.probs.length - 1}); counts ${JSON.stringify(counts)}`);
      const plus = more.get(id)!;
      const moved = rows.flatMap((p, i) => (JSON.stringify(p) === JSON.stringify(plus[i] ?? null) ? [] : [i]));
      if (moved.length) fails.push(`${id}: adding a 4,097th particle moves ${moved.length} others, first row ${moved[0]} from ${fmtV(rows[moved[0]!]!, 12)} to ${fmtV(plus[moved[0]!] ?? null, 12)}`);
      if (plus.length !== N + 1 || plus[N] === null || plus[N] === undefined) fails.push(`${id}: with a burst of 4,097 its row 4,096 holds no live particle at 1 s`);
    }
    none(fails, 'the ten emit shapes');
  }, TIMEOUT);
});
