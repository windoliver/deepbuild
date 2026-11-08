// AC1 #431.304e73e1: spline matches a Fritsch and Carlson reference within 1e-6 at 1,000 inputs and never overshoots
// its points, a spline with 17 points or an image for its table is refused, and homography maps the unit square's
// corners onto its quad within 1e-5.
//
// One operator frame through `check_operator` (#483: `operators`, `data`, `read`), so the GPU's f32 results come back
// as storage words: `spl` evaluates `spline@1` through 16 points at 1,000 inputs (10 evenly spaced over each of its
// 15 pieces, ends included, as SciPy's tests sample a piece, then 850 seeded ones); `nag` evaluates it through NAG
// E01BEC's 9 points at NAG's 11 abscissae; `hom0` … `hom4` map the unit square's corners (0,0), (1,0), (1,1), (0,1)
// through `homography@1` of five quads and divide by w. Then `check_operator` on its own: a spline of 17 points and a
// spline whose points come from an image are refused, each with an error naming the step; the same pass with 16
// literal points checks, so the refusals are the rule's.
//
// The reference is Fritsch–Carlson's monotone cubic in the form the Oracle page names, SciPy's PCHIP (Fritsch and
// Butland's weighted harmonic mean of the secants at interior points, the three-point end slopes held to the
// shape-preserving bounds, a Hermite cubic on each piece), evaluated in f64 at each input as the GPU holds it (f32).
// It is held to be an oracle by NAG's printed values (SciPy's test_nag) before anything is judged against it.
//
// Oracle ports (README: The oracle page): SciPy e4e854eaa8, scipy/interpolate/tests/test_polyint.py:543-670 —
// test_overshoot (each piece's 10 values within its end values; 1e-6 for f32 in place of 1e-15), test_monotone (every
// value after a piece's first lies strictly on the side of its second end) and test_nag (NAG's 11 values within 5e-5),
// all against our GPU output. OpenCV 40738fb16c, modules/imgproc/test/test_imgwarp.cpp:1082-1112 (issue_26916): its
// trapezoid, scaled by 1/1280 into the unit range, is quad hom1; every corner is held to 1e-5 (theirs is 1e-10 in f64).
//
// Wrong programs: a spline with other slopes (a Catmull-Rom or natural cubic overshoots, and misses the reference by
// far more than 1e-6), a sampled or image table (refused here), no point limit, a homography in another corner order
// or without the divide.
//
// SciPy's notice, for the ported tests: Copyright (c) 2001-2002 Enthought, Inc. 2003, SciPy Developers. All rights
// reserved. Redistribution and use in source and binary forms, with or without modification, are permitted provided
// that the following conditions are met: 1. Redistributions of source code must retain the above copyright notice,
// this list of conditions and the following disclaimer. 2. Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials
// provided with the distribution. 3. Neither the name of the copyright holder nor the names of its contributors may be
// used to endorse or promote products derived from this software without specific prior written permission. THIS
// SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
// INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
// SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
// WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
// OpenCV's notice, for the ported quad (Intel License Agreement, For Open Source Computer Vision Library): Copyright
// (C) 2000, Intel Corporation, all rights reserved. Third party copyrights are property of their respective owners.
// Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
// following conditions are met: Redistribution's of source code must retain the above copyright notice, this list of
// conditions and the following disclaimer. Redistribution's in binary form must reproduce the above copyright notice,
// this list of conditions and the following disclaimer in the documentation and/or other materials provided with the
// distribution. The name of Intel Corporation may not be used to endorse or promote products derived from this
// software without specific prior written permission. This software is provided by the copyright holders and
// contributors "as is" and any express or implied warranties, including, but not limited to, the implied warranties of
// merchantability and fitness for a particular purpose are disclaimed. In no event shall the Intel Corporation or
// contributors be liable for any direct, indirect, incidental, special, exemplary, or consequential damages
// (including, but not limited to, procurement of substitute goods or services; loss of use, data, or profits; or
// business interruption) however caused and on any theory of liability, whether in contract, strict liability, or
// tort (including negligence or otherwise) arising in any way out of the use of this software, even if advised of the
// possibility of such damage.
import { describe, expect, it } from 'vitest';
import {
  AC, checked, computeOp, coreTarget, dataInput, errors, frameOf, names, passOp, readStorageF32, requireGpu, run, seeded, shown, useBin, useOut,
  writeF32, type JsonObject,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const f32 = Math.fround;

type Pt = [number, number];
/** 16 points, x in 64ths and y in 256ths so both are exact in f32; rises, falls and near-flat pieces. */
const KNOTS: Pt[] = [0, 4, 9, 13, 18, 24, 29, 33, 38, 44, 49, 53, 57, 60, 62, 64]
  .map((x, k): Pt => [x / 64, [26, 128, 115, 230, 51, 64, 77, 205, 13, 154, 159, 102, 243, 179, 182, 38][k]! / 256]);
/** NAG E01BEC's example, as SciPy's test_nag gives it. */
const NAG: Pt[] = [[7.99, 0], [8.09, 0.27643e-4], [8.19, 0.4375e-1], [8.7, 0.16918], [9.2, 0.46943], [10, 0.94374], [12, 0.99864], [15, 0.99992], [20, 0.99999]];
const NAG_AT = [7.99, 9.191, 10.392, 11.593, 12.794, 13.995, 15.196, 16.397, 17.598, 18.799, 20];
const NAG_IS = [0, 0.464, 0.9645, 0.9965, 0.9992, 0.9998, 0.9999, 1, 1, 1, 1];

/** SciPy's PCHIP end slope (_edge_case): the three-point estimate, held to the shape-preserving bounds. */
function edge(h0: number, h1: number, m0: number, m1: number): number {
  const d = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1);
  if (Math.sign(d) !== Math.sign(m0)) return 0;
  if (Math.sign(m0) !== Math.sign(m1) && Math.abs(d) > 3 * Math.abs(m0)) return 3 * m0;
  return d;
}
/** The Fritsch–Carlson monotone cubic through `pts`, as SciPy's PCHIP builds it, in f64. */
function pchip(pts: Pt[]): (x: number) => number {
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]); const n = pts.length;
  const h = xs.slice(1).map((x, k) => x - xs[k]!); const m = ys.slice(1).map((y, k) => (y - ys[k]!) / h[k]!);
  const d = new Array<number>(n).fill(0);
  if (n === 2) { d[0] = m[0]!; d[1] = m[0]!; } else {
    for (let k = 1; k < n - 1; k++) {
      const m0 = m[k - 1]!; const m1 = m[k]!;
      if (Math.sign(m0) !== Math.sign(m1) || m0 === 0 || m1 === 0) continue;
      const w1 = 2 * h[k]! + h[k - 1]!; const w2 = h[k]! + 2 * h[k - 1]!;
      d[k] = (w1 + w2) / (w1 / m0 + w2 / m1);
    }
    d[0] = edge(h[0]!, h[1]!, m[0]!, m[1]!);
    d[n - 1] = edge(h[n - 2]!, h[n - 3]!, m[n - 2]!, m[n - 3]!);
  }
  return (x) => {
    let k = 0;
    while (k < n - 2 && x >= xs[k + 1]!) k++;
    const hk = h[k]!; const t = (x - xs[k]!) / hk; const t2 = t * t; const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k]! + (t3 - 2 * t2 + t) * hk * d[k]! + (-2 * t3 + 3 * t2) * ys[k + 1]! + (t3 - t2) * hk * d[k + 1]!;
  };
}

