// #3178 AC2 `#3178.ea90fb17`: "A provisional ask still goes on at once. Given a choice with a recommendation in a
// session no work run started, when `deep_ask` runs, then it returns `provisional` with the recommended option (#84)."
//
// A real hub (`deep hub run`) in a temporary home and #667's agent stand-in (../667/helpers.ts, fixtures/agent.mjs),
// whose SessionStart, prompt and first tool call reach the hub through deep-hook, so the hub knows its session from
// hooks alone: no `deep work` run started it. The agent calls deep_ask through its own `deep mcp`.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { Agent, cleanup, createdOf, closings, events, question, startHub, writeSettings, makeHome, sleep, load, type Outcome } from '../667/helpers.ts';

const ID = '#3178.ea90fb17';
/** "At once": the issue's example returns in well under a second; this leaves room for a loaded machine. */
const AT_ONCE_MS = 15_000;

afterEach(cleanup, 60_000);
afterAll(cleanup, 60_000);

describe(`${ID} A provisional ask still goes on at once`, () => {
  it(`${ID} deep_ask with a recommended option, in a session no work run started, returns provisional with the recommended option at once, and the ask stays open for you`, async () => {
    const home = makeHome();
    writeSettings(home);
    const hub = await startHub(home, { confirm: 'confirmed' });
    const agent = Agent.start(home);
    await agent.establish(hub);
    await agent.initialize();

    // The recommended option is the second, so a hub that went on with the first or the default is caught too.
    const args = question('choice', 'Which store should the cache use?', [['redis', 'Redis'], ['sqlite', 'SQLite']], 'sqlite');
    const t0 = Date.now();
    type Got = { outcome?: Outcome; failed?: string };
    const call = agent.tool('deep_ask', args, 150_000).then((o): Got => ({ outcome: o }), (e: unknown): Got => ({ failed: String(e) }));
    const got: Got | undefined = await Promise.race([call, sleep(AT_ONCE_MS).then(() => undefined)]);
    const ms = Date.now() - t0;
    if (got?.failed) throw Error(`BLOCKED: the agent's deep_ask call failed: ${got.failed}`);

    expect(got === undefined ? `still waiting after ${ms} ms (load ${load()})` : 'returned', `${ID} deep_ask goes on at once: it must return within ${AT_ONCE_MS / 1000} s, never wait on you`).toBe('returned');
    const value = got!.outcome!.value;
    expect(got!.outcome!.isError, `${ID} deep_ask is no error: ${JSON.stringify(got!.outcome!.reply).slice(0, 1500)}`).toBe(false);
    expect({ status: value?.status, answer: value?.answer }, `${ID} deep_ask returns provisional with the recommended option (#84): ${JSON.stringify(value).slice(0, 1500)}`)
      .toEqual({ status: 'provisional', answer: 'sqlite' });
    expect(String(value?.ask), `${ID} deep_ask names the ask it raised: ${JSON.stringify(value)}`).toMatch(/^ask:[0-9A-Z]{26}$/);

    // The record: the ask it names was filed as provisional, recommending sqlite, and nothing closed it, so your answer
    // can still switch it.
    const all = await events(hub);
    const created = createdOf(all, String(value.ask));
    expect(created && { question: created.data?.question, provisional: created.data?.provisional, recommended: created.data?.recommended },
      `${ID} the record holds ${value.ask} as a provisional ask recommending sqlite`)
      .toEqual({ question: 'Which store should the cache use?', provisional: true, recommended: 'sqlite' });
    expect(closings(all, String(value.ask)).map((e) => e.kind), `${ID} the provisional ask stays open for you`).toEqual([]);
  }, 300_000);
});
