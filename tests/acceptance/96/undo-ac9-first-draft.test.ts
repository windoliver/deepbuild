// AC9's first draft, moved here unchanged from undo.test.ts and kept by hand only: it validates every recorded event as
// doc.patched@1, which can't carry the revision hash the design's Revision text and #1412 require. Its blind redraft,
// 96-redraft-1412/, runs in its place, on the owner's ruling ("Use the redraft", Nov 24; 96-redraft-1412/DISPUTE.md).
import { describe, expect, it } from 'vitest';
import {
  ALPHA, CLI_ALPHA, CLI_YOU, P, W, WRITER, codes, create, del, expectValidPatched, item, node, outcome, patch, patchedData, posOf, read,
  record, revisionRows, revisionsOf, send, set, show, shown, undo, useBinaries, useFolders, world, writerOf,
} from './helpers.ts';

useBinaries();
const { evidence, state } = useFolders();

describe('AC9 a `deep show` patch run from inside an agent\'s process tree lands in that agent\'s writer layer, never yours, and its undo leaves your change in place', () => {
  it('AC9 `deep show` from alpha\'s tree writes alpha\'s layer, stamped and recorded as alpha; its undo from alpha\'s tree leaves your later change in place', () => {
    const fromTree = patch(P(1), 0, [create(node('alpha.cli-box', 'Box from the CLI', [300, 260]))]);
    const yours = patch(P(2), 1, [set('you.n1', 'items/you.n1/at/pos', [260, 40, 0])]);
    const r = show(world(evidence(), [send(CLI_ALPHA, fromTree), read(), send(CLI_YOU, yours), undo(CLI_ALPHA, P(3), P(1)), read(), revisionsOf()], { state: state() })).replies;
    expect(outcome(r[0]!), 'the patch from alpha\'s tree applies').toBe('applied');
    const landed = shown(r[1]!).document;
    expect(writerOf(landed, 'alpha.cli-box'), 'it lands in alpha\'s writer layer').toBe(W.alpha);
    expect(writerOf(landed, 'alpha.cli-box'), 'never yours').not.toBe(W.you);
    const rows = revisionRows(r[5]!);
    expect(rows.find((row) => row.patches.includes(P(1)))?.writer, 'its revision is stamped as alpha').toEqual(WRITER.alpha);
    const logged = record(state());
    expectValidPatched(logged);
    const first = logged.find((l) => patchedData(l)['patch'] === P(1));
    expect(first && patchedData(first)['writer'], 'its doc.patched event names the agent kind').toBe('agent');
    expect(first?.session, 'and alpha\'s session').toBe(ALPHA.id);
    const yoursLogged = logged.find((l) => patchedData(l)['patch'] === P(2));
    expect(yoursLogged && patchedData(yoursLogged)['writer'], 'your patch from your shell is recorded as you').toBe('you');
    expect(outcome(r[2]!), 'your move applies').toBe('applied');
    expect(outcome(r[3]!), `the undo from alpha's tree applies (${JSON.stringify(codes(r[3]!))})`).toBe('applied');
    const after = shown(r[4]!).document;
    expect(item(after, 'alpha.cli-box'), 'the undo removes alpha\'s box').toBeUndefined();
    expect(posOf(after, 'you.n1'), 'and leaves your change in place').toEqual([260, 40, 0]);
    expect(writerOf(after, 'you.n1'), 'in your layer').toBe(W.you);
  });

  it('AC9 `deep show` from alpha\'s tree can\'t write your layer: a patch to your node, or one that names you as its writer, is refused and nothing of yours changes', () => {
    const atYours = patch(P(1), 0, [set('you.n1', 'items/you.n1/at/pos', [500, 300, 0])]);
    const claimed = { ...patch(P(2), 0, [create(node('you.n9', 'Claimed node', [500, 300]))]), writer: W.you };
    const deleting = patch(P(3), 0, [del('you.n2')]);
    const r = show(world(evidence(), [read(), send(CLI_ALPHA, atYours), send(CLI_ALPHA, claimed), send(CLI_ALPHA, deleting), read()])).replies;
    expect(outcome(r[1]!), 'a set on your node from alpha\'s tree is refused').toBe('refused');
    expect(codes(r[1]!), 'with not_your_layer').toContain('not_your_layer');
    expect(outcome(r[2]!), 'a patch whose payload names you as its writer is refused').toBe('refused');
    expect(outcome(r[3]!), 'a delete of your node from alpha\'s tree is refused').toBe('refused');
    expect(codes(r[3]!), 'with not_your_layer').toContain('not_your_layer');
    expect(shown(r[4]!).hash, 'the document is unchanged').toBe(shown(r[0]!).hash);
  });
});
