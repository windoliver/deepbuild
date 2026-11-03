// AC2: "On a closed curve the frame at u = 1 equals the frame at u = 0 within 1e-6 rad, and a planted seam twist
// fails (parity/geometry/curve-frames-closed.scene)"
//
// The parity fixture is one closed curve@1 through a trefoil knot's points, whose rotation-minimizing frame
// comes back around the loop turned by over 100° (the fixture's `about`). The program's frames at u = 0, at
// u = 1 and at u = 1's left limit (1 − 1e-9, so a curve that wraps u = 1 to 0 can't hide a twist) are read
// through `geometry`'s `at`; each must be within 1e-6 rad of the frame at u = 0, by the largest angle between
// their tangents, normals and binormals. `closure` must show the mismatch the frames spread. The twin
// (`seam_twist_left`) leaves the mismatch at the seam and must fail, naming the curve and u = 1.

import { describe, expect, it } from 'vitest';
import { AC, DOC, SLOW, admitted, curveRow, failsNaming, fixture, geometryCall, none, num, obj, runShow, scenario, sceneDoc, show, useDir, useShow, type CurveRow, type Frame, type JsonObject, type ShowPlanted } from './helpers.ts';
import { angle, fmt } from './reference.ts';

const bin = useShow();
const dir = useDir();
const SCENE = fixture('parity', 'geometry', 'curve-frames-closed.scene');
const CURVE = obj(SCENE['curve'], 'the fixture\'s curve');
const ID = String(CURVE['id']);
const AT = (SCENE['at'] as number[]);
const TOL = num(SCENE['tolerance_rad'], 'tolerance_rad');
const TWIN = (SCENE['twins'] as JsonObject[])[0]!;

const frameAngle = (a: Frame, b: Frame): number => Math.max(angle(a.tangent, b.tangent), angle(a.normal, b.normal), angle(a.binormal, b.binormal));

function read(planted?: ShowPlanted): CurveRow {
  const doc = sceneDoc('A closed trefoil', { [ID]: { kind: CURVE['kind']!, params: CURVE['params']! } });
  const [shown, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc), geometryCall(DOC.a, [ID], AT)], planted));
  admitted(shown!, 'the closed curve\'s document');
  return curveRow(reply!, ID, `geometry of ${ID}`);
}

/** Every frame AC2 compares; each failure names the curve and the u it read. */
function seamProblems(c: CurveRow): string[] {
  if (c.at.length !== AT.length) return [`${ID}: ${c.at.length} at entries for the ${AT.length} values of u asked`];
  const start = c.at[0]!;
  const out: string[] = [];
  c.at.slice(1).forEach((row, i) => {
    const u = AT[i + 1]!;
    const a = frameAngle(row, start);
    if (!(a <= TOL)) out.push(`${ID}: the frame at u = 1 (read at u = ${u}) is ${fmt(a)} rad from the frame at u = 0 (limit ${TOL} rad)`);
  });
  return out;
}

describe(`${AC[2]} closed frames meet at the seam (parity/geometry/curve-frames-closed.scene)`, () => {
  it(`${AC[2]} on the closed trefoil the frame at u = 1 and at its left limit equals the frame at u = 0 within 1e-6 rad, with the closure spread`, () => {
    const c = read();
    const closure = num(c.outputs['closure'], `${ID}.outputs.closure`);
    expect(Math.abs(closure), `${ID}: closure reports the seam mismatch the frames spread (at least ${String(SCENE['closure_min_deg'])}° on this curve), got ${closure}`).toBeGreaterThanOrEqual(num(SCENE['closure_min_deg'], 'closure_min_deg'));
    none(seamProblems(c), 'the closed curve\'s frames at the seam');
  }, SLOW);

  it(`${AC[2]} the planted ${String(TWIN['planted'])} (closure left at the seam) fails, naming the curve and u = 1`, () => {
    failsNaming(seamProblems(read(TWIN['planted'] as ShowPlanted)), TWIN['names'] as string[], `the planted ${String(TWIN['planted'])}`);
  }, SLOW);
});
