// #202.9f697217: "shelf.bookcase@1's rule shelf.span, width ≤ 0.9 × (dividers + 1), passes on {width 1.6, dividers 1}
// and fails on {width 2.0, dividers 1} with the issue shelf.span, naming the item and the fix; its planted twin example
// {width 2.0, dividers 1} fails with shelf.span in the kit; and a planted rule written width ≤ 100 lets its twin pass,
// so the kit fails and the pack is refused, naming shelf.span"
//
// asserts: in `r1`, a board naming acme/shelf@1.0.0 with s1 {width 1.6, dividers 1} and s2 {width 2.0, dividers 1}
// raises exactly one shelf.span issue, its ids [s2] and its fix the rule's; deep_kinds lists the kit's twin of the
// {width 2.0, dividers 1} example (by its hash) expecting shelf.span and raising it; and the planted twin pack
// fixtures/packs/shelf-1.0.0-rule-100 (shelf.span written `width <= 100`, every other file the same) is refused at its
// pack check with an error naming shelf.span.
// Wrong programs: the planted rule (a kit that admits it fails this test), and the merge base (shelf refused for its
// `kinds` field, so nothing expands and nothing is listed).

import { expect, it } from 'vitest';
import {
  BOOKCASE, DOC, PACKS, R1, SHELF, SHELF_RULE_100, SPAN, assetSha, board, declaredRule, issues, item, kindEntry, kitOf, listed, none, packAt, packRow,
  present, refusalFailures, run, scenario, show, str, useBuilds, useEvidence,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();

it('#202.9f697217 shelf.span passes {width 1.6, dividers 1}, fails {width 2.0, dividers 1} naming the item and the fix, its twin fails with shelf.span in the kit, and a planted rule width <= 100 is refused naming shelf.span', () => {
  const bin = builds.bin(R1);
  const fix = str(declaredRule(SHELF, BOOKCASE, SPAN)['fix'], 'shelf.span\'s fix');
  const [packs, shown] = run(bin, scenario(evidence(), [
    PACKS,
    present(DOC.a, board('Two bookcases', [packAt(SHELF)], [
      item('s1', BOOKCASE, { width: 1.6, dividers: 1 }, 'a0', [20, 20]),
      item('s2', BOOKCASE, { width: 2.0, dividers: 1 }, 'a1', [20, 200]),
    ])),
  ], { packs: [SHELF] }));
  expect(packRow(packs!, SHELF).state, `acme/shelf@1.0.0 installs: ${show(packs!)}`).toBe('installed');
  const span = issues(shown!).filter((i) => i.code === SPAN);
  expect(span.map((i) => i.ids), `shelf.span holds on s1 {1.6, 1} and fails on s2 {2.0, 1}, one issue naming s2: ${show(shown!['issues'] ?? null)}`).toEqual([['s2']]);
  expect(span[0]!.fix, 'the issue carries the rule\'s fix').toContain(fix);

  const kit = kitOf(listed(kindEntry(bin, evidence(), BOOKCASE, { packs: [SHELF] }), BOOKCASE), BOOKCASE);
  const w200 = assetSha(SHELF, 'examples/width-2.0.json');
  const twin = kit.twins.find((t) => t.example === w200);
  expect(twin, `the kit lists the planted twin {width 2.0, dividers 1} by its hash ${w200}: ${show(kit.raw)}`).toBeDefined();
  expect([twin!.expect, twin!.raised.includes(SPAN)], 'the twin expects shelf.span and fails with it in the kit').toEqual([SPAN, true]);

  const [planted] = run(bin, scenario(evidence(), [PACKS], { packs: [SHELF_RULE_100] }));
  none(refusalFailures(packRow(planted!, SHELF_RULE_100), SHELF_RULE_100, [SPAN]), 'the planted rule width <= 100, which lets its twin pass');
}, 1_800_000);
