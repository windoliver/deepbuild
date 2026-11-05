// #82 AC11: the same turn with one edit in it, or begun by a scheduled task or another session's message, is judged as
// before (design: Every stop is judged; A loop's turn end isn't a hand-back: a scheduled task or another session's
// message "starts the next turn as a prompt nobody typed").
//
// One session on item 91, whose R1 (expired-token.sh) fails until FLAG, through one hub per run:
//   A  you type `Fix <link>`; the agent reads src/auth.js and stops (the task is open, its checks failing).
//   B  you type "why does the cart round tax per line?"; the agent reads src/cart.js and src/auth.js, makes one edit
//      (FIX, which makes the unit test pass: new evidence) and stops.
//   C  a scheduled task's prompt (turnOrigin scheduled, as the 2.1.308 loop session has it); the agent reads the two
//      files and stops.
//   D  another Claude Code session's message (turnOrigin peer, as the 2.1.299 desktop-peer session has it); the agent
//      reads the two files and stops.
// Each of B, C and D is judged as before: a claim.made for the task, and sent back naming R1. Each stop ends with a
// different "Still open" list. A rule that skips every turn begun by a prompt (DEEP_HUB_PLANT=skips-prompt-turns,
// README, Plants) reads B as an answer and fails on the edit, naming the stop.
import { afterAll, afterEach, describe, it } from 'vitest';
import { verdict,
  AC11, CRITERIA, EXPIRED, FIX, askDraft, blocked, claimsOf, cleanup, failureOf, item, lastPos, makeWorld, must, names, replyText, said, Session, settle,
  shown, startHub, startOnItem, stopAfter, type Ev, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);
afterAll(cleanup, 60_000);

const QUESTION = 'why does the cart round tax per line?';
const LOOP = '/loop every 10 minutes: check whether the expired-token check passes yet';
const PEER = 'Another Claude session sent a message:\n<cross-session-message from="local_8f6f9e9a-898e-4858-aefe-44dfc1b77684" name="GitHub issue #91">\nThe expired-token check is still red on main; please look at it.\n</cross-session-message>\n\nThis came from another Claude session, not typed by your user.';

interface Turn { what: string; from: number; to: number; stop: Ran; event: Ev | undefined }
async function judgedTurns(plant?: string): Promise<{ events: Ev[]; ref: string; turns: Turn[] }> {
  const w = makeWorld({ items: [item(91, 'Expired tokens are accepted', [EXPIRED])], drafts: [askDraft(QUESTION), askDraft(LOOP), askDraft(PEER)] });
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  const ref = await startOnItem(hub, s, 91, '[A]');
  await s.stop('I read the auth middleware.\n\nStill open:\n- the fix itself');
  const turns: Omit<Turn, 'event'>[] = [];
  const turn = async (what: string, body: () => Promise<Ran>) => { const from = await lastPos(hub); const stop = await body(); turns.push({ what, from, to: await lastPos(hub), stop }); };
  await turn(`B, your typed "${QUESTION}" with one edit in it`, async () => { await s.typed(QUESTION); await s.read('src/cart.js'); await s.read('src/auth.js'); await s.edit(FIX.file, FIX.from, FIX.to); return s.stop('The cart rounds tax per line, as the receipts show it; I also fixed checkToken.\n\nStill open:\n- the 401 status'); });
  await turn('C, a scheduled task\'s turn', async () => { await s.scheduled(LOOP); await s.read('src/cart.js'); await s.read('src/auth.js'); return s.stop('The expired-token check is still red.\n\nStill open:\n- the 401 status on an expired token'); });
  await turn('D, another session\'s message\'s turn', async () => { await s.peer(PEER); await s.read('src/cart.js'); await s.read('src/auth.js'); return s.stop('Looked at it for the other session.\n\nStill open:\n- the expired-token check on main'); });
  const events = await settle(hub, () => true);
  return { events, ref, turns: turns.map((t) => ({ ...t, event: stopAfter(events, s, t.from) })) };
}

function judgedAsBefore(r: { events: Ev[]; ref: string; turns: Turn[] }): void {
  r.turns.forEach((t, i) => {
    const until = r.turns[i + 1]?.from ?? Infinity;
    const name = `stop ${t.what} (${t.event ? `agent.stop ${t.event.id}` : 'no agent.stop recorded'})`;
    must(claimsOf(r.events, r.ref, t.from, until).length > 0, `${AC11} ${name} is judged as before: a claim.made for ${r.ref}; none after it: ${said(t.event)}`);
    must(blocked(t.stop) && names(replyText(t.stop), 'R1', CRITERIA.expired), `${AC11} ${name} is sent back as before, naming R1 ("${CRITERIA.expired}"): ${shown(t.stop)}`);
  });
}

describe(`${AC11} a turn with one edit, or begun by a scheduled task or another session's message, is judged as before`, () => {
  it(`${AC11} item 91: the typed question with one edit, a scheduled task's turn and another session's message's turn each make a claim and are sent back naming R1`, async (ctx) => verdict(ctx, async () => {
    judgedAsBefore(await judgedTurns());
  }), 600_000);

  it(`${AC11} (wrong program) a rule that skips every turn begun by a prompt (DEEP_HUB_PLANT=skips-prompt-turns) fails on the edit, naming the stop`, async (ctx) => verdict(ctx, async () => {
    const r = await judgedTurns('skips-prompt-turns');
    const failure = await failureOf(async () => judgedAsBefore(r));
    const B = r.turns[0]!;
    must(failure !== null, `${AC11} the planted rule must fail this test on stop B, the turn with one edit: it passed`);
    must(B.event !== undefined && failure.includes(B.event.id) && failure.includes('stop B'), `${AC11} it fails on the edit, naming the stop, agent.stop ${B.event?.id}: ${failure}`);
  }), 600_000);
});
