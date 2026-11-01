// AC2: every model job goes through the runner (your harness) and the hub holds no model key; a failed job returns its
// failure, never canned text, and nothing it would send goes out (README, Readings: AC2). The sandboxed stocks plug-in
// runs a job through deep.runner.run; the host was opened with the world's runner, whose agent is the fake `claude` on
// your fake sign-in. The wrong programs are a hub that answers a model job itself on a key it holds, and one that
// hands a failed job's caller canned text, each modelled beside the real runner and the same judge.
import { describe, expect, it } from 'vitest';
import {
  act, at, filesUnder, gotOf, ID, initOf, jobsOf, ME, REFRESH, stdinOf, stocksWorld, STOCKS_ID, TOKEN, YOU, type Got, type StocksWorld,
} from './helpers.ts';
import { failedJobProblems, throughRunnerProblems, type RunnerRun } from './judges.ts';

const VALUE = 'NVDA closed at 187.25, under your 200 target';
const ANSWER = `@answer ${JSON.stringify({ value: VALUE, cites: [] })}`;
const FAIL = '@fail rate_limit';

/** Where the hub keeps anything: its root, record, evidence; and every event. Which of them holds either sign-in token. */
async function keyHits(s: StocksWorld): Promise<string[]> {
  const hits: string[] = [];
  for (const f of filesUnder(s.w.dir)) for (const [name, v] of [['access token', TOKEN], ['refresh token', REFRESH]] as const) if (f.text.includes(v)) hits.push(`${f.path} holds your ${name}`);
  const events = JSON.stringify(await s.w.events());
  if (events.includes(TOKEN) || events.includes(REFRESH)) hits.push('the record holds a sign-in token');
  return hits;
}
async function asked(s: StocksWorld, prompt: string): Promise<Got> {
  return gotOf(await act(s.h, 'ask', { prompt, inputs: [] }));
}
async function runnerRun(s: StocksWorld, got: Got): Promise<RunnerRun> {
  const jobs = (await jobsOf(s.w)).map((j) => ({ rec: j.rec, stdin: stdinOf(j.stdout), apiKeySource: initOf(j.stdout)?.apiKeySource }));
  return { got, expected: VALUE, promptLine: ANSWER, jobs, asked: s.asked, keyHits: await keyHits(s) };
}

describe(`AC2 ${ID.ac2} Every model job goes through the runner (your harness) and the hub holds no model key; a failed job returns its failure, never canned text, and nothing it would send goes out`, () => {
  it('AC2 a plug-in\'s model job runs once on your agent through the runner, on your sign-in, and its answer is what the agent gave; the hub calls no model host and holds no key', async () => {
    const s = await stocksWorld(at('2026-11-02T10:00'));
    const got = await asked(s, ANSWER);
    expect(throughRunnerProblems(await runnerRun(s, got))).toEqual([]);
  }, 180_000);

  it('AC2 (wrong program) a hub that answers the job itself, calling the model host on a key it holds, fails, naming the call and the key', async () => {
    const s = await stocksWorld(at('2026-11-02T10:00'));
    // The wrong hub: the job never reaches the runner; the hub calls api.anthropic.com with the key it keeps in its root.
    const run = await runnerRun(s, { ok: true, answer: { handle: 'reading:01TWIN', value: VALUE, cites: [], as_of: s.c.now(), stale_at: s.c.now() } });
    run.asked = [...run.asked, { url: 'https://api.anthropic.com/v1/messages', method: 'POST', headers: { 'x-api-key': TOKEN }, body: '{}' }];
    run.keyHits = [...run.keyHits, `${s.w.home}/model-key holds your access token`];
    const problems = throughRunnerProblems(run);
    expect(problems.some((p) => p.includes('api.anthropic.com')), JSON.stringify(problems)).toBe(true);
    expect(problems.some((p) => p.includes('holds a model key')), JSON.stringify(problems)).toBe(true);
    expect(problems.some((p) => p.includes('didn\'t go through the runner')), JSON.stringify(problems)).toBe(true);
  }, 180_000);

  it('AC2 a job that fails rate_limited returns that failure to the plug-in, never an answer, and the brief it would send never goes out', async () => {
    const s = await stocksWorld(at('2026-11-02T10:00'));
    await s.h.setSendRule(YOU, { sentence: 'my stock brief, to me', piece: STOCKS_ID, recipients: [ME], schedule: null });
    // The control: a brief whose job answers goes out.
    await act(s.h, 'brief', { prompt: ANSWER, inputs: [], key: 'brief-answered', to: ME });
    expect(s.mail.seen.filter((r) => r.body.includes('brief-answered')).length, `a brief whose job answered goes out: ${JSON.stringify(s.mail.seen)}`).toBe(1);
    const got = await asked(s, FAIL);
    await act(s.h, 'brief', { prompt: FAIL, inputs: [], key: 'brief-failed', to: ME });
    const problems = failedJobProblems({
      got, jobs: (await s.w.runner.list()), key: 'brief-failed',
      reachedProvider: s.mail.seen.filter((r) => r.body.includes('brief-failed')).length, sent: (await s.h.sends()).map((r) => ({ key: r.key, outcome: r.outcome })),
    });
    expect(problems).toEqual([]);
  }, 240_000);

  it('AC2 (wrong program) a hub that hands a failed job\'s caller canned text, which the brief then sends, fails, naming the canned text and the send', async () => {
    const s = await stocksWorld(at('2026-11-02T10:00'));
    await s.h.setSendRule(YOU, { sentence: 'my stock brief, to me', piece: STOCKS_ID, recipients: [ME], schedule: null });
    // The real runner fails the job; the wrong hub turns the failure into text, and the plug-in sends what it was given.
    const failed = await s.w.runner.run({ kind: 'read', agent: 'claude-code', prompt: FAIL, deadline_ms: 120_000 });
    const canned = 'The summary is not available right now.';
    await act(s.h, 'brief', { prompt: ANSWER.replace(VALUE, canned), inputs: [], key: 'brief-failed', to: ME });
    const problems = failedJobProblems({
      got: { ok: true, answer: { handle: 'reading:01TWIN', value: canned, cites: [], as_of: s.c.now(), stale_at: s.c.now() } }, jobs: [failed], key: 'brief-failed',
      reachedProvider: s.mail.seen.filter((r) => r.body.includes('brief-failed')).length, sent: (await s.h.sends()).map((r) => ({ key: r.key, outcome: r.outcome })),
    });
    expect(problems.some((p) => p.includes('canned text') && p.includes(canned)), JSON.stringify(problems)).toBe(true);
    expect(problems.some((p) => p.includes('brief-failed') && p.includes('went out')), JSON.stringify(problems)).toBe(true);
  }, 240_000);
});
