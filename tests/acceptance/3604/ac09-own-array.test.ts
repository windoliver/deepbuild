// Criterion 9: "A switch with `closed_by: {array: run[0]}`, where the item's program writes `run[0] = 1` on steps 100
// to 199 only, feeds a 60 W lamp: the lamp carries 0.26087 A on exactly those steps and 0 A on every other, with no
// step of lag and no input entry on the track. A `closed_by` naming an array of another item is refused at check,
// naming the part."
//
// Through `deep-logic first_party`, `playback` and `check` (README: The surface): the switch `relay` closed by the
// item's own `run[0]` (circuits.ts: OWNED), its program writing `run[0]` before each solve, 1 at steps 100 to 199 and
// 0 at every other (README: Programs), 1,000 steps a second, 300 steps, a piece with no controls and an empty track.
// At every step: `run[0]` as the item's array reads what the program wrote; the lamp carries 0.26087 A within 1e-9
// relative exactly at steps 100 to 199, and `i` and `i_rms` 0 within 1e-12 A at every other. Then two items in one
// piece: `pump`, the same item, and `lights`, whose switch is closed by `pump.run[0]`, an array of another item, which
// `lights` doesn't write: `logic_refused` naming `lights` and the part `relay`, and the same piece with `lights`
// closed by its own `run[0]` admitted. The wrong programs: an array read as the step before left it (a step of lag),
// read from the arrays the logic module copied out, or not read at all; and a check that lets another item's array
// close a part.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, checkCall, logicBin, onHost, prebuild, refusedOf, show } from '../190/helpers.ts';
import { BORROWED_CIRCUIT, LAMP, OWNED, RUN, index, type Fix } from './circuits.ts';
import { AC, INTERFACE, circuitLib, item, nums, piece, playbackCall, played, refPiece, rel } from './helpers.ts';

prebuild(() => { logicBin(); });

const STEPS = Array.from({ length: OWNED.steps }, (_, k) => k);

describe(`${AC[9]} a part the piece's own logic closes`, () => {
  it(`${AC[9]} a switch closed by the item's own run[0], written 1 on steps 100 to 199 only, feeds the lamp 0.26087 A on exactly those steps and 0 A on every other, with no step of lag and no input entry on the track`, () => {
    const L = circuitLib();
    const p = refPiece(L, [OWNED]);
    expect([p['controls'], OWNED.track.length], 'the piece has no controls and its track no entry').toEqual([undefined, 0]);
    const [play] = onHost([playbackCall(p, OWNED, STEPS)]);
    const at = played(play!, OWNED.item);
    const lamp = index(OWNED.circuit, 'lamp');
    const on = (k: number): boolean => k >= RUN.from && k <= RUN.to;
    const bad = STEPS.flatMap((k) => {
      const a = at.get(k);
      const run = nums(a, 'run')[0]!;
      const [i, irms] = [nums(a, 'i')[lamp]!, nums(a, 'i_rms')[lamp]!];
      return [
        ...(run !== (on(k) ? 1 : 0) ? [`step ${k}: run[0] reads ${run}`] : []),
        ...(on(k) ? (rel(irms, LAMP.amps) <= 1e-9 ? [] : [`step ${k}: run[0] 1, the lamp carries ${irms} A`])
          : (Math.abs(i) <= 1e-12 && Math.abs(irms) <= 1e-12 ? [] : [`step ${k}: run[0] 0, the lamp carries ${irms} A`])),
      ];
    });
    expect(bad.slice(0, 10), 'the lamp carries 0.26087 A on exactly steps 100 to 199, the steps its program writes run[0] = 1, and 0 A on every other').toEqual([]);
  }, TIMEOUT);

  it(`${AC[9]} a closed_by naming an array of another item is refused at check, naming the part`, () => {
    const L = circuitLib();
    const pump: Fix = { ...OWNED, item: 'pump' };
    const borrowed: Fix = { ...OWNED, item: 'lights', circuit: BORROWED_CIRCUIT, own: [] };
    const own: Fix = { ...OWNED, item: 'lights' };
    const two = (lights: Fix) => piece({ pump: item(pump, INTERFACE, [L.ref]), lights: item(lights, INTERFACE, [L.ref]) }, [], L.assets);
    const [refused, admitted] = onHost([checkCall(two(borrowed)), checkCall(two(own))]);
    const r = refusedOf(refused!, 'the check of lights, its switch closed by pump.run[0]');
    expect([r.code, r.item], 'it is refused at check, naming the item lights').toEqual(['logic_refused', 'lights']);
    expect(r.refusals.some((x) => x['part'] === 'relay'), `a refusal names the part, relay: ${show(r.refusals as never)}`).toBe(true);
    expect(admitted!['ok'], `the same piece with lights closed by its own run[0] is admitted: ${show(admitted)}`).toBe(true);
  }, TIMEOUT);
});
