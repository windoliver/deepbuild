// #965 regression: a /loop turn's ScheduleWakeup whose PostToolUse never reaches the hub (deep-hook spooled it under
// load, so the hub records it after the stop) still holds the stop's journey: the stop reads the turn's wake-up from
// its transcript. Through the real hub and deep-hook, on #965's acceptance world (tests/acceptance/965/helpers.ts).
import { randomBytes } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { begin, cleanup, journeysOn, judgedAt, landing, stopHub, allEvents, WAKE_LINE } from '../../../tests/acceptance/965/helpers.ts';

afterEach(cleanup, 60_000);

it('a wake-up the hub heard of only from the transcript holds the journey for the loop', async () => {
  const { hub, s } = await begin();
  try {
    await s.scheduled('/loop keep the cart total right');
    await s.editCart(1);
    // The call ran and Claude Code wrote it to the transcript, but its hooks never reached the hub.
    const id = `toolu_${randomBytes(10).toString('hex')}`;
    s.entry({ type: 'assistant', message: { role: 'assistant', type: 'message', model: 'claude-haiku-5-5', id: `msg_${randomBytes(6).toString('hex')}`, content: [{ type: 'tool_use', id, name: 'ScheduleWakeup', input: { delaySeconds: 60, prompt: '/loop keep the cart total right', reason: 'check the cart again' } }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
    s.entry({ type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: '{"scheduled":true,"delaySeconds":60}' }] }, toolUseResult: { scheduled: true, delaySeconds: 60 } });
    const seen = await s.stop('Pass 1: the cart rounds each line.');
    const { stop } = await judgedAt(hub, s, 1, seen);
    await landing();
    expect(journeysOn(await allEvents(hub), stop.snapshot), 'the turn scheduled its next wake-up in 60 s, so the 300 s journey waits for the loop').toEqual([]);
    expect(seen.line, 'the line names the held journey and why').toContain(WAKE_LINE);
  } finally {
    await stopHub(hub);
  }
}, 420_000);
