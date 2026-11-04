// #323 AC1, AC2, AC3, AC7: what a claim leaves open becomes open items, and a command the final message tells you to
// run is run by the gate first (design: An agent says it's done: Open items; the done-gate row: "turns the agent's
// 'still open' list into open items, and flags placeholder text left in changed files"; Done means switched on:
// "Review notes on the PR and limits the change writes into its own docs become open items").
//
// One hub, two recorded Claude Code sessions, each in its own repo.
//
// Session A works on "make the auth middleware reject expired tokens". Its turn leaves a TODO in src/auth.js and a
// "not implemented" stub in a new src/refresh.js (src/legacy.js holds a FIXME at the base commit and is never
// touched), writes into README.md that the middleware doesn't check the audience yet, files issue #12 with `gh issue
// create`, and opens PR 22 whose body names a known limit. Its first stop, with the unit test still failing, ends on
// a message with a "Still open" list, a "Follow-ups" list of two bugs it found and left, and the issue it filed
// instead of fixing. It is sent back on the failing unit test; it then fixes the code and stops again saying every
// follow-up is fixed, which is the agent's word and closes nothing.
//
// Session B makes its definition and the repo's spec pass, then stops telling you to run
// `node scripts/verify-expiry.js`, a script the repo doesn't have.
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  AC1, AC2, AC3, AC7, FIX, FLAG, begin, cleanup, decision, draft, isOpen, itemsNaming, itemsOf, judgedAfter, lastPos, listed, makeWorld, must, once,
  replyText, runsOf, settle, shown, startHub, strings, taskVerdicts, type Ev, type Hub, type World,
} from './helpers.ts';
import { PR_URL, prAnswers } from './github.ts';

const PROMPT_A = 'make the auth middleware reject expired tokens';
const PROMPT_B = 'fix the expired token check in the auth middleware';
const PR_BODY = 'Rejects expired tokens at the middleware.\n\nKnown limit: a token with no exp claim is still accepted.';
const FINAL_1 = [
  'I made the middleware flag expired tokens.',
  '',
  'Still open:',
  '- The e2e test for expired tokens was not run',
  '',
  'Follow-ups:',
  '- The refresh endpoint also accepts expired tokens',
  '- Logout leaves the session cookie set',
  '',
  `I also found that the rate limiter double-counts retries, and filed it as #12 (https://github.com/acme/shop/issues/12) instead of fixing it here.`,
].join('\n');
const FINAL_2 = 'All the follow-ups are fixed now: the refresh endpoint and logout are handled, and #12 is closed.';
const COMMAND = 'node scripts/verify-expiry.js';

let w: World;
let hub: Hub;
beforeAll(async () => {
  w = await makeWorld({
    repos: ['a', 'b'],
    drafts: [draft(PROMPT_A), draft(PROMPT_B)],
    answers: prAnswers([{ n: 22, body: PR_BODY, threads: [] }]),
    files: { 'src/legacy.js': '// FIXME: drop the v1 token format once every client is on v2\nmodule.exports = { v1: true };\n' },
  });
  hub = await startHub(w);
}, 180_000);
afterAll(cleanup, 60_000);

/** Session A, played once: the task, the record after each stop, and stop 2's log position. */
const sessionA = once(async (): Promise<{ ref: string; first: Ev[]; second: Ev[] }> => {
  const { s, ref } = await begin(w, hub, w.repos.a!, PROMPT_A, 'session A:');
  await s.edit('src/auth.js', 'rejectsExpired: false', 'rejectsExpired: false, // TODO: allow for clock skew');
  await s.write('src/refresh.js', "module.exports = function refresh(token) {\n  throw new Error('not implemented');\n};\n");
  await s.edit('README.md', "checks each request's token.\n", "checks each request's token.\nThe middleware doesn't check the token's audience yet.\n");
  await s.bash('gh issue create --title "Rate limiter double-counts retries" --body "Each retry is counted twice against the limit."', { stdout: 'https://github.com/acme/shop/issues/12\n' });
  await s.bash(`gh pr create --title "Reject expired tokens" --body "${PR_BODY}"`, { stdout: `${PR_URL(22)}\n` });
  const since = await lastPos(hub);
  await s.stop(FINAL_1);
  const first = await judgedAfter(hub, ref, since);
  await settle(hub, () => false, 3000);
  const since2 = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  await s.stop(FINAL_2);
  await judgedAfter(hub, ref, since2);
  const second = await settle(hub, () => false, 3000);
  return { ref, first, second };
});

describe(`${AC1} a placeholder in a changed file becomes an open item`, () => {
  it(`${AC1} the TODO the turn leaves in src/auth.js and the "not implemented" stub in the new src/refresh.js are open items; the FIXME in src/legacy.js, which the change never touched, is not`, async () => {
    const { ref, first } = await sessionA();
    const items = itemsOf(first, ref);
    must(itemsNaming(first, ref, ['src/auth.js', 'TODO']).length > 0, `${AC1} the TODO left in src/auth.js, a changed file, must become an open item of ${ref} naming the file and the placeholder: its open items are ${listed(items)}`);
    must(itemsNaming(first, ref, ['src/refresh.js', 'not implemented']).length > 0, `${AC1} the "not implemented" left in src/refresh.js, a file the change added, must become an open item of ${ref} naming the file and the placeholder: its open items are ${listed(items)}`);
    must(itemsNaming(first, ref, ['src/legacy.js']).length === 0, `${AC1} src/legacy.js is unchanged, so its FIXME is no open item of this change: ${listed(itemsNaming(first, ref, ['src/legacy.js']))}`);
  }, 600_000);
});

