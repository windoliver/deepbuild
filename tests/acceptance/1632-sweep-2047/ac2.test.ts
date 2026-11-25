// #1632.b9d4ec97 A `deep_ask` that A raised before the clear, and that you answer after it, is never returned to B as
//   B's own through `deep mcp`: B's `deep_wait` on that ask, and every other session-bound call B makes after the
//   clear, never carries that answer as B's. Delivery of the answer along the thread joined across `/clear` stays as
//   the design's "Threads, not IDs" says (the hook replies at B's next prompt, recorded as a `delivery.outcome`) and
//   is not part of this criterion.
// The process is ../1632/fixtures/agent.mjs: its hooks are the real deep-hook and its one deep mcp is its child, kept
// across the clear, as Claude Code keeps its MCP servers. See this folder's README for the readings.

import { afterEach, expect, test } from 'vitest';
import { claimArgs, claimsFor, cleanup, clear, deep, eventMatching, events, sleep, word, world, type Line, type Outcome } from '../1632/helpers.ts';

afterEach(cleanup, 30_000);

type Option = { id: string; label: string };
/** deep_ask's arguments for a taste call with a recommendation, every nullable field left out as null. */
const taste = (question: string, options: Option[], recommended: string): Line => ({
  kind: 'taste', question, options, recommended, steps: null, where: null, why: null, check: null, thread: null, subject: null,
});
const shown = (o: Outcome): string => (o.isError ? `refused ${String(o.value?.code)}: ${String(o.value?.remediation ?? o.value?.message ?? '').slice(0, 200)}` : `ok ${JSON.stringify(o.value).slice(0, 200)}`);

