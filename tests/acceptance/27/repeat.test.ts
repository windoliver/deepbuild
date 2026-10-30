// AC2 #27.6e863673 The repeated question is answered by the resolver and appears under decided for you (fast;
// session.live.test.ts runs it on real sessions).
//
// Session A, in the repo, asks a choice pinned to a requirement (deep_ask's `subject`), and you answer it from the CLI,
// which saves your answer as a decision for the repo. Then a new session B, in the same repo, asks the same question:
// the same kind, words, options and subject (README: Readings, 2). The resolver answers it from your saved decision:
// B's deep_ask comes back with your answer at once, long before its own wait for you would end; the ask closes as
// decided for you citing that decision, logged by the core, never batched for you and never among your open asks; and
// `deep inbox` shows it under "decided for you".
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC2, allEvents, answer, beginAsk, cleanup, decidedLine, inboxRows, inboxText, makeHome, makeRepo, question, setup, startHub, tag, toolValue,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** deep_ask's own wait for you before it says "still waiting" is 40 s at the base; an answer from a decision comes long before. */
const AT_ONCE_MS = 10_000;

describe(`${AC2} The repeated question is answered by the resolver and appears under decided for you`, () => {
  it(`${AC2} the same question asked again in a new session is answered from the decision your CLI answer saved, at once, never reaches you, and deep inbox lists it under decided for you`, async () => {
    const { home } = makeHome();
    const repo = makeRepo(home);
    const hub = await startHub(home);
    await setup(home);
    const q = question({ point: `req:R27${tag(6)}` });

    // Session A asks; you answer from the CLI while deep_ask still waits; A hears your answer.
    const first = await beginAsk(hub, home, { cwd: repo.dir, q });
    const yours = await answer(home, `ask:${(await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === first.s.id)!.id}`, 'green');
    const a = await first.finish();
    expect(toolValue(a.reply).answer, `${AC2} session A's deep_ask comes back with your answer, green: ${JSON.stringify(a.reply).slice(0, 800)}`).toBe('green');
    const saved = (await allEvents(hub)).find((e) => e.kind === 'decision.created' && (e.subject === a.handle || JSON.stringify(e.data).includes(a.id)));
    expect(saved, `${AC2} your CLI answer to ${a.handle} must be saved as a decision (deep inbox answer said: ${yours.stdout.trim()})`).toBeDefined();
    await a.claude.end();

    // Session B, new, same repo, the same question.
    const t0 = Date.now();
    const second = await beginAsk(hub, home, { cwd: repo.dir, q });
    const b = await second.finish();
    const took = Date.now() - t0;
    const events = await allEvents(hub);
    const asked = events.filter((e) => e.kind === 'ask.created' && e.session === b.s.id);
    expect(asked, `${AC2} session B's deep_ask files one ask`).toHaveLength(1);
    const handle = b.handle;
    expect(b.s.id, 'B is a new session').not.toBe(a.s.id);
    expect(toolValue(b.reply).answer, `${AC2} the repeated question must be answered from your saved decision: B's deep_ask must come back with green (${a.green.label}); it replied ${JSON.stringify(b.reply).slice(0, 800)}`).toBe('green');
    expect(took, `${AC2} the resolver answers the repeated question at once: B's deep_ask came back after ${took} ms, as if it had waited for you`).toBeLessThan(AT_ONCE_MS);

    const applied = events.filter((e) => e.kind === 'decision.applied' && JSON.stringify(e.data).includes(b.id));
    expect(applied.map((e) => e.writer), `${AC2} the core logs ${handle} as decided for you, once, naming the decision it reused: decision.applied events ${JSON.stringify(applied.map((e) => e.data))}`).toEqual(['core']);
    expect(JSON.stringify(applied[0]?.data ?? {}), `${AC2} the automatic answer to ${handle} cites the decision saved from your answer to ${a.handle}`).toContain(saved!.id);
    expect(events.filter((e) => e.kind === 'ask.batched' && JSON.stringify(e.data).includes(b.id)), `${AC2} the repeated question never reaches you: no batch names ${handle}`).toEqual([]);

    const row = (await inboxRows(hub)).find((r) => r.ask === handle);
    expect(row, `${AC2} the inbox projection holds ${handle}`).toBeDefined();
    expect({ status: row!.status, outcome: row!.outcome }, `${AC2} ${handle} is closed as decided for you: ${JSON.stringify(row)}`).toEqual({ status: 'closed', outcome: 'decided_for_you' });
    expect(String(row!.decision ?? ''), `${AC2} ${handle}'s row names the decision it reused: ${JSON.stringify(row)}`).toContain(saved!.id);

    const text = await inboxText(home);
    const openLines = text.split('\n').filter((l) => l.includes(handle) && !/decided for you/i.test(l) && decidedLine(text, handle) !== l);
    expect(openLines, `${AC2} the repeated question never reaches you: deep inbox must not list ${handle} among your open asks:\n${text}`).toEqual([]);
    const line = decidedLine(text, handle);
    expect(line, `${AC2} deep inbox must show ${handle} under "decided for you" (on its line, or under a heading saying so):\n${text}`).toBeDefined();
    expect(line, `${AC2} deep inbox's decided-for-you line for ${handle} names the decision it reused, ${saved!.id}:\n${text}`).toContain(saved!.id);
  }, 300_000);
});
