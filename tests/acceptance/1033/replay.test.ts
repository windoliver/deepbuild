// #1033 AC1, AC2 and AC5: the fixture session (fixtures/session, README The session) replayed hook by hook through
// the real deep-hook into `deep hub run`, in a Claude Code home that loads the fixture mod approve-all, whose
// tool.check approves every call. Twice: on a machine with no managed settings, where the mod can approve a call past
// deep-hook's deny, so each denied call's PostToolUse arrives; and on one with managed settings, where the deny holds,
// so a denied call ends at its denial and no PostToolUse arrives. Every reading is the hub's own record.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC5, APPROVER, asksNaming, before, cleanup, decided, GUARD, machine, overridden, PUSH, PUSH_CALL, replay, replyOf, RESEND_CALL,
  SEND_CALL, SEND_TOOL, said, summary, verdicts, ofSession, type Replay,
} from './helpers.ts';

const LIMIT = 900_000;
let free: Replay;
let managed: Replay;

beforeAll(async () => {
  free = await replay(machine({ managed: false }), { denyHolds: false });
  managed = await replay(machine({ managed: true }), { denyHolds: true });
}, 2 * LIMIT);
afterAll(cleanup, 60_000);

/** The replay reached the force push and deep-hook denied it there with the guard entry; anything else is BLOCKED. */
function deniedPush(r: Replay): void {
  if (decided(r, PUSH_CALL) !== 'deny' || !replyOf(r, PUSH_CALL).includes(GUARD)) throw Error(`BLOCKED: deep-hook must deny the force push ${PUSH_CALL} (\`${PUSH}\`) by the guard entry ${GUARD}; it replied ${replyOf(r, PUSH_CALL)}`);
  if (!r.claim) throw Error(`BLOCKED: the session's stop made no claim for ${r.task}:\n${summary(r)}\nhub stderr ${JSON.stringify(r.stderr)}`);
}
const names = (e: { data: unknown }, ...what: string[]): boolean => what.every((w) => JSON.stringify(e.data).includes(w));

describe(`${AC1} a deny the fixture mod approved past is recorded, and the claim reads INCONCLUSIVE naming the call`, () => {
  it(`${AC1} the replay records the deny, then guard.overridden naming the call, the guard entry and the fixture mod`, () => {
    deniedPush(free);
    const denial = before(free, PUSH_CALL);
    expect(denial && Array.isArray(denial.data.matched) && denial.data.matched.includes(GUARD), `the record must hold the deny of the force push ${PUSH_CALL} (\`${PUSH}\`): its tool.before naming ${GUARD} in matched; it holds ${said(denial)}`).toBe(true);
    const ran = ofSession(free).find((e) => e.kind === 'tool.after' && e.data.call === PUSH_CALL);
    expect(ran, `the force push ${PUSH_CALL} ran anyway: its PostToolUse is in the record as a tool.after`).toBeDefined();
    const found = overridden(free).filter((e) => names(e, PUSH_CALL));
    expect(found.length, `the hub must record guard.overridden for the force push ${PUSH_CALL} (\`${PUSH}\`), which deep-hook denied by ${GUARD} and which ran anyway:\n${summary(free)}`).toBe(1);
    const [o] = found;
    expect(names(o!, GUARD), `guard.overridden for ${PUSH_CALL} must name the guard entry that denied it, ${GUARD}: ${said(o)}`).toBe(true);
    expect(names(o!, APPROVER), `guard.overridden for ${PUSH_CALL} must name the mod that could have answered, ${APPROVER}: ${said(o)}`).toBe(true);
    expect(o!.log_pos > denial!.log_pos, `guard.overridden for ${PUSH_CALL} comes after its deny: ${said(o)} against ${said(denial)}`).toBe(true);
  });

  it(`${AC1} the claim's verdict is INCONCLUSIVE naming the call, never PASS on that session's checks`, () => {
    deniedPush(free);
    const v = verdicts(free);
    const outcomes = v.map((e) => String(e.data.outcome));
    expect(outcomes, `the claim ${free.claim} ran in a session whose denied force push ${PUSH_CALL} (\`${PUSH}\`) ran anyway, so it can't pass on that session's evidence:\n${summary(free)}`).not.toContain('PASS');
    expect(outcomes.at(-1), `the claim ${free.claim}'s verdict must read INCONCLUSIVE, naming the force push ${PUSH_CALL} (\`${PUSH}\`):\n${summary(free)}`).toBe('INCONCLUSIVE');
    const reasons = JSON.stringify(v.at(-1)!.data.reasons ?? []);
    expect(reasons.includes(PUSH_CALL) || reasons.includes(PUSH), `the INCONCLUSIVE verdict's reasons must name the call, ${PUSH_CALL} or \`${PUSH}\`: ${reasons}`).toBe(true);
  });
});

