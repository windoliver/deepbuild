// #405.0b08cb52: "A broken fixture reports exactly its planted faults by part ID"
//
// Fixtures (helpers.ts `figure`): a small figure of true shapes on a base plate, shown by the working agent alpha
// through deep_show: boxes (`base`, `housing`, `bracket`, `stand`, `socket-a`, `socket-b`), a sphere (`knob`), a
// cylinder (`washer`) and a 1.5 mm tube (`cable`) from socket-a over to socket-b. The broken figure plants three
// faults; its clean twin is the same figure without them:
//   - `bracket` passes 0.02 m into `housing` (clean: 0.01 m clear of it);
//   - `washer` hangs 0.05 m above the plate, resting on nothing (clean: on the plate);
//   - `cable` ends 0.05 m above socket-b, in the air (clean: it ends on socket-b's top).
// Neither twin has any other fault, and both hold one trap for an audit that reads bounds instead of true shapes: the
// knob's sphere clears the housing's top edge by 2.6 mm while its bounds pass 4 mm into the housing's.
//
// asserts: each twin is the one deliverable of its own claim of alpha's, whose one requirement is the check
// `{kind: geometry.audit, scope: scene, tolerance: {sunk: 0.003, touch: 0.001, land: 0.001}, support: {floating:
// [base, cable]}}`, judged with `verdict` in one `deep-show run`:
//   - the broken figure: FAIL, and its errors and warnings are exactly geometry.overlap naming bracket and housing,
//     geometry.floating naming washer and geometry.unlanded naming cable, each an error; nothing else is raised
//     (so no knob, no socket, no second report of a fault);
//   - the clean twin: PASS, nothing raised.
import { describe, it } from 'vitest';
import {
  FIGURE_CHECK, FULL, PLANTED, TIMEOUT, claimId, claimOf, docId, exactFaultFailures, figure, none, passFailures, presented, reqId, rowOf, run,
  scenarioOf, show, useBuilds, useFolders, verdict,
} from './helpers.ts';

/** The criterion's ID: `#405.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#405.0b08cb52';
const bin = useBuilds([FULL]);
const folder = useFolders();

describe(`${ID} a broken fixture reports exactly its planted faults by part ID`, () => {
  it(`${ID} the broken figure reports exactly its three planted faults by part ID (bracket into housing, the washer held by nothing, the cable's end in the air), and its clean twin passes`, () => {
    const [broken, clean] = [docId(1), docId(2)];
    const claims = { [claimId(1)]: claimOf(broken, reqId(1), FIGURE_CHECK), [claimId(2)]: claimOf(clean, reqId(2), FIGURE_CHECK) };
    const calls = [show(broken, figure(true)), show(clean, figure(false)), verdict(claimId(1)), verdict(claimId(2))];
    const [shownBroken, shownClean, onBroken, onClean] = run(bin(FULL), scenarioOf(folder(), [broken, clean], claims, calls));
    presented(shownBroken!, 'the broken figure');
    presented(shownClean!, 'the clean twin');
    none(exactFaultFailures(rowOf(onBroken!, reqId(1), 'the broken figure'), PLANTED, 'the geometry audit of the broken figure'), 'the broken figure reports exactly its planted faults by part ID');
    none(passFailures(rowOf(onClean!, reqId(2), 'the clean twin'), 'the geometry audit of the clean twin'), 'the clean twin passes');
  }, TIMEOUT);
});
