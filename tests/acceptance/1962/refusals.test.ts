// #1962.248e8322: "A `moved` entry whose target is itself moved, one that loops back to its source, and one whose
// target pack isn't in `requires.packs` are each refused at pack check, naming the entry and the reason"
//
// asserts: in `r1`, three processes, each with its own store, earlier versions offered first (each fixture checked
// first to declare exactly its one `moved` entry):
// - target itself moved: with acme/shelf@1.2.0, acme/furniture@1.0.0 and acme/furniture@3.0.0 installed (3.0.0 moves
//   furniture.case@1 on to furniture/cabinet@1), acme/shelf@2.0.0 of fixtures/packs/shelf-2.0.0-chain (requires.packs
//   [furniture@3.0.0], moved {shelf.bookcase@2: furniture/case@1}) is refused by an error `out_of_range` at
//   `moved/shelf.bookcase@2` whose reason is `target_moved`;
// - a loop: with acme/shelf@1.2.0 installed, shelf-2.0.0-loop (moved {shelf.bookcase@2: shelf/bookcase@2}) is refused
//   by an error `cycle` at `moved/shelf.bookcase@2` whose reason is `loop`;
// - an undeclared pack: with acme/shelf@1.2.0 and acme/furniture@1.0.0 installed, so the target kind exists in the
//   store, shelf-2.0.0-undeclared (no requires.packs, moved {shelf.bookcase@2: furniture/case@1}) is refused by an
//   error `ref_unresolved` at `moved/shelf.bookcase@2` whose reason is `undeclared_pack`.
// The entry's place and its reason are this job's spellings (README: Choices).
// Wrong programs: the merge base, whose pack check refuses every version that carries `moved` as unknown_field at
// `moved`, naming no entry and no reason (furniture@3.0.0 among them); a check that admits a planted entry, or
// refuses it without its place or with another reason.

import { expect, it } from 'vitest';
import {
  FURNITURE_10, FURNITURE_30, OLD_KIND, PACKS, SHELF_12, SHELF_20_CHAIN, SHELF_20_LOOP, SHELF_20_UNDECLARED, at, installFailures, manifestOf, none,
  refusalFailures, run, scenario, useBinary, useEvidence, where, type PackFixture,
} from './helpers.ts';

const bin = useBinary();
const evidence = useEvidence();

/** A planted version's one `moved` entry and its `requires.packs`, as its fixture must hold them. */
function checkMoved(p: PackFixture, target: string, requires: string[] | undefined): void {
  const m = manifestOf(p);
  expect(m['moved'], `the fixture: ${where(p)} declares moved {shelf.bookcase@2: ${target}}`).toEqual({ [OLD_KIND]: target });
  expect(at(m, 'requires', 'packs'), `the fixture: ${where(p)}'s requires.packs`).toEqual(requires);
}

it('#1962.248e8322 a moved entry whose target is itself moved, one that loops back to its source, and one whose target pack isn\'t in requires.packs are each refused at pack check, naming the entry and the reason', () => {
  const b = bin();
  checkMoved(SHELF_20_CHAIN, 'furniture/case@1', ['furniture@3.0.0']);
  checkMoved(SHELF_20_LOOP, 'shelf/bookcase@2', undefined);
  checkMoved(SHELF_20_UNDECLARED, 'furniture/case@1', undefined);
  expect(manifestOf(FURNITURE_30)['moved'], 'the fixture: acme/furniture@3.0.0 moves furniture.case@1 on to furniture/cabinet@1').toEqual({ 'furniture.case@1': 'furniture/cabinet@1' });

  const [chain] = run(b, scenario(evidence(), [PACKS], { packs: [SHELF_12, FURNITURE_10, FURNITURE_30, SHELF_20_CHAIN] }));
  const [loop] = run(b, scenario(evidence(), [PACKS], { packs: [SHELF_12, SHELF_20_LOOP] }));
  const [undeclared] = run(b, scenario(evidence(), [PACKS], { packs: [SHELF_12, FURNITURE_10, SHELF_20_UNDECLARED] }));
  none([
    ...installFailures(chain!, [SHELF_12, FURNITURE_10, FURNITURE_30]),
    ...refusalFailures(chain!, { p: SHELF_20_CHAIN, reason: 'target_moved', code: 'out_of_range' }),
    ...installFailures(loop!, [SHELF_12]),
    ...refusalFailures(loop!, { p: SHELF_20_LOOP, reason: 'loop', code: 'cycle' }),
    ...installFailures(undeclared!, [SHELF_12, FURNITURE_10]),
    ...refusalFailures(undeclared!, { p: SHELF_20_UNDECLARED, reason: 'undeclared_pack', code: 'ref_unresolved' }),
  ], 'each planted moved entry, at its pack check');
}, 1_800_000);
