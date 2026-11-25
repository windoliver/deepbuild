// #3229 AC5 and AC6: a variant a session's own call reached is spent for its task. Through a real hub, deep-hook and the
// Claude Code stand-in: the session's Bash tool runs `deep read ev:<digest>` with a variant's digest, a call recorded as
// its PreToolUse reaches the hub; its claim's code then special-cases the visible fixture and the variant, so both of the
// check's runs pass.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, Agent, CHECK, claim, cleanup, draft, FIXED, LIMIT, Log, makeWorld, mustFail, open, OTHER_PROMPT, PLANTS, PROMPT, Session, shownClaim, SPECIAL_BOTH, SPECIAL_VISIBLE, startHub, variant, variantDigests, type Claim, type Variant, type Worker, type World } from './helpers.ts';

afterEach(cleanup, 120_000);

/** What names the reaching call: its tool_use_id, its recorded event's ID, or its command's own words (README, Readings). */
type Call = string[];
/** The session's recorded call that names the variant's digest; a call the record doesn't hold is BLOCKED. */
async function reach(w: World, k: Worker, r: Log): Promise<Call> {
  const digest = variantDigests(w, k.locked)[0]!;
  const call = await k.s.bash(`deep read ev:${digest}`);
  const event = () => r.events.find((e) => e.kind === 'tool.before' && e.data.call === call.id);
  if (!await r.until(() => event() !== undefined, 300_000)) throw Error(`BLOCKED: the record holds no tool.before of the session's call ${call.id}`);
  return [call.id, event()!.id, 'deep read'];
}
const names = (text: string, call: Call): boolean => call.some((n) => text.includes(n));
const checkRuns = (c: Claim) => c.runs.filter((x) => x.check === CHECK);
/** A claim after a reaching call: INCONCLUSIVE naming the call, no PASS at any point, and no run failed, so what was counted neither way is a passing run. */
function spent(c: Claim, call: Call, when: string): void {
  expect(c.verdicts.map((v) => v.data.outcome), `${when}: the spent variant's run counts neither way, so the claim is never PASS: ${shownClaim(c)}`).not.toContain('PASS');
  expect(c.outcome, `${when}: the claim reads INCONCLUSIVE until a variant no such call reached has run: ${shownClaim(c)}`).toBe('INCONCLUSIVE');
  expect(names(c.text, call), `${when}: the verdict names the call that reached the variant (one of ${call.join(', ')}): ${c.text}`).toBe(true);
  expect(checkRuns(c).filter((x) => x.outcome === 'failed').map((x) => x.run), `${when}: the claim's code special-cases the visible fixture and the variant, so no run of the check failed: ${shownClaim(c)}`).toEqual([]);
}

/** AC5: the reaching call, then the claim whose code special-cases both. */
async function reached(plant?: string): Promise<{ c: Claim; call: Call }> {
  const v = variant();
  const w = makeWorld([draft(PROMPT, [v])]);
  const r = await Log.open(await startHub(w, plant));
  const k = await open(w, r);
  const call = await reach(w, k, r);
  return { c: await claim(k, r, SPECIAL_BOTH(v, 1), { runs: 2, early: (text) => names(text, call) }), call };
}

describe(`${AC[5]} a session's recorded call names a variant's digest, its claim special-cases the visible fixture and the variant: the variant is spent, its passing run counts neither way, the claim is INCONCLUSIVE naming the call`, () => {
  it(`${AC[5]} the claim after the call reads INCONCLUSIVE naming it, never PASS`, async () => {
    const { c, call } = await reached();
    spent(c, call, 'after the call');
  }, LIMIT);

  it(`${AC[5]} the same claim with no such call, which can special-case the visible fixture alone, fails its twin`, async () => {
    const v = variant();
    const w = makeWorld([draft(PROMPT, [v])]);
    const r = await Log.open(await startHub(w));
    const c = await claim(await open(w, r), r, SPECIAL_VISIBLE(1), { runs: 2 });
    expect(checkRuns(c).map((x) => x.outcome).sort(), `the visible fixture's run passes and the unseen variant's fails: ${shownClaim(c)}`).toEqual(['failed', 'passed']);
    expect(c.verdicts.map((x) => x.data.outcome), `so the claim is never PASS, as #33 holds: ${shownClaim(c)}`).not.toContain('PASS');
  }, LIMIT);

  it(`${AC[5]} (wrong program ${PLANTS.counts}) a gate that counts the spent variant's run passes the claim and fails`, async () => {
    const { c, call } = await reached(PLANTS.counts);
    expect(c.outcome, `${PLANTS.counts}: the planted gate must pass the claim: ${shownClaim(c)}`).toBe('PASS');
    await mustFail(`${PLANTS.counts} on AC5`, () => spent(c, call, 'after the call'), ['PASS']);
  }, LIMIT);
});