/** 1,000 inputs: 10 evenly spaced over each of the 15 pieces (ends included), then 850 seeded, each as f32. */
function inputs(): number[] {
  const xs: number[] = [];
  for (let k = 0; k < KNOTS.length - 1; k++) for (let j = 0; j < 10; j++) xs.push(f32(KNOTS[k]![0] + ((KNOTS[k + 1]![0] - KNOTS[k]![0]) * j) / 9));
  const r = seeded(431);
  while (xs.length < 1000) xs.push(f32(r()));
  return xs;
}

/** Five quads: the unit square, OpenCV's issue_26916 trapezoid scaled into the unit range, three seeded convex ones. */
function quads(): Pt[][] {
  const r = seeded(4310);
  const jitter = (): number => Math.round((r() - 0.5) * 0.6 * 1024) / 1024;
  const seededQuad = (): Pt[] => [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]): Pt => [x! + jitter(), y! + jitter()]);
  return [[[0, 0], [1, 0], [1, 1], [0, 1]], [[320 / 1280, 512 / 1280], [960 / 1280, 512 / 1280], [1280 / 1280, 1024 / 1280], [0, 1024 / 1280]], seededQuad(), seededQuad(), seededQuad()];
}
const CORNERS: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

const u32 = (value: number): JsonObject => ({ op: 'const@1', args: { value, type: 'u32' } });
const splineOp = (id: string, points: Pt[], data: string, count: number): JsonObject => computeOp(id, { xs: dataInput(data, count) }, {
  e: { op: 'element@1', args: {} },
  x: { op: 'read@1', args: { buf: 'xs', i: 'e' } },
  s: { op: 'spline@1', args: { points, x: 'x' } },
  w: { op: 'write@1', args: { buf: 'out', i: 'e', v: 's' } },
}, ['out'], count);
const homographyOp = (id: string, quad: Pt[]): JsonObject => computeOp(id, { corners: dataInput('corners', 8) }, {
  e: { op: 'element@1', args: {} }, two: u32(2), one: u32(1),
  i0: { op: 'mul@1', args: { a: 'e', b: 'two' } }, i1: { op: 'add@1', args: { a: 'i0', b: 'one' } },
  u: { op: 'read@1', args: { buf: 'corners', i: 'i0' } }, v: { op: 'read@1', args: { buf: 'corners', i: 'i1' } },
  p: { op: 'compose@1', args: { x: 'u', y: 'v', z: 1 } },
  m: { op: 'homography@1', args: { quad } },
  h: { op: 'mul@1', args: { a: 'm', b: 'p' } },
  hx: { op: 'split@1', args: { x: 'h', pick: 'x' } }, hy: { op: 'split@1', args: { x: 'h', pick: 'y' } }, hz: { op: 'split@1', args: { x: 'h', pick: 'z' } },
  qx: { op: 'div@1', args: { a: 'hx', b: 'hz' } }, qy: { op: 'div@1', args: { a: 'hy', b: 'hz' } },
  wx: { op: 'write@1', args: { buf: 'x', i: 'e', v: 'qx' } }, wy: { op: 'write@1', args: { buf: 'y', i: 'e', v: 'qy' } },
}, ['x', 'y'], 4);
/** A pass whose spline reads the frame's red through `points`: literal points, or an image (the texture input). */
const splinePass = (points: Pt[] | 'src'): JsonObject => passOp('curve', { src: coreTarget('color') }, {
  uv: { op: 'screen_uv@1', args: {} },
  c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } },
  x: { op: 'split@1', args: { x: 'c', pick: 'x' } },
  s: { op: 'spline@1', args: { points, x: 'x' } },
  out: { op: 'compose@1', args: { x: 's', y: 's', z: 's', w: 1 } },
}, 'out');

