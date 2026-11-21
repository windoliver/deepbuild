// #2647 AC4 #2647.e5082fa7: two asks pinned to different commits of one worktree each get their own diff. A planted
// load that reuses the first diff fails, naming the ask.
//
// The real asks core on the real record (asks.ts). One session's worktree commits C1, C2 and C3, each changing other
// files; ask A is pinned to C1 and ask B to C2, and the head is C3. One `needsYou` load must show on each card what
// changed from its own commit to the head, as the merge base reads it with git: A from C1 (three files), B from C2
// (one file). This holds on the merge base; a load that keys what it read by the worktree alone gives B A's diff,
// and the test fails naming B (twins.json: reuses-first-diff).
import { afterEach, describe, expect, it } from 'vitest';
import { changedOnBase, commit, makeTree, openBench, raise, removeTemp, tempDir } from './asks.ts';

const AC4 = '#2647.e5082fa7';

afterEach(() => removeTemp());

describe(`${AC4} two asks pinned to different commits of one worktree each get their own diff; a planted load that reuses the first diff fails, naming the ask`, () => {
  it(`${AC4} ask A pinned to C1 and ask B to C2, head at C3: each card shows the diff from its own commit`, async () => {
    const root = tempDir();
    const t = makeTree(root);
    const c1 = commit(t, { 'src/cart.ts': 'export const total = (items: number[]) => items.reduce((a, b) => a + b, 0);\n', 'README.md': '# shop\n' }, 'first');
    const c2 = commit(t, { 'src/tax.ts': 'export const tax = (n: number) => n * 0.2;\n', 'README.md': '# shop\n\nTaxes.\n' }, 'second');
    const b = await openBench(root, t);
    try {
      const pins = new Map<string, string>();
      pins.set(await raise(b, 'feature/cart', c1), c1);
      pins.set(await raise(b, 'feature/tax', c2), c2);
      commit(t, { 'src/cart.ts': 'export const total = (items: number[], discount = 0) => items.reduce((a, b) => a + b, 0) - discount;\n' }, 'third');
      const expected = new Map([...pins].map(([handle, pin]) => [handle, changedOnBase(t, pin)]));
      const [a, bAsk] = [...pins.keys()];
      if (JSON.stringify(expected.get(a!)) === JSON.stringify(expected.get(bAsk!)) || !expected.get(a!) || !expected.get(bAsk!)) throw Error('BLOCKED: the two pins do not have different diffs to the head');

      const cards = await b.asks.needsYou();
      const wrong = [...pins].flatMap(([handle, pin]) => {
        const card = cards.find((c) => c.ask === handle);
        if (!card) return [`${handle} (pinned to ${pin.slice(0, 12)}) isn't among the cards the load shows`];
        const want = expected.get(handle)!;
        return JSON.stringify(card.changed) === JSON.stringify(want) ? [] : [`${handle}, pinned to ${pin.slice(0, 12)}, shows the diff from ${card.changed?.from.slice(0, 12) ?? 'nothing'} over ${JSON.stringify(card.changed?.files ?? null)}, where its own is from ${pin.slice(0, 12)} over ${JSON.stringify(want?.files)}`];
      });
      expect(wrong, `each ask must get its own diff: ${wrong.join('; ')}`).toEqual([]);
    } finally {
      await b.close();
    }
  }, 60_000);
});
