// AC2 #424.a28f3c85: A cutaway hides geometry past its planes without a rebuild, and a cut part with a status binding
// keeps its outline and badge.
//
// Hiding without a rebuild (Cutaway `cutaway@1`): an orthographic view from +Z (60 px/m) of a 2 m unlit cube before a
// backdrop. First as a film's document input: a `cutaway@1` item, `class: document`, one plane x > offset, its offset
// a channel from 0.5 m at 0 s to −0.5 m at 1 s, drawn at 10 fps for 11 frames with `counts`. On every frame, past the
// plane (1 px clear of it) no pixel shows the cube, and short of it every pixel inside the cube's square (1 px in)
// does; every frame after the first reports `meshes_built: 0`. Then as a view input in session state (the call's
// `cutaway`), two planes in the default union mode, x > 0.5 and y > 0.5: the cube shows only where neither holds.
// The plane removes the side its normal points to (README: Readings).
//
// The status binding (Cutaway: "A part with a status binding keeps its outline and badge where it's cut"; It can never
// hide a status color): a pump whose stroke and badge slots are both bound to a verdict in state fail (#382's status
// bindings, `states`), drawn uncut and with the view cutaway x > 0 through its middle. The cut removes the pump's +X
// half (its pixel count falls by a quarter or more), the status report still lists both its slots in fail, and every
// pixel of the uncut frame that shows the look's exact fail color (#bf232b) shows it in the cut frame too, 99% of at
// least 50. Wrong programs: the base (no cutaway at all); a cutaway that rebuilds the cut mesh (meshes built after the
// first frame); a cutaway that clips the status outline or drops the badge with the geometry.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, PLAIN_LOOK, STATUS, arr, box, camera, cutawayParams, framesOf, linearChannel, obj, ortho, only, px, readIds, readPng,
  requireMetal, runGpu, sessionDoc, str, unlit, useDir, useGpu, view3dCall, writeJson, type Ids, type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [480, 360];
const K = 60;

function cubeDoc(withCut: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: ortho([0, 0, 0], SIZE[0] / K), sky: DARK_SKY,
    cube_mat: unlit([0.8, 0.6, 0.2]), back_mat: unlit([0.2, 0.2, 0.2]),
    cube: box([2, 2, 2], [0, 0, 0], { material: 'cube_mat' }),
    back: box([20, 20, 0.2], [0, 0, -3], { material: 'back_mat' }),
  };
  if (withCut) items['cut'] = { kind: 'cutaway@1', params: cutawayParams([{ normal: [1, 0, 0], offset: 0.5 }], { class: 'document' }) };
  return sessionDoc(`cube-${withCut ? 'cut' : 'plain'}`, SIZE, items, withCut ? { channels: { sweep: linearChannel('items/cut/params/planes/0/offset', 0.5, -0.5, 1) } } : {});
}
/** Pixels that show the cube where they shouldn't, or don't where they should, given what's removed. */
function cutProblems(ids: Ids, removed: (x: number, y: number) => 'removed' | 'kept' | 'edge', label: string): string[] {
  const out: string[] = [];
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    const X = (x + 0.5 - SIZE[0] / 2) / K; const Y = (SIZE[1] / 2 - y - 0.5) / K;
    const r = removed(X, Y);
    if (r === 'edge') continue;
    const inSquare = Math.abs(X) < 1 - 1 / K && Math.abs(Y) < 1 - 1 / K;
    const isCube = ids.at(x, y) === 'cube';
    if (r === 'removed' && isCube) out.push(`${label}: (${x}, ${y}) at x ${X.toFixed(3)} m, y ${Y.toFixed(3)} m shows the cube past the plane`);
    if (r === 'kept' && inSquare && !isCube) out.push(`${label}: (${x}, ${y}) at x ${X.toFixed(3)} m, y ${Y.toFixed(3)} m shows ${ids.at(x, y)}, not the cube, short of the plane`);
  }
  return out;
}
const side = (v: number, offset: number): 'removed' | 'kept' | 'edge' => (v > offset + 1 / K ? 'removed' : v < offset - 1 / K ? 'kept' : 'edge');

const VERDICT = 'verdict:01JB4240000000000000000424';
const FAIL = [0xbf, 0x23, 0x2b];
function pumpDoc(): JsonObject {
  const doc = sessionDoc('pump', SIZE, {
    cam: camera([2.5, 2.2, 4.5], [0, 0.5, 0], 40), sky: { ...DARK_SKY, params: { ...(DARK_SKY['params'] as JsonObject), ambient_top: [0.3, 0.3, 0.3], ambient_low: [0.2, 0.2, 0.2] } },
    floor_mat: unlit([0.25, 0.25, 0.25]),
    floor: box([8, 0.1, 8], [0, -0.05, 0], { material: 'floor_mat' }),
    pump: { kind: 'mark.box@1', params: { size: [1.6, 1.2, 1.2], paint: { fill: { role: 'stone' } } }, at: { pos: [0, 0.6, 0] } },
  });
  doc['status_bindings'] = {
    b_stroke: { target: 'items/pump/params/paint/stroke', source: VERDICT },
    b_badge: { target: 'items/pump/params/paint/badge', source: VERDICT },
  };
  return doc;
}
function slotsOf(reply: JsonObject): string[] {
  const s = obj(reply['status'], 'the status report');
  return arr(s['marks'], 'status.marks').map((m, i) => {
    const o = obj(m, `status.marks[${i}]`);
    return `${str(o['item'], 'a mark\'s item')}/${str(o['slot'], 'a mark\'s slot')}/${str(o['state'], 'a mark\'s state')}`;
  }).sort();
}