describe(`${AC[1]} spline and homography`, () => {
  it(`${AC[1]} spline matches Fritsch–Carlson within 1e-6 at 1,000 inputs and never overshoots; 17 points or an image table is refused; homography maps the unit square's corners onto its quad within 1e-5`, () => {
    requireGpu();
    const dir = out();
    const problems: string[] = [];

    // The reference is an oracle only once it reproduces NAG's printed values (SciPy's test_nag, atol 5e-5).
    const nagRef = pchip(NAG);
    NAG_AT.forEach((x, i) => { if (Math.abs(nagRef(x) - NAG_IS[i]!) > 5e-5) problems.push(`the reference misses NAG at x = ${x}: ${nagRef(x)} against ${NAG_IS[i]}`); });
    expect(problems, 'the f64 reference reproduces NAG E01BEC').toEqual([]);

    const xs = inputs();
    const qs = quads();
    const frame: JsonObject = {
      call: 'check_operator',
      operators: [splineOp('spl', KNOTS, 'xs', xs.length), splineOp('nag', NAG, 'nagx', NAG_AT.length), ...qs.map((q, k) => homographyOp(`hom${k}`, q))],
      data: { xs: writeF32(dir, 'xs.f32', xs), nagx: writeF32(dir, 'nagx.f32', NAG_AT), corners: writeF32(dir, 'corners.f32', CORNERS.flat()) },
      read: ['spl.out', 'nag.out', ...qs.flatMap((_, k) => [`hom${k}.x`, `hom${k}.y`])],
    };
    const seventeen = splineOp('spl17', [...KNOTS.map((p): Pt => [p[0] * 0.9375, p[1]]), [1, 0.5]], 'xs', xs.length);
    const [frameReply, r17, rImage, rControl] = run(bin(), dir, [
      frame, { call: 'check_operator', operator: seventeen }, { call: 'check_operator', operator: splinePass('src') }, { call: 'check_operator', operator: splinePass(KNOTS) },
    ]);

    const { check, dispatches } = frameOf(frameReply!, 'the spline and homography frame');
    expect(check.outcome, `the frame checks and runs: ${shown(check.issues)}`).toBe('accepted');
    const read = dispatches[0]!.read;

    // spline against the reference at 1,000 inputs, within 1e-6.
    const ref = pchip(KNOTS);
    const got = readStorageF32(dir, read['spl.out'], 'spl.out');
    let worst = 0;
    xs.forEach((x, i) => {
      const e = Math.abs(got[i]! - ref(x));
      worst = Math.max(worst, e);
      if (e > 1e-6) problems.push(`spline at x = ${x}: ${got[i]} against the reference ${ref(x)} (off ${e.toExponential(2)})`);
    });
    console.log(`${AC[1]}: spline worst |GPU − reference| over ${xs.length} inputs: ${worst.toExponential(3)}`);
    // Never overshoots (SciPy's test_overshoot) at any input; monotone on each piece (test_monotone) on its 10 samples.
    xs.forEach((x, i) => {
      let k = 0;
      while (k < KNOTS.length - 2 && x >= KNOTS[k + 1]![0]) k++;
      const lo = Math.min(KNOTS[k]![1], KNOTS[k + 1]![1]); const hi = Math.max(KNOTS[k]![1], KNOTS[k + 1]![1]);
      if (got[i]! < lo - 1e-6 || got[i]! > hi + 1e-6) problems.push(`spline overshoots piece ${k} at x = ${x}: ${got[i]} outside [${lo}, ${hi}]`);
    });
    for (let k = 0; k < KNOTS.length - 1; k++) {
      const y1 = KNOTS[k]![1]; const y2 = KNOTS[k + 1]![1];
      for (let j = 1; j < 10; j++) if (!((y2 - y1) * (got[k * 10 + j]! - got[k * 10]!) > 0)) problems.push(`spline piece ${k} isn't monotone: sample ${j} is ${got[k * 10 + j]}, its first ${got[k * 10]}`);
    }
    // NAG's values on the GPU (SciPy's test_nag against our output).
    const nag = readStorageF32(dir, read['nag.out'], 'nag.out');
    NAG_AT.forEach((x, i) => { if (Math.abs(nag[i]! - NAG_IS[i]!) > 5e-5) problems.push(`spline through NAG's points at x = ${x}: ${nag[i]} against NAG's ${NAG_IS[i]}`); });

    // homography: each corner of the unit square lands on its quad's corner within 1e-5.
    qs.forEach((q, k) => {
      const gx = readStorageF32(dir, read[`hom${k}.x`], `hom${k}.x`); const gy = readStorageF32(dir, read[`hom${k}.y`], `hom${k}.y`);
      CORNERS.forEach((c, i) => {
        const want: Pt = [f32(q[i]![0]), f32(q[i]![1])];
        if (!(Math.abs(gx[i]! - want[0]) <= 1e-5 && Math.abs(gy[i]! - want[1]) <= 1e-5)) problems.push(`homography of quad ${k} maps corner (${c.join(', ')}) to (${gx[i]}, ${gy[i]}), not (${want.join(', ')})`);
      });
    });

    // The refusals, each naming the spline's step, against a control that checks.
    const control = checked(rControl!, 'the pass with 16 literal points');
    if (control.outcome !== 'accepted') problems.push(`the control (16 literal points) was ${control.outcome}: ${shown(control.issues)}`);
    for (const [what, reply] of [['a spline with 17 points', r17!], ['a spline whose points are an image', rImage!]] as const) {
      const c = checked(reply, what);
      if (c.outcome !== 'refused') problems.push(`${what} was ${c.outcome}`);
      else if (!errors(c).some((e) => names(e, 's'))) problems.push(`${what} was refused, but no error names step s: ${shown(c.issues)}`);
    }
    expect(problems, 'spline and homography').toEqual([]);
  }, 1_800_000);
});
