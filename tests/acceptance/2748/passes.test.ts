// #2748's criteria 1 to 5 on a real hub with a planted reviewer, as #1862's test runs one. One story, told once
// through one hub (helpers.ts, `theStory`): your wiki holds two passes beside the review's rubric, `research` scoped to
// src/net/** and `audit` with no scope, the audit with the two merged PRs it found bugs in (PR 12 and PR 17, real
// commits of the fixture repo); the claim's checkout holds a file with a pass named `audit` and another prompt. One
// session opens PR 21 and makes five commits, each a claim: line 3 of src/ui/cart.ts (line 6, an unchecked JSON.parse
// the base commit holds, is in its hunk's context); line 16 of it; after you change the audit's prompt on the page,
// line 13 of it; src/net/fetch.ts; and line 10 of src/ui/cart.ts, which adds an unchecked JSON.parse.
// Five short stories run on hubs planted with a wrong program (README, Wrong programs): `runs-every-pass` (AC1),
// `passes-from-checkout` (AC3), `pass-findings-sent-nowhere` and `pass-sends-back-context` (AC4) and
// `replays-every-claim` (AC5). The merge base, where nothing runs a pass, is AC1's wrong program too.
import { afterAll, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, AC5, ADDED, AUDIT, AUDIT_CHANGED, AUDIT_PROMPT, CART, CHECKOUT_PASSES, CONTEXT, CONTEXT_SENT, EVERY_PASS, FETCH, FROM_CHECKOUT, NET_SCOPE, PASSES_PAGE,
  REPLAYS_AGAIN, RESEARCH, SENT_NOWHERE, asksOnce, asksThree, at, bothPasses, cleanup, failureOf, holds, onePassRun, preExisting, progress, sayJobs, sentBack, thePlanted,
  theStory, wikiPrompt, type Round,
} from './helpers.ts';

// The steps the stories reached, with their times, then every process the suite started is stopped by PID.
afterAll(async () => { console.log(progress(200)); await cleanup(); }, 120_000);
const STORY_MS = 2_700_000;
const sayRound = (r: Round): string => `${r.claim} on ${r.commit.slice(0, 12)}; the runner's jobs in its round: ${sayJobs(r.jobs)}`;

it(`${AC1} a claim whose diff touches only ${CART} starts one pass run, ${AUDIT}, and its output names ${RESEARCH} as out of scope; a hub that runs every pass fails, naming ${RESEARCH}; the merge base fails, naming the claim`, async () => {
  const st = await theStory();
  await onePassRun(st.hub, st.first);
  const p = await thePlanted(EVERY_PASS);
  const caught = await failureOf(() => onePassRun(p.hub, p.first));
  holds(caught !== null, `${AC1} on the hub planted with ${EVERY_PASS}, which runs every pass whatever its scope, this test must fail: it passed. ${sayRound(p.first)}`);
  holds(caught.includes(RESEARCH) && caught.includes(NET_SCOPE), `${AC1} the failure on the hub planted with ${EVERY_PASS} names the pass that ran out of scope, ${RESEARCH}: ${caught}`);
}, STORY_MS);

it(`${AC2} a claim whose diff touches ${FETCH} starts both passes`, async () => {
  const st = await theStory();
  await bothPasses(st.hub, st.net);
}, STORY_MS);

it(`${AC3} a file in the claim's checkout that holds a pass named ${AUDIT} with another prompt changes nothing: the prompt in the run's request is the wiki's; a hub that reads passes from the checkout fails, naming the file`, async () => {
  const st = await theStory();
  wikiPrompt(st.first);
  const p = await thePlanted(FROM_CHECKOUT);
  const caught = await failureOf(() => wikiPrompt(p.first));
  holds(caught !== null, `${AC3} on the hub planted with ${FROM_CHECKOUT}, which reads the passes from ${CHECKOUT_PASSES} in the claim's checkout in place of the wiki's ${PASSES_PAGE}, this test must fail: it passed. ${sayRound(p.first)}`);
  holds(caught.includes(CHECKOUT_PASSES), `${AC3} the failure on the hub planted with ${FROM_CHECKOUT} names the file, ${CHECKOUT_PASSES}: ${caught}`);
}, STORY_MS);

it(`${AC4} a finding of ${AUDIT} on a line the change added (${at(ADDED)}) sends the claim back as one item naming the pass; the same finding on a context line (${at(CONTEXT)}) shows as pre-existing and sends nothing back`, async () => {
  const st = await theStory();
  await sentBack(st.hub, st.finding);
  await preExisting(st.hub, st.first);
  const nowhere = await thePlanted(SENT_NOWHERE);
  const first = await failureOf(() => sentBack(nowhere.hub, nowhere.first));
  holds(first !== null, `${AC4} on the hub planted with ${SENT_NOWHERE}, which records a pass's findings and sends none back, the first case must fail: it passed. ${sayRound(nowhere.first)}`);
  holds(first.includes(AUDIT) && first.includes(at(ADDED)), `${AC4} the failure on the hub planted with ${SENT_NOWHERE} names the pass and the finding it didn't send back, ${AUDIT} at ${at(ADDED)}: ${first}`);
  const context = await thePlanted(CONTEXT_SENT);
  const second = await failureOf(() => preExisting(context.hub, context.first));
  holds(second !== null, `${AC4} on the hub planted with ${CONTEXT_SENT}, which sends back a finding on a line the change didn't add or alter, the second case must fail: it passed. ${sayRound(context.first)}`);
  holds(second.includes(at(CONTEXT)) && second.includes('sends nothing back'), `${AC4} the failure on the hub planted with ${CONTEXT_SENT} names the context line it sent back, ${at(CONTEXT)}: ${second}`);
}, STORY_MS);

it(`${AC5} a second claim, with ${AUDIT} and its two PRs unchanged, asks the planted reviewer once, for its own diff, and reads both replays as carried; a hub that replays both PRs again asks three times and fails, naming the calls; after the prompt changes, the next claim asks all three again`, async () => {
  const st = await theStory();
  asksThree(st.first, AUDIT_PROMPT, 'with no replay of the pass in the record yet');
  await asksOnce(st.hub, st.w, st.second);
  asksThree(st.changed, AUDIT_CHANGED, `after you changed the pass's prompt on ${PASSES_PAGE}`);
  const p = await thePlanted(REPLAYS_AGAIN);
  const again = p.second!;
  const caught = await failureOf(() => asksOnce(p.hub, p.w, again));
  holds(caught !== null, `${AC5} on the hub planted with ${REPLAYS_AGAIN}, which replays both PRs again on every claim, this test must fail: it passed. ${sayRound(again)}`);
  const calls = again.calls.map((j) => j.job);
  holds(calls.length === 3 && calls.every((j) => caught.includes(j)), `${AC5} the failure on the hub planted with ${REPLAYS_AGAIN} names the three calls of its second claim (${calls.join(', ') || 'none'}): ${caught}`);
}, STORY_MS);
