// #387.a0eea545 (blind redraft of canonical.test.ts's first test; A9-REDRAFT.md): a revision whose param
// is −0 gets the same content key and canonical bytes as one with +0. deep_show stamps the call's doc ID
// into the document's `id`, and a revision's hash is the sha256 of that canonical document (Revision), so
// canonical bytes are compared under one doc ID: two revisions of one document in one process, and one
// document in two processes. Node keys and results are compared as the first draft does. JSON.stringify
// writes −0 as 0, so the scenario is sent as text with −0 spelled `-0.0`. At the base there is no `eval`.
import { describe, expect, it } from 'vitest';
import {
  DOC, arr, board, currentHash, edit, evalCall, evaluated, label, obj, presented, rect, revisionsOf, run, sameNodes, scenario, show, str,
  useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** Six numeric params and transforms that hold 0, each a placeholder (`__Z<i>__`) the scenario text spells as 0 or −0. */
const ZEROS = 6;
const SIGNED = board('Signed zeros', [
  rect('back', [0, 0, 320, 200], 'a0', 'ground'),
  { id: 'r', kind: 'rect@1', name: 'Rect r', order: 'a1', params: { box: [16, '__Z0__', 64, 40], radius: '__Z1__', paint: { fill: { role: 'ink' } } }, at: { pos: ['__Z2__', 8, '__Z3__'] } },
  label('cap', 'Signed zeros', [16, 100], 'a2', { at: { pos: [16, 100, '__Z4__'] } }),
  { id: 's', kind: 'rect@1', name: 'Rect s', order: 'a3', params: { box: ['__Z5__', 120, 40, 30], paint: { fill: { role: 'muted' } } } },
]);
/** The same board under another title: a revision between the +0 and the −0 one, so the two aren't adjacent. */
const RETITLED = edit(SIGNED, { title: 'Signed zeros, retitled' });

/**
 * The scenario as text, each deep_show call's placeholders written as 0, or as −0 (`-0.0`) where
 * `negative(placeholder, call index)` says so. The documents serialize in call order, so the first
 * placeholder still unnumbered belongs to the call being numbered.
 */
function signedText(calls: JsonObject[], negative: (i: number, call: number) => boolean): string {
  let text = JSON.stringify(scenario(evidence(), calls));
  calls.forEach((c, k) => {
    if (c['call'] !== 'deep_show') return;
    for (let i = 0; i < ZEROS; i++) text = text.replace(`"__Z${i}__"`, `"__C${k}Z${i}__"`);
  });
  return text.replace(/"__C(\d+)Z(\d)__"/g, (_, k: string, i: string) => (negative(Number(i), Number(k)) ? '-0.0' : '0'));
}

/** The hash of revision `rev` in a `revisions` reply. */
function hashOf(reply: JsonObject, rev: number): string {
  const rows = arr(reply['revisions'], 'revisions').map((v, i) => obj(v, `revisions[${i}]`)).filter((r) => r['rev'] === rev);
  expect(rows.length, `one revision ${rev}: ${JSON.stringify(reply['revisions'])}`).toBe(1);
  return str(rows[0]!['hash'], `revision ${rev}'s hash`);
}

describe('#387.a0eea545 a revision whose param is −0 gets the same content key and canonical bytes as one with +0 (redraft)', () => {
  it('#387.a0eea545 a board with −0 in a rect\'s box, radius and at.pos and a label\'s at.pos has the node keys and results of the board with +0, in one process and in two, and the revision hash of the +0 board under the same doc ID, as a later revision of it and in a fresh process', () => {
    const calls = [
      show(SIGNED, { doc: DOC.a }), show(SIGNED, { doc: DOC.b }), evalCall(DOC.a), evalCall(DOC.b),
      show(RETITLED, { doc: DOC.a }), show(SIGNED, { doc: DOC.a }), revisionsOf(DOC.a),
    ];
    // DOC.a's first revision is +0 throughout, its second +0 under another title, its third −0 throughout;
    // DOC.b's board is −0 throughout.
    const raw = signedText(calls, (_, k) => k === 1 || k === 5);
    expect(raw, 'the scenario text spells −0').toContain('-0.0');
    const replies = run(builds.bin(FULL), { raw, calls: calls.length });
    presented(replies[0]!, 'the +0 board');
    presented(replies[1]!, 'the −0 board');
    const plus = evaluated(replies[2]!, 'the +0 board\'s frame');
    const minus = evaluated(replies[3]!, 'the −0 board\'s frame');
    expect(sameNodes(plus, minus, '+0 against −0'), 'every node has the same content key and result').toEqual([]);

    presented(replies[4]!, 'the retitled +0 board');
    presented(replies[5]!, 'the −0 board as the third revision of the +0 board\'s document');
    const revs = replies[6]!;
    const plusHash = hashOf(revs, 1);
    expect(hashOf(revs, 2), 'the retitled revision has other canonical bytes (the hash sees the content)').not.toBe(plusHash);
    expect(hashOf(revs, 3), 'the −0 revision has the canonical bytes of the +0 revision of the same document: one revision hash').toBe(plusHash);
    expect(currentHash(revs), 'the −0 revision is current').toBe(hashOf(revs, 3));

    const alone = [show(SIGNED, { doc: DOC.a }), evalCall(DOC.a), revisionsOf(DOC.a)];
    const lone = run(builds.bin(FULL), { raw: signedText(alone, () => true), calls: alone.length });
    presented(lone[0]!, 'the −0 board in a fresh process');
    expect(sameNodes(plus, evaluated(lone[1]!, 'the −0 board in a fresh process'), '+0 against −0 in another process'), 'the same keys in another process').toEqual([]);
    expect(currentHash(lone[2]!), 'the −0 board in a fresh process has the canonical bytes of the +0 board under the same doc ID: one revision hash').toBe(plusHash);
  }, 600_000);
});