test('#1632.b9d4ec97 after /clear, your answer to the ask A raised before it is never returned through deep mcp as B\'s, by B\'s deep_wait on it or any other session-bound call B makes, while B\'s own calls act for B', async () => {
  const w = await world();
  const { agent, hub, home, a } = w;

  // ---- Setup (BLOCKED, not a verdict, if any of it is missing).
  // A raises a taste call. With a recommendation it goes on provisionally, so no call of A's is open at the clear,
  // as Claude Code runs /clear only between turns.
  const recommended: Option = { id: `keep${word(6)}`, label: `Keep ${word(6)} slate` };
  const chosen: Option = { id: `pick${word(6)}`, label: `Pick ${word(6)} amber` };
  const raised = await agent.call('deep_ask', taste(`Which accent for the ${word()} header?`, [recommended, chosen], recommended.id));
  const handle = raised.isError ? undefined : (raised.value?.ask as string | undefined);
  if (typeof handle !== 'string' || !/^ask:/.test(handle)) throw Error(`BLOCKED: A ${a.id}'s deep_ask named no ask: ${JSON.stringify(raised.reply).slice(0, 1500)}`);
  const created = await eventMatching(hub, (e) => e.kind === 'ask.created' && (e.subject === handle || `ask:${e.id}` === handle));
  if (created?.session !== a.id) throw Error(`BLOCKED: ${handle} wasn't filed under A ${a.id}: ${JSON.stringify(created)}`);

  const { b } = await clear(w, a);

  // ---- Judged: B's calls after the clear, each stamped by B's PreToolUse as Claude Code fires it unless noted.
  const replies: { what: string; tool: string; o: Outcome }[] = [];
  const record = (what: string, tool: string, o: Outcome): Outcome => { console.log(`${what}: ${shown(o)}`); replies.push({ what, tool, o }); return o; };

  // B's deep_wait on A's ask, sent before you answer, so a hub that lets B wait on it would hand B the answer as it lands.
  const held = { ask: handle };
  await agent.stamp(b, 'deep_wait', held);
  const heldWait = agent.call('deep_wait', held, 150_000);
  await sleep(1500);

  // You answer with the option A didn't go on with, so only your answer could carry its ID and label.
  const answered = await deep(home, ['inbox', 'answer', handle, chosen.id]);
  if (answered.code !== 0) throw Error(`BLOCKED: deep inbox answer ${handle} ${chosen.id} exited ${answered.code}: ${answered.stdout}${answered.stderr}`);
  if (!(await eventMatching(hub, (e) => e.kind === 'ask.answered' && e.subject === handle))) throw Error(`BLOCKED: no ask.answered for ${handle} after you answered it`);
  record(`B's deep_wait on A's ${handle}, stamped by B and sent before your answer`, 'deep_wait', await heldWait);

  // B's next prompt, as Claude Code sends it. Its hook reply is the thread's delivery and isn't judged here.
  await agent.hook(b, 'UserPromptSubmit');

  const call = async (what: string, tool: string, args: Line, stamped = true): Promise<Outcome> => {
    if (stamped) await agent.stamp(b, tool, args);
    return record(what, tool, await agent.call(tool, args, 150_000));
  };
  await call(`B's deep_wait on A's ${handle}, stamped by B`, 'deep_wait', { ask: handle });
  await call(`B's deep_wait on A's ${handle}, with no PreToolUse`, 'deep_wait', { ask: handle }, false);
  await call('B\'s deep_status', 'deep_status', {});
  const own: Option[] = [{ id: `thin${word(6)}`, label: `Thin ${word(6)}` }, { id: `thick${word(6)}`, label: `Thick ${word(6)}` }];
  const ownAsk = await call('B\'s own deep_ask', 'deep_ask', taste(`Which border for the ${word()} footer?`, own, own[0]!.id));
  const claim = claimArgs();
  const claimed = await call('B\'s deep_claim', 'deep_claim', claim);
  const itemText = `The ${word()} footer still needs a border`;
  const opened = await call('B\'s deep_open_item', 'deep_open_item', { text: itemText });

  // B's own ask, answered by you, comes back to B through deep_wait: what B may receive is B's, not nothing at all.
  const ownHandle = ownAsk.isError ? undefined : (ownAsk.value?.ask as string | undefined);
  let ownWait: Outcome | undefined;
  if (typeof ownHandle === 'string' && /^ask:/.test(ownHandle)) {
    const ownAnswered = await deep(home, ['inbox', 'answer', ownHandle, own[1]!.id]);
    if (ownAnswered.code !== 0) throw Error(`BLOCKED: deep inbox answer ${ownHandle} ${own[1]!.id} exited ${ownAnswered.code}: ${ownAnswered.stdout}${ownAnswered.stderr}`);
    if (!(await eventMatching(hub, (e) => e.kind === 'ask.answered' && e.subject === ownHandle))) throw Error(`BLOCKED: no ask.answered for B's ${ownHandle} after you answered it`);
    ownWait = await call(`B's deep_wait on its own ${ownHandle}`, 'deep_wait', { ask: ownHandle });
  }
  await call(`B's deep_wait on A's ${handle} again, stamped by B`, 'deep_wait', { ask: handle });

  // The criterion: nothing B gets through deep mcp after the clear carries your answer to A's ask.
  const carried = replies.flatMap(({ what, tool, o }) => {
    const why = carries(o, tool, handle, chosen);
    return why ? [`${what} carried your answer to A's ask (${why}): ${JSON.stringify(o.reply).slice(0, 1500)}`] : [];
  });
  expect(carried, `after the clear (A ${a.id} ended with reason clear, B ${b.id} started in the same process), no call B makes through deep mcp returns your answer "${chosen.id}" (${chosen.label}) to A's ${handle} as B's`).toEqual([]);

  // Not by refusing everything: B's stamped session-bound calls act for B (README: Readings).
  await sleep(500);
  const all = await events(hub);
  const notForB: string[] = [];
  const ownCreated = ownHandle ? all.find((e) => e.kind === 'ask.created' && (e.subject === ownHandle || `ask:${e.id}` === ownHandle)) : undefined;
  if (ownAsk.isError || ownCreated?.session !== b.id) notForB.push(`B's own deep_ask is filed under B: ${shown(ownAsk)}; ask.created under ${ownCreated?.session}`);
  const claims = claimsFor(all, claim.task_ref).map((e) => e.session);
  if (claimed.isError || JSON.stringify(claims) !== JSON.stringify([b.id])) notForB.push(`B's deep_claim is recorded once, under B: ${shown(claimed)}; claim.made under ${JSON.stringify(claims)}`);
  const items = all.filter((e) => e.kind === 'open_item.opened' && e.data?.text === itemText).map((e) => e.session);
  if (opened.isError || JSON.stringify(items) !== JSON.stringify([b.id])) notForB.push(`B's deep_open_item is recorded once, under B: ${shown(opened)}; open_item.opened under ${JSON.stringify(items)}`);
  const ownAnswer = ownWait && !ownWait.isError ? ownWait.value : undefined;
  if (!ownWait || ownWait.isError || ownAnswer?.ask !== ownHandle || ownAnswer?.status !== 'answered' || !JSON.stringify(ownAnswer?.answer ?? null).includes(own[1]!.id)) {
    notForB.push(`B's deep_wait on its own ask returns your answer "${own[1]!.id}" to it: ${ownWait ? shown(ownWait) : 'not made, B raised no ask'}`);
  }
  expect(notForB, `after the clear, B ${b.id}'s stamped session-bound calls act for B (A was ${a.id})`).toEqual([]);
}, 600_000);

/**
 * Why a reply carries your answer to A's `handle` as the caller's own, or null when it doesn't. It carries it when it
 * holds the chosen option's label anywhere; when its value's answer is the chosen option; when a deep_wait on A's ask
 * returns that ask settled (answered or decided) or holds the chosen option's ID as a success; or when a call other
 * than deep_wait names A's ask at all. A refusal of a deep_wait that names the ask (not_found, unbound) carries nothing.
 */
function carries(o: Outcome, tool: string, handle: string, chosen: Option): string | null {
  const text = JSON.stringify(o.reply);
  if (text.includes(chosen.label)) return `holds the chosen option's label "${chosen.label}"`;
  const value = o.value as Line | undefined;
  if (!o.isError && value && typeof value === 'object' && (value.answer === chosen.id || value.answer?.option === chosen.id || value.answer?.id === chosen.id)) return `its answer is "${chosen.id}"`;
  if (tool === 'deep_wait') {
    if (o.isError) return null;
    if (value?.ask === handle && (value.status === 'answered' || value.status === 'decided')) return `returns A's ask ${value.status}`;
    if (text.includes(chosen.id)) return `holds the chosen option "${chosen.id}"`;
    return null;
  }
  if (text.includes(handle)) return `names A's ask ${handle}`;
  return null;
}

