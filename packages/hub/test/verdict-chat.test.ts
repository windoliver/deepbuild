// The status question matcher and answer (#83): the issue's four questions, with a tag after, are status; work is not.
import { describe, expect, it } from 'vitest';
import { isStatusQuestion, statusAnswer } from '../src/verdict-chat.js';

describe('isStatusQuestion', () => {
  it('matches the four questions, in any case, with or without a one-word tag in parentheses', () => {
    for (const q of ['still going?', 'All done?', "what's next?", 'anything for me?', 'still going? (person)', '  all done ? (unplaced)']) expect(isStatusQuestion(q), q).toBe(true);
  });
  it('never matches a prompt that asks for work, a statement, one that only starts like a status question, or an instruction in the parentheses', () => {
    for (const q of ['Now add a test for total.ts.', 'all done', "what's next on the list? add it", 'still going? then stop and write the PR', 'all done? (if not, fix the failing test and push)', 'done', 'status?', 'Fix the cart total, then stop.', '']) expect(isStatusQuestion(q), q).toBe(false);
  });
});

describe('statusAnswer', () => {
  const facts = { session: '0b1dba30-7d4e-4c66-83df-ce84df27db32', agent: 'claude-code', worktree: '/tmp/w1', needsYou: 2, now: 100_000, lastStop: 40_000 };
  it('with no claim yet the session is working; the answer carries the time, the next step, the count, the worktree, the session, how to resume it and its link', () => {
    const a = statusAnswer(undefined, facts);
    expect(a).toBe('working · next: agent (for 1m) · needs you: 2\nwork: /tmp/w1 · session 0b1dba30 (claude-code) · resume: claude --resume 0b1dba30-7d4e-4c66-83df-ce84df27db32 · deep://sessions/0b1dba30-7d4e-4c66-83df-ce84df27db32');
  });
  it("a turn without a claim answers with the session's own state, the next step on you when it waits or is stuck", () => {
    expect(statusAnswer(undefined, { ...facts, state: 'stuck' }).split(' (')[0]).toBe('stuck · next: you');
    expect(statusAnswer(undefined, { ...facts, state: 'waiting' }).split(' (')[0]).toBe('waiting · next: you');
    expect(statusAnswer(undefined, { ...facts, state: 'failed' }).split(' (')[0]).toBe('failed · next: agent');
    expect(statusAnswer(undefined, { ...facts, state: 'finished' }).split(' (')[0]).toBe('finished · next: you');
    expect(statusAnswer(undefined, { ...facts, state: 'unknown' }).split(' (')[0]).toBe('unknown · next: agent');
  });
  it('with a claim the first line is its verdict line, timed from the verdict; the time reads in s, m, h or d', () => {
    const claim = { task: 'task:T', session: facts.session, created: 10_000, checks: [], state: { outcome: 'PASS' as const, requirements: [{ req: 'req:D#R1', outcome: 'PASS' as const, smallest: null, points_to: null }], running: [] } };
    const a = statusAnswer({ ...claim, verdictAt: 95_000 }, { ...facts, agent: 'codex' });
    expect(a.split('\n')[0]).toBe('PASS 1/1 · next: you · receipt (for 5s) · needs you: 2');
    expect(a).toContain('resume: codex resume 0b1dba30-7d4e-4c66-83df-ce84df27db32');
    expect(statusAnswer({ ...claim, verdictAt: 0 }, { ...facts, now: 7_200_000 })).toContain('(for 2h)');
    expect(statusAnswer({ ...claim, verdictAt: 0 }, { ...facts, now: 2 * 86_400_000 })).toContain('(for 2d)');
  });
});
