// AC4 #446.9f0a17a9: An IES distribution keeps the lamp's flux: its power integrated over the sphere stays within 1% of
// its lumens.
//
// The oracle's test, pbrt-v4's goniometric light in `lights_test.cpp`, is C++ over pbrt's own light class and can't be
// fed our output; this takes its property (a table over the sphere integrates to the power), on our renderer's pixels.
//
// The measure. A point lamp at the centre of a 4 m matte cube (ρ 0.5) under a black sky, drawn by six 90° cameras at
// the lamp, 128 px square, so their pixels cover the sphere (±Y's target is off axis by 1e-4, so the up vector holds).
// A pixel's linear value L is ρ E ÷ π, so the wall's illuminance is E = π L ÷ ρ, and the intensity toward the pixel is
// I = E r² ÷ cos θ, r and θ from where its ray meets the cube. Flux is Σ I dΩ, dΩ the pixel's solid angle, cos³α (2 ÷ 128)²
// at α off axis. A quadrature of the file's own table over the same directions agrees with its closed form within
// 0.1% (checked on the CPU; README: BASE-FAILURE), so the 1% is the renderer's.
//
// The file. A generated LM-63-2002 file (CC0, this suite's own), type C, stating 1,200 lm, whose candelas integrate to
// 960 lm (a luminaire's 80%): I(γ, φ) = 0.15 + max(cos γ, 0)² (1 + 0.5 cos 2φ), γ from the lamp's axis (its local −Z).
//
// The cases: no distribution, power 800 (the measure's own control: 800 within 1%, and it fails the shape check, the
// wrong program that ignores the file); the file at `power: 2400` (2,400 within 1%); at `power: from_file` (1,200 within
// 1%, what the file states, not the 960 its candelas sum to); at `distribution_rotation: 90` (2,400 within 1%, and φ
// turned). Shape: I ÷ Φ against the file's linearly interpolated table ÷ its quadrature, within 4% on 99% of directions.
// `--planted ies_peak_normalized`, a table scaled to its peak instead of to its integral, fails naming "flux".
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, box, camera, failsNaming, frameAt, framesOf, matte, none, point, rad, rayAt, readLinear, requireMetal, runGpu, sessionDoc, sha256, useDir, useGpu, view3dCall, writeJson,
  type GpuPlanted, type JsonObject, type JsonValue, type Pinhole, type V3,
} from './helpers.ts';

const ID = AC[4];
const bin = useGpu();
const dir = useDir();
const N = 128;
const SIZE: [number, number] = [N, N];
const A = 2;
const RHO = 0.5;
const STATED = 1200;
const VERTICAL = Array.from({ length: 37 }, (_, i) => i * 5);
const HORIZONTAL = Array.from({ length: 33 }, (_, i) => i * 11.25);
const shape = (gamma: number, phi: number): number => { const c = Math.max(Math.cos(rad(gamma)), 0); return 0.15 + c * c * (1 + 0.5 * Math.cos(rad(2 * phi))); };
/** The table's linear interpolation, as LM-63 reads between its angles. */
function table(gamma: number, phi: number): number {
  const p = ((phi % 360) + 360) % 360;
  const i = Math.min(Math.floor(gamma / 5), 35); const j = Math.min(Math.floor(p / 11.25), 31);
  const u = gamma / 5 - i; const v = p / 11.25 - j;
  const at = (a: number, b: number): number => shape(VERTICAL[a]!, HORIZONTAL[b]!);
  return (1 - v) * ((1 - u) * at(i, j) + u * at(i + 1, j)) + v * ((1 - u) * at(i, j + 1) + u * at(i + 1, j + 1));
}
/** The six cameras at the lamp. */
const CAMERAS: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 1e-4], [0, -1, 1e-4], [0, 0, 1], [0, 0, -1]];
const pinhole = (target: V3): Pinhole => ({ position: [0, 0, 0], target, fov: 90, size: SIZE });
/** A pixel's direction, its solid angle and where its ray meets the cube: r and cos θ. */
function directions(cam: Pinhole): { x: number; y: number; d: V3; dw: number; r: number; cos: number }[] {
  const out: { x: number; y: number; d: V3; dw: number; r: number; cos: number }[] = [];
  const axis = rayAt(cam, N / 2, N / 2);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = rayAt(cam, x + 0.5, y + 0.5);
    const c = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
    const big = Math.max(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
    out.push({ x, y, d, dw: c * c * c * (2 / N) * (2 / N), r: A / big, cos: big });
  }
  return out;
}
/** The file's angles for a direction: γ from the lamp's axis, −Z; φ from local +X toward +Y. */
const angles = (d: V3): [number, number] => [(Math.acos(Math.min(Math.max(-d[2], -1), 1)) * 180) / Math.PI, (Math.atan2(d[1], d[0]) * 180) / Math.PI];

