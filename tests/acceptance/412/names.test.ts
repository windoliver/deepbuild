// AC1: "deep_kinds answers a tool-word pack's word with the mapped kind and its conversion, or no_match, and never
// invents a mapping"
//
// AC11: "An item of kind `circel@1` is refused with `unknown_kind` naming `circle@1` among at most three close names,
// and a field `centre` on circle@1 with `unknown_field` naming `center`; a planted validator that names no close name
// fails the fixture"
//
// AC17: "With ring@2 renaming thick to stroke_width, an item `ring@2 {thick: 3}` is refused with `unknown_field` whose
// first name is stroke_width, with `renamed_in: ring@2`, ahead of any close name; a planted validator that ranks
// names by spelling alone never offers stroke_width and fails, naming the field"
//
// asserts: AC1: in `core` with test/words installed (its aliases map Circle → circle@1 and Rectangle → rect@1, each
// with a stated conversion), deep_kinds `word` answers each word with that target, that conversion and the pack;
// Circel, Rect and Spline, which no alias maps (Rect and Circel spell kinds that exist), answer no_match with no
// target. AC11: alpha's deep_show of a board holding a `circel@1` item flags unknown_kind on it, with close names
// (at most three) holding circle@1; one holding a circle@1 with `centre` flags unknown_field naming center and is
// refused. `--planted validator_without_close` fails both checks, naming circel@1 and centre. AC17: in
// `core,test-ring-b` a board with `ring@2 {center, r, thick: 3}` is refused with unknown_field on thick whose first
// close name is stroke_width with renamed_in ring@2; `--planted close_by_spelling` fails that check, naming thick.

import { describe, expect, it } from 'vitest';
import {
  CORE, DOC, WORDS, answer, board, circle, closeNameFailures, failsNaming, kinds, none, obj, packAt, readJson, run, scenario, show, showDoc,
  useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';
import { join } from 'node:path';

const RING_B: Build = { set: 'core', with: ['test-ring-b'] };
const builds = useBuilds([CORE, RING_B]);
const evidence = useEvidence();

const aliases = obj(obj(readJson(join(WORDS.dir, 'pack.json')), 'the words pack')['aliases'], 'the words pack: aliases');

describe('AC1 deep_kinds answers a tool-word pack\'s word with the mapped kind and its conversion, or no_match, and never invents a mapping', () => {
  it('AC1 each word the pack maps answers its target kind, its stated conversion and the pack', () => {
    const words = Object.keys(aliases);
    const replies = run(builds.bin(CORE), scenario(evidence(), words.map((word) => kinds('word', { word })), { packs: [WORDS] }));
    words.forEach((word, i) => {
      const alias = obj(aliases[word], `alias ${word}`);
      const reply = answer(replies[i]!, `deep_kinds word ${word}`);
      expect([reply['word'], reply['target'], reply['conversion'], reply['pack']], `${word}: the mapped kind, its conversion as the pack states it, and the pack (${show(reply)})`)
        .toEqual([word, alias['target'], alias['conversion'], packAt(WORDS)]);
      expect(reply['code'], `${word} is a match`).toBeUndefined();
    });
  }, 1_800_000);

  it('AC1 a word no alias maps answers no_match with no target, even where it spells a kind that exists', () => {
    const words = ['Circel', 'Rect', 'Spline'];
    const replies = run(builds.bin(CORE), scenario(evidence(), words.map((word) => kinds('word', { word })), { packs: [WORDS] }));
    words.forEach((word, i) => {
      const reply = answer(replies[i]!, `deep_kinds word ${word}`);
      expect(reply['code'], `${word}: no_match (${show(reply)})`).toBe('no_match');
      expect([reply['target'], reply['conversion']], `${word}: no invented mapping`).toEqual([undefined, undefined]);
    });
  }, 1_800_000);
});

const CIRCEL: JsonObject = board('A misspelt kind', [circle('c1', 'circel@1', { center: [100, 100], r: 40, paint: { fill: { role: 'accent' } } })]);
const CENTRE: JsonObject = board('A misspelt field', [circle('c2', 'circle@1', { centre: [100, 100], r: 40, paint: { fill: { role: 'accent' } } })]);
const kindCheck = (reply: JsonObject): string[] => closeNameFailures(reply, { code: 'unknown_kind', id: 'c1', at: 'kind', name: 'circle@1', subject: 'circel@1' });
const fieldCheck = (reply: JsonObject): string[] => closeNameFailures(reply, { code: 'unknown_field', id: 'c2', at: 'centre', name: 'center', subject: 'centre' });

describe('AC11 unknown_kind and unknown_field name up to three close names', () => {
  it('AC11 an item of kind circel@1 is flagged unknown_kind naming circle@1 among at most three close names', () => {
    const [reply] = run(builds.bin(CORE), scenario(evidence(), [showDoc(DOC.a, CIRCEL)]));
    none(kindCheck(reply!), 'circel@1');
  }, 1_800_000);

  it('AC11 a field centre on circle@1 is refused with unknown_field naming center among at most three close names', () => {
    const [reply] = run(builds.bin(CORE), scenario(evidence(), [showDoc(DOC.b, CENTRE)]));
    expect(reply!['outcome'], `the board is refused: ${show(reply)}`).toBe('refused');
    none(fieldCheck(reply!), 'centre');
  }, 1_800_000);

  it('AC11 a planted validator that names no close name fails the fixture, naming circel@1 and centre', () => {
    const [kind, field] = run(builds.bin(CORE), scenario(evidence(), [showDoc(DOC.a, CIRCEL), showDoc(DOC.b, CENTRE)]), 'validator_without_close');
    failsNaming(kindCheck(kind!), ['circel@1'], 'the planted validator on circel@1');
    failsNaming(fieldCheck(field!), ['centre'], 'the planted validator on centre');
  }, 1_800_000);
});

const THICK: JsonObject = board('A renamed field', [{ id: 'r1', kind: 'ring@2', name: 'Ring', order: 'a0', params: { center: [120, 120], r: 50, thick: 3 } }], { requires: { modules: { 'test.ring': '^1' } } });
const renameCheck = (reply: JsonObject): string[] => closeNameFailures(reply, { code: 'unknown_field', id: 'r1', at: 'thick', name: 'stroke_width', subject: 'thick', first: true, renamed_in: 'ring@2' });

describe('AC17 an unknown_field a rename record names is refused with its replacement first, with renamed_in', () => {
  it('AC17 ring@2 {thick: 3} is refused with unknown_field whose first name is stroke_width, renamed_in ring@2', () => {
    const [reply] = run(builds.bin(RING_B), scenario(evidence(), [showDoc(DOC.a, THICK)]));
    expect(reply!['outcome'], `the ring is refused: ${show(reply)}`).toBe('refused');
    none(renameCheck(reply!), 'thick on ring@2');
  }, 1_800_000);

  it('AC17 a planted validator that ranks names by spelling alone never offers stroke_width first, and fails, naming thick', () => {
    const [reply] = run(builds.bin(RING_B), scenario(evidence(), [showDoc(DOC.a, THICK)]), 'close_by_spelling');
    failsNaming(renameCheck(reply!), ['thick'], 'the planted validator ranking by spelling');
  }, 1_800_000);
});
