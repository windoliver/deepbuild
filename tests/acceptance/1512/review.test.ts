// #1512's eight criteria on a real hub. One story, told once through one hub (helpers.ts, `theStory`): the fixture
// repo holds "no default exports" for src/**, "never force-push" with its working guard, and 60 rules for docs/**;
// another agent session proposes "Keep every exported function under forty lines" with deep_propose and nobody keeps
// it; your session opens a task and PR 21 and makes four commits, each a claim the hub reviews through the fake
// reviewer: A adds src/a.ts with a default export, B adds src/b.ts with one, C makes src/a.ts's export a named one
// (the clean twin), D changes docs/a.md alone. The rules page is synced before the first review and after the last.
// Two short stories run on hubs planted with a wrong program (README, Wrong programs): `rubric-holds-every-rule` (AC2,
// and AC4's and AC5's request halves) and `review-without-caller` (AC8). The merge base is AC1's and AC6's.
import { afterAll, it } from 'vitest';
import {
  A_FILE, AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, B_FILE, DOCS_FILE, DRAFTED_SIZE, EVERY_RULE, GUARD, GUARDED, NO_CALLER, PROPOSED, RULE, allEvents, cleanup,
  diffFiles, failureOf, gives, guardedOut, holds, lastVerdict, linesWith, must, naming, oneReviewRun, onPage, outOfScope, outputOf, progress, proposedOut, reviewRuns,
  sayCalls, sayItems, sayRule, sayRuns, sayVerdict, sentBy, theStory, thePlanted, type Round, type Story,
} from './helpers.ts';

// The steps the stories reached, with their times, then every process the suite started is stopped by PID.
afterAll(async () => { console.log(progress(200)); await cleanup(); }, 120_000);
const STORY_MS = 2_700_000;

/** The rules you wrote that cover the first round's diff (src/a.ts, src/auth.js): the control of AC4 and AC5. */
const firstRound = (st: Story) => ({ calls: st.first.calls, rules: [st.before.rule], what: `${sayRule(st.before.rule)}, in the request of the first round, whose diff adds ${A_FILE}` });
const sayRound = (r: Round): string => `${r.claim} on ${r.commit}; the fake reviewer's calls: ${sayCalls(r.calls)}`;

it(`${AC1} a diff that adds a default export in ${A_FILE} is sent back naming "${RULE}", with the file, line and quote`, async () => {
  const st = await theStory();
  const events = await allEvents(st.hub);
  const { first: r, before: { rule } } = st;
  const items = sentBy(events, r.claim);
  const site = items.filter((i) => naming(i, rule)).flatMap((i) => i.sites).find((s) => s.file === A_FILE && s.line === 1 && String(s.quote).includes('export default'));
  holds(site !== undefined, `${AC1} ${r.claim} adds a default export at ${A_FILE}:1 under ${sayRule(rule)}, so it is sent back naming the rule's ID ${rule.id}, with ${A_FILE}, line 1 and the line's quote: `
    + `its review round sent back ${sayItems(items)}. The rule in its requests: ${r.calls.map((c) => `${c.job}: ${linesWith(c, RULE)}`).join('; ') || 'no request'}. `
    + `Its review runs: ${sayRuns(reviewRuns(events, r.claim))}. ${sayRound(r)}`);
  const verdict = lastVerdict(events, r.claim);
  holds(verdict !== undefined && verdict.data.outcome !== 'PASS', `${AC1} a model's finding can send ${r.claim} back and can never pass it: its verdict is ${sayVerdict(verdict)}`);
}, STORY_MS);

it(`${AC2} the same rule on a diff touching only ${DOCS_FILE} is not in that run's rubric; a rubric that always holds every rule fails, naming the rule`, async () => {
  const st = await theStory();
  outOfScope(st.docs, st.before);
  const p = await thePlanted(EVERY_RULE);
  const caught = await failureOf(() => outOfScope(p.round, p.rules!));
  holds(caught !== null, `${AC2} on the hub planted with ${EVERY_RULE}, whose rubric always holds every rule, this test must fail: it passed. ${sayRound(p.round)}`);
  holds(caught.includes(p.rules!.rule.id) && caught.includes(RULE), `${AC2} the failure on the hub planted with ${EVERY_RULE} names the rule, ${sayRule(p.rules!.rule)}: ${caught}`);
}, STORY_MS);

