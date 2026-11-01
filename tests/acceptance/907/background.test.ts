// #907 AC2: a background shell command keeps the session looping until its end notice, and the 300 s journey waits.
// First the reading: a recorded Claude Code session, through the real deep-hook into `deep hub run`, starts `npm run e2e`
// with `Bash` and `run_in_background: true` beside a foreground `npm run lint`, and ends its turn on a green stop; the
// command's end notice arrives as an automatic prompt (its transcript entry: `turnOrigin: task_notification`, a
// `<task-notification>` naming the call), and the agent stops again. Each stop's loop reading is on its agent.stop,
// `data.loop`, as #18's AC24 reads it. Then the hold: the scheduler on a virtual clock, given that session's loop facts
// (the command still running, `LoopFacts.background`, README), holds the 300 s journey until the end notice.
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll } from 'vitest';
import { simulate, type ScriptEvent } from '../../../packages/gate/src/index.ts';
import { cleanup, failureOf, kindOf, makeHome, Session, settle, shown, startHub, type Ev, type Hub } from '../18/mapping/helpers.ts';
import { edit, prompt, runsOf, script, stop, stopOf } from '../29/helpers.ts';
import { journey, unit } from '../29/h-c.ts';
import { AC2, E2E, J, running } from './helpers.ts';

afterAll(cleanup, 60_000);

const TASK = 'bq7x2k9m4';
const CALL = (id: string) => `Bash \`${E2E}\` (run_in_background: true, ${id})`;

/** The command's end notice, as Claude Code 2.1.304 queues it: an automatic prompt, never typed. */
async function endNotice(s: Session, call: string, command: string): Promise<void> {
  s.promptId = randomUUID();
  const text = `<task-notification>\n<task-id>${TASK}</task-id>\n<tool-use-id>${call}</tool-use-id>\n<output-file>/private/tmp/claude-502/${s.id}/tasks/${TASK}.output</output-file>\n<status>completed</status>\n<summary>Background command "${command}" completed (exit code 0)</summary>\n</task-notification>`;
  s.entry({
    promptId: s.promptId, type: 'user', message: { role: 'user', content: text }, isMeta: true, promptSource: 'system',
    origin: { kind: 'task-notification', producer: 'session-task' }, turnOrigin: 'task_notification', queueSkipAttachments: true, turnPosition: { promptIndex: 1, turnIndex: 2 },
  });
  await s.hook('UserPromptSubmit', { prompt: text });
}
async function backgroundSession(hub: Hub): Promise<{ call: string; stops: Ev[]; asks: Ev[] }> {
  const s = new Session(hub.home);
  await s.start();
  // A question that opens no task, so its stop is no claim and nothing holds it: the loop reading is the stop's own.
  await s.prompt('Can you run the e2e suite in the background and tell me whether it passes?', 'human');
  await s.call('Bash', { command: 'npm run lint', description: 'Lint' }, { response: { stdout: 'no problems', stderr: '', interrupted: false, isImage: false } });
  const e2e = await s.call('Bash', { command: E2E, description: 'Run the e2e suite', run_in_background: true }, {
    response: { stdout: '', stderr: '', interrupted: false, isImage: false, backgroundTaskId: TASK },
  });
  await s.stop('The e2e suite runs in the background; I will tell you when it reports.');
  await endNotice(s, e2e.id, E2E);
  await s.stop('The e2e suite passed: 42 tests.');
  const events = await settle(hub, (all) => kindOf(all, s.id, 'agent.stop').length >= 2, { minMs: 2000, timeoutMs: 45_000 });
  return { call: e2e.id, stops: kindOf(events, s.id, 'agent.stop'), asks: kindOf(events, s.id, 'user.ask') };
}
function readings(call: string, stops: Ev[]): void {
  expect(stops.length, `both stops are recorded: ${stops.map(shown).join('; ')}`).toBe(2);
  expect(stops[0]!.data.loop?.state, `the turn ended on a green stop with ${CALL(call)} still running, so the stop reads looping until the command's end notice: ${shown(stops[0])}`).toBe('looping');
  expect(stops[1]!.data.loop?.state, `the end notice of ${CALL(call)} arrived as an automatic prompt and nothing of the session's still runs (the foreground \`npm run lint\` never counted), so the next stop reads a loop with none left: ${shown(stops[1])}`).toBe('none_left');
}
async function hubReading(plant?: string): Promise<{ call: string; stops: Ev[] }> {
  // A hub that doesn't start (a plant the base doesn't list) fails here, never inside the planted judge.
  const hub = await startHub(makeHome(), plant);
  try {
    const { call, stops, asks } = await backgroundSession(hub);
    expect(asks.map((e) => e.data.from), `the prompts' origins: yours, then the end notice's (automatic): ${asks.map(shown).join('; ')}`).toEqual(['person', 'subagent']);
    return { call, stops };
  } finally {
    try { process.kill(hub.pid, 'SIGTERM'); } catch { /* gone */ }
  }
}

