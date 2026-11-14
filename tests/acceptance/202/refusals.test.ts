// #202.84e9c56a: "A pack kind that declares builder: slab, or an array, is refused at pack check, naming the kind and
// the field; a kind in shelf named slab@1 or puppet.rig@1 is refused, naming the kind it would take; and the
// module-set digest is the same with shelf installed and without it, so a pack kind never enters the sealed set"
//
// asserts: in `r1`, with acme/shelf@1.0.0 installed beside it, acme/shelf@1.0.1 (shelf.panel@1 declares builder: slab)
// is refused with an error naming shelf.panel@1 and builder; acme/shelf@1.0.2 (shelf.grid@1 declares arrays) with one
// naming shelf.grid@1 and arrays; acme/shelf@1.0.3 (a kind named slab@1) with one naming slab@1; acme/shelf@1.0.4 (a
// kind named puppet.rig@1) with one naming puppet.rig@1. deep_kinds lists shelf.bookcase@1 with shelf installed and
// not without it, and the module-set digest (deep_kinds' `module_set`, and `set_digest` on the `registry` reply) is
// the same in both processes.
// Wrong program: the merge base, which refuses every one of these packs for its `kinds` field alone (`unknown_field` at
// the path `kinds`, left out of the refusals read here), so shelf.bookcase@1 is never listed.

import { expect, it } from 'vitest';
import {
  BOOKCASE, PACKS, R1, REGISTRY, SHELF, SHELF_ARRAYS, SHELF_BUILDER, SHELF_PUPPET, SHELF_SLAB, kindEntry, none, packRow, refusalFailures, run, scenario,
  sealedOf, show, useBuilds, useEvidence,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();

it('#202.84e9c56a a pack kind declaring builder: slab or an array, or named slab@1 or puppet.rig@1, is refused naming the kind and the field or the name it would take, and the module-set digest is the same with shelf installed and without it', () => {
  const bin = builds.bin(R1);
  const [packs, registryWith] = run(bin, scenario(evidence(), [PACKS, REGISTRY], { packs: [SHELF, SHELF_BUILDER, SHELF_ARRAYS, SHELF_SLAB, SHELF_PUPPET] }));
  expect(packRow(packs!, SHELF).state, `the control: acme/shelf@1.0.0 installs beside them: ${show(packs!)}`).toBe('installed');
  none(refusalFailures(packRow(packs!, SHELF_BUILDER), SHELF_BUILDER, ['shelf.panel@1', 'builder']), 'a pack kind that declares builder: slab');
  none(refusalFailures(packRow(packs!, SHELF_ARRAYS), SHELF_ARRAYS, ['shelf.grid@1', 'arrays']), 'a pack kind that declares an array');
  none(refusalFailures(packRow(packs!, SHELF_SLAB), SHELF_SLAB, ['slab@1']), 'a kind in shelf named slab@1');
  none(refusalFailures(packRow(packs!, SHELF_PUPPET), SHELF_PUPPET, ['puppet.rig@1']), 'a kind in shelf named puppet.rig@1');

  const [registryWithout] = run(bin, scenario(evidence(), [REGISTRY]));
  const withShelf = kindEntry(bin, evidence(), BOOKCASE, { packs: [SHELF] });
  const without = kindEntry(bin, evidence(), BOOKCASE);
  expect(withShelf.entry, 'deep_kinds lists shelf.bookcase@1 with shelf installed').toBeDefined();
  expect(without.entry, 'and not without it').toBeUndefined();
  expect(withShelf.moduleSet, 'deep_kinds\' module-set digest is the same with shelf installed and without it').toBe(without.moduleSet);
  expect(sealedOf(registryWith!).setDigest, 'the registry\'s set_digest is the same with shelf installed and without it').toBe(sealedOf(registryWithout!).setDigest);
}, 1_800_000);