// ---- AC6.
interface Across { call: Call; first: Claim; resumed: Claim; compacted: Claim; attempt: Claim; ids: string[]; other: Claim }
/**
 * One task's claims after the reaching call: by the session itself; once its process ended and a new one resumed it under
 * its own ID; once a compaction rotated its ID in that process; and by a new attempt, a fork in a process and under an ID
 * of its own, which the hub joins to the same thread and task. Beside them, a session on another task, with the same
 * check and the same variant, claims the honest fix. Each claim's code has its own first line, so each runs the check.
 */
async function across(v: Variant, plant?: string): Promise<Across> {
  const w = makeWorld([draft(PROMPT, [v]), draft(OTHER_PROMPT, [v])], 2);
  const r = await Log.open(await startHub(w, plant));
  const k = await open(w, r);
  const call = await reach(w, k, r);
  const early = (text: string): boolean => names(text, call);
  const on = async (s: Session, source: 'resume' | 'compact' | 'fork', turn: number): Promise<Claim> => {
    await s.start(source);
    await s.typed('Why is the total wrong?'); // a question opens no task, so the turn's work is the one task's
    return claim({ ...k, s }, r, SPECIAL_BOTH(v, turn), { runs: 2, early });
  };
  const first = await claim(k, r, SPECIAL_BOTH(v, 1), { runs: 2, early });
  await k.s.end();
  await k.s.agent.stop();
  const agent = Agent.start(w, {}, ['--resume', k.s.id]);
  const resumed = await on(new Session(w, agent, w.trees[0]!, r, k.s.id), 'resume', 2);
  const rotated = new Session(w, agent, w.trees[0]!, r);
  const compacted = await on(rotated, 'compact', 3);
  const forked = new Session(w, Agent.start(w, {}, ['--resume', rotated.id, '--fork-session']), w.trees[0]!, r);
  const attempt = await on(forked, 'fork', 4);
  const other = await claim(await open(w, r, { tree: 1, prompt: OTHER_PROMPT }), r, FIXED(5), { runs: 2 });
  return { call, first, resumed, compacted, attempt, ids: [k.s.id, rotated.id, forked.id], other };
}
function staysSpent(a: Across): void {
  spent(a.first, a.call, 'before any rotation');
  spent(a.resumed, a.call, `after a resume in a new process under the same ID ${a.ids[0]}`);
  spent(a.compacted, a.call, `after a compaction rotated the ID to ${a.ids[1]}`);
  spent(a.attempt, a.call, `on a new attempt, by the forked session ${a.ids[2]}`);
  expect(checkRuns(a.other).map((x) => x.outcome), `a session on another task is unaffected: its honest fix passes the visible fixture and the same variant: ${shownClaim(a.other)}`).toEqual(['passed', 'passed']);
  expect(a.other.outcome, `and its claim reads PASS on the two: ${shownClaim(a.other)}`).toBe('PASS');
}

describe(`${AC[6]} A spent variant stays spent across a compaction, a resume and a new attempt on the task, and a session on another task is unaffected`, () => {
  it(`${AC[6]} the task's claims stay INCONCLUSIVE naming the call through a resume, a compaction that rotates the ID and a new attempt; another task's claim passes`, async () => {
    staysSpent(await across(variant()));
  }, 2 * LIMIT);

  it(`${AC[6]} (wrong program ${PLANTS.byId}) a hub that keys the mark on the session's ID unspends it when the ID rotates, and fails`, async () => {
    const a = await across(variant(), PLANTS.byId);
    spent(a.first, a.call, `${PLANTS.byId}: under the ID that made the call, the planted hub still holds the variant spent`);
    expect(a.compacted.outcome, `${PLANTS.byId}: once the ID rotated, the planted hub must count the variant's run again: ${shownClaim(a.compacted)}`).not.toBe('INCONCLUSIVE');
    await mustFail(`${PLANTS.byId} on AC6`, () => staysSpent(a), [a.ids[1]!]);
  }, 2 * LIMIT);
});
