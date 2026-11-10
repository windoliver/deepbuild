// #202.22a0fc71: "The kit also holds the boundary pair {width 1.81, dividers 1}, which fails shelf.span, and {width
// 1.79, dividers 1}, which passes; a planted rule written width ≤ 0.95 × (dividers + 1) passes the {2.0, 1} twin, fails
// this pair and is refused, naming shelf.span"
//
// asserts: in `r1`, deep_kinds lists shelf.bookcase@1's kit result PASS with the planted twin {width 1.81, dividers 1}
// (by its hash) expecting and raising shelf.span, and the clean example {width 1.79, dividers 1} (by its hash) raising
// nothing; and the planted twin pack fixtures/packs/shelf-1.0.0-rule-095 (shelf.span written `width <= 0.95 *
// (dividers + 1)`, every other file the same) is refused at its pack check with an error naming shelf.span.
// Wrong programs: the planted rule (a kit that tests only the {2.0, 1} twin admits it and fails this test), and the
// merge base (shelf refused for its `kinds` field).

import { expect, it } from 'vitest';
import {
  BOOKCASE, PACKS, R1, SHELF, SHELF_RULE_095, SPAN, assetSha, kindEntry, kitOf, listed, none, packRow, refusalFailures, run, scenario, show, useBuilds,
  useEvidence,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();

it('#202.22a0fc71 the kit holds the boundary pair: {width 1.81, dividers 1} fails shelf.span and {width 1.79, dividers 1} passes, and a planted rule width <= 0.95 × (dividers + 1) is refused naming shelf.span', () => {
  const bin = builds.bin(R1);
  const kit = kitOf(listed(kindEntry(bin, evidence(), BOOKCASE, { packs: [SHELF] }), BOOKCASE), BOOKCASE);
  expect(kit.verdict, `the kit passes: ${show(kit.raw)}`).toBe('PASS');
  const w181 = assetSha(SHELF, 'examples/width-1.81.json');
  const w179 = assetSha(SHELF, 'examples/width-1.79.json');
  const twin = kit.twins.find((t) => t.example === w181);
  expect(twin, `the kit holds the twin {width 1.81, dividers 1} by its hash ${w181}: ${show(kit.raw)}`).toBeDefined();
  expect([twin!.expect, twin!.raised.includes(SPAN)], '{width 1.81, dividers 1} fails shelf.span in the kit').toEqual([SPAN, true]);
  const clean = kit.examples.find((e) => e.example === w179);
  expect(clean, `the kit holds the example {width 1.79, dividers 1} by its hash ${w179}: ${show(kit.raw)}`).toBeDefined();
  expect(clean!.raised, '{width 1.79, dividers 1} passes every rule in the kit').toEqual([]);

  const [planted] = run(bin, scenario(evidence(), [PACKS], { packs: [SHELF_RULE_095] }));
  none(refusalFailures(packRow(planted!, SHELF_RULE_095), SHELF_RULE_095, [SPAN]), 'the planted rule width <= 0.95 × (dividers + 1), which passes the 1.81 m twin');
}, 1_800_000);
