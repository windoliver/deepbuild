// #25's Proof, live: each delivery route on interactive Claude Code sessions run by the agent test harness (#48), never
// `claude -p`, which ends async hooks at teardown. They spend plan usage, so they run only by hand:
//   DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/25/live routes.live.test.ts
// Without the opt-in, the token, a `claude` on PATH or the harness's deep-answer scenario, each test fails with BLOCKED
// in its message; nothing skips. The sessions run with HOME a temporary home, so `~/.claude/settings.json` is the file
// `deep setup` wrote there, DeepBuild's own entries; the harness's hooks only record what Claude Code sent (README:
// The live sessions). The desktop app's half is MANUAL.md.
import { afterAll, describe, expect, it } from 'vitest';
import { AC1, AC2, AC7, AC9, cleanup, environmentProblem, judge, load } from './helpers.ts';
import { carries, deliveries, iso, live, said, stops, wakes, type Answered, type Live, type LiveSession } from './live.ts';

afterAll(cleanup, 60_000);

const MINUTE = 60_000;
const replied = (stop: { last_assistant_message?: unknown } | undefined, a: Answered) => said(stop).includes(a.chosen) && !said(stop).includes(a.other);
const harnessDone = (r: Live, ac: string) => (r.line.verdict === 'PASS' ? [] : [`${ac} the harness's ${r.line.evidence?.route ?? ''} run ended ${r.line.verdict}: ${r.line.reason}`]);
const named = (r: Live, name: string): LiveSession => {
  const s = r.sessions.find((x) => x.name === name);
  if (!s) throw Error(`BLOCKED: the run line names no session ${name}: ${r.sessions.map((x) => x.name).join(', ')}`);
  return s;
};

/** AC1: the stop held while the ask is open continues with your answer, through the Stop hold and no other route. */
function heldProblems(r: Live): string[] {
  const s = named(r, 'A');
  const a = r.answers[0]!;
  const out = harnessDone(r, AC1);
  const first = stops(s).find((p) => p.stop_hook_active !== true);
  if (!first) return [...out, `${AC1} ${s.sessionId} never stopped after it asked ${a.handle}`];
  if (a.at < first.at) throw Error(`INCONCLUSIVE: your answer to ${a.handle} was recorded at ${iso(a.at)}, before ${s.sessionId}'s stop at ${iso(first.at)}, so no held stop was tested`);
  for (const p of wakes(s, first.at).filter((x) => carries(x.prompt, a))) out.push(`${AC1} your answer to ${a.handle} reached ${s.sessionId} through a wake, a UserPromptSubmit it didn't type at ${iso(p.at)}, not through its held stop`);
  const cont = stops(s).find((p) => p.stop_hook_active === true && p.at > first.at);
  if (!cont) out.push(`${AC1} ${s.sessionId}'s stop at ${iso(first.at)} was held and you answered ${a.handle} at ${iso(a.at)}, but no Stop with stop_hook_active followed: the held stop never continued with your answer`);
  else if (!replied(cont, a)) out.push(`${AC1} ${s.sessionId}'s held stop continued, but its reply ${JSON.stringify(said(cont).slice(0, 300))} isn't your answer to ${a.handle}, ${a.chosen}`);
  return out;
}

/** AC2: each answer to an idle session wakes it, with the answer, and the agent replies with it; the wake's delay. */
function wakeProblems(r: Live, rounds: number): { problems: string[]; delays: number[] } {
  const s = named(r, 'A');
  const problems = harnessDone(r, AC2);
  const delays: number[] = [];
  if (r.answers.length < rounds) problems.push(`${AC2} only ${r.answers.length} of ${rounds} rounds reached an idle session to answer`);
  for (const a of r.answers) {
    const woke = wakes(s, a.at - 50).find((p) => carries(p.prompt, a));
    if (!woke) {
      problems.push(`${AC2} round ${a.round}: idle session ${s.sessionId} didn't wake on your answer to ${a.handle}, given at ${iso(a.at)}: no prompt it didn't type reached it`);
      continue;
    }
    const entry = deliveries(s, a, a.at)[0];
    delays.push(Math.min(woke.at, entry ? Date.parse(String(entry.timestamp)) : Infinity) - a.at);
    const reply = stops(s).find((p) => p.at > woke.at);
    if (!replied(reply, a)) problems.push(`${AC2} round ${a.round}: ${s.sessionId} woke at ${iso(woke.at)} but its reply ${JSON.stringify(said(reply).slice(0, 300))} isn't your answer to ${a.handle}, ${a.chosen}`);
  }
  return { problems, delays };
}

