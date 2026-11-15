// #2118: a looping Codex session's slow check is held for its loop, so no stop is held for it; once the loop pauses
// the check runs, and its FAIL reaches the session with its next prompt. #39's world, whose hub and hooks are real;
// the hub's clock is stepped past the grace window (test.clock, as #965's suite steps it).
import { writeFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { allEvents, begin, cleanup, codexHook, control, hookShown, makeHome, MINUTE, newThread, patch, slowRepo, SLOW_ASK, startHub, deep, waitFor, type Line, type Thread } from '../../../tests/acceptance/39/helpers.ts';

afterEach(cleanup, 120_000);

const CHECK = '.deepbuild/checks/slow.sh';
const append = (t: Thread, type: string, payload: Line): void => writeFileSync(t.transcript, `${JSON.stringify({ timestamp: new Date().toISOString(), type, payload })}\n`, { flag: 'a' });
function turnOpens(t: Thread, text: string): void {
  append(t, 'event_msg', { type: 'task_started', turn_id: t.turn, started_at: Math.round(Date.now() / 1000), collaboration_mode_kind: 'default' });
  append(t, 'turn_context', { turn_id: t.turn, cwd: t.cwd, approval_policy: 'never' });
  append(t, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
}
function goalCreated(t: Thread): void {
  const call_id = `call_${crypto.randomUUID().replace(/-/g, '')}`;
  append(t, 'response_item', { type: 'custom_tool_call', status: 'completed', call_id, name: 'exec', input: 'const r = await tools.create_goal({objective:"Add tax, one file a turn."});\ntext(r);\n' });
  const goal = { goal: { threadId: t.id, objective: 'Add tax, one file a turn.', status: 'active', tokensUsed: 0, timeUsedSeconds: 0, createdAt: Math.round(Date.now() / 1000), updatedAt: Math.round(Date.now() / 1000) }, remainingTokens: null, completionBudgetReport: null };
  append(t, 'response_item', { type: 'custom_tool_call_output', call_id, output: [{ type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' }, { type: 'input_text', text: JSON.stringify(goal) }] });
}
const CONTINUATION = '<codex_internal_context source="goal">\nContinue working toward the active thread goal.\n\n<objective>\nAdd tax, one file a turn.\n</objective>\n</codex_internal_context>';

it("a check held for a Codex loop holds no stop, runs once the loop pauses, and its FAIL comes with the session's next prompt", async () => {
  const h = makeHome();
  const repo = slowRepo(h, { expected_ms: 20 * MINUTE, deadline_ms: 20 * MINUTE, sleepS: 1, exit: 1 });
  const hub = await startHub(h, { env: { DEEP_HUB_TEST_CLOCK_STEPS: '1' } });
  expect((await deep(h, ['setup'])).code, 'deep setup').toBe(0);
  const t = newThread(h, { cwd: repo });
  // Turn 1, yours: the goal is created; its stop is held for the check, which fails, so the agent goes on.
  await begin(h, t, SLOW_ASK);
  turnOpens(t, SLOW_ASK);
  await waitFor(async () => (await allEvents(hub)).some((e) => e.kind === 'definition.locked'), 300_000, 'the definition to lock');
  goalCreated(t);
  await patch(h, t, 'tax.txt', 'tax');
  await codexHook(h, t, 'Stop', {}, 900_000);
  // Turn 2, the goal's continuation: another file, and a stop the loop holds the check at.
  t.turn = crypto.randomUUID();
  turnOpens(t, CONTINUATION);
  await patch(h, t, 'tax2.txt', 'more tax');
  const before = (await allEvents(hub)).at(-1)?.log_pos ?? 0;
  const stop = await codexHook(h, t, 'Stop', {}, 900_000);
  const held = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'check.held' && e.log_pos > before && e.data.check === CHECK), 300_000, 'the held place');
  const claim = String(held.data.claim);
  // Held for the check, the stop would wait out Codex's 45-minute Stop timeout: the check starts no run here.
  expect(stop.ran.ms, `the stop isn't held for a check that waits for the loop: ${hookShown(stop)}`).toBeLessThan(5 * MINUTE);
  expect(stop.reply?.decision, `no verdict of the held check at this stop: ${hookShown(stop)}`).toBeUndefined();
  // No prompt comes: past the grace window the loop has paused, and the held check starts.
  await control(hub, 'test.clock', { advance_ms: 2 * MINUTE });
  await waitFor(async () => { const all = await allEvents(hub); const run = all.find((e) => e.kind === 'run.started' && e.data.claim === claim && e.data.check === CHECK); return run !== undefined && all.some((e) => e.kind === 'run.finished' && e.data.run === run.data.run); }, 300_000, "the held check's run to end");
  await waitFor(async () => (await allEvents(hub)).some((e) => e.kind === 'verdict.made' && e.data.claim === claim && e.data.outcome === 'FAIL'), 120_000, "the claim's FAIL");
  t.turn = crypto.randomUUID();
  const next = await codexHook(h, t, 'UserPromptSubmit', { prompt: 'Well?' });
  expect(String(next.reply?.hookSpecificOutput?.additionalContext ?? ''), `the FAIL with the next prompt: ${hookShown(next)}`).toMatch(/FAIL|sent back/);
}, 1_800_000);
