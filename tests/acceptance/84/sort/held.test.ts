// #84 AC26: a question holds the send-back (design: A question holds the send-back; Slow runs start when the turn ends,
// "a stop held until its slow checks land ... is held for them only when ... no question holds its send-back").
//
// Claude Code, item 71: the agent makes FLAG, so R1 passes and the spec's unit check fails, raises the step only you can
// take with deep_ask, naming the spec's `ready` check, and ends asking you to accept the model's license. The Stop hook
// allows that stop, its verdict line names the FAIL, and no claim.sent_back is recorded; the same for two more stops that
// did work. You accept and answer. Once the answer is delivered, carrying the verdict line, the next stop is sent back as
// round 1 of 3. A gate that sends the first stop back fails, naming that stop.
//
// Codex, items 72 and 73: observed sessions, set up with the 45-minute Stop timeout, whose definition holds a journey
// handed with a 10-minute expected time and deadline. The stop ends on the same kind of ask, with the unit check failing
// (72) and with every fast check green (73), where a gate that ignores the question holds the stop for the journey. Each
// reply comes before the journey has ended.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import {
  AC26, CHECKS, CRITERIA, CodexSession, EXPIRED, FIX, FLAG, Inconclusive, SLOW_MS, WORK_LINK, answered, askDraft, blocked, chatLine, cleanup, deliveredTo, failureOf, handles,
  item, lastPos, listed, loadReading, loaded, lockedFor, itemTask, makeWorld, must, raisedAsk, replyText, runsFor, claimsIn, sendBacksIn, Session, settle, setUp, shown, startHub, startOnItem,
  stopsOf, verdict, type Hub, type Ran, type World,
} from './helpers.ts';

const QUESTION = "Accept the model's license on its site";
const TASK = {
  kind: 'unblock', question: QUESTION, options: null, recommended: null,
  steps: ["Open the model's page on its site", 'Accept its license', 'Save the acceptance as vendor/license-accepted in the repo'],
  where: 'the model site, in your browser', why: 'The tests need the model, which needs its license accepted', check: 'ready', thread: null, subject: null,
};
const WORDS = `The model's weights are gated. Please accept the model's license on its site.`;
const LOOP = '/loop every 10 minutes: keep the auth work going';

const stopId = async (hub: Hub, s: Session, at: number): Promise<string> => {
  const events = await settle(hub, (all) => stopsOf(all, s).some((e) => e.log_pos > at), 10_000);
  return stopsOf(events, s).find((e) => e.log_pos > at)?.id ?? 'unrecorded';
};

/** One stop the ask holds: allowed, its line naming the FAIL, no send-back. `named` holds its agent.stop ID for the plant's test. */
async function waits(hub: Hub, s: Session, what: string, named: { stop?: string }): Promise<void> {
  const since = await lastPos(hub);
  const stop = await s.stop(WORDS);
  const id = await stopId(hub, s, since);
  named.stop ??= id;
  const events = await settle(hub, () => true);
  must(!blocked(stop), `${AC26} ${what} (agent.stop ${id}), ending on the license with the unit check failing, isn't sent back: the Stop hook blocked it: ${shown(stop)}`);
  must(sendBacksIn(events, since).length === 0, `${AC26} ${what} (agent.stop ${id}): the record holds no claim.sent_back for it: ${listed(sendBacksIn(events, since))}`);
  // No line at all, on a loaded machine: deep-hook got no reply from the hub in time, so no reading of this stop stands.
  if (!chatLine(stop) && loaded()) throw new Inconclusive(`${AC26} ${what} came back with no verdict line: ${shown(stop)}, ${loadReading()}`);
  must(/\bFAIL\b/.test(chatLine(stop)), `${AC26} ${what} (agent.stop ${id}): its verdict line names the FAIL: ${JSON.stringify(chatLine(stop))}; ${shown(stop)}`);
}

