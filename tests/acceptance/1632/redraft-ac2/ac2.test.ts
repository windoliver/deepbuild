// #1632.681ec30e (blind redraft; criterion 2 as the owner reworded it): A `deep_ask` that A raised before the clear,
//   and that you answer after it, is never returned to B as B's own through `deep mcp`. B's `deep_wait` on that ask,
//   and every other session-bound call B makes after the clear, never carries that answer as B's. Delivery of the
//   answer along the thread joined across `/clear` stays as the design's "Threads, not IDs" bullet says (the hook
//   replies at B's next prompt, recorded as a `delivery.outcome`); it is not part of this criterion.
// The process is ../fixtures/agent.mjs: its hooks are the real deep-hook and its one deep mcp is its child, kept
// across the clear, as Claude Code keeps its MCP servers. See this folder's README for the readings.

import { afterEach, expect, test } from 'vitest';
import { claimArgs, cleanup, clear, deep, eventMatching, word, world, type Agent, type Line, type Outcome, type Session } from '../helpers.ts';

afterEach(cleanup, 30_000);

/** deep_ask's arguments for a taste call with a recommendation, every nullable field the tests leave out as null. */
const taste = (question: string, options: { id: string; label: string }[], recommended: string): Line => ({
  kind: 'taste', question, options, recommended, steps: null, where: null, why: null, check: null, thread: null, subject: null,
});

test('#1632.681ec30e after /clear, your answer to the ask A raised before it never comes back through deep mcp as B\'s: not by B\'s deep_wait on it, nor by any other session-bound call B makes', async () => {
  const w = await world();
  const { agent, hub, home, a } = w;

  // Before the clear: A raises a taste call. With a recommendation it goes on provisionally, so no call is held open
  // across the clear (the base's deep_ask; any status will do as long as it names the ask).
  const tag = word();
  const recommended = { id: `keep${word(6)}`, label: `Keep ${word(6)} slate` };
  const chosen = { id: `pick${word(6)}`, label: `Pick ${word(6)} amber` };
  const raised = await agent.call('deep_ask', taste(`Which accent for the ${tag} header?`, [recommended, chosen], recommended.id));
  const handle = raised.isError ? undefined : (raised.value?.ask as string | undefined);
  if (typeof handle !== 'string' || !/^ask:/.test(handle)) throw Error(`BLOCKED: A ${a.id}'s deep_ask named no ask: ${JSON.stringify(raised.reply).slice(0, 1500)}`);
  const created = await eventMatching(hub, (e) => e.kind === 'ask.created' && (e.subject === handle || `ask:${e.id}` === handle));
  if (created?.session !== a.id) throw Error(`BLOCKED: ${handle} wasn't filed under A ${a.id}: ${JSON.stringify(created)}`);

  // The clear, then your answer: the option A didn't go on with, so only your answer could carry its ID and label.
  const { b } = await clear(w, a);
  const answered = await deep(home, ['inbox', 'answer', handle, chosen.id]);
  if (answered.code !== 0) throw Error(`BLOCKED: deep inbox answer ${handle} ${chosen.id} exited ${answered.code}: ${answered.stdout}${answered.stderr}`);
  if (!(await eventMatching(hub, (e) => e.kind === 'ask.answered' && e.subject === handle))) throw Error(`BLOCKED: no ask.answered for ${handle} after you answered it`);

  // B's next prompt, as Claude Code sends it. What its hook reply says is the thread's delivery and isn't judged here.
  await agent.hook(b, 'UserPromptSubmit');

  // B's session-bound calls after the clear, each stamped by B's PreToolUse as Claude Code fires it, and B's
  // deep_wait once more with no stamp. The deep_wait on A's ask comes first and last, around the rest.
  const own = [{ id: `thin${word(6)}`, label: `Thin ${word(6)}` }, { id: `thick${word(6)}`, label: `Thick ${word(6)}` }];
  const calls: { what: string; tool: string; args: Line; stamped: boolean }[] = [
    { what: `B's deep_wait on A's ${handle}, stamped by B`, tool: 'deep_wait', args: { ask: handle }, stamped: true },
    { what: `B's deep_wait on A's ${handle}, with no PreToolUse`, tool: 'deep_wait', args: { ask: handle }, stamped: false },
    { what: 'B\'s deep_status', tool: 'deep_status', args: {}, stamped: true },
    // B's own taste call recommends an option, so it goes on at once instead of waiting.
    { what: 'B\'s own deep_ask', tool: 'deep_ask', args: taste(`Which border for the ${word()} footer?`, own, own[0]!.id), stamped: true },
    { what: 'B\'s deep_claim', tool: 'deep_claim', args: claimArgs(), stamped: true },
    { what: 'B\'s deep_open_item', tool: 'deep_open_item', args: { text: `The ${word()} footer still needs a border` }, stamped: true },
    { what: `B's deep_wait on A's ${handle} again, stamped by B`, tool: 'deep_wait', args: { ask: handle }, stamped: true },
  ];

  const carried: string[] = [];
  for (const c of calls) {
    const o = await made(agent, b, c.tool, c.args, c.stamped);
    const why = carries(o, c.tool, handle, chosen);
    console.log(`${c.what}: ${o.isError ? `refused ${String(o.value?.code)}: ${String(o.value?.remediation ?? o.value?.message ?? '').slice(0, 160)}` : `ok ${JSON.stringify(o.value).slice(0, 160)}`}`);
    if (why) carried.push(`${c.what} carried your answer to A's ask (${why}): ${JSON.stringify(o.reply).slice(0, 1500)}`);
  }
  expect(carried, `after the clear (A ${a.id} ended with reason clear, B ${b.id} started in the same process), no call B makes through deep mcp returns your answer "${chosen.id}" (${chosen.label}) to A's ${handle} as B's`).toEqual([]);
}, 420_000);

/** One call from the agent's deep mcp, stamped first by `s`'s PreToolUse when `stamped`. */
async function made(agent: Agent, s: Session, tool: string, args: Line, stamped: boolean): Promise<Outcome> {
  if (stamped) await agent.stamp(s, tool, args);
  return agent.call(tool, args);
}

/**
 * Why a reply carries your answer to `handle` as the caller's own, or null when it doesn't. A reply carries it when
 * it holds the chosen option's label anywhere, when its value's answer is the chosen option, when a deep_wait on the
 * ask returns it settled (answered or decided) as a success, or when a call other than deep_wait names the ask at all.
 * A refusal of the deep_wait that names the ask (not_found, unbound) carries nothing.
 */
function carries(o: Outcome, tool: string, handle: string, chosen: { id: string; label: string }): string | null {
  const text = JSON.stringify(o.reply);
  if (text.includes(chosen.label)) return `holds the chosen option's label "${chosen.label}"`;
  const value = o.value as Line | undefined;
  if (!o.isError && value && typeof value === 'object' && value.answer === chosen.id) return `its answer is "${chosen.id}"`;
  if (tool === 'deep_wait') {
    if (!o.isError && value?.ask === handle && (value.status === 'answered' || value.status === 'decided')) return `returns the ask ${value.status}`;
    if (!o.isError && text.includes(chosen.id)) return `holds the chosen option "${chosen.id}"`;
    return null;
  }
  if (text.includes(handle)) return `names A's ask ${handle}`;
  return null;
}
