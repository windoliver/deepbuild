// #387.15327229: the same document reached through two different patch histories gets byte-identical
// content keys and cache hits, and no key contains an epoch or any other change counter
// (parity/kernel/key-history.scene). Histories are whole revisions through deep_show, each followed by a
// frame, so epochs and revision numbers differ between the two (README: Readings). The wrong program: a
// key holding an epoch, a revision number or a count of revisions. At the base there is no `eval`.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DOC, dropped, edit, evalCall, evaluated, fixture, obj, run, sameNodes, scenario, show, useBuilds, useEvidence,
  type Build, type Evaluated, type JsonObject, type JsonValue,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** The fast-check seed of the generated detours, recorded so a failure replays. */
const SEED = 387_0004;

const scene = fixture('parity/kernel/key-history.scene');
const FINAL = obj(scene['document'], 'the scene\'s document');
const T = String(scene['t']);


/** The calls that walk `doc` through `documents`, a frame at T after each revision. */
function walk(id: string, documents: readonly JsonObject[]): JsonObject[] {
  const calls: JsonObject[] = [];
  let before: JsonObject | null = null;
  for (const d of documents) {
    calls.push(show(d, { doc: id, removes: dropped(before, d) }), evalCall(id, { t: T }));
    before = d;
  }
  return calls;
}

describe('#387.15327229 the same document reached through two different patch histories gets byte-identical content keys and cache hits, and no key contains an epoch or any other change counter', () => {
  it(`#387.15327229 generated detours of 0 to 6 revisions to the same document, on two documents in one process and in a fresh one, give byte-identical keys (fast-check seed ${SEED}, 25 runs)`, () => {
    const editArb = fc.record({ item: fc.constantFrom('a', 'b', 'c'), index: fc.integer({ min: 0, max: 3 }), value: fc.integer({ min: 4, max: 200 }) })
      .map((e): Record<string, JsonValue> => ({ [`items/${e.item}/params/box/${e.index}`]: e.value }));
    const detour = fc.array(fc.oneof(editArb, fc.constantFrom<Record<string, JsonValue>>({ 'items/lbl/params/text': 'Elsewhere' }, { 'items/lbl/params/text': 'Settled' })), { maxLength: 6 });
    const path = (edits: Record<string, JsonValue>[]): JsonObject[] => {
      const out: JsonObject[] = [];
      let d = FINAL;
      for (const e of edits) { d = edit(d, e); out.push(d); }
      return [...out, FINAL];
    };
    let reference: Evaluated | undefined;
    fc.assert(fc.property(detour, detour, (x, y) => {
      const a = path(x);
      const b = path(y);
      const replies = run(builds.bin(FULL), scenario(evidence(), [...walk(DOC.a, a), ...walk(DOC.b, b)]));
      const lastA = evaluated(replies[2 * a.length - 1]!, 'the first detour\'s last frame');
      const lastB = evaluated(replies[2 * a.length + 2 * b.length - 1]!, 'the second detour\'s last frame');
      expect(sameNodes(lastA, lastB, `detours of ${a.length - 1} and ${b.length - 1} revisions`), 'one document, one set of keys, whatever the history').toEqual([]);
      reference ??= evaluated(run(builds.bin(FULL), scenario(evidence(), [show(FINAL), evalCall(DOC.a, { t: T })]))[1]!, 'a fresh process\'s one revision');
      expect(sameNodes(reference, lastA, 'a history against no history', { key: true, result: true }), 'the same keys as a process with no history').toEqual([]);
    }), { seed: SEED, numRuns: 25, endOnFailure: true });
  }, 1_800_000);
});
