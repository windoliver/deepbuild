// #82 AC9 and AC10: an answer isn't judged (design: Every stop is judged, "neither is an answer: a stop whose turn
// began with a prompt a person typed that opened no task, with no edit, write or ask in the turn. An answer is never a
// claim and gets no send-back, and the session's open asks wait for its next stop that does work").
//
// One session on item 81, whose R1 (expired-token.sh) fails until FLAG, through one hub per run:
//   A  you type `Fix <link>`; the agent reads src/auth.js, fixes the unit test (FIX) and stops: sent back on R1 (the
//      task is open and its checks fail).
//   B  you type "why does the cart round tax per line?" (it opens no task); the agent reads src/cart.js and src/auth.js
//      and answers. AC9: the Stop allows it; no claim.made and no claim.sent_back between your question and the next
//      prompt; the task stays open.
//   C  you type the same question again; the agent answers with no tool call. AC10: no send-back either.
//   D  you type "can you keep going on the expired-token fix?" (a question, no task); the agent bumps src/auth.js and
//      stops. AC9: judged and sent back as before (a claim for the task, blocked, naming R1).
//   E  that send-back began the turn, not a prompt you typed; the agent stops again with no tool call. AC10: it still
//      gets its one send-back, naming R1, and is no claim.
// Each of A and D ends with a different "Still open" list, so no two stops in a row report the same open items.
// Wrong programs: DEEP_HUB_PLANT=claim-on-tool-calls (the base's, from #303) judges every stop with tool calls, so it
// holds B, and AC9 fails naming B's stop; DEEP_HUB_PLANT=no-work-never-sent-back (README, Plants) drops the send-back
// of every no-work stop, so AC10 fails naming E's stop.
import { afterAll, afterEach, describe, it } from 'vitest';
import { verdict,
  AC10, AC9, CRITERIA, EXPIRED, FIX, askDraft, blocked, claimsIn, claimsOf, cleanup, closedAfter, failureOf, item, lastPos, listed, makeWorld,
  must, names, replyText, said, sendBacksIn, Session, settle, shown, startHub, startOnItem, stopAfter, type Ev, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);
afterAll(cleanup, 60_000);

const QUESTION = 'why does the cart round tax per line?';
const GO_ON = 'can you keep going on the expired-token fix?';

interface Turn { from: number; to: number; stop: Ran; event: Ev | undefined }
interface Run { events: Ev[]; ref: string; A: Turn; B: Turn; C: Turn; D: Turn; E: Turn }

async function answers(plant?: string): Promise<Run> {
  const w = makeWorld({ items: [item(81, 'Expired tokens are accepted', [EXPIRED])], drafts: [askDraft(QUESTION), askDraft(GO_ON)] });
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  const turn = async (body: () => Promise<Ran>): Promise<Omit<Turn, 'event'>> => { const from = await lastPos(hub); const stop = await body(); return { from, to: await lastPos(hub), stop }; };
  const ref = await startOnItem(hub, s, 81, '[A]');
  const A = await turn(async () => { await s.edit(FIX.file, FIX.from, FIX.to); return s.stop('The unit test passes now.\n\nStill open:\n- the 401 status on an expired token'); });
  const B = await turn(async () => { await s.typed(QUESTION); await s.read('src/cart.js'); await s.read('src/auth.js'); return s.stop('Each line is rounded to the cent before it is added, because the receipts show the tax per line.'); });
  const C = await turn(async () => { await s.typed(QUESTION); return s.stop('As before: each line\'s tax is rounded to the cent, as the receipts show it.'); });
  const D = await turn(async () => { await s.typed(GO_ON); await s.bump(); return s.stop('I went on with the fix.\n\nStill open:\n- the audit log line for a rejected token'); });
  const E = await turn(() => s.stop('I have nothing more to change right now.'));
  const events = await settle(hub, () => true);
  const at = (t: Omit<Turn, 'event'>): Turn => ({ ...t, event: stopAfter(events, s, t.from) });
  return { events, ref, A: at(A), B: at(B), C: at(C), D: at(D), E: at(E) };
}

/** The run on the shipped hub, shared by AC9's and AC10's tests (it is read only after it ends). */
let shipped: Promise<Run> | undefined;
const baseRun = (): Promise<Run> => (shipped ??= answers());

