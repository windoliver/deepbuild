// #1700.3deedc17: "A closed 2 × 1 × 0.5 m box reads 1 m³ and the window 0.084 m³, each within 1e-12 relative. The box
// with one face's winding flipped reads closed false and volume unknown, naming the face, and a check that needs its
// volume reads INCONCLUSIVE; a planted reading that sums the flipped face anyway returns a number and fails, naming
// the part"
//
// Fixtures, each a stored scene, the one deliverable of its own claim of alpha's:
//   - `boxDoc` (gltf.ts `box(false)`): `box`, a `mesh.asset@1` of an indexed 2 × 1 × 0.5 m box centred on the origin,
//     8 shared corners at x ±1, y ±0.5, z ±0.25 m (exact in f32), 12 triangles wound outward, two per face in the
//     order −Z, +Z, −Y, +Y, −X, +X;
//   - `windowDoc` (helpers.ts): `window`, the extruded window, 1 × 1 × 0.1 m with four 0.2 m square holes;
//   - `flippedBoxDoc` (gltf.ts `box(true)`): `flipped-box`, the same box with its +Z face's two triangles, 2 and 3 in
//     the file's order, wound backwards (their normals still out), so the four edges around that face are each held
//     twice in one direction.
// The checks: `{kind: geometry.shape, of: box, readings: [volume], expect: {volume: [1 − 1e-12, 1 + 1e-12]}}`, the
// window's with 0.084 ± 1e-12 relative, and on the flipped box `{readings: [closed], expect: {closed: false}}` and
// `{readings: [volume], expect: {volume: [1 − 1e-12, 1 + 1e-12]}}`, two requirements of one claim.
//
// asserts:
//   - the box and the window PASS, the box's one volume result within 1e-12 relative of 1 m³, the window's of 0.084 m³;
//   - the flipped box's closed requirement PASSes with one result of false; its volume requirement is INCONCLUSIVE,
//     never PASS, with one result whose value is `unknown`, naming the part `flipped-box#<n>`; each of the two results
//     names the face, `faces` [2, 3], and the first open `edge`, two world points on the flipped face's boundary
//     (both at z = 0.25 m, differing in x or in y alone); the claim isn't PASS;
//   - with the planted `volume_sums_flipped_faces` (volume sums every triangle as wound, on a part that isn't closed
//     too): the flipped box's volume reads a finite number, its requirement FAILs, and a geometry.reading issue on
//     readings/0 names `flipped-box#<n>`, the reading volume and that number as its actual value.
import { describe, expect, it } from 'vitest';
import { FLIPPED_FACE, FLIPPED_Z, box } from './gltf.ts';
import {
  PLANTED, TIMEOUT, WINDOW_VOLUME, boxDoc, brief, claimId, claimOf, decided, docId, flippedBoxDoc, namesPart, nearAbs, nearRel, oneAt, point,
  putMesh, readingIssuesAt, reqId, rowOf, run, scenarioOf, shape, useBuild, useFolders, verdict, windowDoc, type Result,
} from './helpers.ts';

/** The criterion's ID: `#1700.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1700.3deedc17';
const bin = useBuild();
const folder = useFolders();

const [BOX, WINDOW, FLIPPED] = [docId(1), docId(2), docId(3)];
const within = (v: number): number[] => [v * (1 - 1e-12), v * (1 + 1e-12)];
const flippedClaim = claimOf(FLIPPED, [
  { id: reqId(3), check: shape('flipped-box', ['closed'], { closed: false }) },
  { id: reqId(4), check: shape('flipped-box', ['volume'], { volume: within(1) }) },
]);

/** Why a result doesn't name the flipped face and an edge around it. */
function faceFailures(r: Result, what: string): string[] {
  const failures: string[] = [];
  const faces = Array.isArray(r.raw['faces']) ? r.raw['faces'].map(Number).sort((x, y) => x - y) : null;
  if (JSON.stringify(faces) !== JSON.stringify([...FLIPPED_FACE])) failures.push(`${what} names the faces ${brief(r.raw['faces'] ?? null)}, not the flipped face's triangles ${FLIPPED_FACE.join(', ')}`);
  const edge = Array.isArray(r.raw['edge']) && r.raw['edge'].length === 2 ? r.raw['edge'].map(point) : null;
  if (!edge || !edge[0] || !edge[1]) failures.push(`${what}: its first open edge isn't two world points: ${brief(r.raw['edge'] ?? null)}`);
  else {
    const [a, b] = [edge[0], edge[1]];
    if (!nearAbs(a[2], FLIPPED_Z, 1e-9) || !nearAbs(b[2], FLIPPED_Z, 1e-9)) failures.push(`${what}: its edge ${brief(r.raw['edge'] ?? null)} doesn't lie on the flipped face, z = ${FLIPPED_Z}`);
    const differ = [0, 1].filter((k) => !nearAbs(a[k], b[k]!, 1e-9)).length;
    if (differ !== 1) failures.push(`${what}: its edge ${brief(r.raw['edge'] ?? null)} isn't one of the four edges around the flipped face`);
  }
  return failures;
}

