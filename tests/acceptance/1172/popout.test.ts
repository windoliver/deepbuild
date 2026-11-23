// AC5: after a view pops out to its own window, the main window no longer draws it.
//
// Owner decision on #1172 (2026-11-21, REDRAFT.md): after Needs you pops out, the main window's page keeps the selected
// ask's card, and the criterion is judged on the list's Needs you heading and ask rows leaving the main window and
// showing in the new window. Judged on the main window's tree and pixels, before and after a person's press on the Pop
// out control; the design's `panel_visible` flag isn't read.
//
// A row and a card both hold their ask's question, so the test fixes which card is open. It reads the list while one ask
// (the selected one) has no card, then presses that ask's row (AC3: "a click on it presents that ask's question card"),
// and reads again: what the selected ask gains is its card's share, and every other ask has no card (AC3's judge: no other
// ask's options). A card is told by its own two options as `AXButton`s (README, Pinned item 2; AC3's judge). After the
// pop-out, an ask may keep on the main window only its open card's share, and nothing once its card is gone, so a row
// that stays fails whatever card is open. Before the press the same reading finds the heading and every row with its
// whole question (AC3: "each Needs you row shows its ask's question"), so a reading that sees nothing can't pass, and the
// new window must hold and draw them the same way, so a view that merely disappears can't either.
import { describe, expect, it } from 'vitest';
import { App, appBinary, blocked, captureWindow, makeWorld, nodes, ocr, reads, settled, sees, sleep, tempDir, useCleanup, type Ask, type Line, type Node, type Win } from './helpers.ts';

useCleanup();
const MINUTES = 60_000;
export const POP_OUT = 'Pop out Needs you';
const HEADING = 'Needs you';
/** Letters and digits of a question's start whose drawing still counts as the ask drawn: leaving is judged strictly. */
const START = 10;

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** The nodes whose name holds `text`, without the ones inside such a node: a row and the label within it are one row. */
const outermost = (node: Node, text: string): Node[] => (node.name.includes(text) ? [node] : node.children.flatMap((c) => outermost(c, text)));
/** The ask's card is open: both its options are `AXButton`s on the tree, as AC3's judge reads a presented card. */
const cardOpen = (tree: Node, a: Ask): boolean => [a.option.label, a.other].every((label) => nodes(tree).some((n) => n.role === 'AXButton' && n.name.includes(label)));
/** Any of the ask's options is on the tree, under any role: some of its card is there. */
const anyOption = (tree: Node, a: Ask): boolean => [a.option.label, a.other].some((label) => nodes(tree).some((n) => n.name.includes(label)));

/** What one window shows of the list. */
interface Seen {
  tree: Node;
  headingNodes: number;
  headingLines: number;
  /** Per ask: outermost tree nodes holding its whole question. */
  rows: Map<Ask, number>;
  /** Per ask: whether one pixel line holds its whole question. */
  whole: Map<Ask, boolean>;
  /** Per ask: pixel lines holding its question's first START letters and digits. */
  starts: Map<Ask, number>;
  lines: Line[];
}
function seen(tree: Node, lines: Line[], asks: readonly Ask[]): Seen {
  const start = (a: Ask): string => squash(a.question).slice(0, START);
  return {
    tree,
    headingNodes: nodes(tree).filter((n) => n.name === HEADING).length,
    headingLines: lines.filter((l) => /^needsyou\d*$/.test(squash(l.text))).length,
    rows: new Map(asks.map((a) => [a, outermost(tree, a.question).length])),
    whole: new Map(asks.map((a) => [a, reads(lines, a.question)])),
    starts: new Map(asks.map((a) => [a, lines.filter((l) => squash(l.text).includes(start(a))).length])),
    lines,
  };
}
/** Everything the window lacks of the list: its heading and every ask's row with its whole question, on its tree and its pixels. */
function lacks(where: string, s: Seen, asks: readonly Ask[]): string[] {
  const out: string[] = [];
  if (!s.headingNodes) out.push(`${where}'s tree has no node named "${HEADING}"`);
  if (!s.headingLines) out.push(`${where}'s pixels don't draw the "${HEADING}" heading: they read ${sees(s.lines)}`);
  for (const a of asks) {
    if (!s.rows.get(a)) out.push(`${where}'s tree has no row for ${a.handle} ("${a.question}")`);
    if (!s.whole.get(a)) out.push(`${where}'s pixels don't draw ${a.handle}'s row with its whole question "${a.question}": they read ${sees(s.lines)}`);
  }
  return out;
}

