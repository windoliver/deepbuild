// #323 AC11: open items match on normalized text and scope (design: Open items as records, "Its ID is a hash of its
// normalized text and scope, so the same item raised twice is one record … Normalized means Unicode NFC, case folded,
// white space collapsed and trailing punctuation dropped, with numbers, paths and names kept; scope is the repo, the
// task and the requirement ID. A waiver matches error text after the same normalization, with temporary paths,
// process IDs, addresses and timestamps replaced by placeholders. It closes only when qualifying evidence arrives, or
// by your answer or a rule, and it reaches you only through an ask"; Known failures are waivers, "Closing an open item
// without evidence, as out of scope or won't fix, is a waiver too").
//
// One recorded Claude Code session, two stops in one task, so one repo, task and requirement (none). Stop 1's final
// message leaves "Check the café login on port 3000." open and lists a timeout it didn't verify; you waive the
// timeout's item through its ask. Stop 2's message leaves the first item again, differing only by Unicode form (é
// decomposed), case, runs of white space and trailing punctuation, adds the same item for port 3001, and lists the
// timeout again with another temporary path, PID and time, beside one that took 6000 ms.
import { afterAll, describe, it } from 'vitest';
import {
  AC11, FIX, FLAG, answer, asksRaised, begin, cleanup, closingsOf, draft, failureOf, holds, isOpen, itemId, itemsNaming, itemsOf, judgedAfter, lastPos,
  listed, makeWorld, must, settle, shown, startHub, strings, type Ev, type Line,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PROMPT = 'make the auth middleware reject expired tokens';
const WAIVED = 'timeout after 5000 ms in /tmp/t-81f2 (pid 4242) at 12:00:01';
const SAME_ERROR = 'timeout after 5000 ms in /tmp/t-9c3e (pid 5150) at 12:07:44';
const OTHER_ERROR = 'timeout after 6000 ms in /tmp/t-9c3e (pid 5150) at 12:07:44';
const FIRST = ['I flagged expired tokens.', '', 'Still open:', '- Check the café login on port 3000.', '', 'Not verified:', `- ${WAIVED}`].join('\n');
const SECOND = ['Expired tokens are rejected now.', '', 'Still open:', '- CHECK the café login   on PORT 3000!', '- Check the café login on port 3001.', '', 'Not verified:', `- ${SAME_ERROR}`, `- ${OTHER_ERROR}`].join('\n');

/** The option that closes an open item without evidence: a waiver (waive, won't fix, out of scope), else accept. */
function waiving(ask: Ev): string | undefined {
  const options = (ask.data.options ?? []) as Line[];
  const text = (o: Line) => `${String(o.id)} ${String(o.label ?? '')}`;
  return (options.find((o) => /waive|won.?t[ -]?fix|out[ -]of[ -]scope/i.test(text(o))) ?? options.find((o) => /accept/i.test(text(o))))?.id as string | undefined;
}

async function scenario(plant?: string): Promise<void> {
  const w = await makeWorld({ drafts: [draft(PROMPT)] });
  const hub = await startHub(w, plant);
  const { s, ref } = await begin(w, hub, w.repos.repo!, PROMPT, AC11);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const since1 = await lastPos(hub);
  await s.stop(FIRST);
  await judgedAfter(hub, ref, since1);
  let events = await settle(hub, (all) => itemsNaming(all, ref, ['t-81f2'], since1).length > 0 && asksRaised(all, since1).some((a) => holds(strings(a.data), 't-81f2')), 15_000);
  const [port3000] = itemsNaming(events, ref, ['port 3000'], since1);
  must(port3000 !== undefined, `${AC11} stop 1's "Still open" item, "Check the café login on port 3000.", must become an open item (AC3's reading): the task's open items are ${listed(itemsOf(events, ref))}`);
  must(itemId(port3000!) !== undefined, `${AC11} an open item carries its ID, the hash of its normalized text and scope (\`item\`): ${JSON.stringify(port3000!.data)}`);
  const [waived] = itemsNaming(events, ref, ['t-81f2'], since1);
  must(waived !== undefined, `${AC11} stop 1's "Not verified" item, "${WAIVED}", must become an open item: the task's open items are ${listed(itemsOf(events, ref))}`);
  // You waive the timeout's item through its ask: closing it without evidence.
  const ask = asksRaised(events, since1).find((a) => holds(strings(a.data), 't-81f2') || (itemId(waived!) !== undefined && holds(strings(a.data), itemId(waived!)!)));
  must(ask !== undefined, `${AC11} the open item "${WAIVED}" reaches you only through an ask, which closes it without evidence on your answer: no ask names it: ${listed(asksRaised(events, since1))}`);
  const option = waiving(ask!);
  must(option !== undefined, `${AC11} the ask for "${WAIVED}" offers to close it without evidence (waive, won't fix, out of scope): ${JSON.stringify(ask!.data.options)}`);
  const r = await answer(w, `ask:${ask!.id}`, option!);
  must(r.code === 0, `${AC11} your answer waiving "${WAIVED}" through deep inbox answer must count, exit 0: ${shown(r)}`);
  events = await settle(hub, (all) => closingsOf(all, waived!).length > 0, 15_000);
  must(closingsOf(events, waived!).length > 0, `${AC11} your waiver closes the open item "${WAIVED}": no open_item.closed for it`);

  await s.edit(FIX.file, FIX.from, FIX.to);
  const since2 = await lastPos(hub);
  await s.stop(SECOND);
  await judgedAfter(hub, ref, since2);
  events = await settle(hub, (all) => itemsNaming(all, ref, ['6000 ms'], since2).length > 0, 15_000);
  events = await settle(hub, () => false, 3000);

  const ids3000 = new Set(itemsNaming(events, ref, ['port 3000']).map(itemId));
  must(ids3000.size === 1, `${AC11} "CHECK the café login   on PORT 3000!" differs from "Check the café login on port 3000." only by Unicode form, case, runs of white space and trailing punctuation, in one repo, task and requirement, so it is the same item, one ID: ${[...ids3000].join(', ')}; ${listed(itemsNaming(events, ref, ['port 3000']))}`);
  const port3001 = itemsNaming(events, ref, ['port 3001'], since2);
  must(port3001.length > 0 && port3001.every((i) => itemId(i) !== itemId(port3000!)), `${AC11} 'port 3001' is another item than 'port 3000': numbers are kept, so it gets its own open item with its own ID; ${port3001.length ? `it has the ID of port 3000's, ${itemId(port3000!)}` : 'it has none'}: ${listed(itemsOf(events, ref, since2))}`);
  const again = itemsNaming(events, ref, ['5000 ms', 't-9c3e'], since2);
  must(again.every((i) => !isOpen(events, i)), `${AC11} your waiver of "${WAIVED}" matches "${SAME_ERROR}", the same error with another temporary path, PID and time, so no open item for it stays open: ${listed(again)}`);
  must(!asksRaised(events, since2).some((a) => holds(strings(a.data), 't-9c3e') && holds(strings(a.data), '5000 ms')), `${AC11} the waived error, seen again, never reaches you twice: ${listed(asksRaised(events, since2))}`);
  const other = itemsNaming(events, ref, ['6000 ms'], since2);
  must(other.length > 0 && other.some((i) => isOpen(events, i)), `${AC11} "${OTHER_ERROR}" took 6000 ms, not 5000: numbers are kept, so the waiver doesn't match it and it is an open item: ${listed(other)}`);
}

describe(`${AC11} open items match on normalized text and scope; waivers match with placeholders`, () => {
  it(`${AC11} the port 3000 item raised twice in another form is one item, port 3001 is two; the waiver for "${WAIVED}" matches it with another path, PID and time but not at 6000 ms`, async () => {
    await scenario();
  }, 600_000);

  it(`${AC11} (wrong program) a normalizer that drops numbers (DEEP_HUB_PLANT=normalizer-drops-numbers) merges the two ports and fails this test, naming port 3001`, async () => {
    const failure = await failureOf(() => scenario('normalizer-drops-numbers'));
    must(failure !== null, `${AC11} the planted normalizer must fail this test: it passed`);
    must(failure.includes('port 3001'), `${AC11} the failure names the item it merged, port 3001; it said: ${failure}`);
  }, 600_000);
});