/** AC9's fallback: with the session's waiter gone, the answer comes with the next prompt. */
function promptProblems(r: Live): { problems: string[]; open: string[] } {
  const s = named(r, 'A');
  const a = r.answers[0]!;
  if (!r.killed.length) throw Error(`INCONCLUSIVE: no process of DeepBuild's waiter entry ran under ${s.sessionId} once its turn was over, so nothing stood in for Claude Code stopping it and the next-prompt route went untested`);
  const early = wakes(s, a.at - 50).filter((p) => carries(p.prompt, a));
  const follow = s.typed[1];
  if (early.length && (!follow || early[0]!.at < follow.at)) throw Error(`INCONCLUSIVE: ${s.sessionId} was woken at ${iso(early[0]!.at)} although its waiter (${r.killed.join(', ')}) was stopped, so the next-prompt route went untested`);
  const problems = harnessDone(r, AC9);
  if (!follow) return { problems: [...problems, `${AC9} the harness never typed ${s.sessionId}'s next prompt`], open: [] };
  const reply = stops(s).find((p) => p.at > follow.at);
  if (!replied(reply, a)) problems.push(`${AC9} your answer to ${a.handle}, given at ${iso(a.at)} once ${s.sessionId}'s waiter was gone, didn't reach it with its next prompt at ${iso(follow.at)}: it replied ${JSON.stringify(said(reply).slice(0, 300))}`);
  const open = problems.length || deliveries(s, a, follow.at).length ? [] : [`the reply was your answer, but no transcript entry of ${s.sessionId} after its next prompt carries ${a.handle}'s IDs or ${a.chosen}`];
  return { problems, open };
}

/** AC7: an answer to an ended session reaches the same thread at SessionStart, and a new session on other work gets nothing. */
function endedProblems(r: Live): { problems: string[]; open: string[] } {
  const [A, B, A2] = ['A', 'B', 'A2'].map((n) => named(r, n)) as [LiveSession, LiveSession, LiveSession];
  const a = r.answers[0]!;
  const problems = harnessDone(r, AC7);
  const open: string[] = [];
  const toB = [...deliveries(B, a), ...wakes(B).filter((p) => carries(p.prompt, a))];
  const bReply = stops(B).at(-1);
  if (toB.length || said(bReply).includes(a.chosen)) {
    problems.push(`${AC7} your answer to ${a.handle}, for ended session ${A.sessionId}, reached ${B.sessionId}, a new session on other work in the same worktree: ${toB.length ? JSON.stringify(toB[0]).slice(0, 300) : said(bReply).slice(0, 300)}`);
  }
  const start = A2.hooks.find((p) => p.hook_event_name === 'SessionStart');
  if (start?.source !== 'resume') throw Error(`INCONCLUSIVE: the harness's third session didn't start as a resume of ${A.sessionId} (SessionStart source ${start?.source}), so the same thread went untested`);
  const follow = A2.typed[0];
  const reply = stops(A2).find((p) => p.at > (follow?.at ?? start.at));
  if (!replied(reply, a)) {
    problems.push(`${AC7} your answer to ${a.handle} never reached ${A2.sessionId}, the same thread resumed: it replied ${JSON.stringify(said(reply).slice(0, 300))}`);
    return { problems, open };
  }
  // At SessionStart: the entry that brought it in comes before the resumed thread's typed prompt, or names SessionStart.
  const resumed = A2.entries.filter((e) => Date.parse(String(e.timestamp)) >= start.at - 1000);
  const brought = deliveries({ ...A2, entries: resumed }, a)[0];
  const prompted = resumed.findIndex((e) => e.type === 'user' && typeof e.message?.content === 'string' && e.message.content.trim() === follow?.text.trim());
  const text = JSON.stringify(brought ?? {});
  if (!brought) open.push(`no transcript entry of the resumed thread ${A2.sessionId} carries ${a.handle}'s IDs or ${a.chosen}, so the route it came by can't be read`);
  else if (/SessionStart/.test(text) || (prompted >= 0 && resumed.indexOf(brought) < prompted)) { /* at SessionStart */ }
  else if (/UserPromptSubmit/.test(text)) problems.push(`${AC7} your answer to ${a.handle} reached the resumed thread ${A2.sessionId} only with its next prompt (${String(brought.timestamp)}), not at its SessionStart`);
  else open.push(`the entry that brought ${a.handle} into ${A2.sessionId} follows its typed prompt and names no hook event: ${text.slice(0, 300)}`);
  return { problems, open };
}

describe(`${AC1} A held stop continues with the answer (live)`, () => {
  it(`${AC1} (live) a session whose stop is held while its deep_ask is open continues with your answer through the Stop hold, and isn't also woken with it`, async () => {
    expect(heldProblems(await live('stop-hold', { timeoutMs: 6 * MINUTE }))).toEqual([]);
  }, 15 * MINUTE);

  it(`${AC1} (live, wrong program) a hub whose held stop lets the stop through without the answer (stop-hold-releases-without-answer) fails, naming the ask`, async () => {
    const r = await live('stop-hold', { plant: 'stop-hold-releases-without-answer', timeoutMs: 6 * MINUTE });
    expect(heldProblems(r).join('\n'), 'the check must fail on stop-hold-releases-without-answer, naming the ask').toContain(r.answers[0]!.handle);
  }, 15 * MINUTE);
});

