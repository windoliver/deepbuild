// #159 AC8, AC11, AC12, AC14 and AC20's runner half: what a job waits on before it starts. A job that would bill an
// API key waits for a budget; a job waits at your reserve on its account's 5-hour window, and for the account's
// first reading; an account with no reading for 30 minutes raises one unblock ask; and an agent version the facts
// don't cover runs only its smoke test, under the standing approval you gave, without widening the range.
// The clock is the world's (world.ts): the test moves it past resets and the 30 minutes, then calls the runner's
// tick, as the hub does on its own cadence; the processes themselves run in real time.
import { dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNT, cleanup, coveredVersions, DAY, install, launches, MINUTE, sleep, sub, tempDir, ulid, uuid, waitFor } from './helpers.ts';
import { card, claudeLimits, dataOf, job, openWorld, room, type World } from './world.ts';
import type { JobRecord, Plant } from '../../../packages/runner/src/index.ts';

afterEach(cleanup, 30_000);

/** How long a job that may start gets to show a process, in real time, with no clock moved and no tick. */
const AT_ONCE_MS = 5000;
/** Calls tick while the clock moves through `ms` in 10 s steps, until `done` holds; false if it never did. */
async function within(w: World, ms: number, done: () => Promise<boolean>): Promise<boolean> {
  for (let moved = 0; ; moved += 10_000) {
    await w.runner.tick();
    if (await done()) return true;
    if (moved >= ms) return false;
    w.clock.advance(10_000);
    await sleep(50);
  }
}
const started = async (w: World, id: string): Promise<boolean> => (await w.runner.status(id)).pid !== undefined;
async function notStarted(w: World, bin: string, ids: string[], what: string): Promise<JobRecord[]> {
  await sleep(1500);
  const recs = await Promise.all(ids.map((id) => w.runner.status(id)));
  for (const rec of recs) expect(rec.pid, `${what}: ${rec.job} has a process: ${JSON.stringify(rec)}`).toBeUndefined();
  expect(launches(bin), `${what}: a job's CLI is running`).toEqual([]);
  return recs;
}

describe('AC8 #159.975793ea a job on your plan that would bill an API key starts only under a budget', () => {
  it('AC8 a job on your plan with ANTHROPIC_API_KEY set doesn\'t start without a budget that covers it, and says which key', async () => {
    const bin = install(sub(tempDir(), 'bin'));
    const key = `sk-ant-api03-dh159FAKE-${uuid()}`;
    const issue = 'windoliver/deepbuild#159';
    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin`, env: { ANTHROPIC_API_KEY: key } });
    try {
      await room(w);
      const first = await w.runner.submit(job('draft', 'Draft.\n@sleep 100', { issue }));
      // A budget for another issue doesn't cover it.
      await w.ledger.approve(card, { scope: { kind: 'issue', ref: 'windoliver/deepbuild#1' }, cap_usd: 5, ends: w.clock.now() + DAY });
      await w.runner.tick();
      const [rec] = await notStarted(w, bin, [first.job], 'with no budget that covers it');
      const said = JSON.stringify(rec);
      expect(said, 'the job says which key would bill').toContain('ANTHROPIC_API_KEY');
      expect(said.includes(key), 'the job\'s record holds the key\'s value').toBe(false);
      expect(rec!.state, said).not.toBe('finished');
      // With a budget that covers it, a job starts.
      await w.ledger.approve(card, { scope: { kind: 'issue', ref: issue }, cap_usd: 5, ends: w.clock.now() + DAY });
      await w.runner.tick();
      const second = await w.runner.run(job('draft', 'Draft.', { issue }));
      expect(second.state, `a job under a budget that covers it: ${JSON.stringify(second)}`).toBe('finished');
    } finally {
      await w.close();
    }
  }, 120_000);
});

describe('AC11 #159.1cc6000c at your reserve on the 5-hour window, jobs wait and the claim shows BLOCKED: plan window', () => {
  it('AC11 with the account\'s 5-hour window at 92% and a 10% reserve, a review check and a drafting job start no process and the claim shows BLOCKED, cause plan window; when the window resets both start within 60 s; a job on another account with room starts at once', async () => {
    const bin = install(sub(tempDir(), 'bin'));
    const other = uuid();
    const claim = `claim:${ulid()}`;
    const task = `task:${ulid()}`;
    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin`, reservePct: 10 });
    try {
      const resets = w.clock.now() + 2 * 3_600_000;
      await w.runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: claudeLimits(92, resets) });
      await w.runner.report({ agent: 'claude-code', account: other, rate_limits: claudeLimits(20, w.clock.now() + 3 * 3_600_000) });
      const review = await w.runner.submit(job('review', 'Review.\n@sleep 100', { claim, task }));
      const draft = await w.runner.submit(job('draft', 'Draft.\n@sleep 100', { claim, task }));
      const recs = await notStarted(w, bin, [review.job, draft.job], 'at the reserve');
      for (const rec of recs) {
        expect(rec.blocked, `${rec.job} shows what it waits on`).toMatchObject({ status: 'BLOCKED', cause: 'plan window', owner: 'you' });
        expect(typeof rec.blocked!.since, 'since').toBe('number');
        expect(rec.blocked!.on, 'the claim waiting on it shows BLOCKED').toContain(claim);
      }
      const elsewhere = await w.runner.submit(job('read', 'Read.\n@sleep 100', { account: other }));
      await waitFor(() => started(w, elsewhere.job), AT_ONCE_MS, 'the job on the other account, which has room, to start at once');
      // The window resets: the clock passes its reset time.
      w.clock.advance(resets - w.clock.now() + 1);
      const both = await within(w, 60_000, async () => (await started(w, review.job)) && (await started(w, draft.job)));
      expect(both, 'both jobs started within 60 s of the window\'s reset').toBe(true);
    } finally {
      await w.close();
    }
  }, 120_000);
});

