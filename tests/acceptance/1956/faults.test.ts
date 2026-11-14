// #1956.fd7b382f: "A planted migration with three faults, depth set outside its range, a call outside the function
// list and a read of old.height, refuses the pack version naming all three params with their reasons; a check that
// stops at the first fault names one and fails this test"
//
// asserts: in `r1`, with acme/shelf@1.0.0 installed first, the planted acme/shelf@2.0.0 whose @1-to-@2 step sets width
// = lerp(0, old.width, 1), shelves = old.height * 10 and depth = old.width * 2.5 (fixtures/packs/shelf-2.0.0-three-faults)
// is refused with an error about each of the three params (README: Replies read) holding its reason: width's names
// lerp, shelves' names height, depth's states the value 5. With the planted check `migration_stops_at_first_fault` the
// same pack is still refused, naming exactly one of the three, and this criterion's check fails naming the other two.
// Wrong programs: `migration_stops_at_first_fault`; the merge base, which refuses the pack for its migration and its
// corpus alone (left out of the refusals read here), and refuses the planted name as bad input.

import { expect, it } from 'vitest';
import {
  PACKS, V1, V2_THREE_FAULTS, at, faultFailures, mentions, none, numbersIn, packRow, run, scenario, useBinary, useEvidence, type Fault,
} from './helpers.ts';

const bin = useBinary();
const evidence = useEvidence();

/** The planted check (README: planted values): the pack check's migration part stops at its first failing param. */
const STOPS_AT_FIRST = 'migration_stops_at_first_fault';

const FAULTS: Fault[] = [
  { param: 'width', reason: 'lerp(0, old.width, 1) calls lerp, which the closed function list lacks', holds: (i) => mentions(i.raw, 'lerp') },
  { param: 'shelves', reason: 'old.height * 10 reads old.height, which shelf.bookcase@1 doesn\'t declare', holds: (i) => mentions(i.raw, 'height') },
  { param: 'depth', reason: 'old.width * 2.5 gives the corpus document 5.0 m, outside 0.1 to 1.0', holds: (i) => numbersIn(JSON.stringify(i.raw)).includes(5) },
];

it('#1956.fd7b382f a planted migration with depth out of range, a call outside the function list and a read of old.height is refused naming all three params with their reasons', () => {
  const [packs] = run(bin(), scenario(evidence(), [PACKS], { packs: [V1, V2_THREE_FAULTS] }));
  expect(packRow(packs!, V1).state, 'acme/shelf@1.0.0 installs').toBe('installed');
  none(faultFailures(packRow(packs!, V2_THREE_FAULTS), V2_THREE_FAULTS, FAULTS), `the three-fault migration ${at(V2_THREE_FAULTS)}`);
}, 1_800_000);

it('#1956.fd7b382f a planted check that stops at the first fault names one param and fails this test', () => {
  const [packs] = run(bin(), scenario(evidence(), [PACKS], { packs: [V1, V2_THREE_FAULTS], planted: STOPS_AT_FIRST }));
  const row = packRow(packs!, V2_THREE_FAULTS);
  expect(row.state, `with ${STOPS_AT_FIRST}, ${at(V2_THREE_FAULTS)} is still refused at its first fault`).toBe('refused');
  const failures = faultFailures(row, V2_THREE_FAULTS, FAULTS);
  expect(failures.length, `${STOPS_AT_FIRST} names one of the three params, so the check fails naming the other two:\n  ${failures.join('\n  ')}`).toBe(2);
}, 1_800_000);
