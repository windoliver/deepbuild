// #29 AC36–AC40: a loop's turn end isn't a hand-back. The scheduler on a virtual clock (README, section 7, rule 9).
import { describe, expect, it } from 'vitest';
import { simulate, type Scenario, type SchedulerPlant, type ScriptEvent } from '../../../packages/gate/src/index.ts';
import { edit, mustFail, prompt, runsOf, script, stop, stopOf, MINUTE } from './helpers.ts';
import { J, journey, unit } from './h-c.ts';

const heldOf = (t: ReturnType<typeof simulate>, snapshot: string, check = J) => t.held.find((h) => h.check === check && h.snapshot === snapshot);
const JOURNEY = 300_000;

// ---- AC36
const GOAL_TURNS = 5;
function goal(plant?: SchedulerPlant) {
  const events: ScriptEvent[] = [];
  for (let i = 1; i <= GOAL_TURNS; i++) {
    const p = (i - 1) * 5000; // each next continuation arrives 1 s after the reply (stop + 2 s fast checks)
    events.push(prompt(p, 'continuation'), edit(p + 1000, `S${i}`), stop(p + 2000, `S${i}`, { id: `stop${i}` }));
  }
  events.push({ at: 4 * 5000 + 1500, kind: 'facts', facts: { goal: 'complete' } });
  events.sort((a, b) => a.at - b.at);
  const sc: Scenario = {
    config: { slots: 2, stop_timeout_ms: 45 * MINUTE },
    sessions: [script('G', 'codex-observed', [unit(), journey({ S5: 'failed' })], events, { facts: { goal: 'active' } })],
  };
  return simulate(sc, plant ? { plant } : {});
}
function ac36(plant?: SchedulerPlant) {
  const t = goal(plant);
  for (let i = 1; i <= 4; i++) expect(runsOf(t, J, `S${i}`), `stop ${i}: no journey starts on its snapshot while the goal is active`).toEqual([]);
  const s5 = stopOf(t, 'G', 5);
  const run5 = runsOf(t, J, 'S5');
  expect(run5.length, 'stop 5: the journey starts on its snapshot').toBe(1);
  expect(run5[0]!.started_at, 'stop 5: the journey starts when its fast-lane checks end').toBe(22_000 + 2000);
  expect(s5.reply_at, 'stop 5: held until the journey lands').toBe(24_000 + JOURNEY);
  expect(s5.kind, 'stop 5: its FAIL reaches the agent in the same turn').toBe('send_back');
  expect(s5.held.slow, 'stop 5: the 300 s after its fast lane are a slow hold').toBe(JOURNEY);
  for (let i = 1; i <= 4; i++) {
    const s = stopOf(t, 'G', i);
    expect(s.kind, `stop ${i}: its reply ends the turn`).toBe('ends_turn');
    expect(s.reply_at, `stop ${i}: replies when its fast-lane checks end`).toBe(s.at + 2000);
    expect(s.held.slow, `stop ${i}: no slow hold`).toBe(0);
    expect(s.line, `stop ${i}: names the held check`).toContain('1 check waits for the loop');
    expect(s.line, `stop ${i}: names the reason`).toContain('goal active');
    const h = heldOf(t, `S${i}`);
    expect(h, `stop ${i}: its snapshot holds the place`).toBeDefined();
    expect(h!.replaced_by, `stop ${i}: the next snapshot takes the held place from it`).toBe(`S${i + 1}`);
    expect(h!.started_at, `stop ${i}: its held place never starts`).toBeNull();
  }
}
describe('AC36 a Codex goal holds the journey until the goal completes', () => {
  it('AC36 five goal turns: no journey on the first four snapshots, the fifth starts it and is held until it lands', () => ac36());
  it('AC36 a runner that ignores loops starts the journey at the first stop and fails, naming it', () => mustFail('ignores-loops', () => ac36('ignores-loops'), ['stop 1']));
  it('AC36 a runner that waits out the grace window instead of reading the goal replies to the fifth stop with no journey, and fails, naming it', () => mustFail('waits-grace-not-facts', () => ac36('waits-grace-not-facts'), ['stop 5']));
});