function iesFile(): string {
  let sum = 0;
  for (const c of CAMERAS) for (const p of directions(pinhole(c))) { const [g, f] = angles(p.d); sum += table(g, f) * p.dw; }
  const k = (0.8 * STATED) / sum;
  const line = (v: number[]): string => v.map((x) => x.toFixed(4)).join(' ');
  const rows = HORIZONTAL.map((h) => line(VERTICAL.map((v) => k * shape(v, h))));
  return ['IESNA:LM-63-2002', '[TEST] #446 acceptance', '[MANUFAC] DeepBuild', 'TILT=NONE',
    `1 ${STATED} 1 ${VERTICAL.length} ${HORIZONTAL.length} 1 2 0 0 0`, '1 1 30', line(VERTICAL), line(HORIZONTAL), ...rows, ''].join('\n');
}
function roomDoc(cam: V3, lamp: JsonObject): JsonObject {
  const wall = { material: 'wall' }; const t = 0.1; const o = A + t / 2; const s = 2 * A + 2 * t;
  return sessionDoc(`ies-${cam.join('_')}`, SIZE, {
    cam: camera([0, 0, 0], cam, 90, { near: 0.05, far: 20 }), sky: DARK_SKY, wall: matte(RHO),
    px: box([t, s, s], [o, 0, 0], wall), nx: box([t, s, s], [-o, 0, 0], wall),
    py: box([s, t, s], [0, o, 0], wall), ny: box([s, t, s], [0, -o, 0], wall),
    pz: box([s, s, t], [0, 0, o], wall), nz: box([s, s, t], [0, 0, -o], wall),
    lamp: point(800, [0, 0, 0], { radius: 0.001, range: 1000, ...lamp }),
  });
}
interface Measured { flux: number; miss: (turn: number) => number }
/** The measured flux, and the share of directions off the file's shape by more than 4% when its table is turned by `turn`°. */
function measure(lamp: JsonObject, assets: JsonObject, planted?: GpuPlanted): Measured {
  const out = dir();
  const calls = CAMERAS.map((c, i) => view3dCall({ doc: writeJson(out, `cam${i}`, roomDoc(c, lamp)), size: SIZE, targets: ['linear'], ...(assets as object) }));
  const replies = runGpu(bin(), out, calls, planted);
  const rows: { I: number; d: V3; dw: number }[] = [];
  CAMERAS.forEach((c, i) => {
    const l = readLinear(out, frameAt(framesOf(replies[i]!, `camera ${i}`), 0, `camera ${i}`), SIZE, `camera ${i}`);
    for (const p of directions(pinhole(c))) rows.push({ I: (((Math.PI * l.at(p.x, p.y)) / RHO) * p.r * p.r) / p.cos, d: p.d, dw: p.dw });
  });
  const flux = rows.reduce((s, r) => s + r.I * r.dw, 0);
  const miss = (turn: number): number => {
    const want = rows.map((r) => { const [g, f] = angles(r.d); return table(g, f - turn); });
    const sum = want.reduce((s, w, i) => s + w * rows[i]!.dw, 0);
    return rows.filter((r, i) => Math.abs((r.I / flux) * (sum / want[i]!) - 1) > 0.04).length / rows.length;
  };
  return { flux, miss };
}
const within1 = (name: string, m: Measured, lumens: number): string[] =>
  Math.abs(m.flux / lumens - 1) <= 0.01 ? [] : [`${name}: the flux over the sphere is ${m.flux.toFixed(1)} lm, not ${lumens} lm within 1%`];
const shaped = (name: string, m: Measured, turn: number): string[] =>
  m.miss(turn) <= 0.01 ? [] : [`${name}: the shape misses the file on ${(m.miss(turn) * 100).toFixed(1)}% of directions`];

describe(`${ID} an IES distribution shapes the light and keeps its flux`, () => {
  it(`${ID} the flux integrated over the sphere is the lamp's lumens within 1%, from a number, from the file and turned, and the light takes the file's shape; a lamp that ignores the file and the planted ies_peak_normalized fail`, () => {
    requireMetal();
    const folder = dir();
    const bytes = iesFile();
    const sha = sha256(bytes);
    const path = join(folder, `${sha}.ies`);
    writeFileSync(path, bytes);
    const license: JsonValue = { id: 'CC0-1.0', terms: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode', shareable: true, credit: 'DeepBuild acceptance tests' };
    const assets: JsonObject = { assets: { [sha]: path }, licenses: { [sha]: license } };
    const bare = measure({ power: 800 }, {});
    expect(Math.abs(bare.flux / 800 - 1), `the measure's control: a bare lamp reads ${bare.flux.toFixed(1)} lm of 800`).toBeLessThanOrEqual(0.01);
    const number = measure({ power: 2400, distribution: sha }, assets);
    const file = measure({ power: 'from_file', distribution: sha }, assets);
    const turned = measure({ power: 2400, distribution: sha, distribution_rotation: 90 }, assets);
    // The design doesn't name φ = 0's axis: local +X or +Y, read off the unturned lamp (README: Readings); then the
    // turned one must sit 90° from it.
    const zero = number.miss(0) <= number.miss(90) ? 0 : 90;
    none([
      ...within1('power 2400', number, 2400), ...shaped('power 2400', number, zero),
      ...within1('power from_file', file, STATED), ...shaped('power from_file', file, zero),
      ...within1('rotation 90', turned, 2400), ...shaped('rotation 90', turned, zero + 90),
    ], 'the distributions');
    failsNaming(shaped('a lamp that ignores the file', bare, zero), ['shape'], 'a lamp that ignores the file');
    failsNaming(within1('the planted table', measure({ power: 2400, distribution: sha }, assets, 'ies_peak_normalized'), 2400), ['flux'], 'the planted ies_peak_normalized');
  }, 1_800_000);
});
