// #2647 AC3 #2647.c2acca3a: a Needs you load with five asks of one session pinned to one commit, whose head has moved,
// starts three git processes, counted by a stand-in on PATH, and shows the cards the merge base shows. On the merge
// base it starts fifteen.
//
// The real asks core on the real record (asks.ts). One session in a real worktree raises five authority asks, each
// pinned to the worktree's commit C1; then the worktree commits C2, so its head has moved. One `needsYou` call runs
// with the git stand-in first on PATH: every git process the load starts is one line of its log. The cards it shows
// must be the five asks, each showing what changed from C1 to C2 exactly as the merge base reads it (git rev-parse,
// git diff --name-only, git diff), and the load must have started three git processes. On the merge base each card
// runs its own three: fifteen.
import { afterEach, describe, expect, it } from 'vitest';
import { changedOnBase, commit, counted, gitCounter, makeTree, openBench, raise, removeTemp, tempDir } from './asks.ts';

const AC3 = '#2647.c2acca3a';
/** The starts a load made, grouped by git command (its words past `-C <worktree>` and before the commits). */
const byCommand = (starts: readonly string[]): string => {
  const n = new Map<string, number>();
  for (const s of starts) {
    const words = s.split(' ').slice(2).filter((w) => !/^[0-9a-f]{40}$/.test(w)).join(' ');
    n.set(words, (n.get(words) ?? 0) + 1);
  }
  return [...n].map(([words, times]) => `git ${words} ×${times}`).join(', ') || 'none';
};

afterEach(() => removeTemp());

describe(`${AC3} a Needs you load with five asks of one session pinned to one commit, whose head has moved, starts three git processes and shows the merge base's cards`, () => {
  it(`${AC3} five asks pinned to C1, head at C2: one needsYou starts three git processes, each card showing C1 to C2`, async () => {
    const root = tempDir();
    const t = makeTree(root);
    const c1 = commit(t, { 'src/cart.ts': 'export const total = (items: number[]) => items.reduce((a, b) => a + b, 0);\n', 'README.md': '# shop\n' }, 'first');
    const b = await openBench(root, t);
    try {
      const subjects = ['feature/login', 'feature/cart', 'feature/search', 'feature/billing', 'feature/profile'];
      const handles: string[] = [];
      for (const s of subjects) handles.push(await raise(b, s, c1));
      commit(t, { 'src/cart.ts': 'export const total = (items: number[], discount = 0) => items.reduce((a, b) => a + b, 0) - discount;\n', 'CHANGELOG.md': 'discounts\n' }, 'second');
      const expected = changedOnBase(t, c1);
      if (!expected) throw Error('BLOCKED: the worktree\'s head did not move off C1');

      const counter = gitCounter(root);
      const { value: cards, starts } = await counted(counter, () => b.asks.needsYou());

      // The cards the merge base shows: the five asks, each with what changed from C1 to the head.
      const shown = cards.filter((c) => handles.includes(c.ask));
      const wrong = handles.flatMap((h) => {
        const card = shown.find((c) => c.ask === h);
        if (!card) return [`${h} isn't among the cards the load shows (${cards.map((c) => c.ask).join(', ') || 'none'})`];
        return JSON.stringify(card.changed) === JSON.stringify(expected) ? [] : [`${h} shows changed ${JSON.stringify(card.changed)?.slice(0, 400)}, where the merge base shows ${JSON.stringify(expected).slice(0, 400)}`];
      });
      expect(wrong, `each of the five cards must show what the merge base shows: ${wrong.join('; ')}`).toEqual([]);
      expect(shown.length, 'five cards, one per ask').toBe(5);

      expect(starts.length, `one Needs you load of five asks pinned to one commit started ${starts.length} git processes, where three run each git command once per worktree and commit: ${byCommand(starts)}`).toBe(3);
    } finally {
      await b.close();
    }
  }, 60_000);
});