describe(`${AC2} found bugs left as follow-ups, or filed as issues, get an open item each, and none closes on the agent's word`, () => {
  it(`${AC2} the two follow-ups and issue #12 each get an open item, and after the agent's next stop says they are all fixed, all three are still open`, async () => {
    const { ref, first, second } = await sessionA();
    const left = [
      { what: 'the follow-up "The refresh endpoint also accepts expired tokens"', parts: ['refresh endpoint also accepts expired tokens'] },
      { what: 'the follow-up "Logout leaves the session cookie set"', parts: ['session cookie'] },
      { what: 'issue #12, filed instead of fixing the rate limiter', parts: ['rate limiter'] },
    ];
    const found = left.map((l) => ({ ...l, items: itemsNaming(first, ref, l.parts) }));
    for (const l of found) must(l.items.length > 0, `${AC2} ${l.what} must become an open item of ${ref}: its open items are ${listed(itemsOf(first, ref))}`);
    const ids = new Set(found.map((l) => l.items[0]!.id));
    must(ids.size === 3, `${AC2} each bug left gets an open item of its own, not one for the list: ${found.map((l) => `${l.what}: ${l.items[0]!.id}`).join('; ')}`);
    must(holds12(found[2]!.items), `${AC2} the open item for the filed issue names it, #12 or its link: ${listed(found[2]!.items)}`);
    for (const l of found) must(l.items.every((i) => isOpen(second, i)), `${AC2} ${l.what} closes only on evidence, your answer or a rule; the agent's "${FINAL_2}" is its word, so the item stays open: ${listed(second.filter((e) => e.kind === 'open_item.closed' && e.data.task_ref === ref))}`);
  }, 600_000);
});
const holds12 = (items: Ev[]) => items.some((i) => strings(i.data).some((t) => /#12\b|issues\/12\b/.test(t)));

describe(`${AC3} limits the change writes into its PR body or its docs become open items, as a "still open" list does`, () => {
  it(`${AC3} the PR body's "Known limit", README's "doesn't check the token's audience yet" and the "Still open" item each become an open item`, async () => {
    const { ref, first } = await sessionA();
    const items = itemsOf(first, ref);
    must(itemsNaming(first, ref, ['e2e test for expired tokens']).length > 0, `${AC3} the final message's "Still open" item, "The e2e test for expired tokens was not run", must become an open item of ${ref}: its open items are ${listed(items)}`);
    must(itemsNaming(first, ref, ['no exp claim']).length > 0, `${AC3} the limit PR 22's body states, "Known limit: a token with no exp claim is still accepted", must become an open item of ${ref}, as the "Still open" one does: its open items are ${listed(items)}`);
    must(itemsNaming(first, ref, ['audience']).length > 0, `${AC3} the limit the change wrote into README.md, "The middleware doesn't check the token's audience yet", must become an open item of ${ref}, as the "Still open" one does: its open items are ${listed(items)}`);
  }, 600_000);
});

describe(`${AC7} a command the final message tells you to run is run by the gate first`, () => {
  it(`${AC7} with the definition and the spec passing, a stop that says to run \`${COMMAND}\`, a missing script, runs it once and is sent back with its output`, async () => {
    const { s, ref } = await begin(w, hub, w.repos.b!, PROMPT_B, AC7);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(FLAG.file, FLAG.from, FLAG.to);
    const since = await lastPos(hub);
    const stop = await s.stop(`Expired tokens are rejected now. To verify, run \`${COMMAND}\` from the repo root.`);
    const verifying = (all: Ev[]) => runsOf(all, ref, since).some((r) => r.finished !== undefined && strings(r.started.data).some((t) => t.includes('verify-expiry.js')));
    const events = await settle(hub, (all) => verifying(all) && taskVerdicts(all, ref, since).length > 0, 45_000);
    const runs = runsOf(events, ref, since).filter((r) => strings(r.started.data).some((t) => t.includes('verify-expiry.js')));
    must(runs.length === 1, `${AC7} the gate runs \`${COMMAND}\`, which the final message tells you to run, once before the stop's reply: ${runs.length} runs of it; the claim's runs are ${runsOf(events, ref, since).map((r) => String(r.started.data.check)).join(', ') || 'none'}`);
    must(runs[0]!.finished?.data.outcome === 'failed', `${AC7} \`${COMMAND}\` fails (the script doesn't exist): ${JSON.stringify(runs[0]!.finished?.data ?? 'no run.finished')}`);
    const reply = replyText(stop);
    must(decision(stop) === 'deny', `${AC7} the command you were told to run fails, so the claim is sent back; deep-hook let the stop through: ${shown(stop)}`);
    must(reply.includes('verify-expiry.js') && /Cannot find module/.test(reply), `${AC7} the send-back carries the command and its output (node's "Cannot find module"): ${reply.slice(0, 800)}`);
  }, 600_000);
});