// ---- AC37
function claimTurn(via: 'deep_claim' | 'gh_pr_create', plant?: SchedulerPlant) {
  const events: ScriptEvent[] = [
    prompt(0, 'continuation'), edit(1000, 'S1'), stop(2000, 'S1'),
    prompt(5000, 'continuation'), edit(6000, 'S2'), stop(7000, 'S2'),
    prompt(10_000, 'continuation'), edit(11_000, 'S3'), { at: 11_500, kind: 'claim', via }, stop(12_000, 'S3'),
    prompt(315_000, 'continuation'), edit(316_000, 'S4'), stop(317_000, 'S4'),
  ];
  const sc: Scenario = { config: { slots: 2, stop_timeout_ms: 45 * MINUTE }, sessions: [script('G', 'codex-observed', [unit(), journey()], events, { facts: { goal: 'active' } })] };
  return simulate(sc, plant ? { plant } : {});
}
function ac37(via: 'deep_claim' | 'gh_pr_create', plant?: SchedulerPlant) {
  const t = claimTurn(via, plant);
  const runs = runsOf(t, J);
  expect(runs.map((r) => r.snapshot), `claim ${via}: the journey runs on the claim's snapshot only`).toEqual(['S3']);
  expect(runs[0]!.started_at, `claim ${via}: starts when the stop's fast-lane checks end`).toBe(14_000);
  expect(['claim', 'turn_end']).toContain(runs[0]!.started_by);
  const s3 = stopOf(t, 'G', 3);
  expect(s3.reply_at, `claim ${via}: its stop is held until the journey lands`).toBe(14_000 + JOURNEY);
  expect(s3.held.slow, `claim ${via}: slow hold`).toBe(JOURNEY);
  const s4 = stopOf(t, 'G', 4);
  expect(s4.reply_at, `claim ${via}: the fourth stop replies when its fast lane ends`).toBe(s4.at + 2000);
  expect(s4.held.slow).toBe(0);
  expect(heldOf(t, 'S4'), `claim ${via}: the fourth stop takes the held place again`).toBeDefined();
  expect(runsOf(t, J, 'S4'), `claim ${via}: and starts nothing`).toEqual([]);
}
describe('AC37 a claim in a goal turn starts the journey at its green stop', () => {
  for (const via of ['deep_claim', 'gh_pr_create'] as const) {
    it(`AC37 ${via} in the third turn starts the journey on its snapshot and holds the stop until it lands; the fourth stop takes the held place`, () => ac37(via));
    it(`AC37 a runner that holds a claim's stop for the loop (${via}) fails, naming the claim`, () => mustFail('holds-claim-stop-for-loop', () => ac37(via, 'holds-claim-stop-for-loop'), [`claim ${via}`]));
  }
});