describe(`${AC2} the completed post_message send, repeated after a resume, denied as a duplicate and run by the mod, raises exactly one ask naming it`, () => {
  it(`${AC2} exactly one ask names the repeated send ${SEND_TOOL}, and deep-hook denied the repeat`, () => {
    deniedPush(free);
    const first = ofSession(free).find((e) => e.kind === 'tool.after' && e.data.call === SEND_CALL);
    if (!first) throw Error(`BLOCKED: the first send ${SEND_CALL} must complete before the resume:\n${summary(free)}`);
    const asks = asksNaming(free, 'post_message');
    expect(asks.length, `the repeated send ${RESEND_CALL} (${SEND_TOOL} to #releases), denied as a duplicate and run anyway by ${APPROVER}, may already have left, so exactly one ask names it; asks naming it: ${asks.map(said).join('; ') || 'none'}\n${summary(free)}`).toBe(1);
    expect(decided(free, RESEND_CALL), `deep-hook must deny the repeated send ${RESEND_CALL} (${SEND_TOOL}) as a duplicate of the completed ${SEND_CALL}; it replied ${replyOf(free, RESEND_CALL)}`).toBe('deny');
    const ran = ofSession(free).find((e) => e.kind === 'tool.after' && e.data.call === RESEND_CALL);
    expect(ran, `the repeated send ${RESEND_CALL} ran anyway: its PostToolUse is in the record`).toBeDefined();
  });
});

describe(`${AC5} with managed settings on the machine the deny holds: no guard.overridden, and the claim is judged as usual`, () => {
  it(`${AC5} the managed machine's replay: the force push denied and never run, no guard.overridden, the claim PASS; the same session with no managed settings records guard.overridden`, () => {
    deniedPush(managed);
    expect(ofSession(managed).find((e) => e.kind === 'tool.after' && e.data.call === PUSH_CALL), 'with the deny holding, the force push never ran').toBeUndefined();
    expect(overridden(managed).map(said), `with managed settings present the deny holds, so no guard.overridden is recorded:\n${summary(managed)}`).toEqual([]);
    const outcomes = verdicts(managed).map((e) => String(e.data.outcome));
    expect(outcomes.at(-1), `with managed settings present the claim ${managed.claim} is judged as usual: its check fails on the merge base and passes on the snapshot, so PASS:\n${summary(managed)}`).toBe('PASS');
    expect(outcomes.filter((x) => x !== 'PASS'), `no other verdict about ${managed.claim}`).toEqual([]);
    // The same session, the same mod, no managed settings: the hub records the deny that didn't hold, so the managed
    // settings are what kept guard.overridden out above.
    deniedPush(free);
    expect(overridden(free).filter((e) => names(e, PUSH_CALL)).length, `on the machine with no managed settings the same session's force push ${PUSH_CALL} ran past its deny, and the hub must record guard.overridden for it; only the managed settings may keep it out:\n${summary(free)}`).toBe(1);
  });
});
