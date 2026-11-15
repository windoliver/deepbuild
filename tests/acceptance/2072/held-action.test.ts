// #2072: a held plug-in change or send is held for the exact call that was asked about. Your yes to the ask for one call
// (the action, its plug-in and version, and the whole input, under one request ID) is spent by that call alone.
//
// Through a real hub, the test plug-ins of #363 installed with `deep install`, and an agent stand-in's own `deep-actions`
// server (call_action, with the request ID the issue names). The yes is given as a person gives it, `deep inbox answer`.
// What ran is read from the record (`action.entered`, the plug-in's store events) and from the plug-in's own `runs` read.
import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { hubWorld, CLI, NODE, REPO, type HubWorld, type Line, type Outcome } from '../363/hub.ts';
import { ALERT, pkg, requestId, sleep } from '../363/helpers.ts';

const callAction = (w: HubWorld, action: string, request: string, input: unknown): Promise<Outcome> =>
  w.agent.callTool('deep-actions', 'call_action', { action, request, input: JSON.stringify(input) }, 60_000);

/** `deep inbox answer <ask> approve`, the person's yes; the hub's OS confirmation is its test stand-in. */
function sayYes(w: HubWorld, ask: string): Promise<void> {
  const env = { HOME: w.hub.home, XDG_CONFIG_HOME: `${w.hub.home}/.config`, PATH: `${NODE.replace(/\/[^/]*$/, '')}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' };
  return new Promise((resolve, reject) => {
    execFile(NODE, [CLI, 'inbox', 'answer', ask, 'approve'], { cwd: REPO, env, timeout: 120_000 }, (error, stdout, stderr) =>
      error ? reject(Error(`BLOCKED: deep inbox answer ${ask} approve failed: ${error.message} ${stdout}${stderr}`)) : resolve());
  });
}

const enteredFor = (all: Line[], request: string): Line[] => all.filter((e) => e.kind === 'action.entered' && e.data?.request === request);
const asksOf = (all: Line[], w: HubWorld): Line[] => all.filter((e) => e.kind === 'ask.created' && e.session === w.session.id);

/** The plug-in's own count of its handlers that ran, a read, which asks nothing. */
async function ran(w: HubWorld): Promise<{ set_alert: number; send_digest: number }> {
  const o = await callAction(w, 'ext.stocks.runs', requestId(), {});
  expect(o.isError, `the runs read must succeed: ${JSON.stringify(o.reply).slice(0, 800)}`).toBe(false);
  return o.value.output;
}

/** Holds `action` under a fresh request ID, answers its ask yes, and returns the request ID. */
async function heldAndApproved(w: HubWorld, action: string, input: unknown): Promise<string> {
  const request = requestId();
  const held = await callAction(w, action, request, input);
  expect(held.isError, `${action} must come back held, not fail: ${JSON.stringify(held.reply).slice(0, 800)}`).toBe(false);
  expect(held.value?.status, `${action} is held behind an ask: ${JSON.stringify(held.value)}`).toBe('held');
  expect(await ran(w), 'nothing ran while the ask is open').toEqual({ set_alert: 0, send_digest: 0 });
  await sayYes(w, String(held.value.ask));
  return request;
}

describe('#2072 AC1 A send held under r1 with input A, answered yes: r1 with input B is refused and A alone runs', () => {
  it('AC1 r1 with input B is refused naming r1, nothing runs and no action.entered is written; r1 with input A then runs once', async () => {
    const w = await hubWorld([await pkg('stocks')]);
    await w.agent.initialize('deep-actions');
    const A = { to: 'a@example.invalid' };
    const B = { to: 'b@example.invalid' };
    const request = await heldAndApproved(w, 'ext.stocks.send_digest', A);

    const before = (await w.events()).length;
    const other = await callAction(w, 'ext.stocks.send_digest', request, B);
    await sleep(500);
    const all = await w.events();
    const entered = enteredFor(all, request);
    const fate = `the call with r1 and input B ${JSON.stringify(B)} answered ${JSON.stringify(other.reply).slice(0, 600)}; action.entered for r1: ${JSON.stringify(entered.map((e) => e.data?.input))}`;
    expect.soft(other.isError, `the call with r1 and another input is refused, but it ran: ${fate}`).toBe(true);
    expect.soft(JSON.stringify(other.reply), `the refusal names the request ID ${request}: ${fate}`).toContain(request);
    expect.soft(entered.filter((e) => JSON.stringify(e.data?.input) === JSON.stringify(B)), `input B ran under r1 on the strength of the yes for input A: ${fate}`).toEqual([]);
    expect.soft(entered, `a refused call writes no action.entered: ${fate}`).toEqual([]);
    expect.soft(all.length, `a refused call writes nothing to the record: ${fate}`).toBe(before);
    expect.soft((await ran(w)).send_digest, `nothing ran for input B: ${fate}`).toBe(0);

    // Your yes still stands for the first call alone: A runs, once, with no second ask.
    const first = await callAction(w, 'ext.stocks.send_digest', request, A);
    expect.soft(first.isError, `the call with r1 and input A runs on the yes: ${JSON.stringify(first.reply).slice(0, 600)}`).toBe(false);
    expect.soft(first.value?.status, `the call with r1 and input A is done: ${JSON.stringify(first.value)}`).toBe('done');
    const after = await w.events();
    expect.soft(enteredFor(after, request).map((e) => e.data?.input), 'input A ran once under r1, and only A').toEqual([A]);
    expect.soft((await ran(w)).send_digest, 'the send ran once').toBe(1);
    expect.soft(asksOf(after, w).length, 'the refusal raised no second ask; the one yes stands').toBe(1);
  }, 360_000);
});

describe('#2072 AC2 A send held under r1, answered yes: r1 naming another change or send action is refused', () => {
  it('AC2 a held send, then r1 naming a change action: refused naming r1, the change does not run', async () => {
    const w = await hubWorld([await pkg('stocks')]);
    await w.agent.initialize('deep-actions');
    const request = await heldAndApproved(w, 'ext.stocks.send_digest', { to: 'a@example.invalid' });

    const before = (await w.events()).length;
    const other = await callAction(w, 'ext.stocks.set_alert', request, { symbol: 'NVDA', above: 200 });
    await sleep(500);
    const all = await w.events();
    const fate = `the call with r1 naming ext.stocks.set_alert answered ${JSON.stringify(other.reply).slice(0, 600)}; action.entered for r1: ${JSON.stringify(enteredFor(all, request).map((e) => e.data?.action))}`;
    expect.soft(other.isError, `a call with r1 that names another action is refused, but it ran: ${fate}`).toBe(true);
    expect.soft(JSON.stringify(other.reply), `the refusal names the request ID ${request}: ${fate}`).toContain(request);
    expect.soft(enteredFor(all, request).filter((e) => e.data?.action === 'ext.stocks.set_alert'), `ext.stocks.set_alert ran under r1 on the yes for ext.stocks.send_digest: ${fate}`).toEqual([]);
    expect.soft(enteredFor(all, request), `a refused call writes no action.entered: ${fate}`).toEqual([]);
    expect.soft(all.filter((e) => e.kind === ALERT), `the change wrote no store item: ${fate}`).toEqual([]);
    expect.soft(all.length, `a refused call writes nothing to the record: ${fate}`).toBe(before);
    expect.soft((await ran(w)).set_alert, `the change's handler did not run: ${fate}`).toBe(0);

    // The yes still stands for the send alone.
    const first = await callAction(w, 'ext.stocks.send_digest', request, { to: 'a@example.invalid' });
    expect.soft(first.value?.status, `the held send then runs on its yes: ${JSON.stringify(first.reply).slice(0, 600)}`).toBe('done');
    expect.soft(await ran(w), 'the send ran once and the change never').toEqual({ set_alert: 0, send_digest: 1 });
  }, 360_000);

  it('AC2 a held change, then r1 naming a send action: refused naming r1, the send does not run', async () => {
    const w = await hubWorld([await pkg('stocks')]);
    await w.agent.initialize('deep-actions');
    const request = await heldAndApproved(w, 'ext.stocks.set_alert', { symbol: 'NVDA', above: 200 });

    const before = (await w.events()).length;
    const other = await callAction(w, 'ext.stocks.send_digest', request, { to: 'a@example.invalid' });
    await sleep(500);
    const all = await w.events();
    const fate = `the call with r1 naming ext.stocks.send_digest answered ${JSON.stringify(other.reply).slice(0, 600)}; action.entered for r1: ${JSON.stringify(enteredFor(all, request).map((e) => e.data?.action))}`;
    expect.soft(other.isError, `a call with r1 that names another action is refused, but it ran: ${fate}`).toBe(true);
    expect.soft(JSON.stringify(other.reply), `the refusal names the request ID ${request}: ${fate}`).toContain(request);
    expect.soft(enteredFor(all, request), `a refused call writes no action.entered: ${fate}`).toEqual([]);
    expect.soft(all.length, `a refused call writes nothing to the record: ${fate}`).toBe(before);
    expect.soft((await ran(w)).send_digest, `the send's handler did not run: ${fate}`).toBe(0);
  }, 360_000);
});

