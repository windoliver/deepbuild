// AC8: budgets, on the reference Mac in the local preflight, compared with the merge base: a verdict's status posts
// within 5 s, with at most one API call per verdict and backoff on rate limits.
//
// The timing runs on the design's rule: a warm-up, five runs of twenty verdicts, each sample from the verdict.made's
// time to the status reaching the forge. Readings count only on a reference Mac (Mac15,7 or Mac15,12), Low Power Mode
// off, thermal state nominal, not loaded past its core count, on battery or mains alike; anywhere else that test skips as
// INCONCLUSIVE with the readings, never PASS. The merge base is measured by the same driver; a base with no poster has no
// reading, and nothing regresses from it. The call count and the backoff aren't timings, so they run anywhere.
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, type TestContext } from 'vitest';
import { AC8, cleanup, CURRENT, inconclusiveIfLoaded, judge, load, type Load, median, mergeBase, percentile, REPO, sleep, waitFor, World, type Checkout } from './helpers.ts';
import type { Forced } from './forge.ts';

const FILE = 'tests/acceptance/46/budgets.test.ts';
const LIMIT_MS = 5000;
const SAMPLES = 20;
/** How long a sample waits past the budget before it reads as no status. */
const SAMPLE_WAIT = 2 * LIMIT_MS;

interface Reading { checkout: string; ms: number[]; failures: string[]; loads: Load[] }
const shownReading = (r: Reading) => `${r.checkout}: ${r.ms.map((x) => x.toFixed(0)).join('/')} ms; ${r.failures.join('; ').slice(0, 800)}`;

async function measure(co: Checkout, n = SAMPLES): Promise<Reading> {
  const reading: Reading = { checkout: co.label, ms: [], failures: [], loads: [load()] };
  const w = await World.start({ co });
  const s = await w.session();
  try {
    for (let i = 0; i < n; i++) {
      const sha = await s.commitFile(`notes/sample-${i}.md`);
      await s.push();
      const made = await s.verdict(await s.claim(sha), 'PASS');
      const status = await waitFor(() => w.forge.latest(sha), SAMPLE_WAIT, `status on ${sha}`).catch(() => undefined);
      if (!status) { reading.failures.push(`no status on ${sha} within ${SAMPLE_WAIT} ms of its verdict (${co.label})`); break; }
      reading.ms.push(status.at - made.ts);
    }
    reading.loads.push(load());
    return reading;
  } finally {
    s.claude.quit();
    await w.stop();
  }
}
async function measured(ctx: TestContext, co: Checkout): Promise<Reading> {
  const r = await measure(co);
  if (r.failures.length) {
    inconclusiveIfLoaded(ctx, [...r.loads, load()], shownReading(r));
    throw Error(r.failures.join('\n'));
  }
  return r;
}

