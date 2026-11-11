// The least-pairwise-distance rule of SciPy's TestPoisson, test_mindist and test_fill_space, in
// scipy/stats/tests/test_qmc.py (lines 938 to 968) at commit e4e854eaa8f18d807cd3496028e257e36caa93cc of
// https://github.com/scipy/scipy, re-expressed on our distribute's output (#136: a linked test counts only when run
// against our output). No SciPy code runs here and none is copied; the rule, the radii's range, the sample cap, the
// bounds and the rtol are upstream's. SciPy's license notice, kept with what is ported from it:
//
//   Copyright (c) 2001-2002 Enthought, Inc. 2003, The SciPy Developers.
//   All rights reserved.
//
//   Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
//   following conditions are met:
//
//   1. Redistributions of source code must retain the above copyright notice, this list of conditions and the
//      following disclaimer.
//   2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the
//      following disclaimer in the documentation and/or other materials provided with the distribution.
//   3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote
//      products derived from this software without specific prior written permission.
//
//   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
//   INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
//   DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
//   SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
//   SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
//   WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
//   USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
// Upstream, and ours:
//   - test_mindist draws 50 samples from a Poisson-disk engine over the unit hypercube for each of five radii between
//     0.08 and 0.2, and requires at most 50 samples, with the least pairwise distance at least the radius. Ours: a
//     poisson scatter over a flat 1 × 1 m plate with `min_distance` the radius and `max: 50`, for five radii across
//     the same range; at most 50 points, the least pairwise distance at least the radius.
//   - test_fill_space fills the plane with radius 0.2 inside no bounds (the unit square), [−5, 5]² and [1.1, 5.1]²,
//     and requires the least pairwise distance at least radius × (1 − 1e-6). Ours: a poisson scatter with
//     `min_distance: 0.2` over flat plates on those three squares (x and z in place of upstream's two axes), with the
//     same rule and rtol.
// Both of ours also need two points at least, since the least pairwise distance of fewer isn't a number.
import { describe, expect, it } from 'vitest';
import {
  AC, RTOL, STONES, TIMEOUT, docId, elementsOf, geometry, judgesFailTheirPlants, leastDistance, poissonDoc, presented, run, scenarioOf, show, useFolders,
  useShow, type JsonObject, type V3,
} from './helpers.ts';

const ID = AC[3];
const bin = useShow();
const folder = useFolders();

/** Each document's points of `stones`, all from one process. */
function scatters(documents: readonly JsonObject[], what: (k: number) => string): V3[][] {
  const ids = documents.map((_, k) => docId(100 + k));
  const replies = run(bin(), scenarioOf(folder(), ids, documents.flatMap((d, k) => [show(ids[k]!, d), geometry(ids[k]!, [STONES])])));
  return documents.map((_, k) => {
    presented(replies[2 * k]!, `${what(k)} (an instancer fed by from: distribute)`);
    return elementsOf(replies[2 * k + 1]!, STONES, 1, what(k)).map((e) => e.pos);
  });
}

describe(`${ID} SciPy's TestPoisson least-pairwise-distance rule, on our distribute's output`, () => {
  it(`${ID} test_mindist: at most 50 points over the unit plate for five radii from 0.08 to 0.2, the least pairwise distance at least the radius`, () => {
    judgesFailTheirPlants();
    const NS = 50;
    const RADII = [0.08, 0.11, 0.14, 0.17, 0.2];
    const got = scatters(RADII.map((r) => poissonDoc(r, { max: NS }, 1, 1, 0.5, 0.5)), (k) => `the unit plate at radius ${RADII[k]}`);
    RADII.forEach((radius, k) => {
      const sample = got[k]!;
      expect(sample.length, `radius ${radius}: at most ${NS} points (max: ${NS})`).toBeLessThanOrEqual(NS);
      expect(sample.length, `radius ${radius}: at least two points, so there is a least pairwise distance`).toBeGreaterThanOrEqual(2);
      expect(leastDistance(sample).d, `radius ${radius}: the least pairwise distance of ${sample.length} points`).toBeGreaterThanOrEqual(radius * (1 - RTOL));
    });
  }, TIMEOUT);

  it(`${ID} test_fill_space: radius 0.2 over the unit plate, [−5, 5]² and [1.1, 5.1]², the least pairwise distance at least radius × (1 − 1e-6)`, () => {
    judgesFailTheirPlants();
    const radius = 0.2;
    /** Upstream's `l_bounds, u_bounds`; none is the unit square. */
    const BOUNDS: readonly [number, number][] = [[0, 1], [-5, 5], [1.1, 5.1]];
    const got = scatters(BOUNDS.map(([l, u]) => poissonDoc(radius, {}, u - l, u - l, (l + u) / 2, (l + u) / 2)), (k) => `the plate over [${BOUNDS[k]!.join(', ')}]²`);
    BOUNDS.forEach(([l, u], k) => {
      const sample = got[k]!;
      expect(sample.length, `[${l}, ${u}]²: at least two points, so there is a least pairwise distance`).toBeGreaterThanOrEqual(2);
      expect(leastDistance(sample).d, `[${l}, ${u}]²: the least pairwise distance of ${sample.length} points`).toBeGreaterThanOrEqual(radius * (1 - RTOL));
    });
  }, TIMEOUT);
});
