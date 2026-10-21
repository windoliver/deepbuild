// A stop's cause from transcript error records and rate-limit records (#603), which no recorded session
// reaches: each record is planted in the shape the agent writes it, and read through the real facts files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { replaySession } from '../adapters/index.mjs';

const facts = (agent) => JSON.parse(readFileSync(new URL(`../adapters/${agent}.facts.json`, import.meta.url), 'utf8'));
const stopOf = (agent, payload, transcript) => {
  const file = facts(agent);
  const [replayed] = replaySession({ facts: file, version: file.versions[0], payloads: [payload], transcript }).payloads;
  return replayed.events.find((event) => event.kind === 'agent.stop');
};

const codexStop = { session_id: 's', turn_id: 't2', transcript_path: '/r.jsonl', cwd: '/w', hook_event_name: 'Stop', model: 'gpt-reserve', permission_mode: 'default', stop_hook_active: false, last_assistant_message: 'done' };
const turn = (id) => ({ type: 'turn_context', payload: { turn_id: id } });
const tokens = (rateLimits) => ({ type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rateLimits } });
const limits = (reached, primary) => ({ limit_id: 'codex', primary, secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1760900000 }, rate_limit_reached_type: reached });

test('a Codex limit reached in the turn is plan_window_spent, resetting when the spent window does', () => {
  const stop = stopOf('codex', codexStop, [turn('t2'), tokens(limits('rate_limit_reached', { used_percent: 100, window_minutes: 300, resets_at: 1760031451 }))]);
  assert.equal(stop.data.cause, 'plan_window_spent');
  assert.equal(stop.data.plan_resets, 1760031451000);
});

test('a Codex limit reached with no window spent to reset is rate_limited', () => {
  assert.equal(stopOf('codex', codexStop, [turn('t2'), tokens(limits('rate_limit_reached', null))]).data.cause, 'rate_limited');
});

test("another turn's limit and a limit not reached leave the cause unknown", () => {
  const reached = tokens(limits('rate_limit_reached', { used_percent: 100, window_minutes: 300, resets_at: 1760031451 }));
  assert.equal(stopOf('codex', codexStop, [turn('t1'), reached, turn('t2')]).data.cause, 'unknown');
  assert.equal(stopOf('codex', codexStop, [turn('t2'), tokens(limits(null, { used_percent: 99, window_minutes: 300, resets_at: 1760031451 }))]).data.cause, 'unknown');
});

test("a Codex error event names the cause by its codex_error_info, never by its message", () => {
  const error = (info, message) => ({ type: 'event_msg', payload: { type: 'error', message, codex_error_info: info } });
  assert.equal(stopOf('codex', codexStop, [turn('t2'), error('context_window_exceeded', 'x')]).data.cause, 'context_overflow');
  assert.equal(stopOf('codex', codexStop, [turn('t2'), error('other', 'You have hit your usage limit. Rate limited.')]).data.cause, 'unknown');
});

test('a Claude Code API error entry in the turn names the cause, as the StopFailure error does', () => {
  const payload = { session_id: 's', transcript_path: '/t.jsonl', cwd: '/w', prompt_id: 'p', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'x' };
  const entry = (error) => ({ type: 'assistant', isApiErrorMessage: true, error, message: { id: 'm', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } });
  assert.equal(stopOf('claude-code', payload, [{ type: 'user', promptId: 'p' }, entry('rate_limit')]).data.cause, 'rate_limited');
  assert.equal(stopOf('claude-code', payload, [{ type: 'user', promptId: 'p' }, entry('rate_limit')]).data.usage, null);
  assert.equal(stopOf('claude-code', payload, [{ type: 'user', promptId: 'o' }, entry('rate_limit'), { type: 'user', promptId: 'p' }]).data.cause, 'unknown');
});
