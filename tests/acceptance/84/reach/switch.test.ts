// #84 SWITCH: you choose B after the agent went on with A (design: Work goes on while you decide; Asks stay current).
//
// One session on item 851, R1 (a session store is set, passes on either store) and R2 (expired tokens, fails until FLAG):
//   C0  a commit before the choice, which nothing about the choice touches.
//   A   the agent's stop asks: the cookie store or the header store, recommending the cookie store. A provisional choice.
//   -   the agent goes on with the cookie store: commits C1 and C2, every check green on them.
//   -   you choose the header store.
//   B   its next stop, all green on the cookie store: one send-back naming the header store, C1 and C2.
//   C   a stop with no new work: the claim still can't pass, and the send-back isn't repeated.
//   D   the agent moves to the header store, commit C3, and stops: its checks run on C3 and the claim can pass.
// "A check of B" is a run of the requirement's check on a commit made after your answer (README, Reading the criteria).
// Wrong program: DEEP_HUB_PLANT=records-switch-only records your answer and sends nothing more, so B passes on C2.
import { afterAll, afterEach, describe, it } from 'vitest';
import {
  SWITCH, EXPIRED, FLAG, STORE, answered, asksOf, blocked, claimsOf, cleanup, failureOf, handles, item, lastPos, listed, makeWorld, must, namesWord, optionMatching, outcomeOf,
  replyText, runsFor, said, Session, settle, shown, startHub, startOnItem, verdict, verdictsIn, type Ev, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);
afterAll(cleanup, 60_000);

const short = (commit: string) => commit.slice(0, 7);

interface Run { ref: string; c0: string; c1: string; c2: string; c3: string; answeredAt: number; dAt: number; B: Ran; C: Ran; D: Ran; events: Ev[] }

async function switched(plant?: string): Promise<Run> {
  const w = makeWorld({ items: [item(851, [STORE, EXPIRED])] });
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  const ref = await startOnItem(hub, s, 851, SWITCH);
  await s.bump();
  const c0 = await s.commit('Bump the round');
  const since = await lastPos(hub);
  await s.stop('For R1, the cookie store or the header store? I recommend the cookie store.');
  let events = await settle(hub, (all) => asksOf(all, s, since).some((a) => a.data.kind === 'choice' && a.data.provisional === true));
  const ask = asksOf(events, s, since).find((a) => a.data.kind === 'choice' && a.data.provisional === true);
  must(ask !== undefined, `${SWITCH} stop A, a choice between two options that names its requirement, raises a provisional choice: ${listed(asksOf(events, s, since))}`);
  const header = optionMatching(ask, /header/i);
  must(header !== undefined, `${SWITCH} the choice offers the header store: ${said(ask)}`);

  // The agent goes on with the recommended option.
  await s.edit('src/store.js', 'kind: null', "kind: 'cookie'");
  const c1 = await s.commit('Use the cookie store');
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const c2 = await s.commit('Reject expired tokens');

  const answeredAt = await lastPos(hub);
  await answered(w, ask, header.id, SWITCH);
  await settle(hub, (all) => all.some((e) => e.kind === 'ask.answered' && e.subject === `ask:${ask.id}`));
  const B = await s.stop('The cookie store is in and every check passes.');
  const C = await s.stop('I have nothing more to change.');

  await s.edit('src/store.js', "kind: 'cookie'", "kind: 'header'");
  const c3 = await s.commit('Use the header store');
  const dAt = await lastPos(hub);
  const D = await s.stop('The header store is in.');
  events = await settle(hub, (all) => verdictsIn(all, dAt).some((v) => outcomeOf(v) === 'PASS'), 60_000);
  return { ref, c0, c1, c2, c3, answeredAt, dAt, B, C, D, events };
}

/** One send-back, at the first stop after your answer, naming B and the commits made under A and no other commit. */
function sendBackNamesB(r: Run): void {
  must(blocked(r.B), `${SWITCH} stop B, green on the cookie store, is sent back: the Stop hook let it through: ${shown(r.B)}`);
  const text = replyText(r.B);
  must(/header/i.test(text), `${SWITCH} the send-back names B, the header store: ${text.slice(0, 500)}`);
  for (const [name, commit] of [['C1', r.c1], ['C2', r.c2]] as const) must(text.includes(short(commit)), `${SWITCH} the send-back names ${name} (${short(commit)}), made under A: ${text.slice(0, 500)}`);
  must(!namesWord(text, short(r.c0)), `${SWITCH} C0 (${short(r.c0)}) came before the choice, so it isn't a commit made under A: ${text.slice(0, 500)}`);
  must(!replyText(r.C).includes(short(r.c1)), `${SWITCH} the agent gets one send-back: stop C, with no new work, got it again: ${replyText(r.C).slice(0, 400)}`);
}
/** The claim can't pass on A's commits, however green, and passes once a check runs on B's. */
function passesOnlyOnB(r: Run): void {
  const early = verdictsIn(r.events, r.answeredAt, r.dAt).filter((v) => outcomeOf(v) === 'PASS');
  must(early.length === 0, `${SWITCH} the claim can't pass until a check of B runs: ${listed(early)}`);
  const claims = claimsOf(r.events, r.ref, r.dAt);
  const ran = runsFor(r.events, handles(claims)).filter((x) => x.finished?.data.outcome === 'passed');
  must(ran.length > 0, `${SWITCH} stop D's claim runs its checks on C3, the header store: ${listed(claims)}`);
  must(!blocked(r.D), `${SWITCH} stop D, with its checks green on the header store, is let through: ${shown(r.D)}`);
  const passed = verdictsIn(r.events, r.dAt).filter((v) => outcomeOf(v) === 'PASS');
  must(passed.length > 0, `${SWITCH} once a check of B ran the claim can pass: ${listed(verdictsIn(r.events, r.dAt))}`);
}

describe(`${SWITCH} when you choose B after the agent went on with A, the agent gets one send-back naming B and the commits made under A, and the claim can't pass until a check of B runs`, () => {
  it(`${SWITCH} item 851: stop B gets one send-back naming the header store and the cookie store's two commits; no PASS until the checks run on the header store's commit`, async (ctx) => verdict(ctx, async () => {
    const r = await switched();
    sendBackNamesB(r);
    passesOnlyOnB(r);
  }), 600_000);

  it(`${SWITCH} (wrong program) a hub that only records the change (DEEP_HUB_PLANT=records-switch-only) fails this test`, async (ctx) => verdict(ctx, async () => {
    const r = await switched('records-switch-only');
    const failure = await failureOf(async () => { sendBackNamesB(r); passesOnlyOnB(r); });
    must(failure !== null, `${SWITCH} the planted hub must fail this test: it passed`);
  }), 600_000);
});