describe('AC12 #159.efc3ed4c with no reading for an account yet, its jobs wait for the first; your sessions don\'t', () => {
  it('AC12 with no window reading for an account, a drafting job and a review check start no process and show they wait for its first reading; a reading with room above the reserve starts both within 60 s; nothing of yours waits on a reading', async () => {
    const bin = install(sub(tempDir(), 'bin'));
    const claim = `claim:${ulid()}`;
    const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin` });
    try {
      const draft = await w.runner.submit(job('draft', 'Draft.\n@sleep 100', { claim }));
      const review = await w.runner.submit(job('review', 'Review.\n@sleep 100', { claim }));
      for (const rec of await notStarted(w, bin, [draft.job, review.job], 'before the account\'s first reading')) {
        expect(rec.blocked?.cause, `${rec.job} shows it waits for the account's first reading: ${JSON.stringify(rec)}`).toMatch(/first reading/);
        expect(JSON.stringify(rec.blocked), 'it names the account').toContain(ACCOUNT);
      }
      expect((await w.asks.needsYou()).length, 'waiting for a first reading asks you nothing').toBe(0);
      await w.runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: claudeLimits(30, w.clock.now() + 3 * 3_600_000) });
      const both = await within(w, 60_000, async () => (await started(w, draft.job)) && (await started(w, review.job)));
      expect(both, 'both jobs started within 60 s of a reading with room').toBe(true);
    } finally {
      await w.close();
    }
  }, 120_000);
});

/** The unblock asks raised so far that name the account. */
async function unblockAsks(w: World): Promise<{ id: string; question: string; options: { id: string; label: string }[] }[]> {
  return (await w.events('ask.created')).filter((e) => dataOf(e).kind === 'unblock' && String(dataOf(e).question).includes(ACCOUNT))
    .map((e) => ({ id: `ask:${e.id}`, question: String(dataOf(e).question), options: dataOf(e).options as { id: string; label: string }[] }));
}

