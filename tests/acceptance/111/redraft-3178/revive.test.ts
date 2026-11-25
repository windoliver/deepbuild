// #111.ddf55f68, blind redraft: "Reviving a rejected direction is stopped with the decision cited". A direction is
// rejected two ways a person decides: by saying so in chat (read from the transcript), or by passing over an option when
// answering a choice. An agent revives it two ways: by proposing it (deep_propose) or by just doing it (a Bash call that
// deep-hook sees). Each revival must be stopped, and what stops it must name the saved decision by its handle. Each test
// also runs a direction nobody rejected, so a program that stops everything fails too. The chat rejection is read from
// Claude Code's and Codex's transcripts; the assistant's same words save nothing; the decision covers its repo only
// (README here).
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  callTool, claudeSession, cleanup, codexSession, compile, decision, decisions, deep, denialText, eventsOf, filedWhileWaiting, hubOf, inboxText,
  memoryHome, pending, put, shown, startAgent, toolCallIn, type Line, type Mem, type Saved,
} from '../helpers.ts';

afterAll(cleanup, 60_000);
const AC = '#111.ddf55f68';
const KEY = 'kafka';

const CODEX_KEY = 'mongodb';
const AGENT_WORD = 'nats';

/** The saved decisions whose data holds `direction`. */
const rejecting = async (m: Mem, direction: string): Promise<Saved[]> =>
  (await decisions(m)).filter((d) => JSON.stringify(d.data).includes(direction));
/**
 * A home where, for the api repo, you said no to `kafka` in a Claude Code session (whose assistant "rejected" `nats`), and
 * to `mongodb` in a Codex session.
 */
async function saidNo(): Promise<{ m: Mem; saved: Saved }> {
  const m = memoryHome({ agents: ['claude'] });
  put(join(m.web, 'scripts', 'live.sh'), '#!/bin/sh\n');
  claudeSession(m, m.api,
    { role: 'user', text: `We went over the job queue for the api and said no. rejected: \`${KEY}\`.` },
    { role: 'assistant', text: `Understood, the queue stays as it is. rejected: \`${AGENT_WORD}\`.` });
  codexSession(m, m.api,
    { role: 'user', text: `The api's store stays as it is. rejected: \`${CODEX_KEY}\`.` },
    { role: 'assistant', text: 'Understood.' });
  await compile(m);
  const found = await rejecting(m, KEY);
  expect(found.length, `your rejection is one saved decision: ${JSON.stringify(found).slice(0, 600)}`).toBe(1);
  return { m, saved: found[0]! };
}
/** Asks filed anywhere in the record whose data holds `marker`. */
const asksHolding = async (m: Mem, marker: string): Promise<number> =>
  (await eventsOf(m.h.home, ['ask.created'])).filter((e) => JSON.stringify(e).includes(marker)).length;

