// AC3 #1490.22b977d9: "A planted picker that always takes the smallest set ends at the export refusal for a missing
// module, naming the module"
//
// asserts, through `deep-show run`'s web export (README: The surface under test):
//   - the physics lab (#172's lab: a 3D scene with the world `field` and the logic item `scorer`) on its recorded
//     track, exported under the planted picker `web_picks_smallest_set` (chosen: it always takes the size record's
//     smallest set), is refused, with nothing written in the bundle's folder;
//   - the refusal is the export's for a missing module (an entry with code `module_missing`, #172's refusal of a canvas
//     module the player lacks), and it names a module the lab uses (the 3D scene, physics or logic module) that the
//     smallest set lacks;
//   - with the shipped picker, the same lab on the same track is exported (so the refusal is the picker's doing).
// Wrong programs it fails: the merge base (it has no such picker: the scenario answers bad_input); a picker whose wrong
// set gets past the refusal (a bundle is written, or the export ends elsewhere); a refusal that names no module.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL, TIMEOUT, exportOnce, labDoc, labTrack, refusedUnwritten, show, useShow, useTemp, webReceiptOf, type JsonValue } from '../172/helpers.ts';
import { AC, LAB_MODULES, moduleMissing, names, readRecord, smallestSet } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const PLANTED = 'web_picks_smallest_set';

describe(`${AC[3]} a picker that always takes the smallest set ends at the refusal for a missing module`, () => {
  it(`${AC[3]} the planted ${PLANTED} ends the physics lab's export at the refusal for a missing module, naming the module`, () => {
    const evidence = temp();
    const out = join(temp(), 'bundle');
    const reply = exportOnce(shows(FULL), evidence, labDoc(evidence), out, `the physics lab (planted ${PLANTED})`, { track: labTrack(), planted: PLANTED });
    refusedUnwritten(reply, out, `the physics lab's web export under the planted picker ${PLANTED}`);
    const record = readRecord();
    const smallest = smallestSet(record);
    const lacking = LAB_MODULES.filter((m) => !smallest.modules.includes(m));
    expect(lacking.length, `the smallest set, ${smallest.name} (${smallest.modules.join(', ')}), lacks a module the lab uses (${LAB_MODULES.join(', ')})`).toBeGreaterThan(0);
    const missing = moduleMissing(reply);
    expect(missing.length, `the export's refusal is for a missing module (code module_missing): ${show(reply, 2000)}`).toBeGreaterThan(0);
    expect(missing.some((e) => lacking.some((m) => names(e, m))), `the refusal names the module ${lacking.join(' or ')} that ${smallest.name} lacks: ${show(missing as JsonValue, 2000)}`).toBe(true);

    const again = temp();
    webReceiptOf(exportOnce(shows(FULL), again, labDoc(again), join(temp(), 'bundle'), 'the physics lab', { track: labTrack() }), 'the physics lab with the shipped picker');
  }, TIMEOUT);
});
