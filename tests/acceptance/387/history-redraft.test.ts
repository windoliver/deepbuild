// #387.15327229 (blind redraft of history.test.ts's first test; A4-REDRAFT.md): the same document reached
// through two different patch histories gets byte-identical content keys and cache hits, and no key
// contains an epoch or any other change counter (parity/kernel/key-history.scene). deep_show stamps the
// call's doc ID into the document's `id`, and a revision's hash is the sha256 of that canonical document
// (Revision), so "both histories reach the same document" is checked per doc ID: each history's last
// revision has the hash a fresh process gets for the scene's document shown once under that history's doc
// ID. Keys, results, the cache hits and the run-nothing check are the first draft's. The wrong program: a
// key holding an epoch, a revision number or a count of revisions. At the base there is no `eval`.
import { describe, expect, it } from 'vitest';
import {
  DOC, currentHash, dropped, edit, evalCall, evaluated, fixture, obj, presented, revisionsOf, run, sameNodes, scenario, show, useBuilds, useEvidence,
  type Build, type JsonObject, type JsonValue,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();

const scene = fixture('parity/kernel/key-history.scene');
const FINAL = obj(scene['document'], 'the scene\'s document');
const T = String(scene['t']);

interface History { start: Record<string, JsonValue>; revisions: Record<string, JsonValue>[] }
const history = (name: string): History => obj(obj(scene['histories'], 'histories')[name], `history ${name}`) as unknown as History;

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
/** The documents a history's revisions make, from its start (edits on the final document). */
function documentsOf(h: History): JsonObject[] {
  const out = [edit(FINAL, h.start)];
  for (const r of h.revisions) out.push(edit(out[out.length - 1]!, r));
  return out;
}

describe('#387.15327229 the same document reached through two different patch histories gets byte-identical content keys and cache hits, and no key contains an epoch or any other change counter (redraft)', () => {
  it('#387.15327229 parity/kernel/key-history.scene: the short and the long history each reach the scene\'s document under its own doc ID, the same keys and results at 1 s, and the second\'s last frame runs nothing, finding its results by key', () => {
    const short = documentsOf(history('short'));
    const long = documentsOf(history('long'));
    const calls = [...walk(DOC.a, short), ...walk(DOC.b, long), revisionsOf(DOC.a), revisionsOf(DOC.b)];
    const replies = run(builds.bin(FULL), scenario(evidence(), calls));
    for (let i = 0; i < calls.length - 2; i += 2) presented(replies[i]!, `revision call ${i}`);
    const [revsA, revsB] = replies.slice(-2) as [JsonObject, JsonObject];
    const lastA = evaluated(replies[2 * short.length - 1]!, 'the short history\'s last frame');
    const lastB = evaluated(replies[2 * short.length + 2 * long.length - 1]!, 'the long history\'s last frame');
    expect(sameNodes(lastA, lastB, 'the two histories\' last frames'), 'byte-identical content keys and results').toEqual([]);
    expect(lastB.nodes.filter((n) => n.run === 'ran').map((n) => `${n.operator}@${n.item ?? ''}`), 'the second history\'s last frame runs no operator: every result is kept or found by key').toEqual([]);
    expect(lastB.nodes.some((n) => n.run === 'hit'), 'its last revision\'s changes are cache hits on the first history\'s results').toBe(true);

    // A fresh process with no history shows the scene's document once under each doc ID.
    const fresh = run(builds.bin(FULL), scenario(evidence(), [show(FINAL, { doc: DOC.a }), evalCall(DOC.a, { t: T }), revisionsOf(DOC.a), show(FINAL, { doc: DOC.b }), revisionsOf(DOC.b)]));
    presented(fresh[0]!, 'the scene\'s document under the short history\'s doc ID in a fresh process');
    presented(fresh[3]!, 'the scene\'s document under the long history\'s doc ID in a fresh process');
    expect(currentHash(revsA), 'the short history reaches the scene\'s document (its revision hash under the same doc ID)').toBe(currentHash(fresh[2]!));
    expect(currentHash(revsB), 'the long history reaches the scene\'s document (its revision hash under the same doc ID)').toBe(currentHash(fresh[4]!));
    expect(sameNodes(lastA, evaluated(fresh[1]!, 'a fresh process\'s one revision'), 'a history against no history'), 'a fresh process with no history gets the same keys and results').toEqual([]);
  }, 600_000);
});