it(`${AC3} a clean twin of the diff, with a named export, gets no finding on "${RULE}"`, async () => {
  const st = await theStory();
  const events = await allEvents(st.hub);
  const { twin: r, before: { rule } } = st;
  const without = r.calls.filter((c) => !gives(c, rule));
  holds(r.calls.length > 0 && without.length === 0, `${AC3} the clean twin ${r.claim}, whose diff makes ${A_FILE}'s export a named one, is reviewed with ${sayRule(rule)} in its rubric: `
    + `${r.calls.length ? `the request ${without.map((c) => c.job).join(', ')} holds no line naming it` : 'no review run of it was given a request'}. ${sayRound(r)}`);
  for (const c of r.calls) must(diffFiles(c.given).join(',') === A_FILE, `BLOCKED: ${AC3} the clean twin's review must be given its commit's change, which touches ${A_FILE} alone: ${c.job}'s diff touches ${JSON.stringify(diffFiles(c.given))}`);
  const items = sentBy(events, r.claim).filter((i) => naming(i, rule));
  const failed = reviewRuns(events, r.claim).filter((x) => x.finished?.data.outcome === 'failed' && JSON.stringify(x.finished.data).includes(rule.id));
  holds(items.length === 0 && failed.length === 0, `${AC3} the clean twin ${r.claim}, a named export where the first diff had a default one, gets no finding on ${sayRule(rule)}: `
    + `${items.length ? `its review round sent back ${sayItems(items)}` : ''}${items.length && failed.length ? ', and ' : ''}${failed.length ? `its review runs failed naming it: ${sayRuns(failed)}` : ''}. ${sayRound(r)}`);
}, STORY_MS);

it(`${AC4} a rule an agent proposed and you never kept is not in the rubric, read from the run's request`, async () => {
  const st = await theStory();
  proposedOut(st.calls, firstRound(st), st.proposal);
  const p = await thePlanted(EVERY_RULE);
  const caught = await failureOf(() => proposedOut(p.round.calls, { calls: p.round.calls, rules: p.rules!.docs, what: 'the rules for docs/**, in its docs round\'s request' }, p.proposal!));
  holds(caught !== null, `${AC4} on the hub planted with ${EVERY_RULE}, whose rubric holds every rule an agent proposed too, this test must fail: it passed. ${sayRound(p.round)}`);
  holds(caught.includes(PROPOSED), `${AC4} the failure on the hub planted with ${EVERY_RULE} names the proposed rule, "${PROPOSED}": ${caught}`);
}, STORY_MS);

it(`${AC5} a rule with a working guard stays out of the rubric, and the page keeps the guard as its enforcer`, async () => {
  const st = await theStory();
  guardedOut(st.calls, firstRound(st), st.before.guarded);
  const guarded = onPage(st.after, GUARDED);
  holds(guarded?.enforcer.kind === 'guard' && guarded.enforcer.name === GUARD, `${AC5} after the reviews, the rules page keeps the guard ${GUARD} as the enforcer of "${GUARDED}": it shows ${JSON.stringify(guarded?.enforcer ?? 'no line for the rule')}`);
  const rule = onPage(st.after, RULE);
  holds(rule?.enforcer.kind === 'review', `${AC5} the rules page reads review as the enforcer of ${sayRule(st.before.rule)}, a text-only rule the reviews held, beside the guard it keeps for "${GUARDED}": it shows ${JSON.stringify(rule?.enforcer ?? 'no line for the rule')}`);
  const p = await thePlanted(EVERY_RULE);
  const caught = await failureOf(() => guardedOut(p.round.calls, { calls: p.round.calls, rules: p.rules!.docs, what: 'the rules for docs/**, in its docs round\'s request' }, p.rules!.guarded));
  holds(caught !== null, `${AC5} on the hub planted with ${EVERY_RULE}, whose rubric holds every rule whatever enforces it, this test must fail: it passed. ${sayRound(p.round)}`);
  holds(caught.includes(GUARDED), `${AC5} the failure on the hub planted with ${EVERY_RULE} names the guarded rule, "${GUARDED}": ${caught}`);
}, STORY_MS);

