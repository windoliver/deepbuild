// AC11 #540.2aa57686: The stored entry for a margin hit on a line holds the point on the segment nearest the stored ray,
// within 1/1024 m of the test's own f64 closest-point computation, and a replay after the camera turns reads the same
// entry
//
// The scene (fixtures.ts `railDoc` with `pins`): criterion 8's line `rail` from (−2, −10, −5) to (−2, 10, −5) and the
// point control `aim` with `on: surface`, `targets: [rail]` and `margin: 3`, and `pins`, a logic item reading `aim`
// that keeps the last press's 256 B (programs.ts). Through `deep-show run`: a click at (302.5, 700.5), 2 px from the
// line's column; `logic` over 60 steps; the viewer's orbit of 90° (a 360 px drag with the middle button); and `logic`
// again with logic.determinism. Expected: geometry.ts's ray through (302.5, 700.5) from the eye, and the point of the
// segment nearest it.
import { describe, expect, it } from 'vitest';
import { EYE_POSE, RAIL, railDoc } from './fixtures.ts';
import { fmt, nearestOnSegment, off, rayAt, STEP_1024, type V2 } from './geometry.ts';
import {
  AC, DOC, Script, TIMEOUT, binOf, cameraOf, entriesOf, entryName, hashDiff, lastArray, logicOf, none, prebuild, presented, putEvidence, runShow,
  sameEntry, scenario, show, useTemp, valueOf, verdictOf, type JsonObject,
} from './helpers.ts';
import { pinsProgram, rowOf } from './programs.ts';

prebuild();
const temp = useTemp();
const D = DOC(11);
const AT: V2 = [302.5, 700.5];
const RAY = rayAt(EYE_POSE, AT);
const NEAREST = nearestOnSegment(RAIL[0], RAIL[1], RAY);

describe(`${AC[11]} a margin hit on a line stores the point on it nearest the stored ray`, () => {
  it(`${AC[11]} the press's entry holds the segment's point nearest its ray within 1/1024 m, and a replay after a 90° turn reads the same entry`, () => {
    const ev = temp();
    const pins = pinsProgram();
    putEvidence(ev, pins.bytes);
    const s = new Script();
    s.present(D, railDoc('surface', pins));
    const seen = s.scope();
    const [down, up] = s.click(AT);
    const first = s.logic(D, 60);
    s.orbit([100, 900], 360);
    const turned = s.scope();
    const second = s.logic(D, 60, 'logic.determinism');
    const r = runShow(binOf(), scenario(ev, [{ id: D, size: EYE_POSE.size }], s.calls), 'AC11 the press beside the line');
    presented(r[0]!, 'the line');
    expect(Math.abs(Math.abs(cameraOf(r[turned]!, 'the scope after the orbit').azimuth - cameraOf(r[seen]!, 'the scope').azimuth) - 90), 'the fixture: the middle-button drag of 360 px turns the view 90°').toBeLessThan(1e-9);

    const failures: string[] = [];
    const press: JsonObject | null = entriesOf(r, [down, up], 'aim').find((e) => valueOf(e).phase === 'press') ?? null;
    if (!press) failures.push(`the press writes no press entry of aim: ${show(r[down]!['appended'] ?? null)}`);
    else {
      const v = valueOf(press);
      const name = entryName(press);
      if (JSON.stringify(v.hit) !== JSON.stringify({ set: 0, key: [0, 0] })) failures.push(`${name} names ${show(v.hit)}, not the line rail`);
      if (!v.ray || off(v.ray.origin, RAY.origin) > 1e-9 || off(v.ray.dir, RAY.dir) > 1e-9) failures.push(`${name} stores ray ${show(v.ray)}, not the eye along ${fmt(RAY.dir, 9)}`);
      if (!v.surface || off(v.surface.point, NEAREST) > STEP_1024) failures.push(`${name} holds point ${v.surface ? fmt(v.surface.point, 6) : 'none'}, not within 1/1024 m of ${fmt(NEAREST, 6)}, the point of the segment nearest the stored ray`);
    }
    const a = logicOf(r[first]!, 'the logic run'), b = logicOf(r[second]!, 'the logic run after the turn');
    const track = (x: JsonObject[]): JsonObject[] => x.filter((e) => e['control'] === 'aim');
    if (track(b.track).length !== track(a.track).length || !track(b.track).every((e, i) => sameEntry(e, track(a.track)[i]!))) failures.push(`after the turn the track holds other entries of aim: ${show(track(b.track), 800)}`);
    const before = lastArray(a.steps, 'pins.rec'), after = lastArray(b.steps, 'pins.rec');
    if (!before || JSON.stringify(before) !== JSON.stringify(after)) failures.push(`after the turn the logic item reads point ${after ? fmt(rowOf(after).xyz, 6) : 'none'}${press ? ` from ${entryName(press)}` : ''}, not the same entry's ${before ? fmt(rowOf(before).xyz, 6) : 'none'}`);
    const differ = hashDiff(a.steps, b.steps);
    if (differ) failures.push(`after the turn ${differ}`);
    if (verdictOf(b.check) !== 'PASS') failures.push(`logic.determinism after the turn answers ${verdictOf(b.check)}, not PASS`);
    none(failures, 'the margin hit on the line and its replay');
  }, TIMEOUT);
});
