// Criterion 6: "A circuit with a diode part is refused at check, naming the part."
//
// Through `deep-logic first_party` and `check` (README: The surface): the lamp's circuit with a diode `rectifier`
// across the lamp (circuits.ts: DIODE_CIRCUIT) is refused, `logic_refused` naming the item and, in a refusal, the
// part by its ID (README: Pieces: refusal at check); the same circuit without the diode, the same program and links,
// is admitted, so the refusal is the diode's. The wrong programs: a check that admits a part circuit@1 can't model,
// leaving the library to skip it or solve it as something else, and a refusal that names another part or none.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, checkCall, logicBin, onHost, prebuild, refusedOf, show } from '../190/helpers.ts';
import { DIODE_CIRCUIT, PLUGGED, type Fixture } from './circuits.ts';
import { AC, INTERFACE, circuitLib, fixturePiece } from './helpers.ts';

prebuild(() => { logicBin(); });

describe(`${AC[6]} a part circuit@1 can't model`, () => {
  it(`${AC[6]} a circuit with a diode part is refused at check, naming the part`, () => {
    expect(DIODE_CIRCUIT.parts.filter((p) => p.kind === 'diode').map((p) => p.id), 'the fixture holds one diode, rectifier, beside the lamp\'s parts').toEqual(['rectifier']);
    const L = circuitLib();
    const diode: Fixture = { ...PLUGGED, item: 'rectified', circuit: DIODE_CIRCUIT };
    const [refused, admitted] = onHost([checkCall(fixturePiece(diode, INTERFACE, [L.ref], L.assets)), checkCall(fixturePiece(PLUGGED, INTERFACE, [L.ref], L.assets))]);
    const r = refusedOf(refused!, 'the check of a circuit with a diode');
    expect([r.code, r.item], 'it is refused at check, naming the logic item').toEqual(['logic_refused', 'rectified']);
    expect(r.refusals.filter((x) => x['part'] === 'rectifier').length, `a refusal names the part, rectifier: ${show(r.refusals as never)}`).toBeGreaterThan(0);
    expect(r.refusals.filter((x) => typeof x['part'] === 'string' && x['part'] !== 'rectifier'), 'and no refusal names another part').toEqual([]);
    expect(admitted!['ok'], `the same circuit without the diode is admitted: ${show(admitted)}`).toBe(true);
  }, TIMEOUT);
});