// ---- AC38
function wakeups(plant?: SchedulerPlant) {
  const events: ScriptEvent[] = [
    prompt(0, 'scheduled'), edit(1000, 'S1'), { at: 5000, kind: 'words', via: 'typed' },
    { at: 7000, kind: 'facts', facts: { wakeup_due: 70_000 } }, stop(8000, 'S1', { id: 'w1' }),
    prompt(70_000, 'scheduled'), edit(71_000, 'S2'), { at: 71_500, kind: 'facts', facts: { wakeup_due: 134_000 } }, stop(72_000, 'S2', { id: 'w2' }),
    prompt(134_000, 'scheduled'), edit(135_000, 'S3'), { at: 135_500, kind: 'facts', facts: { wakeup_due: null } }, stop(136_000, 'S3', { id: 'w3' }),
  ];
  const sc: Scenario = { config: { slots: 2 }, sessions: [script('L', 'claude', [unit(), journey()], events)] };
  return simulate(sc, plant ? { plant } : {});
}
function ac38(plant?: SchedulerPlant) {
  const t = wakeups(plant);
  const r1 = runsOf(t, J, 'S1');
  expect(r1.length, 'stop 1: your words in its turn start the journey at its green stop').toBe(1);
  expect(r1[0]!.started_at, 'stop 1: when its fast-lane checks end').toBe(10_000);
  expect(r1[0]!.started_by, 'stop 1: started by your words').toBe('words');
  const s2 = stopOf(t, 'L', 2);
  expect(s2.line, 'stop 2: its verdict line').toContain('1 check waits for the loop');
  expect(runsOf(t, J, 'S2'), 'stop 2: starts nothing, holds its snapshot').toEqual([]);
  expect(heldOf(t, 'S2')?.replaced_by, 'stop 2: the held place is taken by the third snapshot').toBe('S3');
  const r3 = runsOf(t, J, 'S3');
  expect(r3.length, 'stop 3: the turn that schedules no wake-up queues the journey on its snapshot').toBe(1);
  expect(r3[0]!.queued_at, 'stop 3: queued when its reply ends the turn').toBe(138_000);
  expect(r3[0]!.started_at, 'stop 3: starts when the running journey ends').toBe(10_000 + JOURNEY);
  expect(t.queue.some((q) => q.snapshot === 'S3' && q.check === J && q.op === 'queued'), 'stop 3: a queue event for its snapshot').toBe(true);
}
describe('AC38 a Claude Code /loop with wake-ups and your words', () => {
  it('AC38 your words start the journey at that turn\'s green stop, the next stop holds, the turn with no wake-up queues', () => ac38());
  it('AC38 a runner that counts your words only when they start a turn holds the first journey too and fails, naming the stop', () => mustFail('words-only-at-turn-start', () => ac38('words-only-at-turn-start'), ['stop 1']));
});

// ---- AC39
const SOAK = 'soak:long';
function heartbeat(plant?: SchedulerPlant) {
  const soak = { ...journey(undefined, 20 * MINUTE), id: SOAK };
  const events: ScriptEvent[] = [prompt(0, 'scheduled'), edit(500, 'S1'), { at: 600, kind: 'facts', facts: { heartbeat_due: 3000 + 15 * MINUTE } }, stop(1000, 'S1')];
  const sc: Scenario = { config: { slots: 2 }, sessions: [script('H', 'claude', [unit(), journey(), soak], events)] };
  return simulate(sc, plant ? { plant } : {});
}
function ac39a(plant?: SchedulerPlant) {
  const t = heartbeat(plant);
  const j = runsOf(t, J, 'S1');
  expect(j.length, `check ${J}: a 300 s journey fits before the next heartbeat in 15 minutes and starts`).toBe(1);
  expect(j[0]!.started_at, `check ${J}: when the fast-lane checks end`).toBe(3000);
  expect(['turn_end', 'loop_paused']).toContain(j[0]!.started_by);
  expect(runsOf(t, SOAK), `check ${SOAK}: a 20-minute check can't end before the heartbeat and is held`).toEqual([]);
  expect(t.held.find((h) => h.check === SOAK)?.reason, `check ${SOAK}: held for the heartbeat`).toMatch(/heartbeat/i);
  expect(t.held.some((h) => h.check === J), `check ${J}: not held`).toBe(false);
  expect(stopOf(t, 'H', 1).line).toContain('1 check waits for the loop');
}
function peer(agent: 'claude' | 'codex-observed', next: boolean, plant?: SchedulerPlant) {
  const events: ScriptEvent[] = [prompt(0, 'session'), edit(500, 'S1'), stop(1000, 'S1')];
  if (next) events.push(prompt(40_000, 'session'), edit(41_000, 'S2'), stop(42_000, 'S2'));
  const sc: Scenario = { config: { slots: 2, stop_timeout_ms: 45 * MINUTE }, sessions: [script('P', agent, [unit(), journey()], events)] };
  return simulate(sc, plant ? { plant } : {});
}
describe('AC39 heartbeats and another session\'s messages', () => {
  it('AC39 a heartbeat turn due in 15 minutes starts the 300 s journey and holds the 20-minute check', () => ac39a());
  it('AC39 a runner that holds every loop check leaves the journey unrun and fails, naming the check', () => mustFail('holds-every-loop-check', () => ac39a('holds-every-loop-check'), [`check ${J}`]));
  for (const agent of ['claude', 'codex-observed'] as const) {
    it(`AC39 (${agent}) a turn another session's message started ends green with no automatic prompt by 60 s after its reply: the journey starts then`, () => {
      const t = peer(agent, false);
      const s = stopOf(t, 'P', 1);
      expect(s.reply_at, 'the reply comes when the fast lane ends, no slow hold').toBe(3000);
      expect(s.held.slow).toBe(0);
      expect(t.held.find((h) => h.snapshot === 'S1')?.reason, 'held while no fact foresees a prompt').toBeTruthy();
      const r = runsOf(t, J, 'S1');
      expect(r.length).toBe(1);
      expect(r[0]!.started_at, 'starts when the grace window after the reply ends').toBe(3000 + 60_000);
      expect(r[0]!.started_by).toBe('loop_paused');
    });
    it(`AC39 (${agent}) in the twin the next message comes at 40 s and its turn changes src/cart.ts: no journey starts on the first snapshot`, () => {
      const t = peer(agent, true);
      expect(runsOf(t, J, 'S1'), 'no journey on the first snapshot').toEqual([]);
      expect(t.held.find((h) => h.snapshot === 'S1')?.replaced_by, 'the second snapshot took its held place').toBe('S2');
      const r = runsOf(t, J, 'S2');
      expect(r.length, 'the journey starts on the second snapshot once its own grace window ends').toBe(1);
      expect(r[0]!.started_at).toBe(44_000 + 60_000);
    });
  }
});

