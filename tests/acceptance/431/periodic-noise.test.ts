// AC8 #431.800494a1: Seeded noise repeats on its period: noise, noise3 and fbm (6 octaves, lacunarity 2, gain 0.5) with
// period [8, 8] give values at p + (8, 0) and p + (0, 8) equal to those at p within 1e-6 at 1,000 points and match
// their CPU references within one 10-bit code value; fbm with a period and lacunarity 2.5 is refused, naming the step;
// 3D cells with jitter 0 put f1 at the distance to the nearest cell centre, by each metric, within 1e-6 at 1,000
// points; and a planted period that wraps only the first octave breaks the 6-octave fbm's equality and fails, naming
// the point.
//
// One operator frame through `check_operator` (#483: `operators`, `data`, `read`; this suite's `reference: true`, the
// step graph's f64 interpreter over the same data: README). 1,000 seeded points p in [−20, 20]², each coordinate a
// multiple of 2⁻¹⁶ so p + 8 and p × 2^k are exact in f32; the data holds p, then p + (8, 0), then p + (0, 8), 3,000
// points. Compute operators over those 3,000 elements: `nz` (noise@1), `nz3` (noise3@1, three outputs) and `fb`
// (fbm@1, octaves 6, lacunarity 2, gain 0.5), each with seed 7 and period [8, 8]. Equal within 1e-6: element k against
// k + 1,000 and k + 2,000, on the GPU. Each value against the interpreter's within one 10-bit code (1/1023 of
// max(1, |reference|)). The design gives no noise's formula, so the noise reference is the renderer's own interpreter,
// the CPU reference the design names (Compile, validate and cache); each output must spread over 0.1 or more, so
// equal values aren't constants. Cells: `ce`, `cm`, `cc` run cells@1 on 1,000 seeded 3D points (multiples of 2⁻¹⁶ in
// [−10, 10]³) with jitter 0 and metric euclidean, manhattan and chebyshev, and f1 is held to that metric's distance from
// p to floor(p) + 0.5, the nearest cell centre under every one of the three, within 1e-6. Then `check_operator` on its
// own: fbm with period [8, 8] and lacunarity 2.5 is refused, an error naming its step `n`.
// Wrong program (planted `period_first_octave`): fbm wraps only its first octave on the period, so octaves 2 to 6 at
// p × 2^k don't repeat and the fbm's equality fails, naming the point.
import { describe, expect, it } from 'vitest';
import {
  AC, checked, codes10, computeOp, dataInput, errors, frameOf, names, readStorageF32, requireGpu, run, seeded, shown, useBin, useOut, writeF32,
  type JsonObject, type Planted,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const N = 1000;
const SEED: JsonObject = { op: 'const@1', args: { value: 7, type: 'u32' } };
const u32 = (value: number): JsonObject => ({ op: 'const@1', args: { value, type: 'u32' } });

function points2(): number[] {
  const r = seeded(8431);
  const q = (): number => Math.round((r() * 40 - 20) * 65536) / 65536;
  const p: [number, number][] = Array.from({ length: N }, () => [q(), q()]);
  return [...p.flat(), ...p.flatMap(([x, y]) => [x + 8, y]), ...p.flatMap(([x, y]) => [x, y + 8])];
}
function points3(): number[] {
  const r = seeded(3431);
  return Array.from({ length: N * 3 }, () => Math.round((r() * 20 - 10) * 65536) / 65536);
}

/** Steps reading element e's 2D point from `pts`. */
const read2: JsonObject = {
  e: { op: 'element@1', args: {} }, two: u32(2), one: u32(1),
  i0: { op: 'mul@1', args: { a: 'e', b: 'two' } }, i1: { op: 'add@1', args: { a: 'i0', b: 'one' } },
  px: { op: 'read@1', args: { buf: 'pts', i: 'i0' } }, py: { op: 'read@1', args: { buf: 'pts', i: 'i1' } },
  p: { op: 'compose@1', args: { x: 'px', y: 'py' } }, seed: SEED,
};
function noiseOps(lacunarity = 2): JsonObject[] {
  const pts = { pts: dataInput('pts2', 6 * N) };
  return [
    computeOp('nz', pts, { ...read2, n: { op: 'noise@1', args: { p: 'p', seed: 'seed', period: [8, 8] } }, w: { op: 'write@1', args: { buf: 'out', i: 'e', v: 'n' } } }, ['out'], 3 * N),
    computeOp('nz3', pts, {
      ...read2, n: { op: 'noise3@1', args: { p: 'p', seed: 'seed', period: [8, 8] } },
      nx: { op: 'split@1', args: { x: 'n', pick: 'x' } }, ny: { op: 'split@1', args: { x: 'n', pick: 'y' } }, nz: { op: 'split@1', args: { x: 'n', pick: 'z' } },
      wx: { op: 'write@1', args: { buf: 'x', i: 'e', v: 'nx' } }, wy: { op: 'write@1', args: { buf: 'y', i: 'e', v: 'ny' } }, wz: { op: 'write@1', args: { buf: 'z', i: 'e', v: 'nz' } },
    }, ['x', 'y', 'z'], 3 * N),
    computeOp('fb', pts, {
      ...read2, n: { op: 'fbm@1', args: { p: 'p', seed: 'seed', octaves: 6, lacunarity, gain: 0.5, period: [8, 8] } },
      w: { op: 'write@1', args: { buf: 'out', i: 'e', v: 'n' } },
    }, ['out'], 3 * N),
  ];
}
const METRICS = [['ce', 'euclidean'], ['cm', 'manhattan'], ['cc', 'chebyshev']] as const;
function cellOps(): JsonObject[] {
  return METRICS.map(([id, metric]) => computeOp(id, { pts: dataInput('pts3', 3 * N) }, {
    e: { op: 'element@1', args: {} }, three: u32(3), one: u32(1), two: u32(2),
    i0: { op: 'mul@1', args: { a: 'e', b: 'three' } }, i1: { op: 'add@1', args: { a: 'i0', b: 'one' } }, i2: { op: 'add@1', args: { a: 'i0', b: 'two' } },
    px: { op: 'read@1', args: { buf: 'pts', i: 'i0' } }, py: { op: 'read@1', args: { buf: 'pts', i: 'i1' } }, pz: { op: 'read@1', args: { buf: 'pts', i: 'i2' } },
    p: { op: 'compose@1', args: { x: 'px', y: 'py', z: 'pz' } }, seed: SEED,
    c: { op: 'cells@1', args: { p: 'p', seed: 'seed', jitter: 0, metric } },
    w: { op: 'write@1', args: { buf: 'out', i: 'e', v: 'c.f1' } },
  }, ['out'], N));
}
const OUTPUTS = ['nz.out', 'nz3.x', 'nz3.y', 'nz3.z', 'fb.out'] as const;

function noiseProblems(planted?: Planted): string[] {
  const dir = out();
  const p2 = points2(); const p3 = points3();
  const replies = run(bin(), dir, [
    {
      call: 'check_operator', operators: [...noiseOps(), ...cellOps()], data: { pts2: writeF32(dir, 'pts2.f32', p2), pts3: writeF32(dir, 'pts3.f32', p3) },
      read: [...OUTPUTS, ...METRICS.map(([id]) => `${id}.out`)], reference: true,
    },
    { call: 'check_operator', operator: noiseOps(2.5)[2]! },
  ], planted);
  const { check, dispatches } = frameOf(replies[0]!, 'the noise frame');
  expect(check.outcome, `the noise frame checks and runs: ${shown(check.issues)}`).toBe('accepted');
  const d = dispatches[0]!;
  const problems: string[] = [];
  for (const name of OUTPUTS) {
    const g = readStorageF32(dir, d.read[name], name);
    const c = readStorageF32(dir, d.reference[name], `${name}'s reference`);
    let lo = Infinity; let hi = -Infinity; let refOff = 0; let firstRef = '';
    for (let k = 0; k < N; k++) {
      lo = Math.min(lo, g[k]!); hi = Math.max(hi, g[k]!);
      for (const [o, what] of [[N, '(8, 0)'], [2 * N, '(0, 8)']] as const) {
        if (!(Math.abs(g[k + o]! - g[k]!) <= 1e-6)) problems.push(`${name} at p = (${p2[2 * k]}, ${p2[2 * k + 1]}): ${g[k]} at p, ${g[k + o]} at p + ${what}`);
      }
    }
    for (let k = 0; k < 3 * N; k++) if (codes10(g[k]!, c[k]!) > 1) { if (refOff++ === 0) firstRef = `${g[k]} against ${c[k]} at element ${k}`; }
    if (refOff) problems.push(`${name}: ${refOff} of ${3 * N} values past one 10-bit code of the CPU reference (first: ${firstRef})`);
    if (hi - lo < 0.1) problems.push(`${name} spreads only from ${lo} to ${hi}: equal values here prove nothing`);
  }
  METRICS.forEach(([id, metric], m) => {
    const g = readStorageF32(dir, d.read[`${id}.out`], `${id}.out`);
    for (let k = 0; k < N; k++) {
      const v = [0, 1, 2].map((a) => Math.abs(p3[3 * k + a]! - (Math.floor(p3[3 * k + a]!) + 0.5)));
      const want = m === 0 ? Math.hypot(v[0]!, v[1]!, v[2]!) : m === 1 ? v[0]! + v[1]! + v[2]! : Math.max(v[0]!, v[1]!, v[2]!);
      if (!(Math.abs(g[k]! - want) <= 1e-6)) problems.push(`cells (${metric}) f1 at p = (${p3.slice(3 * k, 3 * k + 3).join(', ')}): ${g[k]}, not the distance to the nearest centre ${want}`);
    }
  });
  const lac = checked(replies[1]!, 'fbm with a period and lacunarity 2.5');
  if (lac.outcome !== 'refused') problems.push(`fbm with a period and lacunarity 2.5 was ${lac.outcome}`);
  else if (!errors(lac).some((e) => names(e, 'n'))) problems.push(`fbm with lacunarity 2.5 was refused, but no error names step n: ${shown(lac.issues)}`);
  console.log(`${AC[8]}${planted ? ` (${planted})` : ''}: ${problems.length} problems${problems.length ? `; first: ${problems[0]}` : ''}`);
  return problems;
}

describe(`${AC[8]} seeded noise repeats on its period`, () => {
  it(`${AC[8]} noise, noise3 and fbm repeat on period [8, 8] within 1e-6 and match their CPU references; fbm's lacunarity 2.5 is refused; 3D cells' f1 is the distance to the nearest centre by each metric`, () => {
    requireGpu();
    expect(noiseProblems().slice(0, 20)).toEqual([]);
  }, 1_800_000);
  it(`${AC[8]} a planted period that wraps only the first octave (--planted period_first_octave) breaks the 6-octave fbm's equality and fails, naming the point`, () => {
    requireGpu();
    const problems = noiseProblems('period_first_octave');
    expect(problems.filter((p) => /^fb\.out at p = \(-?[\d.]+, -?[\d.]+\)/.test(p)).length, `the check names a point where fbm doesn't repeat: ${problems.slice(0, 3).join('; ')}`).toBeGreaterThan(0);
  }, 1_800_000);
});