describe(`${ID} a closed part's volume, and an open part's unknown`, () => {
  it(`${ID} the box reads 1 m³ and the window 0.084 m³ within 1e-12 relative; the box with one face's winding flipped reads closed false and volume unknown, naming the face, and a check that needs its volume is INCONCLUSIVE; a planted reading that sums the flipped face returns a number and fails, naming the part`, () => {
    const evidence = folder();
    const [closedSha, flippedSha] = [putMesh(evidence, box(false)), putMesh(evidence, box(true))];
    const docs = { [BOX]: boxDoc(closedSha), [WINDOW]: windowDoc(), [FLIPPED]: flippedBoxDoc(flippedSha) };
    const claims = {
      [claimId(1)]: claimOf(BOX, [{ id: reqId(1), check: shape('box', ['volume'], { volume: within(1) }) }]),
      [claimId(2)]: claimOf(WINDOW, [{ id: reqId(2), check: shape('window', ['volume'], { volume: within(WINDOW_VOLUME) }) }]),
      [claimId(3)]: flippedClaim,
    };
    const [onBox, onWindow, onFlipped] = run(bin(), scenarioOf(evidence, docs, claims, [verdict(claimId(1)), verdict(claimId(2)), verdict(claimId(3))]));

    const b = rowOf(onBox!, reqId(1), 'the box');
    decided(b, 'PASS', 'the box read for 1 m³');
    const boxVolume = oneAt(b, 0, 'the box: volume').value;
    expect(nearRel(boxVolume, 1, 1e-12), `the closed box reads 1 m³ within 1e-12 relative, got ${brief(boxVolume)}`).toBe(true);
    const w = rowOf(onWindow!, reqId(2), 'the window');
    decided(w, 'PASS', 'the window read for 0.084 m³');
    const windowVolume = oneAt(w, 0, 'the window: volume').value;
    expect(nearRel(windowVolume, WINDOW_VOLUME, 1e-12), `the window reads 0.084 m³ within 1e-12 relative, got ${brief(windowVolume)}`).toBe(true);

    const closed = rowOf(onFlipped!, reqId(3), 'the flipped box: closed');
    decided(closed, 'PASS', 'the flipped box read for closed false');
    const c = oneAt(closed, 0, 'the flipped box: closed, one result for its one part');
    expect(c.value, 'the flipped box reads closed false').toBe(false);
    expect(faceFailures(c, 'the flipped box: closed'), 'its closed result names the flipped face and an edge around it').toEqual([]);
    const volume = rowOf(onFlipped!, reqId(4), 'the flipped box: volume');
    decided(volume, 'INCONCLUSIVE', 'a check that needs the flipped box\'s volume');
    const v = oneAt(volume, 0, 'the flipped box: volume, one result for its one part');
    expect(v.value, `the flipped box reads volume unknown: ${brief(v.raw)}`).toBe('unknown');
    expect(namesPart(v.ids, 'flipped-box'), `its unknown names the part flipped-box#<n>: ${brief(v.raw)}`).toBe(true);
    expect(faceFailures(v, 'the flipped box: volume'), 'its unknown names the flipped face and its first open edge').toEqual([]);
    expect(onFlipped!['result'], `the claim on the flipped box doesn't pass on an unknown: ${brief(onFlipped!['result'])}`).not.toBe('PASS');

    // The planted reading that sums the flipped face anyway.
    const [planted] = run(bin(), scenarioOf(evidence, { [FLIPPED]: flippedBoxDoc(flippedSha) }, { [claimId(3)]: flippedClaim }, [verdict(claimId(3))], PLANTED.volume));
    const p = rowOf(planted!, reqId(4), `the flipped box's volume under ${PLANTED.volume}`);
    const summed = oneAt(p, 0, `the flipped box under ${PLANTED.volume}: volume`).value;
    expect(typeof summed === 'number' && Number.isFinite(summed), `the planted reading returns a number for the flipped box, got ${brief(summed)}`).toBe(true);
    decided(p, 'FAIL', `the flipped box's volume under ${PLANTED.volume}`);
    const issue = readingIssuesAt(p, 0).find((i) => namesPart(i.ids, 'flipped-box'));
    expect(issue, `a geometry.reading issue on readings/0 names the part flipped-box#<n>: ${brief(p.raw['issues'] ?? null, 3000)}`).toBeDefined();
    expect(issue!.reading, `the issue names the reading volume: ${brief(issue!.raw)}`).toBe('volume');
    expect(issue!.actual, `the issue names the number the planted reading returned: ${brief(issue!.raw)}`).toBe(summed);
  }, TIMEOUT);
});
