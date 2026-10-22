// AC8 no other writer's channel or placement writes a path of your item. AC10 deleting your node an agent's
// arrow is parented to hides only the arrow and tells the agent. AC11 a writer's whole revision of a shared
// document is diffed against its own layer only.
import { describe, expect, it } from 'vitest';
import {
  ASALPHA, ASBRAVO, CLI_YOU, P, W, arrow, codes, create, del, envelope, fixture, issues, item, layerOf, move, node, outcome, patch, read, send, show,
  shown, sorted, strs, useBinaries, useFolders, whole, world, writerOf, type JsonObject,
} from './helpers.ts';

useBinaries();
const { evidence } = useFolders();

describe('AC8 an agent\'s channel or placement that writes a path of an item in your layer is refused with not_your_layer, and your item doesn\'t move', () => {
  const tag = node('alpha.tag', 'Tag', [300, 120]);
  // The kernel's channel shape in this slice is its target path alone (tests/acceptance/389), and the marks
  // module draws only channels with keys, so a channel alone isn't presented at the base either way: the
  // channel case reads the refusal's code, the placement case whether it's presented.
  const channelOn = (target: string): JsonObject => envelope([tag], { channels: { 'alpha.slide': { target: `items/${target}/at/pos/0` } } });
  const placementOn = (target: string): JsonObject => envelope([tag], {
    clips: { 'alpha.nudge': { slots: { target: { type: 'rect@1', required: true } }, span: 'auto', channels: { x: { target: 'slot:target/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 300, interp: 'linear' }, k1: { t: '1s', value: 480, interp: 'linear' } } } } } },
    placements: { 'alpha.nudge-1': { clip: 'alpha.nudge', slots: { target }, start: '0s' } },
  });

  function refusedOnYours(r: JsonObject[], what: string): void {
    expect(outcome(r[1]!), `the ${what} on your node is refused`).toBe('refused');
    expect(codes(r[1]!), 'with not_your_layer').toContain('not_your_layer');
    expect(shown(r[2]!).hash, 'the document is unchanged').toBe(shown(r[0]!).hash);
    expect(item(shown(r[2]!).document, 'you.n1'), 'n1 is as it was').toEqual(item(shown(r[0]!).document, 'you.n1'));
  }

  it('AC8 alpha\'s channel that writes your n1\'s position is refused with not_your_layer and n1 doesn\'t move; the same channel on alpha\'s own tag is not refused for whose item it writes', () => {
    const r = show(world(evidence(), [read(), whole(ASALPHA, channelOn('you.n1')), read(), whole(ASALPHA, channelOn('alpha.tag'))])).replies;
    refusedOnYours(r, 'channel');
    expect(codes(r[3]!), 'a channel on alpha\'s own item is never not_your_layer').not.toContain('not_your_layer');
  });

  it('AC8 alpha\'s placement that binds your n1 to its clip is refused with not_your_layer and n1 doesn\'t move; the same placement on alpha\'s own tag is presented', () => {
    const r = show(world(evidence(), [read(), whole(ASALPHA, placementOn('you.n1')), read(), whole(ASALPHA, placementOn('alpha.tag')), read()])).replies;
    refusedOnYours(r, 'placement');
    expect(outcome(r[3]!), `the placement on alpha's own tag is presented (${JSON.stringify(codes(r[3]!))})`).toBe('presented');
    expect(item(shown(r[4]!).document, 'you.n1'), 'and n1 is still as it was').toEqual(item(shown(r[0]!).document, 'you.n1'));
  });
});

describe('AC10 deleting your node that an agent\'s arrow is parented to applies, hides only the arrow and sends the agent ref_unresolved, and the document doesn\'t freeze at its last good revision', () => {
  it('AC10 your delete of n1 applies; alpha\'s arrow to n1 stays in the document but doesn\'t draw; alpha reads ref_unresolved on it; everything else draws', () => {
    const arrows = patch(P(1), 0, [create(arrow('alpha.to-n1', 'Arrow to node 1', 'you.n1')), create(arrow('alpha.to-n2', 'Arrow to node 2', 'you.n2')), create(node('alpha.tag', 'Tag', [300, 120]))]);
    const gone = patch(P(2), 1, [del('you.n1')]);
    const r = show(world(evidence(), [send(ASALPHA, arrows), read(), send(CLI_YOU, gone), read(), read(undefined, ASALPHA)])).replies;
    expect(outcome(r[0]!), 'alpha\'s arrows apply').toBe('applied');
    const before = shown(r[1]!);
    expect(outcome(r[2]!), 'your delete of n1 applies').toBe('applied');
    const after = shown(r[3]!);
    expect(after.rev, 'and becomes the current revision: the document doesn\'t freeze at the last good one').toBeGreaterThan(before.rev);
    expect(item(after.document, 'you.n1'), 'n1 is gone').toBeUndefined();
    expect(item(after.document, 'alpha.to-n1'), 'alpha\'s arrow to n1 is still in the document, alpha\'s').toBeDefined();
    expect(writerOf(after.document, 'alpha.to-n1'), 'in alpha\'s layer').toBe(W.alpha);
    expect(after.draws, 'everything draws but the arrow whose parent is gone').toEqual(sorted(['you.n2', 'alpha.to-n2', 'alpha.tag']));
    const alphaSees = shown(r[4]!, 'alpha\'s read');
    const sent = alphaSees.issues.filter((i) => i.code === 'ref_unresolved');
    expect(sent.map((i) => i.ids), 'alpha is sent ref_unresolved on its arrow to n1, and only that').toEqual([['alpha.to-n1']]);
  });

  it('AC10 after the delete, writers keep patching: alpha re-parents its arrow to n2, which applies, is current and draws', () => {
    const arrows = patch(P(1), 0, [create(arrow('alpha.to-n1', 'Arrow to node 1', 'you.n1'))]);
    const gone = patch(P(2), 1, [del('you.n1')]);
    const reparent = patch(P(3), 2, [move('alpha.to-n1', 'you.n2')]);
    const r = show(world(evidence(), [send(ASALPHA, arrows), send(CLI_YOU, gone), send(ASALPHA, reparent), read(), read(undefined, ASALPHA)])).replies;
    expect([outcome(r[0]!), outcome(r[1]!), outcome(r[2]!)], 'the arrows, the delete and the re-parent all apply').toEqual(['applied', 'applied', 'applied']);
    const now = shown(r[3]!);
    expect(now.rev, 'the re-parent is current').toBe(3);
    expect(now.draws, 'the arrow draws again').toContain('alpha.to-n1');
    expect(shown(r[4]!).issues.filter((i) => i.code === 'ref_unresolved'), 'and alpha has no ref_unresolved left').toEqual([]);
  });
});

describe('AC11 a whole revision in a shared document is diffed against its writer\'s own layer only', () => {
  const SIX = [1, 2, 3, 4, 5, 6].map((i) => node(`alpha.i${i}`, `Alpha ${i}`, [200 + 30 * i, 40], `a${i}`));
  const FOUR = [1, 2, 3, 4].map((i) => node(`bravo.j${i}`, `Bravo ${i}`, [200 + 30 * i, 260], `a${i}`));
  const A_IDS = SIX.map((i) => String(i['id']));
  const B_IDS = FOUR.map((i) => String(i['id']));
  const calls = (): JsonObject[] => [
    whole(ASBRAVO, envelope(FOUR)), read(),
    whole(ASALPHA, envelope(SIX)), read(),
    whole(ASALPHA, envelope(SIX)), read(),
    whole(ASALPHA, envelope(SIX.slice(0, 4))), read(),
  ];
  /** What the criterion asks of A's first whole revision, as failures; empty when it holds. */
  function firstFailures(reply: JsonObject, before: JsonObject, after: JsonObject): string[] {
    const out: string[] = [];
    if (outcome(reply) !== 'presented') {
      const named = issues(reply).filter((i) => i.code === 'unintended_removal').flatMap((i) => i.ids);
      out.push(`alpha's first whole revision of its six was ${outcome(reply)}, naming ${JSON.stringify(sorted(named))}`);
      return out;
    }
    const [b, a] = [shown(before), shown(after)];
    const bravo = layerOf(b.document, W.bravo);
    if (a.files[bravo] !== b.files[bravo]) out.push(`bravo's layer file changed: ${b.files[bravo]} → ${a.files[bravo]}`);
    for (const id of B_IDS) if (JSON.stringify(item(a.document, id)) !== JSON.stringify(item(b.document, id))) out.push(`bravo's ${id} changed`);
    return out;
  }

  it('AC11 with bravo holding 4, alpha\'s whole revision of its 6 is presented and bravo\'s 4 stay, by hash; re-sent unchanged, the document\'s hash doesn\'t move', () => {
    const r = show(world(evidence(), calls())).replies;
    expect(outcome(r[0]!), 'bravo\'s 4 are presented').toBe('presented');
    expect(firstFailures(r[2]!, r[1]!, r[3]!), 'alpha\'s 6 are presented and bravo\'s 4 stay by hash').toEqual([]);
    expect(sorted(strs(r[2]!['created'], 'created')), 'the reply lists alpha\'s six as created and nothing of bravo\'s or yours').toEqual(sorted(A_IDS));
    expect(strs(r[2]!['removed'], 'removed'), 'and nothing removed').toEqual([]);
    expect(outcome(r[4]!), 'all six re-sent are presented').toBe('presented');
    expect(sorted(strs(r[4]!['unchanged'], 'unchanged')), 'all six unchanged').toEqual(sorted(A_IDS));
    expect(shown(r[5]!).hash, 'and the document\'s hash is the same').toBe(shown(r[3]!).hash);
  });

  it('AC11 alpha\'s revision with 4 of its 6 and no removes is refused with unintended_removal naming exactly alpha\'s two, and the 6-item revision stays', () => {
    const r = show(world(evidence(), calls())).replies;
    expect(outcome(r[6]!), 'the four are refused').toBe('refused');
    const named = issues(r[6]!).filter((i) => i.code === 'unintended_removal').flatMap((i) => i.ids);
    expect(sorted(named), 'unintended_removal names exactly alpha\'s two left out, none of bravo\'s or yours').toEqual(['alpha.i5', 'alpha.i6']);
    expect(shown(r[7]!).hash, 'the six-item revision stays current, by hash').toBe(shown(r[5]!).hash);
  });

  it('AC11 a planted diff against the whole document refuses alpha\'s first revision, naming bravo\'s four, and this test fails on it', () => {
    // Redrafted after a dispute: under the planted diff bravo's own whole revision would be diffed against
    // your two nodes and refused, so bravo's four never landed. Here the stored board holds bravo's four in
    // its layer and nothing else, so alpha's first revision is the only one the planted hub diffs.
    const seed = fixture('board.json');
    seed['items'] = Object.fromEntries(FOUR.map((i) => [String(i['id']), { ...i, layer: 'bravo-main' }]));
    const r = show(world(evidence(), [read(), whole(ASALPHA, envelope(SIX)), read()], { planted: 'diffs_whole_document' }, seed)).replies;
    expect(outcome(r[1]!), 'the planted diff refuses alpha\'s first revision').toBe('refused');
    const named = issues(r[1]!).filter((i) => i.code === 'unintended_removal').flatMap((i) => i.ids);
    expect(sorted(named), 'naming bravo\'s four').toEqual(sorted(B_IDS));
    const failures = firstFailures(r[1]!, r[0]!, r[2]!);
    expect(failures.length, 'the check fails on the planted diff').toBeGreaterThan(0);
    for (const id of B_IDS) expect(failures.join('\n'), `the failure names ${id}`).toContain(id);
  });
});
