// #2072: your yes to a held plug-in action runs that call alone. Real hub, #363's stocks plug-in, the agent's
// deep-actions `call_action`, the authority ask answered as the app answers it, and the record read back.
import { describe, expect, it } from 'vitest';
import { actionEventsFor, callAction, CHANGE, expectRefused, holdCall, hubWorld, pkg, requestId, runAllowed, runs, SEND, sayYes, type HubWorld } from './helpers.ts';

const world = async (): Promise<HubWorld> => {
  const w = await hubWorld([await pkg('stocks')]);
  await w.agent.initialize('deep-actions');
  return w;
};
const entered = (events: { kind?: unknown }[]): number => events.filter((e) => e.kind === 'action.entered').length;

describe('AC1 #2072 After a send is held and answered yes, the same request ID with other input is refused and runs nothing; the first input then runs once', () => {
  it('AC1 r1 + input A held and answered yes: r1 + input B is refused with nothing run or entered; r1 + input A runs once', async () => {
    const w = await world();
    const r1 = requestId();
    const A = { to: 'first@example.invalid' };
    const B = { to: 'second@example.invalid' };
    const held = await holdCall(w, SEND, A, r1);
    await sayYes(w, held);

    const other = await callAction(w, SEND, B, r1);
    // Read the record before judging the answer: a run of B is the failure, whatever the call returned.
    expect(entered(await actionEventsFor(w, r1)), `input ${JSON.stringify(B)} sent with ${r1} after the yes for input ${JSON.stringify(A)} was entered in the record`).toBe(0);
    expect((await runs(w)).send_digest, `input ${JSON.stringify(B)} sent with ${r1} after the yes for input ${JSON.stringify(A)} ran the send`).toBe(0);
    expectRefused(other, `${SEND} with ${r1} and changed input ${JSON.stringify(B)}`, r1);
    expect(await actionEventsFor(w, r1), 'the refusal wrote no action event').toEqual([]);

    const again = await runAllowed(w, SEND, A, r1);
    expect(again.isError, `your yes still stands for the first call: ${r1} with input ${JSON.stringify(A)} runs: ${JSON.stringify(again.reply).slice(0, 800)}`).toBe(false);
    expect((await runs(w)).send_digest, `${r1} with input ${JSON.stringify(A)} runs once`).toBe(1);
    expect(entered(await actionEventsFor(w, r1)), 'one action.entered for the request').toBe(1);
  }, 400_000);
});

describe('AC2 #2072 After the same yes, the same request ID naming another change or send action is refused the same way', () => {
  it.each([
    ['a send held, a change called', SEND, { to: 'first@example.invalid' }, CHANGE, { symbol: 'TSLA', above: 300 }],
    ['a change held, a send called', CHANGE, { symbol: 'AMD', above: 100 }, SEND, { to: 'first@example.invalid' }],
  ] as const)('AC2 %s under r1: the other action is refused, nothing runs or is entered; the held action then runs once', async (_what, heldAction, heldInput, otherAction, otherInput) => {
    const w = await world();
    const r1 = requestId();
    const held = await holdCall(w, heldAction, heldInput, r1);
    await sayYes(w, held);

    const other = await callAction(w, otherAction, otherInput, r1);
    expect(entered(await actionEventsFor(w, r1)), `${otherAction} called with ${r1} after the yes for ${heldAction} was entered in the record`).toBe(0);
    expect(await runs(w), `${otherAction} called with ${r1} after the yes for ${heldAction} ran`).toEqual({ set_alert: 0, send_digest: 0 });
    expectRefused(other, `${otherAction} with ${r1}, after the yes for ${heldAction}`, r1);
    expect(await actionEventsFor(w, r1), 'the refusal wrote no action event').toEqual([]);

    const again = await runAllowed(w, heldAction, heldInput, r1);
    expect(again.isError, `your yes still stands for ${heldAction}: ${JSON.stringify(again.reply).slice(0, 800)}`).toBe(false);
    const after = await runs(w);
    expect(after.set_alert + after.send_digest, `${heldAction} with ${r1} runs once`).toBe(1);
  }, 400_000);
});

describe('AC3 #2072 An input longer than the question shows is marked as cut, with its length', () => {
  it('AC3 the ask for a 2,000-character input states that length', async () => {
    const w = await world();
    // The input's JSON text is exactly 2,000 characters: {"to":"…"} is 9 characters around a 1,991-character value.
    const input = { to: 'x'.repeat(1991) };
    expect(JSON.stringify(input).length).toBe(2000);
    const held = await holdCall(w, SEND, input, requestId());
    const shown = [held.question, ...(JSON.stringify(held.card ?? {}).match(/"[^"]*"/g) ?? [])].join(' ');
    expect(shown, `the ask shows the input's first part: ${held.question.slice(0, 200)}`).toContain('xxxxxxxxxx');
    expect(shown, `the ask for a 2000-character input never states its length, so it reads as the whole input: ...${held.question.slice(-200)}`).toMatch(/(?<![\w,.])2,?000(?!\w|,\d)/);
    expect(held.question.includes('x'.repeat(1991)), 'the whole input is not what the question shows').toBe(false);
  }, 240_000);
});
