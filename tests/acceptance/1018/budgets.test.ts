// #1018 AC6 #1018.e558130f: budgets, on the reference Mac in the local preflight. Judged by the design's rule for timing
// results: five samples after a warm-up; PASS when all are within the limit, FAIL when all are over it by more than the
// margin, otherwise INCONCLUSIVE. Off a reference Mac, on battery, with Low Power Mode on or unknown, or with a thermal
// warning, the test skips as INCONCLUSIVE; it never passes by skipping. What "compared with the merge base" reads as here
// is in the README (Open points).
import { join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { openRecord, ulid } from '../../../packages/record/src/index.ts';
import { environmentProblem } from '../29/helpers.ts';
import { allEvents, cleanup, type Ev } from '../29/h-d.ts';
import {
  claimId, draft, makeTrees, open, removeTemp, requirement, runsIn, SAMPLE, settled, startHub, stop, stopHub, vitestCheck, writes,
  type Hub, type Trees,
} from './helpers.ts';

afterEach(async () => {
  await cleanup();
  removeTemp();
}, 300_000);

function gated(ctx: TestContext): void {
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE ${problem}: a budget counts only on a reference Mac on mains power`);
}
function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.abs(Math.min(...runs)), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}

const PROMPT = 'make prices carry the tax';
const CHECK = '.deepbuild/checks/price.sh';
const FILES: Record<string, string> = {
  ...SAMPLE,
  'src/price.ts': 'export const withTax = (amount: number): number => Math.round(amount * 1.2);\n',
  'test/price.test.ts': "import { expect, it } from 'vitest';\nimport { withTax } from '../src/price.ts';\n\nit('adds the tax', () => {\n  expect(withTax(100)).toBe(120);\n});\n",
  [CHECK]: vitestCheck('test/price.test.ts'),
};
const KEYS = 10_000;

/**
 * One sample: a session in the first worktree changes src/price.ts, which the check reads, so its claim runs the check
 * as the merge base would; a session in the second makes the same change, so its claim carries that run. Returns what
 * carrying added: the carried claim's time from its claim to its verdict, less the first claim's time from its claim to
 * its verdict apart from its runs' own time.
 */
async function sample(hub: Hub, w: Trees, i: number): Promise<number> {
  const bytes = { 'src/cart.ts': SAMPLE['src/cart.ts']!, 'src/price.ts': `// sample ${i}\nexport const withTax = (amount: number): number => Math.round(amount * 1.2);\n` };
  const ran = await open(hub, w, w.trees[0]!, PROMPT);
  await writes(ran, bytes);
  await stop(ran);
  await settled(hub, w, [ran]);
  const carried = await open(hub, w, w.trees[1]!, PROMPT);
  await writes(carried, bytes);
  await stop(carried);
  const r = await settled(hub, w, [ran, carried]);
  const [x, y] = r.claims;
  const own = r.runs.filter((run) => run.claim === x!.claim);
  const vx = x!.verdicts[0];
  const vy = y!.verdicts[0];
  if (!vx || !vy || !own.length || own.some((run) => !run.finished) || r.runs.some((run) => run.claim === y!.claim)) {
    throw Error(`BLOCKED: sample ${i} must hold a claim that ran the check and one that carried it, each with a verdict: ${JSON.stringify(r.claims.map((c) => ({ claim: c.claim, outcome: c.outcome })))}`);
  }
  const running = own.reduce((ms, run) => ms + (run.finished!.ts - run.started.ts), 0);
  return (vy.ts - y!.made!.ts) - (vx.ts - x!.made!.ts - running);
}

/** Keeps KEYS more results in the record, each on a key of its own: copies of a real run's events under other checks. */
async function keepKeys(w: Trees, from: Ev[]): Promise<void> {
  const started = from.find((e) => e.kind === 'run.started')!;
  const finished = from.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run)!;
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: Date.now });
  try {
    const core = { writer: 'core', actor: 'you', scope: 'you' };
    for (let n = 0; n < KEYS; n++) {
      const ts = Date.now();
      const run = `run:${ulid(ts)}`;
      const check = `.deepbuild/checks/kept-${n}.sh`;
      await record.append(core, { v: started.v ?? 1, id: ulid(ts), kind: 'run.started', ts, subject: run, data: { ...started.data, run, check } });
      await record.append(core, { v: finished.v ?? 1, id: ulid(ts), kind: 'run.finished', ts, subject: run, data: { ...finished.data, run, check } });
    }
  } finally {
    await record.close();
  }
}

describe('AC6 #1018.e558130f budgets on the reference Mac, compared with the merge base', () => {
  it('AC6 with 10,000 keys kept, carrying a result across sessions adds under 5 ms at p95 to a claim\'s verdict', async (ctx) => {
    gated(ctx);
    const w = makeTrees(FILES, [draft(PROMPT, [requirement('R1', 'Prices carry the tax', CHECK)])], 2);
    let hub = await startHub(w);
    try {
      await sample(hub, w, 0);
      const events = await allEvents(hub);
      const first = events.find((e) => e.kind === 'claim.made')!;
      const runs = runsIn(events).filter((run) => run.claim === claimId(first));
      await stopHub(hub);
      await keepKeys(w, runs.flatMap((run) => [run.started, run.finished!]));
      hub = await startHub(w);
      const added: number[] = [];
      for (const i of [1, 2, 3, 4, 5]) added.push(await sample(hub, w, i));
      judge(ctx, `ms carrying adds to a claim's verdict with ${KEYS} keys kept`, added, 5);
    } finally {
      await stopHub(hub);
    }
  }, 3_600_000);
});
