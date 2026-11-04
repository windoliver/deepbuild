// AC1: "Each familiar recipe builds the same bounds as the reference library's geometry with the same parameters,
// checked on fixtures"
//
// One document holds one instance of every familiar@1 recipe (fixtures/familiar-bounds.json), each with the
// reference library's own parameter names and non-default values. The program's mesh is every derived item the
// instance expanded to that `geometry` answers, placed in the world by its row's `world`; its box must equal, within
// the fixture's 1e-6 m per bound, the box of the vertices three.js builds with the same parameters at the pinned
// commit (reference.ts: each generator's positions, ported and checked once against r186's own code). The cases
// use odd segment counts and partial sweeps, so a recipe that drops a segment count, starts a sweep elsewhere or
// lays a flat shape in another plane misses a bound.

import { describe, expect, it } from 'vitest';
import { AC, DOC, PACKS, SLOW, aabb, admitted, derivedOf, fixture, geometryCall, meshRows, none, obj, placed, runShow, scenario, sceneDoc, show, useDir, useShow, type JsonObject } from './helpers.ts';
import { THREE, boundsOf, fmtV, threePoints, type Params, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();
const FIXTURE = fixture('familiar-bounds.json');
const CASES = FIXTURE['cases'] as JsonObject[];
const TOL = FIXTURE['tolerance_m'] as number;

describe(`${AC[1]} familiar recipes build the reference library's bounds`, () => {
  it(`${AC[1]} each of the ${CASES.length} familiar@1 recipes builds the bounds of three.js ${THREE.commit.slice(0, 10)}'s geometry with the same parameters, within 1e-6 m`, () => {
    expect((FIXTURE['pin'] as JsonObject)['commit'], 'the fixture names the pinned commit reference.ts ports').toBe(THREE.commit);
    const items: Record<string, JsonObject> = {};
    for (const c of CASES) items[String(c['id'])] = { kind: c['recipe']!, params: c['params']! };
    const doc = sceneDoc('Familiar geometry', items, [PACKS.familiar]);
    const [shownReply, geo] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc), geometryCall(DOC.a)], [PACKS.familiar]));
    admitted(shownReply!, 'the familiar geometry document');
    const rows = meshRows(geo!, 'geometry of the familiar document');
    const problems: string[] = [];
    for (const c of CASES) {
      const id = String(c['id']);
      const name = String(c['recipe']).replace(/^familiar\./, '').replace(/@1$/, '');
      const theirs = boundsOf(threePoints(name, obj(c['params'], `${id}.params`) as Params));
      const built = derivedOf(shownReply!, id).filter((d) => rows.has(d.id));
      if (built.length === 0) { problems.push(`${id} (${String(c['recipe'])}): builds no mesh (derived: ${derivedOf(shownReply!, id).map((d) => d.id).join(', ') || 'none'})`); continue; }
      const ours = aabb(built.flatMap((d) => placed(rows.get(d.id)!)));
      const scale = Math.max(1, ...[0, 1, 2].map((k) => theirs.max[k]! - theirs.min[k]!));
      const off = (a: V3, b: V3): boolean => [0, 1, 2].some((k) => !(Math.abs(a[k]! - b[k]!) <= TOL * scale));
      if (off(ours.min, theirs.min) || off(ours.max, theirs.max)) {
        problems.push(`${id} (${String(c['three'])}): bounds ${fmtV(ours.min)} to ${fmtV(ours.max)}, the library's ${fmtV(theirs.min)} to ${fmtV(theirs.max)}`);
      }
    }
    none(problems, 'familiar recipes against the reference library\'s bounds');
  }, SLOW);
});