describe(`${AC[2]} a cutaway hides geometry past its planes without a rebuild, and keeps a cut part's status outline and badge`, () => {
  it(`${AC[2]} a document cutaway whose offset sweeps hides the cube past its plane at every frame with no mesh built after the first, and a view cutaway of two planes hides their union`, () => {
    requireMetal();
    const out = dir();
    const [swept, view] = runGpu(bin(), out, [
      view3dCall({ doc: writeJson(out, 'swept', cubeDoc(true)), size: SIZE, frames: 11, fps: 10, capture: 'every', targets: ['ids'], counts: true }),
      view3dCall({ doc: writeJson(out, 'plain', cubeDoc(false)), size: SIZE, targets: ['ids'], cutaway: cutawayParams([{ normal: [1, 0, 0], offset: 0.5 }, { normal: [0, 1, 0], offset: 0.5 }], { mode: 'union' }) }),
    ]);
    const frames = framesOf(swept!, 'the swept cutaway');
    expect(frames.length, 'the sweep draws 11 frames').toBe(11);
    const problems: string[] = [];
    for (const f of frames) {
      const offset = 0.5 - 0.1 * f.frame;
      problems.push(...cutProblems(readIds(out, f, `frame ${f.frame}`), (X) => side(X, offset), `frame ${f.frame} (offset ${offset.toFixed(1)} m)`).slice(0, 5));
      if (f.frame > 0) {
        expect(f.meshes_built, `frame ${f.frame} reports the meshes it built (counts)`).not.toBeNull();
        if (f.meshes_built !== 0) problems.push(`frame ${f.frame}: the cutaway moved and ${f.meshes_built} meshes were built (a rebuild)`);
      }
    }
    const v = readIds(out, only(view!, 'the view cutaway'), 'the view cutaway');
    problems.push(...cutProblems(v, (X, Y) => {
      const a = side(X, 0.5); const b = side(Y, 0.5);
      return a === 'removed' || b === 'removed' ? 'removed' : a === 'kept' && b === 'kept' ? 'kept' : 'edge';
    }, 'the view cutaway, union of x > 0.5 and y > 0.5').slice(0, 10));
    expect(problems, `the cutaway:\n  ${problems.join('\n  ')}`).toEqual([]);
  }, 1_800_000);

  it(`${AC[2]} a pump cut through its middle keeps its fail outline and badge: both slots reported, and every fail-colored pixel of the uncut frame still fail-colored`, () => {
    requireMetal();
    expect(STATUS['fail'], 'the look\'s fail color is #bf232b').toBe('#bf232b');
    const out = dir();
    const doc = writeJson(out, 'pump', pumpDoc());
    const call = (cutaway?: JsonObject): JsonObject => view3dCall({ doc, look: PLAIN_LOOK, size: SIZE, targets: ['final', 'ids'], states: { [VERDICT]: 'fail' }, ...(cutaway ? { cutaway } : {}) });
    const [uncut, cut] = runGpu(bin(), out, [call(), call(cutawayParams([{ normal: [1, 0, 0], offset: 0 }]))]);
    const uf = only(uncut!, 'the uncut pump'); const cf = only(cut!, 'the cut pump');
    const ui = readIds(out, uf, 'the uncut pump'); const ci = readIds(out, cf, 'the cut pump');
    const uPng = readPng(out, uf.final, 'the uncut pump'); const cPng = readPng(out, cf.final, 'the cut pump');
    const pumpU = ui.count.get('pump') ?? 0; const pumpC = ci.count.get('pump') ?? 0;
    console.log(`${AC[2]}: the pump covers ${pumpU} pixels uncut, ${pumpC} cut`);
    expect(pumpC, 'the cutaway removes the pump\'s +X half: its pixels fall by a quarter or more').toBeLessThanOrEqual(0.75 * pumpU);
    expect(slotsOf(uncut!), 'uncut, the status report lists the pump\'s stroke and badge in fail').toEqual(['pump/badge/fail', 'pump/stroke/fail']);
    expect(slotsOf(cut!), 'cut, the status report still lists the pump\'s stroke and badge in fail').toEqual(['pump/badge/fail', 'pump/stroke/fail']);
    let fail = 0; let kept = 0; let first = '';
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
      if (px(uPng, x, y).join() !== FAIL.join()) continue;
      fail++;
      if (px(cPng, x, y).join() === FAIL.join()) kept++; else if (!first) first = `(${x}, ${y}) reads ${px(cPng, x, y).join(', ')}`;
    }
    console.log(`${AC[2]}: ${fail} fail-colored pixels uncut, ${kept} kept when cut`);
    expect(fail, 'the uncut pump shows its fail outline and badge: at least 50 pixels of #bf232b').toBeGreaterThanOrEqual(50);
    expect(kept / fail, `the cut pump keeps its outline and badge: 99% of the fail-colored pixels stay fail; first lost ${first}`).toBeGreaterThanOrEqual(0.99);
  }, 1_800_000);
});
