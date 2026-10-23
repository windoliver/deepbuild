// #387.a0eea545: a revision whose param is −0 gets the same content key and canonical bytes as one with
// +0, and a NaN or an infinity in a param is refused with out_of_range, naming the path. JSON.stringify
// writes −0 as 0, so these scenarios are sent as text with −0 spelled `-0.0`; NaN has no JSON spelling,
// so the infinity half is reached with `1e999`, `-1e999` and an f32 param past f32's range (README:
// Readings). The base already writes −0 as 0 in the canonical document (one revision hash); it has no
// content keys on any surface and answers a document holding 1e999 with bad_input for the whole line.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DOC, arr, board, doc, evalCall, evaluated, label, obj, outcome, rect, revisionsOf, run, sameNodes, scenario, show, str,
  useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** The fast-check seed of the generated −0 placements, recorded so a failure replays. */
const SEED = 387_0009;

/** Six numeric params and transforms that hold 0, each a placeholder (`__Z<i>__`) the scenario text spells as 0 or −0. */
const ZEROS = 6;
const SIGNED = board('Signed zeros', [
  rect('back', [0, 0, 320, 200], 'a0', 'ground'),
  { id: 'r', kind: 'rect@1', name: 'Rect r', order: 'a1', params: { box: [16, '__Z0__', 64, 40], radius: '__Z1__', paint: { fill: { role: 'ink' } } }, at: { pos: ['__Z2__', 8, '__Z3__'] } },
  label('cap', 'Signed zeros', [16, 100], 'a2', { at: { pos: [16, 100, '__Z4__'] } }),
  { id: 's', kind: 'rect@1', name: 'Rect s', order: 'a3', params: { box: ['__Z5__', 120, 40, 30], paint: { fill: { role: 'muted' } } } },
]);

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

describe('#387.a0eea545 a revision whose param is −0 gets the same content key and canonical bytes as one with +0, and a NaN or an infinity in a param is refused with out_of_range, naming the path', () => {
  it(`#387.a0eea545 −0 at any of the board's zero params gives the keys of +0 (fast-check seed ${SEED}, 30 runs)`, () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { minLength: ZEROS, maxLength: ZEROS }), (signs) => {
      const calls = [show(SIGNED, { doc: DOC.a }), show(SIGNED, { doc: DOC.b }), evalCall(DOC.a), evalCall(DOC.b)];
      const replies = run(builds.bin(FULL), { raw: signedText(calls, (i, k) => k === 1 && signs[i]!), calls: calls.length });
      expect(sameNodes(evaluated(replies[2]!, 'the +0 board'), evaluated(replies[3]!, `the board with −0 at ${JSON.stringify(signs)}`), '+0 against −0'), 'the same content keys').toEqual([]);
    }), { seed: SEED, numRuns: 30, endOnFailure: true });
  }, 1_800_000);

  it('#387.a0eea545 an infinity in a param (1e999, -1e999, or 1e39 at the f32 param size) is refused with out_of_range naming the param\'s path, and no revision becomes current', () => {
    const cases: { id: string; doc: JsonObject; path: string }[] = [
      { id: doc(1), doc: board('Huge size', [label('big', 'Too big', [16, 16], 'a0', { params: { text: 'Too big', font: 'body', size: 1e39, box: { w: 160, h: 20 } } })]), path: 'items/big/params/size' },
      { id: doc(2), doc: board('Infinite radius', [rect('r', [16, 16, 64, 40], 'a0', 'ink', { params: { box: [16, 16, 64, 40], radius: '__INF__', paint: { fill: { role: 'ink' } } } })]), path: 'items/r/params/radius' },
      { id: doc(3), doc: board('Infinite width', [rect('w', [16, 16, 64, 40], 'a0', 'ink', { params: { box: [16, 16, '__NINF__', 40], paint: { fill: { role: 'ink' } } } })]), path: 'items/w/params/box' },
    ];
    const calls = cases.flatMap((c) => [show(c.doc, { doc: c.id }), revisionsOf(c.id)]);
    const raw = JSON.stringify(scenario(evidence(), calls)).replace('"__INF__"', '1e999').replace('"__NINF__"', '-1e999');
    const replies = run(builds.bin(FULL), { raw, calls: calls.length });
    cases.forEach((c, k) => {
      const reply = replies[2 * k]!;
      expect(outcome(reply), `${c.path}: the revision is refused: ${JSON.stringify(reply).slice(0, 800)}`).toBe('refused');
      const named = arr(reply['issues'], `${c.path}: issues`).map((v) => obj(v, 'an issue'))
        .filter((i) => i['code'] === 'out_of_range' && i['severity'] === 'error' && str(i['path'], 'an issue\'s path').startsWith(c.path));
      expect(named.length, `${c.path}: an out_of_range error names the param's path: ${JSON.stringify(reply['issues'])}`).toBeGreaterThan(0);
      const current = arr(replies[2 * k + 1]!['revisions'], 'revisions').filter((r) => obj(r, 'a revision')['state'] === 'current');
      expect(current, `${c.path}: no revision of the refused document is current`).toEqual([]);
    });
  }, 600_000);
});