/** The Claude Code half, up to and including the first stop after your answer is delivered. */
async function claude(n: number, named: { stop?: string }, plant?: string): Promise<void> {
  const w = makeWorld({ items: [item(n, 'Expired tokens are accepted', [EXPIRED])], drafts: [askDraft(LOOP)] });
  const hub = await startHub(w, { plant });
  await setUp(w);
  const s = new Session(w);
  await startOnItem(hub, s, n, AC26);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const raised = await lastPos(hub);
  await s.deepAsk(TASK);
  const ask = `ask:${(await raisedAsk(hub, QUESTION, raised, AC26)).id}`;
  await waits(hub, s, 'the first stop', named);
  // Nothing typed: words in the session would close a question that needs no authority.
  for (const what of ['the second stop', 'the third stop']) {
    await s.scheduled(LOOP);
    await s.bump();
    await waits(hub, s, what, {});
  }

  mkdirSync(join(w.repo, 'vendor'), { recursive: true });
  writeFileSync(join(w.repo, 'vendor/license-accepted'), 'accepted\n');
  const mark = s.heard.length;
  await answered(w, ask, 'done', AC26);
  let next: Ran | undefined;
  let last: Ran | undefined;
  for (let round = 0; round < 3 && next === undefined; round++) {
    if (!last || !blocked(last)) await s.scheduled(LOOP);
    await s.bump();
    last = await s.stop(WORDS);
    // The hub records an answer delivered when it reads the transcript showing it, at a hook after the one that handed
    // it, so the first stop whose reply finds it recorded is the first stop after your answer was delivered (#325).
    if (deliveredTo(await settle(hub, () => true), ask)) next = last;
  }
  must(next !== undefined, `${AC26} your answer to ${ask} is delivered to the session within three stops`);
  const carried = s.heard.slice(mark).map((r) => `${r.stdout}\n${r.stderr}`).find((t) => t.includes(ask));
  must(carried !== undefined, `${AC26} a hook's reply carries your answer to ${ask}`);
  must(/\bFAIL\b/.test(carried!), `${AC26} your answer carries the claim's verdict line as it stands, naming the FAIL: ${carried!.slice(0, 700)}`);
  must(blocked(next!), `${AC26} the first stop after your answer is delivered is sent back, the unit check failing: ${shown(next!)}`);
  must(/\b1\s*(?:\/|of)\s*3\b/.test(replyText(next!)), `${AC26} it is sent back as round 1 of 3: the stops the ask held counted for nothing: ${replyText(next!).slice(0, 600)}`);
}

/** One observed Codex stop on the license ask, with the journey queued: the reply comes before the journey ends. */
async function codex(hub: Hub, w: World, n: number, what: string, edit: (s: CodexSession) => Promise<void>): Promise<void> {
  const s = new CodexSession(w);
  await s.start();
  const text = `Fix ${WORK_LINK(n)}`;
  await s.prompt(text);
  const ready = await settle(hub, (all) => { const ref = itemTask(all, s, text); return ref !== undefined && lockedFor(all, ref).length > 0; }, 60_000);
  must(itemTask(ready, s, text) !== undefined, `BLOCKED: ${AC26} ${what} the Codex session opens its task: ${listed(ready.filter((e) => /^(task|definition)\./.test(e.kind)))}`);
  await edit(s);
  const raised = await lastPos(hub);
  await s.deepAsk(TASK);
  await raisedAsk(hub, QUESTION, raised, `${AC26} ${what}`);
  const since = await lastPos(hub);
  const stop = await s.stop(WORDS);
  const events = await settle(hub, () => true);
  must(!stop.timedOut && !blocked(stop), `${AC26} ${what} the observed Codex stop isn't sent back and isn't held for the journey: ${shown(stop)}`);
  must(sendBacksIn(events, since).length === 0, `${AC26} ${what} no claim.sent_back: ${listed(sendBacksIn(events, since))}`);
  const journey = runsFor(events, handles(claimsIn(events, since))).filter((r) => String(r.started.data.check).includes('checkout-journey'));
  const ended = journey.filter((r) => r.finished && r.finished.ts <= stop.ended);
  must(ended.length === 0, `${AC26} ${what} the stop's reply comes before the journey ends (it takes 8 s), not after it: replied ${(stop.ms / 1000).toFixed(1)} s after the stop; ${listed(ended.map((r) => r.finished!))}`);
}

afterAll(cleanup, 60_000);

describe(`${AC26} a stop that ends asking you to accept a model's license isn't sent back or held for a journey, and the send-back resumes after your answer`, () => {
  it(`${AC26} item 71 (Claude Code): three stops on the open task are allowed, FAIL on the line, no claim.sent_back; your answer goes with the line, and the next stop is sent back as round 1 of 3`, async (ctx) => verdict(ctx, () => claude(71, {})), 600_000);

  it(`${AC26} items 72 and 73 (observed Codex): the stop on the same kind of ask, with a 10-minute journey queued, isn't held for the journey, with the unit check failing or every fast check green`, async (ctx) => verdict(ctx, async () => {
    const journey = { text: CRITERIA.journey, check: CHECKS.journey, on_base: 'passes' as const, expected_ms: SLOW_MS, deadline_ms: SLOW_MS };
    const w = makeWorld({ items: [72, 73].map((n) => item(n, 'Expired tokens are accepted', [EXPIRED, journey])) });
    const hub = await startHub(w);
    await setUp(w);
    await codex(hub, w, 72, 'item 72, the unit check failing:', (s) => s.patch(FLAG.file, FLAG.from, FLAG.to));
    await codex(hub, w, 73, 'item 73, the fast checks green:', (s) => s.patch(FIX.file, FIX.from, FIX.to));
  }), 600_000);

  it(`${AC26} (wrong program) a gate that sends the first stop back (DEEP_HUB_PLANT=sends-back-held-stop) fails this test, naming the stop`, async (ctx) => verdict(ctx, async () => {
    const named: { stop?: string } = {};
    const why = await failureOf(() => claude(74, named, 'sends-back-held-stop'));
    must(why !== null, `${AC26} the planted gate sends-back-held-stop must fail this test; it passed`);
    must(why.includes('the first stop') && named.stop !== undefined && why.includes(named.stop), `${AC26} the planted gate fails naming the first stop (agent.stop ${named.stop}): ${why}`);
  }), 600_000);
});