describe('#2072 AC3 An input longer than the question shows is marked as cut, with its length', () => {
  it('AC3 an input of 2,000 characters shows on the ask as cut, with its length', async () => {
    const w = await hubWorld([await pkg('stocks')]);
    await w.agent.initialize('deep-actions');
    // The input's JSON text is exactly 2,000 characters: {"to":"…"} is 9 characters around the value.
    const head = 'HEADOFINPUT';
    const tail = 'TAILOFINPUT';
    const input = { to: head + 'x'.repeat(2000 - 9 - head.length - tail.length) + tail };
    expect(JSON.stringify(input).length, 'the input is 2,000 characters').toBe(2000);
    const held = await callAction(w, 'ext.stocks.send_digest', requestId(), input);
    expect(held.value?.status, `the send is held: ${JSON.stringify(held.reply).slice(0, 600)}`).toBe('held');
    const created = asksOf(await w.events(), w).find((e) => `ask:${e.id}` === held.value.ask);
    expect(created, `the ask ${held.value.ask} is on the record`).toBeDefined();
    const question = String(created!.data?.question);
    expect(question, `the ask names the action: ${question}`).toContain('ext.stocks.send_digest');
    expect(question, `the ask still shows the start of the input: ${question}`).toContain(head);
    expect(question, `the ask does not show the whole input: ${question}`).not.toContain(tail);
    expect(question, `the ask gives the input's length, 2,000: ${question}`).toMatch(/2,?000/);
    expect(question, `the ask says the input is cut: ${question}`).toMatch(/cut|truncat|shorten|abridg|first \d+ of|…|\.\.\./i);
  }, 240_000);
});