describe(`${AC8} Budgets, on the reference Mac in the local preflight, compared with the merge base: a verdict's status posts within 5 s, with at most one API call per verdict and backoff on rate limits`, () => {
  afterAll(cleanup, 120_000);

  it(`${AC8} the local preflight runs ${FILE}: a check lane runs it with Vitest, one file at a time, not excluded`, async () => {
    const { checks } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: { name: string; commands: string[][] }[] };
    const covers = (arg: string) => arg === FILE || (arg.endsWith('/') && FILE.startsWith(arg)) || (arg.endsWith('/**') && FILE.startsWith(arg.slice(0, -2)));
    const runs = checks.flatMap((lane) => lane.commands.map((command) => ({ lane: lane.name, command })))
      .filter(({ command }) => command.some((a) => /vitest/.test(a)) && command.includes('--no-file-parallelism') && command.some((a, i) => covers(a) && command[i - 1] !== '--exclude'));
    expect(runs.map((r) => r.lane), `some lane must run ${FILE} with --no-file-parallelism`).not.toEqual([]);
  });

  it(`${AC8} on the reference Mac, a verdict's status reaches the forge within ${LIMIT_MS} ms at p95, over a warm-up and five runs of ${SAMPLES} verdicts, compared with the merge base`, async (ctx) => {
    const warm = await measured(ctx, CURRENT);
    console.log(`${AC8} warm-up: ${shownReading(warm)}`);
    inconclusiveIfLoaded(ctx, warm.loads, `readings only. ${shownReading(warm)}`);
    const base = await measure(await mergeBase(), 1).then(async (first) => (first.ms.length ? measure(await mergeBase()) : first));
    console.log(`${AC8} merge base: ${shownReading(base)}`);
    const runs: Reading[] = [];
    for (let i = 0; i < 5; i++) {
      runs.push(await measured(ctx, CURRENT));
      console.log(`${AC8} run ${i + 1}: ${shownReading(runs[i]!)}`);
    }
    const judged = judge(`${AC8} verdict to status, p95`, runs.map((r) => percentile(r.ms, 95)), LIMIT_MS, 'ms');
    console.log(`${judged.verdict} ${judged.text}`);
    inconclusiveIfLoaded(ctx, runs.flatMap((r) => r.loads), `readings only. ${judged.text}`);
    const mine = median(runs.flatMap((r) => r.ms));
    const regressed: string[] = [];
    if (base.ms.length) {
      const theirs = median(base.ms);
      console.log(`${AC8} median ${mine.toFixed(1)} ms against the merge base's ${theirs.toFixed(1)} ms`);
      if (mine > theirs * 1.5) regressed.push(`median ${mine.toFixed(1)} ms against the merge base's ${theirs.toFixed(1)} ms`);
    } else console.log(`${AC8} median ${mine.toFixed(1)} ms; the merge base has no reading: ${base.failures.join('; ').slice(0, 400)}`);
    expect([...(judged.verdict === 'FAIL' ? [`FAIL ${judged.text}`] : []), ...regressed.map((r) => `FAIL ${AC8} ${r}`)], 'the budget within its limit and no regression from the merge base').toEqual([]);
    if (judged.verdict === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${judged.text}`);
  }, 7_200_000);
});

describe(`${AC8} One API call per verdict, and backoff on rate limits`, () => {
  afterEach(cleanup, 60_000);

  it(`${AC8} each verdict costs one call that names its commit: its POST, with no read of the commit or its statuses first`, async () => {
    const w = await World.start();
    const s = await w.session();
    const shas: string[] = [];
    for (let i = 0; i < 5; i++) {
      const sha = await s.commitFile(`notes/call-${i}.md`);
      await s.push();
      await s.verdict(await s.claim(sha), i % 2 ? 'BLOCKED' : 'PASS');
      await w.status(sha);
      shas.push(sha);
    }
    await sleep(1000);
    for (const sha of shas) {
      const calls = w.forge.calls.filter((c) => c.path.includes(sha) && !c.path.includes('/compare/'));
      expect(calls.map((c) => `${c.method} ${c.path}`), `the calls naming ${sha}`).toEqual([`POST /repos/acme/shop/statuses/${sha}`]);
    }
    expect(w.forge.calls.filter((c) => c.method === 'GET' && c.path === '/repos/acme/shop').length, 'the repo isn\'t read per verdict').toBeLessThan(shas.length);
  }, 300_000);

  const WAIT_S = 3;
  const shapes: [string, () => { forced: Forced; notBefore: (at: number) => number }][] = [
    ['a 429 with Retry-After', () => ({ forced: { status: 429, headers: { 'retry-after': String(WAIT_S) }, message: 'API rate limit exceeded' }, notBefore: (at) => at + WAIT_S * 1000 }) ],
    ['a 403 with Retry-After, GitHub\'s secondary limit', () => ({ forced: { status: 403, headers: { 'retry-after': String(WAIT_S) }, message: 'You have exceeded a secondary rate limit' }, notBefore: (at) => at + WAIT_S * 1000 }) ],
    ['a 403 with no calls left until X-RateLimit-Reset, GitHub\'s primary limit', () => {
      const reset = Math.ceil(Date.now() / 1000) + WAIT_S + 6;
      return { forced: { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }, message: 'API rate limit exceeded' }, notBefore: () => reset * 1000 };
    }],
  ];
  it.each(shapes)(`${AC8} %s: no call reaches the forge until the limit lifts, a second verdict meanwhile waits too, and each then posts once`, async (_, shape) => {
    const w = await World.start();
    const s = await w.session();
    const first = await s.commitFile('notes/first.md');
    const second = await s.commitFile('notes/second.md');
    await s.push();
    const claims = [await s.claim(first), await s.claim(second)];
    const { forced, notBefore } = shape();
    w.forge.limitNext(forced);
    await s.verdict(claims[0]!, 'PASS');
    const refused = await waitFor(() => w.forge.posts()[0], 30_000, 'the first POST');
    expect(refused.status, 'the forge refused it').toBe(forced.status);
    await s.verdict(claims[1]!, 'BLOCKED');
    const [a, b] = [await w.status(first), await w.status(second)];
    expect([a.state, b.state], 'both land once the limit lifts').toEqual(['success', 'pending']);
    const lifted = notBefore(refused.at);
    const after = w.forge.posts().slice(1);
    expect(after.filter((c) => c.at < lifted).map((c) => `${c.path} ${lifted - c.at} ms early`), 'no POST before the limit lifts').toEqual([]);
    await sleep(1000);
    expect(w.forge.posts().length, 'one refused, then one for each verdict').toBe(3);
  }, 300_000);
});