it(`${AC6} with 60 rules in scope, the added lines stay under the drafted size and the run's output names each rule left out`, async () => {
  const st = await theStory();
  const events = await allEvents(st.hub);
  const { docs: r, before: { all, docs } } = st;
  holds(r.calls.length > 0, `${AC6} ${r.claim}, whose diff touches only ${DOCS_FILE} and so has the ${docs.length} rules for docs/** in scope, gets a review run whose request can be read: the fake reviewer was never called in that round`);
  for (const c of r.calls) must(diffFiles(c.given).join(',') === DOCS_FILE, `BLOCKED: ${AC6} the docs round's review must be given a diff touching only ${DOCS_FILE}: ${c.job}'s diff touches ${JSON.stringify(diffFiles(c.given))}`);
  const run = reviewRuns(events, r.claim).find((x) => x.started.data.commit === r.commit);
  holds(run !== undefined, `${AC6} ${r.claim} has a review run on its commit ${r.commit}, whose output names the rules left out: ${sayRuns(reviewRuns(events, r.claim))}`);
  const output = await outputOf(st.hub, events, String(run.started.data.run));
  const flat = output.replace(/\s+/g, ' ').toLowerCase();
  for (const c of r.calls) {
    const held = all.filter((x) => gives(c, x));
    const size = held.reduce((n, x) => n + x.tokens, 0);
    holds(size <= DRAFTED_SIZE, `${AC6} with ${docs.length} rules in scope, the rubric's added lines stay under the drafted size, ${DRAFTED_SIZE} tokens by the rules page's sizes: ${c.job}'s request holds ${held.length} rules of the page, ${size} tokens`);
    const left = docs.filter((d) => !gives(c, d));
    const unnamed = left.filter((d) => !output.includes(d.id) && !flat.includes(d.text.replace(/\s+/g, ' ').toLowerCase()));
    holds(unnamed.length === 0, `${AC6} with ${docs.length} rules in scope, ${left.length} of them were left out of ${c.job}'s request, and the run's output (${String(run.started.data.run)}) names ${left.length - unnamed.length} of them: `
      + `${unnamed.length} are dropped unnamed, such as ${unnamed.slice(0, 3).map((d) => `${d.handle} "${d.text.slice(0, 18)}…"`).join(', ')}`);
    holds(held.some((x) => docs.includes(x)), `${AC6} the rubric gains the rules in scope up to the drafted size: ${c.job}'s request holds none of the ${docs.length}`);
  }
}, STORY_MS);

it(`${AC7} after two send-backs naming one rule, the rules page shows 2 and how each ended; the count is a reading and never moves a verdict`, async () => {
  const st = await theStory();
  const events = await allEvents(st.hub);
  const { rule } = st.before;
  const sent = [st.first, st.second].map((r) => ({ r, items: sentBy(events, r.claim).filter((i) => naming(i, rule)) }));
  holds(sent.every((x) => x.items.length > 0), `${AC7} the story sends ${sayRule(rule)} back twice, at ${A_FILE}:1 (commit A) and at ${B_FILE}:1 (commit B), each a send-back naming the rule: `
    + `${sent.map((x) => `${x.r.claim} sent back ${sayItems(x.items)}`).join('; ')}`);
  const line = onPage(st.after, RULE);
  const counted = line?.json.sent_back as { count?: unknown; fixed?: unknown; left?: unknown } | undefined;
  holds(counted?.count === 2, `${AC7} after two send-backs naming ${sayRule(rule)} in the last 30 days, its line on the rules page shows 2 (sent_back.count): it shows ${JSON.stringify(line?.json ?? 'no line for the rule')}`);
  holds(counted.fixed === 1 && counted.left === 1, `${AC7} the rules page shows how each send-back of ${sayRule(rule)} ended: ${A_FILE}:1's fixed by commit C, ${B_FILE}:1's left (sent_back.fixed 1, sent_back.left 1): it shows ${JSON.stringify(counted)}`);
  const later = [st.twin, st.docs].map((r) => ({ r, verdict: lastVerdict(events, r.claim) }));
  holds(later.every((x) => x.verdict?.data.outcome === 'PASS'), `${AC7} the count is a reading and never moves a verdict: each claim judged after the second send-back, with nothing sent back of its own, is PASS: `
    + `${later.map((x) => `${x.r.name} ${x.r.claim} ${sayVerdict(x.verdict)}`).join('; ')}`);
}, STORY_MS);

it(`${AC8} a claim that opens a PR through a real hub starts one review run, read from the record; a hub with no caller for the review check starts none and fails this test, naming the claim`, async () => {
  const st = await theStory();
  oneReviewRun(await allEvents(st.hub), st.first);
  const p = await thePlanted(NO_CALLER);
  const caught = await failureOf(async () => oneReviewRun(await allEvents(p.hub), p.round));
  holds(caught !== null, `${AC8} on the hub planted with ${NO_CALLER}, which holds the review kind with no caller, this test must fail: it passed. ${sayRound(p.round)}`);
  holds(caught.includes(p.round.claim), `${AC8} the failure on the hub planted with ${NO_CALLER} names the claim, ${p.round.claim}: ${caught}`);
}, STORY_MS);
