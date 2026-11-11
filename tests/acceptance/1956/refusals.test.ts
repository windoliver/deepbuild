// #1956.9e619118: "A planted migration that sets depth = old.width × 2.5 gives the corpus document 5.0 m, outside 0.1
// to 1.0, and the pack version is refused, naming depth and the item; and one whose expression calls a function the
// closed list lacks, or reads old.height, which @1 doesn't declare, is refused, naming it"
//
// asserts: in `r1`, each process with acme/shelf@1.0.0 installed first: the planted acme/shelf@2.0.0 that sets depth =
// old.width * 2.5 (fixtures/packs/shelf-2.0.0-depth-25) is refused with an error about depth (README: Replies read)
// that names the corpus item case1 and the value 5; the planted 2.0.0 that sets depth = lerp(0, old.width, 0.25)
// (shelf-2.0.0-lerp) is refused with an error about depth that names lerp; the planted 2.0.0 that sets depth =
// old.height * 0.25 (shelf-2.0.0-height) is refused with an error about depth that names height; and the control
// 2.0.0 (shelf-2.0.0, depth = old.width * 0.25) installs.
// Wrong program: the merge base, which refuses every 2.0.0 for its migration and its corpus alone (left out of the
// refusals read here), so no refusal names depth with its reason.

import { expect, it } from 'vitest';
import {
  ITEM, PACKS, V1, V2, V2_DEPTH_25, V2_HEIGHT, V2_LERP, at, faultFailures, mentions, none, numbersIn, packRow, run, scenario, show,
  useBinary, useEvidence, type Fault, type PackFixture,
} from './helpers.ts';

const bin = useBinary();
const evidence = useEvidence();

const PLANTED: [PackFixture, Fault][] = [
  [V2_DEPTH_25, { param: 'depth', reason: `old.width * 2.5 gives the corpus item ${ITEM} 5.0 m, outside 0.1 to 1.0`, holds: (i) => mentions(i.raw, ITEM) && numbersIn(JSON.stringify(i.raw)).includes(5) }],
  [V2_LERP, { param: 'depth', reason: 'it calls lerp, which the closed function list lacks', holds: (i) => mentions(i.raw, 'lerp') }],
  [V2_HEIGHT, { param: 'depth', reason: 'it reads old.height, which shelf.bookcase@1 doesn\'t declare', holds: (i) => mentions(i.raw, 'height') }],
];

it('#1956.9e619118 planted migrations setting depth = old.width × 2.5 (5.0 m for case1), calling lerp or reading old.height are each refused, naming depth with the item, the function or the param they read', () => {
  const b = bin();
  for (const [p, fault] of PLANTED) {
    const [packs] = run(b, scenario(evidence(), [PACKS], { packs: [V1, p] }));
    expect(packRow(packs!, V1).state, `acme/shelf@1.0.0 installs before ${at(p)}`).toBe('installed');
    none(faultFailures(packRow(packs!, p), p, [fault]), `the planted migration ${at(p)}`);
  }
  const [control] = run(b, scenario(evidence(), [PACKS], { packs: [V1, V2] }));
  expect(packRow(control!, V2).state, `the control: acme/shelf@2.0.0 with depth = old.width * 0.25 installs: ${show(packRow(control!, V2).issues.map((i) => i.raw), 3000)}`).toBe('installed');
}, 1_800_000);
