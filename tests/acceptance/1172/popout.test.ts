// AC5: after a view pops out to its own window, the main window no longer draws it.
//
// Owner decision on #1172 (2026-11-21, REDRAFT.md): after Needs you pops out, the main window's page keeps the selected
// ask's card, and the criterion is judged on the list's Needs you heading and ask rows leaving the main window and
// showing in the new window. So the main window may still hold one ask's question, the card's, and nothing else of the
// list. Judged on the main window's tree and pixels, before and after a person's press on the Pop out control; the
// design's `panel_visible` flag isn't read. Before the press the same reading finds the heading and every row, so a
// reading that sees nothing can't pass, and the new window must hold and draw them, so a view that merely disappears
// can't either. A row is read on the pixels by the start of its question (START), since a row may draw it cut short.
import { describe, expect, it } from 'vitest';
import { App, appBinary, blocked, captureWindow, makeWorld, nodes, ocr, settled, sees, sleep, tempDir, useCleanup, type Ask, type Line, type Node, type Win } from './helpers.ts';

useCleanup();
const MINUTES = 60_000;
export const POP_OUT = 'Pop out Needs you';
const HEADING = 'Needs you';
/** Letters and digits of a question's start a row must draw to be read on the pixels; the fixture's three differ by then. */
const START = 10;

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** The nodes whose name holds `text`, without the ones inside such a node: a row and the label within it are one row. */
const outermost = (node: Node, text: string): Node[] => (node.name.includes(text) ? [node] : node.children.flatMap((c) => outermost(c, text)));

/** What one window shows of the list: heading nodes and lines, each ask's nodes, and the asks whose question's start is drawn. */
interface Seen { headingNodes: number; headingLines: number; rows: Map<Ask, number>; drawn: Set<Ask>; lines: Line[] }
function seen(tree: Node, lines: Line[], asks: readonly Ask[]): Seen {
  const start = (a: Ask): string => squash(a.question).slice(0, START);
  return {
    headingNodes: nodes(tree).filter((n) => n.name === HEADING).length,
    headingLines: lines.filter((l) => /^needsyou\d*$/.test(squash(l.text))).length,
    rows: new Map(asks.map((a) => [a, outermost(tree, a.question).length])),
    drawn: new Set(asks.filter((a) => lines.some((l) => squash(l.text).includes(start(a))))),
    lines,
  };
}
/** Everything the window lacks of the list: its heading and every ask's row, on its tree and its pixels. */
function lacks(where: string, s: Seen, asks: readonly Ask[]): string[] {
  const out: string[] = [];
  if (!s.headingNodes) out.push(`${where}'s tree has no node named "${HEADING}"`);
  if (!s.headingLines) out.push(`${where}'s pixels don't draw the "${HEADING}" heading: they read ${sees(s.lines)}`);
  for (const a of asks) {
    if (!s.rows.get(a)) out.push(`${where}'s tree has no row for ${a.handle} ("${a.question}")`);
    if (!s.drawn.has(a)) out.push(`${where}'s pixels don't draw ${a.handle}'s row (its question starting "${a.question.slice(0, START)}"): they read ${sees(s.lines)}`);
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

      let before: Seen | undefined;
      const missing = await settled(async () => lacks('before the pop-out, the main window', (before = await look(main!, 'before')), asks));
      expect(missing, 'the reading sees the heading and every row in the main window before it pops out').toEqual([]);

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
        for (const a of asks) if (after.rows.get(a)! >= before!.rows.get(a)!) out.push(`the main window's tree still holds ${a.handle}'s row ("${a.question}")`);
        // The selected ask's card stays (the decision): one ask's question at most, the same ask on the tree and the pixels.
        const kept = asks.filter((a) => after.rows.get(a)!);
        if (kept.length > 1) out.push(`the main window's tree still holds ${kept.length} asks' questions, more than one card's: ${kept.map((a) => a.handle).join(', ')}`);
        for (const a of asks) if (after.drawn.has(a) && !kept.includes(a)) out.push(`the main window still draws ${a.handle}'s row on its pixels: they read ${sees(after.lines)}`);
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
