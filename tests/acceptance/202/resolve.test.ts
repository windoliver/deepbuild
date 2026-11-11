// #202.e054c7a0: "A document that names a pack resolves the pack's recipe-backed kind at check after the registry has
// sealed"
//
// asserts: in `r1`, one process answers `registry` sealed (state sealed or ready, the seal run once); then
// `install_pack` installs acme/shelf@1.0.0; then a board naming the pack with b1, a shelf.bookcase@1 at its defaults,
// is checked and b1 resolves through acme/shelf@1.0.0 as the kind shelf.bookcase@1, expanding into its 2 sides, 4
// boards and 1 divider; and `registry` after it shows the seal still run once, with the same module-set digest.
// Wrong program: the merge base, whose pack check refuses shelf for its `kinds` field, so the board names a missing pack.

import { expect, it } from 'vitest';
import {
  BOOKCASE, DOC, R1, REGISTRY, SHELF, board, derivedIds, expansionOf, installPack, item, packAt, present, run, scenario, sealedOf, show, sorted,
  useBuilds, useEvidence,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();

it('#202.e054c7a0 a document naming acme/shelf@1.0.0 resolves its recipe-backed kind shelf.bookcase@1 at check, after the registry sealed', () => {
  const [before, install, shown, after] = run(builds.bin(R1), scenario(evidence(), [
    REGISTRY,
    installPack(SHELF),
    present(DOC.a, board('A bookcase at its defaults', [packAt(SHELF)], [item('b1', BOOKCASE, {}, 'a0')])),
    REGISTRY,
  ]));
  const sealed = sealedOf(before!, 'registry before the pack');
  expect(['sealed', 'ready'], `the registry has sealed before the pack is installed: ${sealed.state}`).toContain(sealed.state);
  expect(sealed.sealRuns, 'the seal ran once, at startup').toBe(1);
  expect(install!['outcome'], `acme/shelf@1.0.0 installs after the seal: ${show(install!)}`).toBe('installed');
  const e = expansionOf(shown!, 'b1');
  expect([e.kind, e.pack], 'b1 resolves at check through the pack the document names, as its recipe-backed kind').toEqual([BOOKCASE, packAt(SHELF)]);
  expect(sorted(Object.keys(e.derived)), 'and expands into 2 sides, 4 boards and 1 divider at its defaults')
    .toEqual(sorted([...derivedIds('b1', 'sides', 2), ...derivedIds('b1', 'boards', 4), ...derivedIds('b1', 'dividers', 1)]));
  const later = sealedOf(after!, 'registry after the document');
  expect([later.sealRuns, later.setDigest], 'the seal didn\'t run again for the pack\'s kind, and its module-set digest is unchanged').toEqual([1, sealed.setDigest]);
}, 1_800_000);