const id = (t: Turn) => (t.event ? `agent.stop ${t.event.id}` : 'its agent.stop (not recorded)');
/** AC9 on B: the answer that read two files isn't held: allowed, no claim, no send-back, the task still open. */
function answerNotHeld(r: Run, who: string): void {
  const B = r.B;
  must(!blocked(B.stop), `${who} stop B (${id(B)}), the answer to your typed "${QUESTION}" that read two files, isn't held: the Stop hook must allow it; it was sent back: ${replyText(B.stop).slice(0, 400)}`);
  must(claimsIn(r.events, B.from, r.C.from).length === 0, `${who} stop B (${id(B)}) makes no claim.made: ${listed(claimsIn(r.events, B.from, r.C.from))}`);
  must(sendBacksIn(r.events, B.from, r.C.from).length === 0, `${who} stop B (${id(B)}) gets no claim.sent_back: ${listed(sendBacksIn(r.events, B.from, r.C.from))}`);
  must(closedAfter(r.events, r.ref, B.from).length === 0, `${who} the task ${r.ref} stays open after stop B (${id(B)}): ${listed(closedAfter(r.events, r.ref, B.from))}`);
}
/** AC9 on D: the next stop that edits a file is judged and sent back as before, naming R1. */
function editJudged(r: Run, who: string): void {
  const D = r.D;
  must(claimsOf(r.events, r.ref, D.from, r.E.from).length > 0, `${who} stop D (${id(D)}), the session's next stop that edits a file, is judged: no claim.made for ${r.ref} after it: ${said(D.event)}`);
  must(blocked(D.stop) && names(replyText(D.stop), 'R1', CRITERIA.expired), `${who} stop D (${id(D)}) is sent back as before, naming the failing requirement R1 ("${CRITERIA.expired}"): ${shown(D.stop)}`);
}
/** AC10 on C: the same question answered with no tool call gets no send-back either. */
function noToolNoSendBack(r: Run, who: string): void {
  const C = r.C;
  must(!blocked(C.stop) && sendBacksIn(r.events, C.from, r.D.from).length === 0, `${who} stop C (${id(C)}), the same question answered with no tool call, gets no send-back: ${shown(C.stop)}; ${listed(sendBacksIn(r.events, C.from, r.D.from))}`);
  must(claimsIn(r.events, C.from, r.D.from).length === 0, `${who} stop C (${id(C)}) makes no claim: ${listed(claimsIn(r.events, C.from, r.D.from))}`);
}
/** AC10 on E: the no-work stop in the turn D's send-back began still gets its one send-back, naming R1, and is no claim. */
function sendBackBegunGetsOne(r: Run, who: string): void {
  const E = r.E;
  must(blocked(E.stop), `${who} stop E (${id(E)}), a no-work stop in a turn that a send-back began, not a prompt you typed, still gets its one send-back; deep-hook let it through: ${shown(E.stop)}`);
  must(names(replyText(E.stop), 'R1', CRITERIA.expired), `${who} stop E's (${id(E)}) send-back names R1, the requirement still unmet: ${replyText(E.stop).slice(0, 400)}`);
  must(claimsIn(r.events, E.from).length === 0, `${who} stop E (${id(E)}), with no work, is no claim: ${listed(claimsIn(r.events, E.from))}`);
}

describe(`${AC9} an answer that read two files isn't held; the next stop that edits is judged as before`, () => {
  it(`${AC9} item 81: your typed "${QUESTION}", answered after reading two files, is allowed with no claim.made and no claim.sent_back, the task open; the next stop that edits is sent back naming R1`, async (ctx) => verdict(ctx, async () => {
    const r = await baseRun();
    must(blocked(r.A.stop), `BLOCKED: ${AC9} stop A, after the fix with R1 failing, is sent back, so the task is open with its checks failing: ${shown(r.A.stop)}`);
    answerNotHeld(r, AC9);
    editJudged(r, AC9);
  }), 600_000);

  it(`${AC9} (wrong program) a gate that judges every stop with tool calls (DEEP_HUB_PLANT=claim-on-tool-calls) holds the answer and fails, naming the stop`, async (ctx) => verdict(ctx, async () => {
    const r = await answers('claim-on-tool-calls');
    const failure = await failureOf(async () => answerNotHeld(r, AC9));
    must(failure !== null, `${AC9} the planted gate must fail this test on stop B, the answer that read two files: it passed`);
    must(r.B.event !== undefined && failure.includes(r.B.event.id), `${AC9} the failure names the stop, ${id(r.B)}: ${failure}`);
  }), 600_000);
});

describe(`${AC10} no send-back for an answer with no tool call; a no-work stop in a turn a send-back began still gets its one`, () => {
  it(`${AC10} item 81: the same question answered with no tool call gets no send-back; the no-work stop after stop D's send-back gets one, naming R1`, async (ctx) => verdict(ctx, async () => {
    const r = await baseRun();
    noToolNoSendBack(r, AC10);
    must(blocked(r.D.stop), `BLOCKED: ${AC10} stop D is sent back, so the next turn is one a send-back began: ${shown(r.D.stop)}`);
    sendBackBegunGetsOne(r, AC10);
  }), 600_000);

  it(`${AC10} (wrong program) a rule that drops that send-back for every no-work stop (DEEP_HUB_PLANT=no-work-never-sent-back) fails, naming the stop`, async (ctx) => verdict(ctx, async () => {
    const r = await answers('no-work-never-sent-back');
    const failure = await failureOf(async () => sendBackBegunGetsOne(r, AC10));
    must(failure !== null, `${AC10} the planted rule must fail this test on stop E: it passed`);
    must(r.E.event !== undefined && failure.includes(r.E.event.id), `${AC10} the failure names the stop, ${id(r.E)}: ${failure}`);
  }), 600_000);
});
