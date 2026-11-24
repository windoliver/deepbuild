// AC2 #27.6e863673 "The repeated question is answered by the resolver and appears under decided for you" (blind
// redraft for #3178; README). Session A, in the repo, asks a choice that waits on you (no recommendation), pinned to a
// requirement; you answer it from the CLI, which saves your answer as a decision for the repo; A ends. A new session B,
// in the same repo, asks the same question: same kind, words, options and subject. The resolver answers it from your
// saved decision: B's deep_ask comes back with your answer at once; the ask closes as decided for you, logged by the
// core citing that decision, never batched for you and never among your open asks; `deep inbox` shows it under
// "decided for you", naming the decision. A second test asks B's repeat with a recommendation (blue, the other
// option): the design's core tries saved decisions and rules before anything else and delivers that answer, "logged
// as decided for you", so B still gets your green, never "go on with blue" (README: Readings, 3).
import { afterAll, describe, expect, it } from 'vitest';
import { allEvents, answer, decidedLine, inboxRows, inboxText, makeHome, makeRepo, payload, startHub, tag, toolValue } from '../helpers.ts';
import { cleanup } from '../outcomes-redraft/standin.ts';
import { beginAsk, setupHome, waitingQuestion } from './world.ts';

afterAll(cleanup, 60_000);

const ID = '#27.6e863673';
/** deep_ask waits 40 s for you before it says "still waiting"; an answer from a saved decision comes long before. */
const AT_ONCE_MS = 10_000;

/** A asks and you answer green from the CLI; A ends; a new session B asks the same question, with `recommended` if given. */
async function repeat(recommended?: string): Promise<void> {
  const { home } = makeHome();
  const repo = makeRepo(home);
  const hub = await startHub(home);
  await setupHome(home);
  const q = waitingQuestion({ point: `req:R27${tag(6)}` });

  // Session A asks; you answer from the CLI while its deep_ask waits for you; A hears your answer.
  const first = await beginAsk(hub, home, { cwd: repo.dir, q });
  const yours = await answer(home, `ask:${first.created.id}`, 'green');
  const a = await first.finish();
  expect(toolValue(a.reply).answer, `${ID} precondition: session A's deep_ask waits on you and comes back with your answer, green: ${JSON.stringify(a.reply).slice(0, 800)}`).toBe('green');
  const saved = (await allEvents(hub)).find((e) => e.kind === 'decision.created' && (e.subject === a.handle || JSON.stringify(e.data).includes(a.id)));
  expect(saved, `${ID} your CLI answer to ${a.handle} must be saved as a decision (deep inbox answer said: ${yours.stdout.trim()})`).toBeDefined();
  await a.claude.hook('SessionEnd', payload(a.s, 'SessionEnd'));
  await a.claude.kill();

  // Session B, new, of its own Claude Code, in the same repo: the same question (kind, words, options, subject).
  const t0 = Date.now();
  const second = await beginAsk(hub, home, { cwd: repo.dir, q: { ...q, ...(recommended ? { recommended } : {}) } });
  const b = await second.finish();
  const took = Date.now() - t0;
  const events = await allEvents(hub);
  const how = recommended ? ` (asked with ${recommended} recommended)` : '';
  expect(b.s.id, 'B is a new session').not.toBe(a.s.id);
  expect(events.filter((e) => e.kind === 'ask.created' && e.session === b.s.id), `${ID} session B's deep_ask files one ask`).toHaveLength(1);
  expect(toolValue(b.reply).answer, `${ID} the repeated question${how} must be answered from your saved decision: B's deep_ask must come back with green (${a.green.label}); it replied ${JSON.stringify(b.reply).slice(0, 800)}`).toBe('green');
  expect(took, `${ID} the resolver answers the repeated question at once: B's deep_ask came back after ${took} ms, as if it had waited for you`).toBeLessThan(AT_ONCE_MS);

  const applied = events.filter((e) => e.kind === 'decision.applied' && JSON.stringify(e.data).includes(b.id));
  expect(applied.map((e) => e.writer), `${ID} the core logs ${b.handle}${how} as decided for you, once: decision.applied events ${JSON.stringify(applied.map((e) => e.data))}`).toEqual(['core']);
  expect(JSON.stringify(applied[0]?.data ?? {}), `${ID} the automatic answer to ${b.handle} cites the decision saved from your answer to ${a.handle}`).toContain(saved!.id);
  expect(events.filter((e) => e.kind === 'ask.batched' && JSON.stringify(e.data).includes(b.id)), `${ID} the repeated question never reaches you: no batch names ${b.handle}`).toEqual([]);

  const row = (await inboxRows(hub)).find((r) => r.ask === b.handle);
  expect(row, `${ID} the inbox projection holds ${b.handle}`).toBeDefined();
  expect({ status: row!.status, outcome: row!.outcome }, `${ID} ${b.handle}${how} is closed as decided for you: ${JSON.stringify(row)}`).toEqual({ status: 'closed', outcome: 'decided_for_you' });
  expect(String(row!.decision ?? ''), `${ID} ${b.handle}'s row names the decision it reused: ${JSON.stringify(row)}`).toContain(saved!.id);

  const text = await inboxText(home);
  const line = decidedLine(text, b.handle);
  const open = text.split('\n').filter((l) => l.includes(b.handle) && l !== line);
  expect(open, `${ID} the repeated question never reaches you: deep inbox must not list ${b.handle} among your open asks:\n${text}`).toEqual([]);
  expect(line, `${ID} deep inbox must show ${b.handle} under "decided for you" (on its line, or under a heading saying so):\n${text}`).toBeDefined();
  expect(line, `${ID} deep inbox's decided-for-you line for ${b.handle} names the decision it reused, ${saved!.id}:\n${text}`).toContain(saved!.id);
}

describe(`${ID} The repeated question is answered by the resolver and appears under decided for you`, () => {
  it(`${ID} the same question asked again in a new session is answered from the decision your CLI answer saved, at once, never reaches you, and deep inbox lists it under decided for you`, () => repeat(), 300_000);
  it(`${ID} the same question asked again with a recommendation (blue) is still answered from your saved decision (green), at once, under decided for you, never left to go on with the recommendation`, () => repeat('blue'), 300_000);
});
