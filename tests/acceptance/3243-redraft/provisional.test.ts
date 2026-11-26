// #3243 `#3243.48cf467d`: "A provisional ask still goes on at once. Given a choice with a recommendation in a session no
// work run started, when `deep_ask` runs, then it returns `provisional` with the recommended option (#84), unless an
// approved proposal changes #84's rule."
//
// A real hub (`deep hub run`) in a temporary home, `deep setup` into that home, and #25's Claude Code stand-in
// (../25/routes/helpers.ts, fixtures/claude.mjs), which runs DeepBuild's hook entries from the settings setup wrote and
// starts the session's own `deep mcp`. The session reaches the hub through its hooks alone: no `deep work` run started
// it. The agent calls deep_ask through that `deep mcp` with a choice whose recommended option is the second one.
//
// What the test decides on (README, How the test decides): deep_ask's own reply (status and answer), how soon it came,
// and the ask the record holds for it, open. Not whether the ask is in Needs you yet: the design shows asks in batches,
// so a provisional ask may wait queued for the next one (README, What it doesn't require).
import { availableParallelism, loadavg } from 'node:os';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, allEvents, appendTranscript, callId, cleanup, control, loadReading, makeHome, newSession, payload, setup, sleep, startHub, tag, typedPrompt,
  type Line,
} from '../25/routes/helpers.ts';

const ID = '#3243.48cf467d';
/** "At once": the issue's probe got its reply in well under a second; this leaves room for a loaded machine. */
const AT_ONCE_MS = 20_000;
/** How long the test waits for any reply at all before it calls deep_ask still waiting. */
const REPLY_MS = 90_000;
/** The events that close an ask: the closed set of outcomes (design: Every ask ends), as events. */
const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot', 'ask.unanswerable']);

afterAll(cleanup, 60_000);

/** A deep_* tool reply's value: its structured content, else its first text block's JSON. */
function valueOf(reply: Line): Line | undefined {
  const result = (reply.result ?? {}) as Line;
  if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent as Line;
  const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
  if (typeof text !== 'string') return undefined;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Line) : undefined;
  } catch {
    return undefined;
  }
}

describe(`${ID} A provisional ask still goes on at once`, () => {
  it(`${ID} a choice with a recommendation, in a session no work run started, comes back from deep_ask provisional with the recommended option, at once, and the ask stays open`, async (ctx) => {
    const { home } = makeHome();
    // noAskWait: a deep_ask that waits on you says "still waiting" at once instead of after 40 s, so a hub that doesn't
    // go on provisionally fails on the reply's status, not on a timeout.
    const hub = await startHub(home, { noAskWait: true });
    await setup(home);

    // A session of its own Claude Code, known to the hub from its hooks: it starts, you type a prompt.
    const s = newSession(home);
    const claude = Claude.start(home);
    await claude.hook('SessionStart', payload(s, 'SessionStart'));
    typedPrompt(s, 'Pick a cache store, then go on.');
    await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Pick a cache store, then go on.' }));
    await claude.initialize();

    // The precondition: no work run is recorded in this home, so no work run started the session.
    const runs = (await allEvents(hub)).filter((e) => e.kind === 'work.run');
    if (runs.length) throw Error(`BLOCKED: a fresh home must hold no work run, but the record holds ${JSON.stringify(runs).slice(0, 800)}`);

    // The choice. The recommended option is the second, so a hub that goes on with the first option or a default is caught.
    const t = tag(4);
    const redis = { id: `redis${t}`, label: `Redis ${t}` };
    const sqlite = { id: `sqlite${t}`, label: `SQLite ${t}` };
    const question = `Which store should the cache use for ${t}?`;
    const args = { kind: 'choice', question, options: [redis, sqlite], recommended: sqlite.id };
    const call = callId();
    appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'mcp__deep__deep_ask', input: args }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
    await claude.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'mcp__deep__deep_ask', tool_input: args, tool_use_id: call }));

    const t0 = Date.now();
    type Got = { reply?: Line; failed?: string; ms: number };
    const got: Got | undefined = await Promise.race([
      claude.request('tools/call', { name: 'deep_ask', arguments: args }, REPLY_MS).then((reply): Got => ({ reply, ms: Date.now() - t0 }), (e: unknown): Got => ({ failed: String(e), ms: Date.now() - t0 })),
      sleep(REPLY_MS + 10_000).then(() => undefined),
    ]);
    if (got?.failed && !/no (reply|answer)/.test(got.failed)) throw Error(`BLOCKED: the session's deep_ask call failed: ${got.failed}`);
    const reply = got?.reply;
    expect(reply ? 'replied' : `no reply in ${REPLY_MS / 1000} s (${loadReading()})`, `${ID} deep_ask goes on at once: it must reply, never wait on you`).toBe('replied');

    // The reply: provisional, with the recommended option, naming the ask it raised.
    const value = valueOf(reply!);
    expect(!!reply!.error || reply!.result?.isError === true, `${ID} deep_ask is no error: ${JSON.stringify(reply).slice(0, 1500)}`).toBe(false);
    expect({ status: value?.status, answer: value?.answer }, `${ID} deep_ask returns provisional with the recommended option ${sqlite.id} (#84): ${JSON.stringify(value ?? reply).slice(0, 1500)}`)
      .toEqual({ status: 'provisional', answer: sqlite.id });
    const handle = String(value?.ask);
    expect(handle, `${ID} deep_ask names the ask it raised: ${JSON.stringify(value)}`).toMatch(/^ask:[0-9A-Z]{26}$/);

    // The record: the ask deep_ask named is this session's choice, filed as provisional with sqlite recommended, and
    // nothing closed it, so your answer can still switch it.
    const all = await allEvents(hub);
    const created = all.find((e) => e.kind === 'ask.created' && `ask:${e.id}` === handle);
    expect(created && { session: created.session, question: created.data?.question, provisional: created.data?.provisional, recommended: created.data?.recommended },
      `${ID} the record holds ${handle} as ${s.id}'s provisional choice recommending ${sqlite.id}`)
      .toEqual({ session: s.id, question, provisional: true, recommended: sqlite.id });
    expect(all.filter((e) => CLOSING.has(e.kind) && e.subject === handle).map((e) => e.kind), `${ID} the provisional ask ${handle} stays open for you: nothing closes it`).toEqual([]);
    const listed = ((await control(hub, (conn) => conn.call('inbox.read'))).asks as Line[]).find((r) => r.ask === handle);
    expect(listed && { ask: listed.ask, closed_at: listed.closed_at }, `${ID} the inbox lists ${handle} among its open asks: ${JSON.stringify(listed)}`)
      .toEqual({ ask: handle, closed_at: null });

    // At once. A late reply on a machine loaded past its core count is INCONCLUSIVE, never PASS; on one that isn't, a FAIL.
    if (got!.ms > AT_ONCE_MS) {
      const text = `deep_ask replied provisional after ${got!.ms} ms, past ${AT_ONCE_MS} ms`;
      if (loadavg()[0]! > availableParallelism()) ctx.skip(`INCONCLUSIVE ${ID} ${text}, read at ${loadReading()}`);
      throw Error(`${ID} deep_ask goes on at once: ${text}, at ${loadReading()}`);
    }
  }, 400_000);
});