describe(`${AC} reviving a rejected direction is stopped with the decision cited`, () => {
  it(`${AC} an agent proposing a direction you rejected in chat is refused, citing the decision, and you aren't asked; a direction nobody rejected reaches you`, async () => {
    const { m, saved } = await saidNo();
    const { agent } = await startAgent(m, m.api, 'make the api faster');

    const other = await callTool(agent, 'deep_propose', { target: 'the api', change: 'Run the api\'s jobs on `rabbitmq`, marker beryl', evidence: null });
    expect(other.isError, `a direction nobody rejected isn't stopped: ${JSON.stringify(other.reply).slice(0, 800)}`).toBe(false);
    expect(await inboxText(m), 'and it reaches you').toContain('beryl');

    const revived = await callTool(agent, 'deep_propose', { target: 'the api', change: `Run the api's jobs on \`${KEY}\`, marker garnet`, evidence: null });
    expect(revived.isError, `the revival is stopped: ${JSON.stringify(revived.reply).slice(0, 800)}`).toBe(true);
    expect(JSON.stringify(revived.reply), 'the refusal cites the decision by its handle').toContain(saved.handle);
    expect(await inboxText(m), 'the revival never reaches you').not.toContain('garnet');
    expect(await asksHolding(m, 'garnet'), 'no ask was filed for it').toBe(0);
  }, 900_000);

  it(`${AC} an agent's tool call that revives a direction you rejected in chat is denied by deep-hook, citing the decision; a call naming a direction nobody rejected runs`, async () => {
    const { m, saved } = await saidNo();
    const runs = await toolCallIn(m, m.api, 'sh scripts/live.sh rabbitmq');
    expect(decision(runs), `a call naming a direction nobody rejected runs: ${shown(runs)}`).toBe('allow');

    const denied = await toolCallIn(m, m.api, `sh scripts/live.sh ${KEY}`);
    expect(decision(denied), `the revival is denied: ${shown(denied)}`).toBe('deny');
    expect(denialText(denied as never), 'the denial cites the decision by its handle').toContain(saved.handle);
  }, 900_000);

  it(`${AC} a direction you rejected in Codex's transcript is saved by the core for that repo, once, and reviving it is stopped citing it, proposed or run`, async () => {
    const { m } = await saidNo();
    const found = await rejecting(m, CODEX_KEY);
    expect(found.length, `your "rejected: \`${CODEX_KEY}\`" in Codex is one saved decision: ${JSON.stringify(found).slice(0, 600)}`).toBe(1);
    const saved = found[0]!;
    expect(saved.writer, 'saved by the core').toBe('core');
    expect(String(saved.data.scope), 'for the repo you said it in').toMatch(/^repo:/);
    await compile(m);
    expect((await rejecting(m, CODEX_KEY)).length, 'a second read saves no second decision').toBe(1);

    const { agent } = await startAgent(m, m.api, 'make the api store faster');
    const revived = await callTool(agent, 'deep_propose', { target: 'the api', change: `Move the api's store to \`${CODEX_KEY}\`, marker amber`, evidence: null });
    expect(revived.isError, `the revival is stopped: ${JSON.stringify(revived.reply).slice(0, 800)}`).toBe(true);
    expect(JSON.stringify(revived.reply), 'citing the decision Codex\'s transcript saved').toContain(saved.handle);
    expect(await asksHolding(m, 'amber'), 'and you aren\'t asked').toBe(0);
    const denied = await toolCallIn(m, m.api, `sh scripts/live.sh ${CODEX_KEY}`);
    expect(decision(denied), `running it is denied: ${shown(denied)}`).toBe('deny');
    expect(denialText(denied as never), 'citing the same decision').toContain(saved.handle);
  }, 900_000);

  it(`${AC} the same words from the assistant save no decision and stop nothing`, async () => {
    const { m } = await saidNo();
    expect(await rejecting(m, AGENT_WORD), 'an agent\'s word is no decision').toEqual([]);
    const { agent } = await startAgent(m, m.api, 'make the api faster');
    const proposed = await callTool(agent, 'deep_propose', { target: 'the api', change: `Run the api's events on \`${AGENT_WORD}\`, marker coral`, evidence: null });
    expect(proposed.isError, `what only the assistant called rejected isn't stopped: ${JSON.stringify(proposed.reply).slice(0, 800)}`).toBe(false);
    expect(await inboxText(m), 'and it reaches you').toContain('coral');
    const ran = await toolCallIn(m, m.api, `sh scripts/live.sh ${AGENT_WORD}`);
    expect(decision(ran), `and running it isn't denied: ${shown(ran)}`).toBe('allow');
  }, 900_000);

  it(`${AC} the decision covers the repo you said it in: the same direction in another repo is proposed to you and runs`, async () => {
    const { m, saved } = await saidNo();
    expect(String(saved.data.scope), 'the decision is for one repo').toMatch(/^repo:/);
    const { agent } = await startAgent(m, m.web, 'make the web part faster');
    const proposed = await callTool(agent, 'deep_propose', { target: 'the web part', change: `Run the web part's jobs on \`${KEY}\`, marker topaz`, evidence: null });
    expect(proposed.isError, `the decision covers its repo, not ${m.web}: ${JSON.stringify(proposed.reply).slice(0, 800)}`).toBe(false);
    expect(await inboxText(m), 'so it reaches you').toContain('topaz');
    const ran = await toolCallIn(m, m.web, `sh scripts/live.sh ${KEY}`);
    expect(decision(ran), `and it runs there: ${shown(ran)}`).toBe('allow');
  }, 900_000);

  it(`${AC} the option you passed over when you answered a choice is a rejected direction: an agent proposing it is refused, citing the decision your answer saved; the option you chose isn't stopped`, async () => {
    const m = memoryHome({ agents: ['claude'] });
    await compile(m);
    const hub = hubOf(m);
    const { agent } = await startAgent(m, m.api, 'choose the api style');
    const question = 'Which style for the api, marker quartz?';
    // No recommendation, so the call waits for your answer and nothing goes on before it.
    const asked = pending(callTool(agent, 'deep_ask', {
      kind: 'choice', question, options: [{ id: 'rest', label: 'Stay on `rest`' }, { id: 'gql', label: 'Move to `graphql`' }],
      subject: { point: 'req:apistyle', screen: null, element: null },
    }));
    const created = await filedWhileWaiting(asked, hub, (e: { kind: string; data: Line }) => e.kind === 'ask.created' && e.data?.question === question, 'the choice');
    const handle = `ask:${created.id}`;
    const answered = await deep(m.h.home, ['inbox', 'answer', handle, 'rest']);
    expect(answered.code, `you answer rest: ${shown(answered)}`).toBe(0);
    await asked;
    const saved = (await decisions(m)).find((d) => d.subject === handle);
    expect(saved, `your answer saved a decision for ${handle}`).toBeDefined();

    const chosen = await callTool(agent, 'deep_propose', { target: 'the api', change: 'Document why the api stays on `rest`, marker opal', evidence: null });
    expect(chosen.isError, `the option you chose isn't stopped: ${JSON.stringify(chosen.reply).slice(0, 800)}`).toBe(false);

    const revived = await callTool(agent, 'deep_propose', { target: 'the api', change: 'Move the api to `graphql` after all, marker jade', evidence: null });
    expect(revived.isError, `the passed-over option is stopped: ${JSON.stringify(revived.reply).slice(0, 800)}`).toBe(true);
    expect(JSON.stringify(revived.reply), 'citing the decision your answer saved').toContain(saved!.handle);
    expect(await asksHolding(m, 'jade'), 'and you aren\'t asked about it again').toBe(0);
  }, 900_000);
});
