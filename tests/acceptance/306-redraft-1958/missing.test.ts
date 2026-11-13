// AC3: "A document that names a pack version this build lacks is refused with pack_missing, naming the
// pack and the version, never drawn with another version, and a check that needs it is BLOCKED; the pack
// versions task later opens such a document and keeps that pack's instances byte for byte"
// #1958, Scope: "A version whose bytes are gone: the document opens; each instance of it is kept byte for byte
// through other writers' patches and skipped when drawing with pack_missing, naming the pack and the version; … a
// check that touches one is BLOCKED; nothing draws one with another version; this replaces the whole-document
// refusal the pack format task describes (#306)"
//
// Blind redraft of tests/acceptance/306/missing.test.ts after #1958 (REDRAFT.md). #306's scenario as it was: in the
// build without scene3d, with test/chart@1.0.0 installed, a board naming test/chart@2.0.0 (a version the store
// lacks) with c1 {n: 5}; and with no pack installed, a board naming test/chart@1.0.0. Only the refusal half changes.
//
// asserts: the board opens (`presented`, no error) instead of being refused; a `pack_missing` (a notice, an issue or
// a blocked row) names the pack and the version, its `ids` exactly [c1]; c1 has no `expansions` row, so it was never
// drawn with another version (1.0.0, installed in the first test); the snapshot is the same board with c1 left out
// (and no pack named), drawn in the same process, so c1 was skipped when drawing; `read` gives c1 as it was sent, less
// the `layer` the hub stamps, so it was kept byte for byte; and the board's `deep show --check` from your shell is
// BLOCKED, in the first test also with a `pack_missing` naming the pack and 2.0.0 and no expansion of c1 (as #306's
// first test read the check's reply).

import { describe, expect, it } from 'vitest';
import {
  CHART, DOC, R1, asSent, board, canon, check, errors, expansionRow, instance, issues, mentions, outcome, packAt, packMissing, read, readItems,
  run, scenario, shot, show, useBuilds, useEvidence, type JsonObject, type PackFixture,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();
const MISSING = { id: 'test/chart', version: '2.0.0' };

const C1 = instance('c1', 'chart.bars@1', { n: 5 }, 'a0', [40, 40]);
const bars = (pack: string) => board('Bars', [pack], [C1]);
/** The same board with c1 left out, naming no pack: what the board draws when c1 is skipped. */
const withoutC1 = () => board('Bars', [], []);

/** The board naming `pack@version` opened: presented, c1 skipped with pack_missing naming both, never expanded, kept as sent. */
function opensSkipped(shown: JsonObject, others: JsonObject, kept: JsonObject, pack: string, version: string, what: string): void {
  expect(outcome(shown), `${what} opens (presented), not refused whole: ${JSON.stringify(shown['issues'] ?? null).slice(0, 600)}`).toBe('presented');
  expect(errors(issues(shown, what)).map((i) => i.raw), `${what} opens with no error`).toEqual([]);
  const missing = packMissing(shown, what).filter((m) => mentions(m.raw, pack) && mentions(m.raw, version));
  expect(missing.some((m) => canon([...m.ids].sort()) === canon(['c1'])), `${what}: c1 is skipped with a pack_missing naming the pack ${pack} and the version ${version}, its ids [c1]: ${JSON.stringify(packMissing(shown, what).map((m) => m.raw)).slice(0, 600)}`).toBe(true);
  expect(expansionRow(shown, 'c1'), `${what}: c1 has no expansion, so it is never drawn with another version`).toBeUndefined();
  expect(outcome(others), `the same board without c1 is presented: ${JSON.stringify(others['issues'] ?? null).slice(0, 600)}`).toBe('presented');
  const alone = shot(others, 'the same board without c1');
  expect(alone, 'the same board without c1 draws one snapshot').not.toBe('');
  expect(shot(shown, what), `${what} draws one snapshot, the same as the board without c1: c1 is skipped when drawing`).toBe(alone);
  const c1 = asSent(readItems(kept, `read of ${what}`)['c1'], `read of ${what}: c1`);
  expect(canon(c1), `${what} keeps c1 byte for byte as it was sent`).toBe(canon(C1));
}

describe('AC3 a document naming a pack version this build lacks opens with that pack\'s instances kept and skipped with pack_missing, and its check is BLOCKED (redraft 1958)', () => {
  it('AC3 with 1.0.0 installed, a board naming test/chart@2.0.0 opens, c1 kept and skipped with pack_missing naming the pack and 2.0.0, never drawn with 1.0.0, its check BLOCKED (redraft 1958)', () => {
    const [shown, others, kept, checked] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main', [DOC.b]: 'main', [DOC.c]: 'main' }, [CHART], [
      show(bars(`${MISSING.id}@${MISSING.version}`), { pixels: true }),
      show(withoutC1(), { doc: DOC.c, pixels: true }),
      read(DOC.a),
      check(bars(`${MISSING.id}@${MISSING.version}`), { doc: DOC.b }),
    ]));
    opensSkipped(shown!, others!, kept!, MISSING.id, MISSING.version, 'the board naming test/chart@2.0.0');
    expect(checked!['result'], `the check of a document that needs the missing pack is BLOCKED: ${JSON.stringify(checked).slice(0, 600)}`).toBe('BLOCKED');
    const named = packMissing(checked!, 'the check').filter((m) => mentions(m.raw, MISSING.id) && mentions(m.raw, MISSING.version));
    expect(named.length, `the check of the board naming test/chart@2.0.0 has a pack_missing naming the pack and 2.0.0: ${JSON.stringify(checked).slice(0, 600)}`).toBeGreaterThan(0);
    expect(expansionRow(checked!, 'c1'), 'the check never expands c1 with another version').toBeUndefined();
  });

  it('AC3 with no pack installed, a board naming test/chart@1.0.0 opens, c1 kept and skipped with pack_missing naming the pack and 1.0.0, and its check is BLOCKED (redraft 1958)', () => {
    const none: PackFixture[] = [];
    const [shown, others, kept, checked] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main', [DOC.b]: 'main', [DOC.c]: 'main' }, none, [
      show(bars(packAt(CHART)), { pixels: true }),
      show(withoutC1(), { doc: DOC.c, pixels: true }),
      read(DOC.a),
      check(bars(packAt(CHART)), { doc: DOC.b }),
    ]));
    opensSkipped(shown!, others!, kept!, CHART.id, CHART.version, 'the board naming test/chart@1.0.0 in a store without it');
    expect(checked!['result'], 'its check is BLOCKED').toBe('BLOCKED');
  });
});
