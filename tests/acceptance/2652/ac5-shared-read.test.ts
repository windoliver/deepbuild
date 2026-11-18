// #2652 AC5 #2652.669feed5: a planted runner that shares one `read` list between two runs and then changes it for one
// fails, naming the other run.
//
// Through a real hub (`deep hub run`), deep-hook and #29's Claude Code stand-in, with #1018's helpers. Two kept runs of
// one check whose read lists are equal: in the hub's first life, a session in each of two worktrees cut from one commit
// makes the check pass on its own src/cart.ts, A in the first and B in the second, so both runs read the same files with
// other contents, each on its own key. The hub stops and starts again on that record, so both are kept runs it reads at
// its start (#1018). In its second life a new session in each worktree makes the same change: each claim must read its
// worktree's kept run as carried, naming it, and run nothing of the check itself. The planted runner gives B the list
// A's `read` and key are, then changes it for A; B's claim no longer finds B, and the judgement fails naming B.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '../29/h-d.ts';
import { git } from '../31/helpers.ts';
import {
  draft, makeTrees, open, removeTemp, requirement, SAMPLE, settled, shownReading, startHub, stop, stopHub, verdictText, writes,
  type ClaimRead, type Reading, type RunRead, type Trees, type Worker,
} from '../1018/helpers.ts';
import { AC5, PLANTS } from './helpers.ts';

afterEach(async () => {
  await cleanup();
  removeTemp();
}, 300_000);

const PROMPT = 'note in the cart module which session tallied it';
const CHECK = '.deepbuild/checks/cart.sh';
/** A node:test check that reads src/cart.ts, so the run's read files hold it, and passes on either session's version. */
const CART_TEST = "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { readFileSync } from 'node:fs';\n\ntest('the cart module totals its items', () => {\n  assert.ok(readFileSync('src/cart.ts', 'utf8').includes('export function total'));\n});\n";
const FILES: Record<string, string> = { ...SAMPLE, 'test/cart.test.mjs': CART_TEST, [CHECK]: 'node --test test/cart.test.mjs\n' };
/** Each worktree's src/cart.ts: the same file but for one line, so its runs read the same paths and hold other contents. */
const cartOf = (tree: number): string => `${SAMPLE['src/cart.ts']}// tallied by session ${tree}\n`;

/** The runs of the check a claim ran itself. */
const ownRuns = (r: Reading, c: ClaimRead): RunRead[] => r.runs.filter((x) => x.claim === c.claim && x.check === CHECK);
/** A session in each worktree, one after the other, each making its worktree's change and stopping. */
async function bothTrees(hub: Awaited<ReturnType<typeof startHub>>, w: Trees): Promise<Reading> {
  const workers: Worker[] = [];
  for (const [i, tree] of w.trees.entries()) {
    const k = await open(hub, w, tree, PROMPT);
    await writes(k, { 'src/cart.ts': cartOf(i + 1) });
    await stop(k);
    await settled(hub, w, [...workers, k]);
    workers.push(k);
  }
  return settled(hub, w, workers);
}

interface Scenario { kept: RunRead[]; second: Reading }
/** The hub's first life makes the two kept runs; its second, started with `plant`, reads them at its start. */
async function scenario(plant?: string): Promise<Scenario> {
  const w = makeTrees(FILES, [draft(PROMPT, [requirement('R1', 'The cart module says which session tallied it', CHECK)])], 2);
  let hub = await startHub(w);
  let first: Reading;
  try {
    first = await bothTrees(hub, w);
  } finally {
    await stopHub(hub);
  }
  const kept = first.claims.map((c) => ownRuns(first, c)[0]!);
  const keyOf = (x: RunRead | undefined) => x?.finished?.data.key as { id: string; paths: string[] } | undefined;
  const [a, b] = [keyOf(kept[0]), keyOf(kept[1])];
  // The setup, not the criterion: two passed runs, each on a key of its own, whose paths are one list's and hold src/cart.ts.
  if (kept.length !== 2 || kept.some((x) => x?.outcome !== 'passed') || !a || !b || a.id === b.id || JSON.stringify(a.paths) !== JSON.stringify(b.paths) || !a.paths.includes('src/cart.ts')) {
    throw Error(`BLOCKED: the first life must keep two passed runs of ${CHECK}, one per worktree, on two keys with equal paths that hold src/cart.ts: ${JSON.stringify(kept.map((x) => ({ run: x?.run, outcome: x?.outcome, key: x?.finished?.data.key })))}; ${shownReading(first)}`);
  }
  for (const tree of w.trees) git(tree, ['checkout', '--', 'src/cart.ts']);
  hub = await startHub(w, { plant });
  try {
    return { kept, second: await bothTrees(hub, w) };
  } finally {
    await stopHub(hub);
  }
}

/**
 * Each kept run carries its result to the second life's claim in its worktree: the claim's verdict names that run and
 * marks it carried, and the claim ran no run of the check itself. Every kept run that doesn't is named.
 */
function eachCarries(r: Scenario): void {
  const wrong: string[] = [];
  for (const [i, run] of r.kept.entries()) {
    const c = r.second.claims[i]!;
    const text = verdictText(c);
    const own = ownRuns(r.second, c);
    if (text.includes(run.run) && /\bcarried\b/i.test(text) && !own.length) continue;
    wrong.push(`${run.run}, kept from the first life's claim in ${c.tree.split('/').pop()}, must carry its ${run.outcome} to ${c.claim} there, on the same files: the claim ${own.length ? `ran ${own.map((x) => x.run).join(', ')} itself` : 'ran nothing of the check'} and its verdict says ${JSON.stringify(text.slice(0, 600))}`);
  }
  expect(wrong, `Each kept run carries its result to a claim with an equal key:\n${wrong.join('\n')}\n${shownReading(r.second)}`).toEqual([]);
}

describe(`${AC5} a planted runner that shares one read list between two runs and then changes it for one fails, naming the other run`, () => {
  it(`${AC5} two kept runs of one check with equal read lists each carry their result to the next life's claim in their worktree`, async () => {
    eachCarries(await scenario());
  }, 3_600_000);

  it(`${AC5} (wrong program ${PLANTS.sharedRead}) a runner that gives B the list A's read is and then changes it for A fails, naming B`, async () => {
    const r = await scenario(PLANTS.sharedRead);
    let message: string | null = null;
    try { eachCarries(r); } catch (error) { message = error instanceof Error ? error.message : String(error); }
    const other = r.kept[1]!.run;
    expect(message, `${PLANTS.sharedRead}: the planted runner passed the judgement, so it proves nothing`).not.toBeNull();
    expect(message, `${PLANTS.sharedRead}: the failure must name the other run, B, ${other}`).toContain(other);
  }, 3_600_000);
});