async function noReading(answer: 'run' | 'connect'): Promise<void> {
  const bin = install(sub(tempDir(), 'bin'));
  const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin` });
  try {
    const first = await w.runner.submit(job('draft', 'Draft.'));
    w.clock.advance(29 * MINUTE);
    await w.runner.tick();
    expect(await unblockAsks(w), 'an ask before 30 minutes without a reading').toEqual([]);
    w.clock.advance(MINUTE + 1000);
    await w.runner.tick();
    w.clock.advance(30 * MINUTE);
    await w.runner.tick();
    const asks = await unblockAsks(w);
    expect(asks.length, 'unblock asks naming the account after 30 and 60 minutes without a reading').toBe(1);
    const ask = asks[0]!;
    expect(ask.options.length, `its answers: ${JSON.stringify(ask.options)}`).toBe(2);
    const run = ask.options.find((o) => /without a reading/i.test(o.label) && /10/.test(o.label));
    const connect = ask.options.find((o) => /connect/i.test(o.label));
    expect(run, `an answer that runs jobs without a reading, at most 10 a day: ${JSON.stringify(ask.options)}`).toBeDefined();
    expect(connect, `an answer that connects a CLI that reports windows: ${JSON.stringify(ask.options)}`).toBeDefined();
    await w.asks.answer(card, ask.id, { option: (answer === 'run' ? run : connect)!.id });
    await w.runner.tick();
    if (answer === 'run') {
      expect(await within(w, 60_000, () => started(w, first.job)), 'the waiting job started after "run without a reading"').toBe(true);
      expect((await w.runner.wait(first.job)).state).toBe('finished');
      for (let i = 2; i <= 10; i++) {
        const rec = await w.runner.run(job('draft', `Draft ${i}.`));
        expect(rec.state, `job ${i} of 10 that day: ${JSON.stringify(rec)}`).toBe('finished');
      }
      const eleventh = await w.runner.submit(job('draft', 'Draft 11.'));
      expect(await within(w, 60_000, () => started(w, eleventh.job)), 'an 11th job that day started').toBe(false);
    } else {
      expect(await within(w, 60_000, () => started(w, first.job)), 'the job started with no reading after "connect a CLI"').toBe(false);
    }
    w.clock.advance(31 * MINUTE);
    await w.runner.tick();
    w.clock.advance(31 * MINUTE);
    await w.runner.tick();
    expect((await unblockAsks(w)).length, 'the ask repeated for the account after its answer').toBe(1);
  } finally {
    await w.close();
  }
}

describe('AC14 #159.9e5f5a51 30 minutes with no reading while a job waits: one unblock ask, never repeated', () => {
  it('AC14 with no window reading for an account for 30 minutes while a job waits, exactly one unblock ask names the account with two answers; after either answer it never repeats, and with the first an 11th job that day waits', async () => {
    await noReading('run');
    await noReading('connect');
  }, 300_000);
});

/** After Claude Code updates to a version its facts don't cover: its smoke test, and then a drafting job. */
async function smokeScenario(plant?: Plant): Promise<void> {
  const version = '2.1.999';
  expect(coveredVersions(), `the facts already cover ${version}; pick a newer uncovered version`).not.toContain(version);
  const bin = install(sub(tempDir(), 'bin'), { version });
  const w = await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin`, ...(plant ? { plant } : {}) });
  try {
    await room(w);
    const smoke = await w.runner.submit(job('smoke', 'Run the smoke test.'));
    await notStarted(w, bin, [smoke.job], 'without the standing approval');
    const asks = (await w.asks.needsYou()).filter((c) => c.kind === 'authority');
    expect(asks.length, 'one authority ask for the standing approval of Claude Code\'s smoke test').toBe(1);
    const shown = asks[0]!;
    const allow = shown.options.find((o) => o.decision === 'allow');
    expect(allow, `the ask offers an approval: ${JSON.stringify(shown.options)}`).toBeDefined();
    // At your reserve, even the approved smoke test waits.
    await w.runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: claudeLimits(95, w.clock.now() + 3 * 3_600_000) });
    // You click the approval on the card: the click's token, bound to the plan it showed, if it showed one.
    await w.asks.answer(card, shown.ask, { option: allow!.id, token: 'click-1', ...(shown.plan ? { plan_hash: shown.plan.hash } : {}) });
    await w.runner.tick();
    const held = (await notStarted(w, bin, [smoke.job], 'approved, at the reserve'))[0]!;
    expect(held.blocked?.cause, 'the smoke test waits inside your plan reserve').toBe('plan window');
    await room(w);
    expect(await within(w, 60_000, () => started(w, smoke.job)), 'the smoke test started under the standing approval').toBe(true);
    expect((await w.runner.wait(smoke.job)).state).toBe('finished');
    // The range is widened only by your approval of its recorded payloads' diff, never by its own run.
    const draft = await w.runner.run(job('draft', 'Draft.'));
    if (draft.state !== 'refused') throw Error(`the facts' range was widened to ${version} by the smoke test's own run, before you approved its diff: ${JSON.stringify(draft)}`);
    expect(String(draft.refused), 'the refusal names the version').toContain(version);
    // One standing approval: the next smoke test asks nothing.
    const again = await w.runner.run(job('smoke', 'Run the smoke test again.'));
    expect(again.state, JSON.stringify(again)).toBe('finished');
    expect((await w.asks.needsYou()).length, 'a second ask for the standing approval').toBe(0);
  } finally {
    await w.close();
  }
}

describe('AC20 #159.641cb71a an uncovered version runs only its smoke test, under your standing approval, and never widens itself', () => {
  it('AC20 (the runner\'s half) a smoke test on a version the facts don\'t cover waits for your one standing approval and your plan reserve, then runs; a drafting job on that version is still refused, naming it', async () => {
    await smokeScenario();
  }, 180_000);

  it('AC20 (wrong program) a runner that widens the facts\' range on the smoke test\'s own run fails, naming the version', async () => {
    await expect(smokeScenario('widens-range-on-smoke')).rejects.toThrow(/widened to 2\.1\.999/);
  }, 180_000);
});