describe('#1172 a popped-out view leaves the main window', () => {
  it('AC5 after Needs you pops out to its own window, its heading and rows leave the main window and the new window draws them', async () => {
    const world = await makeWorld();
    const asks = world.asks;
    const app = await App.launch({ home: world.home, binary: await appBinary() });
    const dir = tempDir();
    try {
      const [main, ...others] = await app.windows();
      if (!main || others.length) blocked(`before the pop-out deep-app should have one window: ${JSON.stringify([main, ...others])}`);
      const axOf = async (win: Win): Promise<Node> => {
        const ax = (await app.tree()).windows.find((w) => w.frame.every((v, i) => Math.abs(v - win.frame[i]!) < 2));
        return ax?.tree ?? blocked(`the tree has no window at ${JSON.stringify(win.frame)}`);
      };
      const look = async (win: Win, name: string): Promise<Seen> => seen(await axOf(win), await ocr(await captureWindow(win.id, `${dir}/${name}.png`)), asks);

      // 1. The list as launched, and an ask with none of its card on the main window: the one to select.
      let launched: Seen | undefined;
      const missing = await settled(async () => lacks('at launch, the main window', (launched = await look(main!, 'launch')), asks));
      expect(missing, 'the reading sees the heading and every row in the main window at launch').toEqual([]);
      const selected = asks.find((a) => !anyOption(launched!.tree, a)) ?? blocked('every ask has some of its card open at launch, so no row can be read apart from a card');

      // 2. Its row pressed: its card opens, no other ask's card is open, and the list is still all there.
      const pick = await app.press(selected.question);
      expect(pick, `${selected.handle}'s row takes a person's press`).toMatchObject({ found: true, pressed: true });
      let before: Seen | undefined;
      const unready = await settled(async () => {
        before = await look(main!, 'before');
        const out = lacks('before the pop-out, the main window', before, asks);
        if (!cardOpen(before.tree, selected)) out.push(`a press on ${selected.handle}'s row opened no card with its options in the main window`);
        for (const a of asks) if (a !== selected && anyOption(before.tree, a)) out.push(`with ${selected.handle} selected, the main window still holds ${a.handle}'s card`);
        for (const label of [selected.option.label, selected.other]) if (!reads(before.lines, label)) out.push(`${selected.handle}'s card isn't on the main window's pixels: they lack "${label}"`);
        if (before.rows.get(selected)! < launched!.rows.get(selected)!) out.push(`${selected.handle}'s row left the main window's tree on its own press`);
        return out;
      }, 4000);
      expect(unready, 'before the pop-out: the whole list, and the selected ask\'s card and no other').toEqual([]);
      if ((await app.windows()).length !== 1) blocked('the selected ask\'s card opened a window of its own, so the pop-out can\'t be told apart');
      // What the card adds of its ask's question: on the tree, nodes; on the pixels, lines with the question's start.
      const cardNodes = before!.rows.get(selected)! - launched!.rows.get(selected)!;
      const cardLines = Math.max(0, before!.starts.get(selected)! - launched!.starts.get(selected)!);

      // 3. The pop-out.
      const press = await app.press(POP_OUT);
      expect(press, `the window has a "${POP_OUT}" control a person can press`).toMatchObject({ found: true, pressed: true });
      let popped: Win | undefined;
      await settled(async () => { popped = (await app.windows()).find((w) => w.id !== main!.id); return popped ? [] : ['one window']; }, 6000);
      expect(popped, 'the view opens in a window of its own').toBeDefined();

      const left = await settled(async () => {
        const after = await look(main!, 'main');
        const out: string[] = [];
        if (after.headingNodes >= before!.headingNodes) out.push(`the main window's tree still holds the "${HEADING}" heading (${after.headingNodes} node(s), ${before!.headingNodes} before)`);
        if (after.headingLines >= before!.headingLines) out.push(`the main window still draws the "${HEADING}" heading on its pixels: they read ${sees(after.lines)}`);
        for (const a of asks) {
          // The selected ask's card may stay (the decision), so its share may; a row's never does.
          const card = a === selected && cardOpen(after.tree, a);
          const [nodesAllowed, linesAllowed] = card ? [cardNodes, cardLines] : [0, 0];
          const held = after.rows.get(a)!;
          const drawn = after.starts.get(a)!;
          if (held > nodesAllowed) out.push(`the main window's tree still holds ${a.handle}'s row ("${a.question}"): ${held} node(s) hold its question, ${card ? `its open card's share is ${cardNodes}` : 'and no card of its is open'}`);
          if (drawn > linesAllowed) out.push(`the main window still draws ${a.handle}'s row on its pixels: ${drawn} line(s) start its question, ${card ? `its open card's share is ${cardLines}` : 'and no card of its is open'}; they read ${sees(after.lines)}`);
        }
        return out;
      }, 4000);
      expect(left, 'the list leaves the main window').toEqual([]);

      await sleep(300);
      const shown = await settled(async () => lacks('the popped window', await look(popped!, 'popped'), asks), 4000);
      expect(shown, 'the popped window holds and draws the list').toEqual([]);
    } finally {
      await app.stop();
    }
  }, 8 * MINUTES);
});
