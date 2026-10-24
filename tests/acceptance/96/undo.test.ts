// AC3 undo is by writer: your change survives an agent's undo. AC9 a `deep show` patch run inside an
// agent's process tree lands in that agent's layer, never yours, and its undo leaves your change in place.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, ASALPHA, CLI_ALPHA, CLI_YOU, P, W, WRITER, arrow, codes, create, del, expectValidPatched, item, node, obj, outcome, patch, patchedData,
  posOf, read, record, revisionRows, revisionsOf, send, set, show, shown, undo, useBinaries, useFolders, world, writerOf, type JsonObject,
} from './helpers.ts';

useBinaries();
const { evidence, state } = useFolders();

const fillOf = (doc: JsonObject, id: string): unknown => obj(obj(obj(item(doc, id), id)['params'], 'params')['paint'], 'paint')['fill'];
/** Refusals an undo of another writer's change, or of content another writer has since changed, may carry. */
const UNDO_REFUSALS = ['undo_conflict', 'not_your_layer'];

describe('AC3 your change survives an agent\'s undo', () => {
  it('AC3 alpha undoes its own patch after you moved n1: alpha\'s items go, and n1 stays where you put it', () => {
    const drew = patch(P(1), 0, [create(arrow('alpha.to-n1', 'Arrow to node 1', 'you.n1')), create(node('alpha.tag', 'Tag', [300, 120]))]);
    const moved = patch(P(2), 1, [set('you.n1', 'items/you.n1/at/pos', [220, 60, 0])]);
    const r = show(world(evidence(), [send(ASALPHA, drew), send(CLI_YOU, moved), undo(ASALPHA, P(3), P(1)), read()])).replies;
    expect([outcome(r[0]!), outcome(r[1]!)], 'alpha\'s patch and your move apply').toEqual(['applied', 'applied']);
    expect(outcome(r[2]!), `alpha's undo of its own patch applies (${JSON.stringify(codes(r[2]!))})`).toBe('applied');
    const doc = shown(r[3]!).document;
    expect(item(doc, 'alpha.to-n1'), 'alpha\'s arrow is gone').toBeUndefined();
    expect(item(doc, 'alpha.tag'), 'and its tag').toBeUndefined();
    expect(posOf(doc, 'you.n1'), 'your later move of n1 survives alpha\'s undo').toEqual([220, 60, 0]);
    expect(writerOf(doc, 'you.n1'), 'n1 is still yours').toBe(W.you);
  });

  it('AC3 after your patch takes alpha\'s tag into your layer, alpha\'s undo of its own earlier change to the tag is refused and your change stays', () => {
    const made = patch(P(1), 0, [create(node('alpha.tag', 'Tag', [300, 120]))]);
    const nudged = patch(P(2), 1, [set('alpha.tag', 'items/alpha.tag/at/pos', [320, 140, 0])]);
    const yours = patch(P(3), 2, [set('alpha.tag', 'items/alpha.tag/params/paint/fill', { role: 'muted' })]);
    const r = show(world(evidence(), [send(ASALPHA, made), send(ASALPHA, nudged), send(CLI_YOU, yours), read(), undo(ASALPHA, P(4), P(2)), read()])).replies;
    expect([outcome(r[0]!), outcome(r[1]!), outcome(r[2]!)], 'alpha\'s two patches and yours apply').toEqual(['applied', 'applied', 'applied']);
    const before = shown(r[3]!);
    expect(writerOf(before.document, 'alpha.tag'), 'your patch took the tag into your layer').toBe(W.you);
    expect(outcome(r[4]!), 'alpha\'s undo of a change to an item you have since changed is refused').toBe('refused');
    expect(codes(r[4]!).some((c) => UNDO_REFUSALS.includes(c)), `with undo_conflict or not_your_layer, got ${JSON.stringify(codes(r[4]!))}`).toBe(true);
    const after = shown(r[5]!);
    expect(after.hash, 'the document is unchanged').toBe(before.hash);
    expect(fillOf(after.document, 'alpha.tag'), 'your change to the tag survives').toEqual({ role: 'muted' });
    expect(posOf(after.document, 'alpha.tag'), 'and the position it had when you took it').toEqual([320, 140, 0]);
  });

  it('AC3 an agent can\'t undo your change: alpha\'s undo of your patch is refused and n1 stays', () => {
    const moved = patch(P(1), 0, [set('you.n1', 'items/you.n1/at/pos', [220, 60, 0])]);
    const r = show(world(evidence(), [send(CLI_YOU, moved), read(), undo(ASALPHA, P(2), P(1)), read()])).replies;
    expect(outcome(r[0]!), 'your move applies').toBe('applied');
    expect(outcome(r[2]!), 'alpha\'s undo of your patch is refused').toBe('refused');
    expect(codes(r[2]!).some((c) => UNDO_REFUSALS.includes(c)), `with undo_conflict or not_your_layer, got ${JSON.stringify(codes(r[2]!))}`).toBe(true);
    expect(shown(r[3]!).hash, 'the document is unchanged').toBe(shown(r[1]!).hash);
    expect(posOf(shown(r[3]!).document, 'you.n1'), 'n1 stays where you moved it').toEqual([220, 60, 0]);
  });
});

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
