// #202.ee304566: "A kind that declares a cost at defaults of 0.10 ms of CPU, whose expansion the check estimates at 0.20
// ms, fails cost_understated, naming the kind; and a planted expander that walks a kind's inputs in hash-map order
// expands its example to different bytes twice and fails the kit's determinism part, naming the example"
//
// asserts: in `r1,test-weight` (the test canvas module test.weight, whose item kind test.weight@1 costs 0.20 ms of CPU
// per item in the cost model), acme/costly@1.0.0's costly.unit@1, which declares cpu_ms 0.10 at its defaults and
// expands into one test.weight@1 item, is refused at its pack check with an error cost_understated naming
// costly.unit@1; acme/shelf@1.0.0, installed beside it, passes its kit (each example expanded twice to the same bytes),
// and under the scenario's `planted: "expander_hash_map_order"` it is refused, the refusal naming the determinism part
// and an example of shelf.bookcase@1 by its hash.
// Wrong programs: the planted expander (named) and the cost kind (a kit that admits it fails this test); the merge base
// (no test-weight feature; shelf refused for its `kinds` field).

import { expect, it } from 'vitest';
import {
  COSTLY, PACKS, SHELF, WEIGHT, assetShas, determinismFailures, failsNaming, none, packRow, refusalFailures, run, scenario, useBuilds, useEvidence,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([WEIGHT]);
const evidence = useEvidence();

const packs = (planted?: string): JsonObject =>
  run(builds.bin(WEIGHT), scenario(evidence(), [PACKS], { packs: [COSTLY, SHELF], planted }))[0]!;

it('#202.ee304566 a kind declaring 0.10 ms of CPU whose expansion the check estimates at 0.20 ms fails cost_understated naming the kind, while each example of shelf.bookcase@1 expands to the same bytes twice', () => {
  const reply = packs();
  none(refusalFailures(packRow(reply, COSTLY), COSTLY, ['costly.unit@1'], 'cost_understated'), 'costly.unit@1, which declares 0.10 ms of CPU and expands into 0.20 ms');
  none(determinismFailures(packRow(reply, SHELF), SHELF), 'the kit\'s determinism part on shelf.bookcase@1\'s examples');
}, 1_800_000);

it('#202.ee304566 a planted expander that walks a kind\'s inputs in hash-map order expands its example to different bytes twice and fails the kit\'s determinism part, naming the example', () => {
  const failures = determinismFailures(packRow(packs('expander_hash_map_order'), SHELF), SHELF);
  failsNaming(failures, ['determinism'], 'the expander that walks inputs in hash-map order');
  const hashes = assetShas(SHELF);
  expect(failures.some((f) => hashes.some((h) => f.includes(h))), `the refusal names an example of shelf.bookcase@1 by its hash (${hashes.join(', ')}):\n  ${failures.join('\n  ')}`).toBe(true);
}, 1_800_000);