// ---- The hold, on the scheduler's virtual clock.
const NOTICE = 122_000;
/** The same session in the scheduler: `facts` says what the session's loop facts read; without them, what an adapter counting only subagents reads. */
function heldUntilNotice(facts: boolean) {
  const events: ScriptEvent[] = [
    prompt(0, 'human'),
    ...(facts ? [running(500, [E2E])] : []),
    edit(1000, 'S1'), stop(2000, 'S1', { id: 'green' }),
    // The end notice, two minutes later: an automatic prompt; the command no longer runs.
    prompt(NOTICE, 'subagent'),
    ...(facts ? [running(NOTICE, [])] : []),
    edit(NOTICE + 2000, 'S2'), stop(NOTICE + 3000, 'S2', { id: 'after-notice' }),
  ];
  return simulate({ config: { slots: 2 }, sessions: [script('E', 'claude', [unit(), journey()], events)] });
}
function journeyWaits(facts: boolean): void {
  const t = heldUntilNotice(facts);
  const s1 = stopOf(t, 'E', 1);
  const runs = runsOf(t, J);
  console.log(`AC2 scheduler ${facts ? 'with the background fact' : 'subagents only'}: stop 1 ${s1.kind} at ${s1.at}, replied ${s1.reply_at}, admitted [${s1.admitted.join(', ')}], slow [${s1.slow.join(', ')}], line "${s1.line}"; ${J} runs: ${runs.map((r) => `${r.snapshot} ${r.lane} lane, started ${r.started_at}`).join('; ') || 'none'}`);
  expect(s1.kind, 'stop 1 is green and ends the turn').toBe('ends_turn');
  expect(s1.slow, `stop 1: the 300 s ${J} is a slow-lane check`).toContain(J);
  const early = runs.filter((r) => r.started_at < NOTICE);
  expect(early.map((r) => `${r.snapshot} at ${r.started_at} ms`), `${CALL('its call')} still ran from stop 1 until its end notice at ${NOTICE} ms, so the 300 s ${J} waits; it started at once`).toEqual([]);
  const held = t.held.find((h) => h.check === J && h.snapshot === 'S1');
  expect(held, `stop 1: ${J} holds its queued place while ${E2E} runs`).toBeDefined();
  expect(held!.started_at, `stop 1: its held place never starts on S1`).toBeNull();
  expect(held!.replaced_by, `the stop after the end notice takes the held place`).toBe('S2');
  const after = runsOf(t, J, 'S2');
  expect(after.length, `the green stop after the end notice, with nothing left running, starts ${J}`).toBe(1);
  expect(after[0]!.started_at, `when that stop's fast lane ends`).toBe(NOTICE + 3000 + 2000);
}

describe(`${AC2} a background \`npm run e2e\` keeps the session looping until its end notice, and the 300 s journey waits`, () => {
  it(`${AC2} the recorded session's green stop with \`npm run e2e\` running in the background reads looping, and the stop after its end notice reads none left`, async () => {
    const { call, stops } = await hubReading();
    readings(call, stops);
  }, 240_000);
  it(`${AC2} (wrong program) an adapter that counts only subagents (DEEP_HUB_PLANT=background-subagents-only) reads the green stop as not looping and fails this test, naming the call`, async () => {
    const { call, stops } = await hubReading('background-subagents-only');
    const failure = await failureOf(() => readings(call, stops));
    expect(failure, 'the planted adapter must fail the loop readings').not.toBeNull();
    expect(failure, 'the failure names the call').toContain(`Bash \`${E2E}\``);
    expect(failure, 'the failure names the call by its ID').toContain(call);
  }, 240_000);
  it(`${AC2} given the session's loop facts, the scheduler holds the 300 s journey from the green stop until the end notice, and the stop after it starts the journey`, () => {
    journeyWaits(true);
  });
  it(`${AC2} (wrong program) with the facts an adapter that counts only subagents reads, the journey starts at once and this test fails, naming the call`, async () => {
    const failure = await failureOf(() => journeyWaits(false));
    expect(failure, 'the journey must start at once on facts that leave the command out, failing this test').not.toBeNull();
    expect(failure, 'the failure names the call').toContain(`Bash \`${E2E}\``);
  });
});