describe(`${AC2} An idle session wakes within 2 s of an answer at p95 (live)`, () => {
  it(`${AC2} (live) in six rounds an idle session wakes on each answer with it and replies with it; on the reference Mac rounds 2 to 6 wake within 2 s of the answer`, async (ctx) => {
    const loads = [await load()];
    const r = await live('idle-wake', { rounds: 6, timeoutMs: 30 * MINUTE });
    loads.push(await load());
    const { problems, delays } = wakeProblems(r, 6);
    expect(problems).toEqual([]);
    const judged = judge(`${AC2} answer to wake of an idle interactive session, rounds 2 to 6 (round 1 the warm-up)`, delays.slice(1), 2000, 'ms', false);
    console.log(`${judged.verdict} ${judged.text}; round 1 ${delays[0]?.toFixed(0)} ms`);
    const problem = environmentProblem(loads);
    if (problem) ctx.skip(`INCONCLUSIVE (reading only: ${problem}): ${judged.text}`);
    expect(judged.verdict, judged.text).not.toBe('FAIL');
    if (judged.verdict === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${judged.text}`);
  }, 45 * MINUTE);

  it(`${AC2} (live, wrong program) a waiter that ends without waking the session when its answer comes (waiter-never-wakes) fails, naming the ask`, async () => {
    const r = await live('idle-wake', { rounds: 1, plant: 'waiter-never-wakes', timeoutMs: 5 * MINUTE });
    expect(wakeProblems(r, 1).problems.join('\n'), 'the check must fail on waiter-never-wakes, naming the ask').toContain(r.answers[0]!.handle);
  }, 15 * MINUTE);
});

describe(`${AC9} If the desktop app doesn't wake, the view says so and the answer falls back to the next prompt (live, the terminal's fallback; the desktop half is MANUAL.md)`, () => {
  it(`${AC9} (live) with the session's waiter stopped as Claude Code stops one at its timeout, your answer reaches the session with its next prompt (UserPromptSubmit)`, async (ctx) => {
    const { problems, open } = promptProblems(await live('next-prompt', { timeoutMs: 8 * MINUTE }));
    expect(problems).toEqual([]);
    if (open.length) ctx.skip(`INCONCLUSIVE ${open.join('; ')}`);
  }, 15 * MINUTE);

  it(`${AC9} (live, wrong program) a hub that counts an answer delivered once a waiter took it, though the waiter is gone (delivered-to-dead-waiter), fails, naming the ask`, async () => {
    const r = await live('next-prompt', { plant: 'delivered-to-dead-waiter', timeoutMs: 8 * MINUTE });
    expect(promptProblems(r).problems.join('\n'), 'the check must fail on delivered-to-dead-waiter, naming the ask').toContain(r.answers[0]!.handle);
  }, 15 * MINUTE);
});

describe(`${AC7} An answer to a session that has ended reaches only the same thread at SessionStart (live: a resume)`, () => {
  it(`${AC7} (live) an answer given after the session ended reaches nothing in a new session on other work in the same worktree, and reaches the same thread resumed, at its SessionStart`, async (ctx) => {
    const { problems, open } = endedProblems(await live('resume', { timeoutMs: 12 * MINUTE }));
    expect(problems).toEqual([]);
    if (open.length) ctx.skip(`INCONCLUSIVE ${open.join('; ')}`);
  }, 20 * MINUTE);

  it(`${AC7} (live, wrong program) a hub that gives an ended session's answer to the next session starting in the same worktree (ended-answer-to-worktree) fails, naming that session`, async () => {
    const r = await live('resume', { plant: 'ended-answer-to-worktree', timeoutMs: 12 * MINUTE });
    expect(endedProblems(r).problems.join('\n'), 'the check must fail on ended-answer-to-worktree, naming the new session').toContain(named(r, 'B').sessionId);
  }, 20 * MINUTE);

  it(`${AC7} (live, wrong program) a hub that gives an ended session's answer to its resumed thread only with the next prompt (ended-answer-at-next-prompt) fails, naming the ask`, async () => {
    const r = await live('resume', { plant: 'ended-answer-at-next-prompt', timeoutMs: 12 * MINUTE });
    const { problems, open } = endedProblems(r);
    if (!problems.length && open.length) throw Error(`INCONCLUSIVE: ${open.join('; ')}`);
    expect(problems.join('\n'), 'the check must fail on ended-answer-at-next-prompt, naming the ask').toMatch(new RegExp(`${r.answers[0]!.handle}[^\\n]*only with its next prompt`));
  }, 20 * MINUTE);
});
