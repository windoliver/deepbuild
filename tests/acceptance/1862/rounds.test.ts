// AC1 and AC2: review rounds converge on a real hub. One story, told once through one hub (helpers.ts, `theStory`):
// a session fixes the auth middleware, breaks src/cart.ts at lines 10 (the loop runs one past the end) and 40 (the
// catch drops the error), commits (A), opens PR 21 and stops; the first review, by the fake reviewer, sends both
// findings back. The session changes only line 10 back, commits (B) and stops; the second review runs.
//
// AC1 reads the second round: what reached the record and the session (line 40 isn't sent again), what the fake
// reviewer was given (commit B's change alone), and the record's `open` (line 40 stays the first send-back's open
// item). On the merge base the second round reads the whole diff from the merge base and sends line 40 again.
// AC2 reads the record once the claim has settled on commit B: how each sent-back item ended, as #87's ItemOutcome.
// On the merge base no outcome is recorded.
import { afterAll, it } from 'vitest';
import {
  AC1, AC2, BOUND, CART, LINE_10, LINE_40, addedIn, allEvents, cleanup, decision, isItem, must, names, objectsIn, outcomesOf, reviewRuns, sayCalls, sayFinding,
  sayReplies, sayRuns, settle, theStory, told, type Ev, type Finding,
} from './helpers.ts';

afterAll(cleanup, 60_000);

it(`${AC1} the second review reads only the next commit's change: ${sayFinding(LINE_40)} isn't sent again and stays the first send-back's open item`, async () => {
  const { hub, first, second } = await theStory();
  const events = await allEvents(hub);
  const runs = reviewRuns(events, second.claim);
  const stop = second.replies[0]!.ran;
  const seen = `The second round's review runs: ${sayRuns(runs)}. The fake reviewer's calls in it: ${sayCalls(second.calls)}. ${sayReplies(second.replies)}`;

  // Not sent again: no review run of the second claim fails naming it, and the second stop isn't sent back naming it.
  const failed = runs.filter((r) => r.finished?.data.outcome === 'failed' && names(JSON.stringify(r.finished.data), LINE_40));
  const blocked = decision(stop) === 'deny' && names(told(stop), LINE_40);
  must(failed.length === 0 && !blocked, `${AC1} ${sayFinding(LINE_40)} (quoting "${LINE_40.quote}") is sent again: ${first.claim} was sent back with it on commit ${first.commit}, the next commit `
    + `${second.commit} changed only ${CART}:${LINE_10.line}, and the second round sends it back a second time on ${second.claim}: `
    + `${[failed.length ? `${failed.length} of its review runs failed naming it` : '', blocked ? 'its stop was sent back naming it' : ''].filter(Boolean).join(', and ')}. ${seen}`);

  // The second review read only commit B's change: the one line its diff adds is line 10, as commit B left it.
  must(second.calls.length > 0, `${AC1} ${second.claim}, on the commit after the first send-back, gets a second review: the fake reviewer wasn't called in the second round. ${seen}`);
  for (const call of second.calls) {
    const added = addedIn(call.given);
    must(added.length === 1 && added[0]!.at === `${CART}:${LINE_10.line}` && added[0]!.text === BOUND, `${AC1} the second review reads only commit ${second.commit}'s change, which puts ${CART}:${LINE_10.line} back to `
      + `"${BOUND.trim()}" and changes nothing else: the diff ${call.job} was given adds ${added.map((l) => `${l.at} "${l.text.trim()}"`).join(', ') || 'no line'}. It was given:\n${call.given}`);
  }

  // It stays the first send-back's open item: the record of the second round lists it under `open` (README).
  const at = events.find((e) => `claim:${e.id}` === second.claim)!.log_pos;
  const listed = events.filter((e) => e.log_pos > at && objectsIn(e.data).some((o) => Array.isArray(o.open) && o.open.some((i) => isItem(i, LINE_40))));
  must(listed.length > 0, `${AC1} ${sayFinding(LINE_40)} stays the first send-back's open item: after the second round the record lists it, as {rule, sites: [{file, line, quote}]}, under \`open\` `
    + `in an event's data (README, Two new surfaces in the record); none of the ${events.filter((e) => e.log_pos > at).length} events after ${second.claim} does. ${seen}`);
}, 600_000);

it(`${AC2} once the claim settles, ${sayFinding(LINE_10)} is recorded fixed with the commit that changed it, and ${sayFinding(LINE_40)} left`, async () => {
  const { hub, first, second } = await theStory();
  // The claim settled when its second round was judged with nothing sent back (README): its outcomes follow at once.
  const events = await settle(hub, (all: Ev[]) => [LINE_10, LINE_40].every((f) => outcomesOf(all, f).length > 0), 30_000);
  const story = `The first round sent both items back on ${first.claim} at commit ${first.commit}; the second round, ${second.claim} at commit ${second.commit}, which changed only ${CART}:${LINE_10.line}, has its verdict`;

  const unrecorded = [LINE_10, LINE_40].filter((f) => outcomesOf(events, f).length === 0);
  must(unrecorded.length === 0, `${AC2} no outcome is recorded for ${unrecorded.map(sayFinding).join(', nor for ')}: the record states how each sent-back item ended, as `
    + `{rule, sites, ended: 'fixed' | 'left', commit}, in an event's data (README, Two new surfaces in the record), and none of its ${events.length} events does. ${story}`);
  const ended = (f: Finding) => outcomesOf(events, f).at(-1)!;
  const fixed = ended(LINE_10);
  must(fixed.ended === 'fixed' && fixed.commit === second.commit, `${AC2} ${sayFinding(LINE_10)} ended fixed, by the commit that changed it, ${second.commit}: the record says ${JSON.stringify(fixed)}. ${story}`);
  const left = ended(LINE_40);
  must(left.ended === 'left', `${AC2} ${sayFinding(LINE_40)} ended left, since no commit of the claim changed ${CART}:${LINE_40.line}: the record says ${JSON.stringify(left)}. ${story}`);
}, 600_000);
