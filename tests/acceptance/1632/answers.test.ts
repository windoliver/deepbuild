// #1632.681ec30e A `deep_ask` that A raised before the clear, and that you answer after it, is never delivered to B.
// "Delivered to B" is read as anything B's process hears for B (README: Readings): the replies deep-hook gives B's
// hooks (its prompt and its tool calls), what B's deep_wait on the ask returns, and a `delivery.outcome` of
// `delivered` in the record for that ask. You answer with `deep inbox answer` (#24), as suite 26 does.

import { afterEach, expect, test } from 'vitest';
import { cleanup, clear, deep, eventMatching, events, sleep, valueOf, word, world, type Fired } from './helpers.ts';

afterEach(cleanup, 30_000);

test('#1632.681ec30e an ask A raised before /clear and you answer after it reaches none of B\'s hooks, calls or deliveries', async () => {
  const w = await world();
  const { agent, hub, home, a } = w;
  const tag = word();
  const question = `Which header colour for ${tag}?`;
  const chosen = `teal${tag}`;
  const label = `Teal ${tag} header`;
  // A raises it; deep_ask returns before anyone answers (still waiting, or provisional with its recommended option),
  // so no call of A's is open at the clear, as Claude Code runs /clear only between turns.
  const asked = valueOf(await agent.call('deep_ask', { kind: 'taste', question, options: [{ id: 'blue', label: 'Blue header' }, { id: chosen, label }], recommended: 'blue' }, 120_000), `deep_ask from A ${a.id}`);
  const created = await eventMatching(hub, (e) => e.kind === 'ask.created' && e.data?.question === question);
  if (!created || created.session !== a.id) throw Error(`BLOCKED: A's deep_ask wasn't filed under A ${a.id}: ${JSON.stringify(created)}`);
  if (asked?.status === 'answered' || asked?.answer === chosen) throw Error(`BLOCKED: A's deep_ask returned ${JSON.stringify(asked)} before anyone answered`);
  const handle = `ask:${created.id}`;

  const { b, fired: started } = await clear(w, a);
  const answer = await deep(home, ['inbox', 'answer', handle, chosen]);
  expect(answer.code, `you answer ${handle} with ${chosen} after the clear: ${answer.stdout}${answer.stderr}`).toBe(0);
  if (!(await eventMatching(hub, (e) => e.kind === 'ask.answered' && e.subject === handle))) throw Error(`BLOCKED: no ask.answered for ${handle}`);
  await sleep(1000);

  // B works on: a prompt, a deep_wait on the ask after its PreToolUse, another tool call, a second prompt.
  const heard: { what: string; text: string }[] = started.map((f, i) => ({ what: `B's ${['SessionStart', 'first prompt', 'first tool call'][i]} hook reply`, text: shownOf(f) }));
  heard.push({ what: 'B\'s prompt hook reply after the answer', text: shownOf(await agent.hook(b, 'UserPromptSubmit', { prompt: 'go on' })) });
  const waitArgs = { ask: handle };
  heard.push({ what: 'B\'s deep_wait PreToolUse reply', text: shownOf(await agent.stamp(b, 'deep_wait', waitArgs)) });
  const waited = await agent.call('deep_wait', waitArgs, 120_000);
  heard.push({ what: 'B\'s deep_wait result', text: JSON.stringify(waited.reply) });
  heard.push({ what: 'B\'s next tool call hook reply', text: shownOf(await agent.hook(b, 'PreToolUse')) });
  heard.push({ what: 'B\'s second prompt hook reply', text: shownOf(await agent.hook(b, 'UserPromptSubmit', { prompt: 'and the footer' })) });

  expect(waited.isError || (waited.value?.status !== 'answered' && waited.value?.answer !== chosen), `B ${b.id}'s deep_wait on A ${a.id}'s ${handle} must not return your answer ${chosen}: ${JSON.stringify(waited.value)}`).toBe(true);
  expect(heard.filter((h) => h.text.includes(handle) || h.text.includes(label)).map((h) => `${h.what}: ${h.text.slice(0, 600)}`),
    `your answer to A ${a.id}'s ${handle} (${label}) reaches nothing B ${b.id} hears`).toEqual([]);
  const delivered = (await events(hub)).filter((e) => e.kind === 'delivery.outcome' && e.data?.delivery === handle && e.data?.outcome === 'delivered');
  expect(delivered.map((e) => `delivery.outcome ${e.id} delivered via ${e.data?.via} under ${e.session}`), `${handle}, raised by A ${a.id} and answered after the clear, is recorded delivered to no one (B is ${b.id})`).toEqual([]);
}, 240_000);

const shownOf = (f: Fired): string => `exit ${f.code} stdout ${f.stdout} stderr ${f.stderr}`;
