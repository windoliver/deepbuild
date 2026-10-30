// #111.AC2 Reviving a rejected direction is stopped with the decision cited; and Scope: decisions made in chat are
// captured from transcripts. A direction is an exact key in backticks (README, Invented here). The agent revives it two
// ways: by proposing it (deep_propose) and by just doing it (a tool call, through deep-hook).
import { afterAll, describe, expect, it } from 'vitest';
import {
  callTool, claudeSession, cleanup, codexSession, compile, decision, decisions, deep, denialText, eventsOf, filedWhileWaiting, hubOf, inboxText, memoryHome, pending, startAgent, toolCallIn, shown, type Line, type Mem,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const AC2 = '#111.ddf55f68';

/** The active decision that rejects `direction`, as the record holds it. */
async function rejecting(m: Mem, direction: string) {
  const all = await decisions(m);
  return all.filter((d) => JSON.stringify(d.data).includes(direction));
}
async function chatWorld(): Promise<Mem> {
  const m = memoryHome({ agents: ['claude'] });
  claudeSession(m, m.api,
    { role: 'user', text: 'We went over this for api and we said no to it. rejected: `graphql`.' },
    { role: 'assistant', text: 'Understood, staying on REST. rejected: `vue`.' });
  codexSession(m, m.api,
    { role: 'user', text: 'The store stays as it is. rejected: `mongodb`.' },
    { role: 'assistant', text: 'Understood.' });
  await compile(m);
  return m;
}

describe(`${AC2} reviving a rejected direction`, () => {
  it(`${AC2} a direction you rejected in chat is saved as a decision, from Claude Code's and Codex's transcripts, by the core; the same words from the assistant save none`, async () => {
    const m = await chatWorld();
    for (const direction of ['graphql', 'mongodb']) {
      const found = await rejecting(m, direction);
      expect(found.length, `your "rejected: \`${direction}\`" is one saved decision`).toBe(1);
      expect(found[0]!.writer, 'saved by the core').toBe('core');
      expect(String(found[0]!.data.scope), 'for the repo you said it in').toMatch(/^repo:/);
    }
    expect(await rejecting(m, 'vue'), 'an agent\'s word is no decision').toEqual([]);
    // A second read of the same transcripts saves no second decision.
    await compile(m);
    expect((await rejecting(m, 'graphql')).length, 'a re-read saves it once').toBe(1);
  }, 900_000);

  it(`${AC2} an agent's deep_propose of the rejected direction is refused, citing the decision, and never reaches you; another direction, or the same one in another repo, goes on to the inbox`, async () => {
    const m = await chatWorld();
    const [saved] = await rejecting(m, 'graphql');
    expect(saved, 'the decision is saved').toBeDefined();
    const { agent } = await startAgent(m, m.api, 'make the api better');
    const change = 'Move the api to `graphql`, marker zircon';
    const stopped = await callTool(agent, 'deep_propose', { target: 'the api', change, evidence: null });
    expect(stopped.isError, `the revival is refused: ${JSON.stringify(stopped.reply).slice(0, 800)}`).toBe(true);
    expect(JSON.stringify(stopped.value), 'the refusal cites the decision by its handle').toContain(saved!.handle);
    expect(await inboxText(m), 'you aren\'t asked again').not.toContain('zircon');

    const other = await callTool(agent, 'deep_propose', { target: 'the api', change: 'Move the api to `grpc`, marker jasper', evidence: null });
    expect(other.isError, `a direction you didn't reject isn't stopped: ${JSON.stringify(other.reply).slice(0, 800)}`).toBe(false);
    expect(await inboxText(m), 'and reaches you').toContain('jasper');
    const agentWord = await callTool(agent, 'deep_propose', { target: 'the api', change: 'Move the web part to `vue`, marker onyx', evidence: null });
    expect(agentWord.isError, 'what only an agent called rejected isn\'t stopped').toBe(false);

    const { agent: elsewhere } = await startAgent(m, m.web, 'make the web part better');
    const web = await callTool(elsewhere, 'deep_propose', { target: 'the web part', change: 'Move the web part to `graphql`, marker topaz', evidence: null });
    expect(web.isError, `the decision covers its repo, not ${m.web}: ${JSON.stringify(web.reply).slice(0, 800)}`).toBe(false);
  }, 900_000);

  it(`${AC2} an agent's tool call that revives it is denied by deep-hook, citing the decision; another package, or the same one in another repo, runs`, async () => {
    const m = await chatWorld();
    const [saved] = await rejecting(m, 'graphql');
    expect(saved, 'the decision is saved').toBeDefined();
    const denied = await toolCallIn(m, m.api, 'npm install graphql');
    expect(decision(denied), `the revival is denied: ${shown(denied)}`).toBe('deny');
    expect(denialText(denied as never), 'citing the decision by its handle').toContain(saved!.handle);
    expect(decision(await toolCallIn(m, m.api, 'npm install grpc')), 'another package runs').toBe('allow');
    expect(decision(await toolCallIn(m, m.api, 'npm install graphql-tools')), 'a longer name is another key').toBe('allow');
    expect(decision(await toolCallIn(m, m.web, 'npm install graphql')), 'the same package in another repo runs').toBe('allow');
  }, 900_000);

  it(`${AC2} the option you passed over when you answered a choice is a rejected direction: proposing it is refused, citing the decision that answer saved; the one you chose isn't`, async () => {
    const m = memoryHome({ agents: ['claude'] });
    await compile(m);
    const hub = hubOf(m);
    const { agent } = await startAgent(m, m.api, 'choose the api style');
    const question = 'Which style for the api, marker quartz?';
    const asked = pending(callTool(agent, 'deep_ask', {
      kind: 'choice', question, options: [{ id: 'rest', label: 'Stay on `rest`' }, { id: 'gql', label: 'Move to `graphql`' }], recommended: 'rest',
      subject: { point: 'req:apistyle', screen: null, element: null },
    }));
    const created = await filedWhileWaiting(asked, hub, (e: { kind: string; data: Line }) => e.kind === 'ask.created' && e.data?.question === question, 'the choice');
    const handle = `ask:${created.id}`;
    const answered = await deep(m.h.home, ['inbox', 'answer', handle, 'rest']);
    expect(answered.code, `you answer rest: ${shown(answered)}`).toBe(0);
    await asked;
    const saved = (await eventsOf(m.h.home, ['decision.created'])).map((e) => e as unknown as { id: string; subject?: string }).find((e) => e.subject === handle);
    expect(saved, `your answer saved a decision for ${handle}`).toBeDefined();
    const stopped = await callTool(agent, 'deep_propose', { target: 'the api', change: 'Move the api to `graphql` after all', evidence: null });
    expect(stopped.isError, `the passed-over option is refused: ${JSON.stringify(stopped.reply).slice(0, 800)}`).toBe(true);
    expect(JSON.stringify(stopped.value), 'citing the decision').toContain(`decision:${saved!.id}`);
    const chosen = await callTool(agent, 'deep_propose', { target: 'the api', change: 'Document why the api is on `rest`', evidence: null });
    expect(chosen.isError, 'the option you chose isn\'t stopped').toBe(false);
  }, 900_000);
});
