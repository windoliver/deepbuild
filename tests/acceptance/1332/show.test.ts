// AC6 and AC7, on one run: an issue whose `Runs on:` line names a machine this host can't serve starts nothing and
// says what it waits for; `deep work show` prints the record's state word for each issue, never one from a comment.
import { expect, test } from 'vitest';
import { must, mustFail, MIN, named, recordWords, sleep, waitUntil, World, type Ran } from './helpers.ts';

const MAC = 100;
/** The Spark, Linux on aarch64 (docs/parallel-proof.md): a Mac host can't serve it. */
const SPARK = 101;
const AFTER = 102;
const SET = [MAC, SPARK, AFTER];
const SCOPE = 'work through #100, #101 and #102 with Claude Code, two at a time';
/** The state words people see (design: States people see). */
const WORDS = ['queued', 'working', 'says done', 'PASS', 'sent back', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'needs you', 'stale', 'quiet', 'stuck', 'flagged', 'finished', 'running'];

/** The run on this Mac: #100 runs on the Mac, #101 on the Spark, #102 after #100; until #100 and #102 have landed. */
async function scene(plant?: string): Promise<{ w: World; asked: Ran }> {
  const w = await World.open({ issues: [{ runsOn: 'Mac' }, { runsOn: 'Spark' }, { blockedBy: [MAC] }], ...(plant ? { plant } : {}) });
  const asked = await w.run(SCOPE);
  if (asked.code !== 0) return { w, asked };
  await w.approve(asked);
  await waitUntil(() => w.merged(MAC) && w.merged(AFTER), 40 * MIN, 2000);
  await sleep(20_000);
  return { w, asked };
}
let shared: Promise<{ w: World; asked: Ran }> | undefined;

/**
 * The judgement of AC7: a comment on #100 says another state word than the record's, then `deep work show` prints, for
 * each issue, the word the record holds. Read again while the record moves under it.
 */
async function sameWords(w: World): Promise<void> {
  const own = recordWords(await w.events()).get(MAC)?.word;
  must(own !== undefined, `the record holds no state word for #${MAC}`);
  const other = WORDS.find((x) => x !== own && x !== 'PASS') ?? 'needs you';
  w.forge.comment(MAC, `State: ${other}`);
  let said = '';
  for (let tries = 1; ; tries++) {
    const before = recordWords(await w.events());
    const s = await w.show();
    const after = recordWords(await w.events());
    const moved = SET.some((n) => before.get(n)?.word !== after.get(n)?.word);
    said = s.ran.stdout.slice(-2500);
    if (moved && tries < 5) { await sleep(2000); continue; }
    for (const n of SET) {
      must(after.has(n), `the record holds no state word for #${n}`);
      must(s.rows.has(n), `deep work show prints no row for #${n}: ${said}`);
      must(s.rows.get(n)!.word === after.get(n)!.word, `deep work show prints "${s.rows.get(n)!.word}" for #${n}, but the record's state word for it is "${after.get(n)!.word}"`);
    }
    return;
  }
}

test(named(6), async () => {
  const { w, asked } = await (shared ??= scene());
  expect(asked.code, `deep work "${SCOPE}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  expect(w.merged(MAC), `the run serves the Mac's issue: #${MAC} landed`).toBe(true);
  expect(w.on(SPARK).map((l) => `${l.agent} at ${new Date(l.started).toISOString()}`), `#${SPARK} runs on the Spark, which this Mac can't serve: it starts nothing`).toEqual([]);
  expect((await w.events()).filter((e) => e.kind === 'start.started' && e.data.issue === SPARK).length, `the record holds no start for #${SPARK}`).toBe(0);
  const s = await w.show();
  const row = s.rows.get(SPARK);
  expect(row, `deep work show prints #${SPARK}'s row: ${s.ran.stdout.slice(-2000)} ${s.ran.stderr.slice(-400)}`).toBeDefined();
  expect(row!.text, `#${SPARK}'s row reads what it waits for: the machine its Runs on: line names`).toContain('Spark');
}, 60 * MIN);

test(named(7), async () => {
  const { w, asked } = await (shared ??= scene());
  expect(asked.code, `deep work "${SCOPE}" raises the run's one approval and exits 0: exit ${asked.code}, ${asked.stderr.slice(-600)}`).toBe(0);
  await sameWords(w);

  const planted = await scene('state-from-comment');
  expect(planted.asked.code, `the planted run's approval: exit ${planted.asked.code}`).toBe(0);
  await mustFail('a reader that takes a state from a comment', () => sameWords(planted.w), [`#${MAC}`]);
}, 90 * MIN);
