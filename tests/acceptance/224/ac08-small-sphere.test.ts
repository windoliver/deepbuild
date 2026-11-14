// AC8 #224.5f6db998: "In the box [−1, 1] m on each axis at tolerance 0.002 m, a sphere of radius 0.01 m centered at
// (0.31, 0.27, 0.43) m is found, as one closed shell with V − E + F = 2; a planted mesher that drops every cell whose
// corners share a sign finds nothing and fails"
//
// `bead`, an implicit `surface@1` with `zero: (x − 0.31)² + (y − 0.27)² + (z − 0.43)² − 0.0001`, `box` [−1, 1]³,
// tolerance 0.002 m, one-sided (README: Readings), read back by `geometry`.
//   The judge: something is drawn; it is one closed shell (positions welded at 1e-6 m, every edge on two triangles) with
//   V − E + F = 2; and every vertex lies within the 0.002 m tolerance of that sphere (|‖p − c‖ − 0.01| ≤ 0.002), so what
//   is found is the bead, where it is.
//   - The shipped program passes it.
//   - Under `octree_drops_same_sign` (the planted mesher: every cell whose eight corners share a sign dropped, whatever
//     its interval bound) nothing is drawn, and the judge fails, naming that it found nothing.
// Fails: a mesher that trusts corner signs, so a shell smaller than a cell is lost; a bead found elsewhere or open.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, TIMEOUT, admitted, ask, dist, failsNaming, geometry, meshOf, none, present, sceneDoc, shellFailures, triangleCount, useBins, zeroSurface,
  type Mesh, type Run, type V3,
} from './helpers.ts';

useBins();
const ID = AC[8];
const C: V3 = [0.31, 0.27, 0.43];
const bead = zeroSurface('(x - 0.31)^2 + (y - 0.27)^2 + (z - 0.43)^2 - 0.0001', 1, 0.002);

function meshed(o: Run = {}): Mesh {
  const [shownReply, geo] = ask([present(DOC(1), sceneDoc('A bead in a big box', { bead })), geometry(DOC(1), ['bead'])], o);
  // The planted mesher's empty mesh may raise what it likes; only the shipped program must be admitted.
  if (!o.planted) admitted(shownReply, 'the bead');
  return meshOf(geo, 'bead', 'the bead');
}
function foundFailures(m: Mesh): string[] {
  if (triangleCount(m) === 0) return ['the bead: found nothing, no triangle'];
  const f = shellFailures(m, 1, 2, 'the bead');
  const off = m.positions.map((p, i) => [i, Math.abs(dist(p, C) - 0.01)] as const).filter(([, d]) => d > 0.002);
  if (off.length) f.push(`the bead: ${off.length} vertices lie more than 0.002 m off the sphere at (0.31, 0.27, 0.43), such as vertex ${off[0]![0]} by ${off[0]![1]} m`);
  return f;
}

describe(`${ID} a shell far smaller than the box is found`, () => {
  it(`${ID} a sphere of radius 0.01 m at (0.31, 0.27, 0.43) m in the box [−1, 1] m at tolerance 0.002 m is found, as one closed shell with V − E + F = 2`, () => {
    none(foundFailures(meshed()), 'the bead is found');
  }, TIMEOUT);

  it(`${ID} a planted mesher that drops every cell whose corners share a sign (planted octree_drops_same_sign) finds nothing and fails`, () => {
    const m = meshed({ planted: 'octree_drops_same_sign' });
    expect(triangleCount(m), 'the planted mesher finds nothing').toBe(0);
    failsNaming(foundFailures(m), ['found nothing'], 'octree_drops_same_sign');
  }, TIMEOUT);
});
