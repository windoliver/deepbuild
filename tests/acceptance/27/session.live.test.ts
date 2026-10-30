// #27's exit criterion on real sessions: interactive Claude Code sessions run by the agent test harness (#48), never
// `claude -p`, which ends async hooks at teardown. They spend plan usage, so they run only by hand:
//   DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/27 session.live.test.ts
// Without the opt-in, the token, a `claude` on PATH, a Claude Code version the facts cover or the harness's routes,
// each test fails with BLOCKED in its message; nothing skips. The sessions run with HOME a temporary home, so
// `~/.claude/settings.json` is the file `deep setup` wrote there; the harness's own hooks only record what Claude Code
// sent (README: The live sessions).
import { afterAll, describe, expect, it } from 'vitest';
import { AC1, AC2, cleanup, decidedLine, inboxRows, iso } from './helpers.ts';
import { live, replies, said, stops, wakes, type LiveSession, type Live } from './live.ts';

afterAll(cleanup, 60_000);

const MINUTE = 60_000;
const named = (r: Live, name: string): LiveSession => {
  const s = r.sessions.find((x) => x.name === name);
  if (!s) throw Error(`BLOCKED: the run line names no session ${name}: ${r.sessions.map((x) => x.name).join(', ')}`);
  return s;
};
const carries = (text: unknown, chosen: string) => (typeof text === 'string' ? text : JSON.stringify(text ?? '')).includes(chosen);

describe('#27 on real Claude Code sessions: an answer reaches an idle session; a repeat never reaches you', () => {
  it(`${AC1} (live) a real interactive session asks, stops and goes idle; your answer from the CLI wakes it, and its reply is the option you chose`, async () => {
    const r = await live(AC1, 'idle-wake', { timeoutMs: 15 * MINUTE });
    const s = named(r, 'A');
    const a = r.answers[0]!;
    expect(r.line.verdict, `${AC1} the harness's idle-wake run must end PASS: ${r.line.reason}`).toBe('PASS');
    const woke = wakes(s, a.at - 50).find((p) => carries(p.prompt, a.chosen) || carries(p.prompt, a.id));
    expect(woke, `${AC1} idle session ${s.sessionId} didn't wake on your answer to ${a.handle}, given at ${iso(a.at)}: no prompt it didn't type reached it`).toBeDefined();
    const reply = stops(s).find((p) => p.at > woke!.at);
    expect(replies(reply, a), `${AC1} ${s.sessionId} woke at ${iso(woke!.at)}; it must use your answer: its reply ${JSON.stringify(said(reply).slice(0, 300))} isn't ${a.chosen} alone`).toBe(true);
    const out = r.events.filter((e) => e.kind === 'delivery.outcome' && (e.subject === a.handle || String(e.data?.delivery ?? '').includes(a.id)));
    expect(out.map((e) => e.data?.outcome), `${AC1} the record says your answer to ${a.handle} was delivered and acknowledged, once`).toEqual(['delivered']);
    console.log(`${AC1} (live) answer to wake: ${woke!.at - a.at} ms (a reading; AC5 judges the budget)`);
  }, 25 * MINUTE);

  it(`${AC2} (live) the same question asked again in a new real session is answered by the resolver, the agent uses the answer, and it appears under decided for you`, async () => {
    const r = await live(AC2, 'repeat', { timeoutMs: 20 * MINUTE });
    const [A, B] = [named(r, 'A'), named(r, 'B')];
    const a = r.answers[0]!;
    expect(r.line.verdict, `${AC2} the harness's repeat run must end PASS: ${r.line.reason}`).toBe('PASS');
    const asked = (session: string) => r.events.filter((e) => e.kind === 'ask.created' && e.session === session);
    const [first] = asked(A.sessionId);
    const [again] = asked(B.sessionId);
    expect(again, `${AC2} session B (${B.sessionId}) must ask the question again through deep_ask`).toBeDefined();
    expect({ question: again!.data?.question, options: again!.data?.options }, `${AC2} B asks the same question as A`).toEqual({ question: first!.data?.question, options: first!.data?.options });
    const handle = `ask:${again!.id}`;
    const answeredByYou = r.events.filter((e) => e.kind === 'ask.answered' && (e.subject === handle || JSON.stringify(e.data).includes(again!.id)) && e.writer !== 'core' && !String(e.writer).startsWith('ext:'));
    expect(answeredByYou, `${AC2} you answered only A's question; nobody typed an answer to ${handle}`).toEqual([]);
    expect(r.events.filter((e) => e.kind === 'ask.batched' && JSON.stringify(e.data).includes(again!.id)), `${AC2} the repeated question never reaches you: no batch names ${handle}`).toEqual([]);
    const row = (await inboxRows(r.hub)).find((x) => x.ask === handle);
    expect(row?.outcome, `${AC2} ${handle} is answered by the resolver, decided for you: ${JSON.stringify(row)}`).toBe('decided_for_you');
    const reply = stops(B)[0];
    expect(replies(reply, a), `${AC2} B must use the answer the resolver gave: its reply ${JSON.stringify(said(reply).slice(0, 300))} isn't ${a.chosen} alone`).toBe(true);
    expect(decidedLine(r.inbox, handle), `${AC2} deep inbox must show ${handle} under "decided for you":\n${r.inbox}`).toBeDefined();
  }, 30 * MINUTE);
});