// ---- AC40
function question(plant?: SchedulerPlant) {
  const events: ScriptEvent[] = [
    prompt(0, 'continuation'), edit(1000, 'S1'), stop(2000, 'S1', { sorted: 'question_holds' }),
    prompt(5000, 'continuation'), edit(6000, 'S2'), stop(7000, 'S2'),
    prompt(10_000, 'continuation'), edit(11_000, 'S3'), stop(12_000, 'S3'),
    prompt(15_000, 'continuation'), { at: 15_500, kind: 'words', via: 'answer' }, edit(16_000, 'S4'), stop(17_000, 'S4'),
  ];
  const sc: Scenario = { config: { slots: 2, stop_timeout_ms: 45 * MINUTE }, sessions: [script('Q', 'codex-observed', [unit(), journey()], events, { facts: { goal: 'active' } })] };
  return simulate(sc, plant ? { plant } : {});
}
function ac40(plant?: SchedulerPlant) {
  const t = question(plant);
  expect(runsOf(t, J, 'S1'), 'stop 1: the question\'s stop starts no journey').toEqual([]);
  const s1 = stopOf(t, 'Q', 1);
  expect(s1.kind, 'stop 1: not sent back').toBe('question_holds');
  expect(s1.reply_at, 'stop 1: held no longer than its fast lane').toBe(4000);
  expect(s1.held.question, 'stop 1: the whole hold is a question hold').toBe(2000);
  for (const n of [2, 3]) {
    expect(runsOf(t, J, `S${n}`), `stop ${n}: holds its journey`).toEqual([]);
    expect(stopOf(t, 'Q', n).held.slow, `stop ${n}: no slow hold`).toBe(0);
  }
  expect(heldOf(t, 'S2')?.replaced_by, 'stop 2 is replaced by stop 3').toBe('S3');
  const r = runsOf(t, J, 'S4');
  expect(r.length, 'stop 4: the first green stop after the answer starts it').toBe(1);
  expect(r[0]!.started_at, 'stop 4: when its fast lane ends').toBe(19_000);
  expect(r[0]!.started_by, 'stop 4: started by your answer').toBe('answer');
  expect(stopOf(t, 'Q', 4).reply_at, 'stop 4: held until it lands').toBe(19_000 + JOURNEY);
}
describe('AC40 a question holds the journey until your answer is delivered', () => {
  it('AC40 a goal turn ending on a step only you can take holds its journey through two goal turns; the first green stop after your answer starts it', () => ac40());
  it('AC40 a runner that starts the journey at the question\'s stop fails, naming the stop', () => mustFail('starts-at-question-stop', () => ac40('starts-at-question-stop'), ['stop 1']));
});
