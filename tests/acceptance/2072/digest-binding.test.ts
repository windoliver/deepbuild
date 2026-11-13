// #2072, scope: a held call's ask is kept with the digest of what was asked, "the action, its plug-in and version, and
// the whole input", and a later call with that request ID runs only when its digest equals the one the ask was raised
// for. Any other is refused before anything runs or is written, naming the request ID, and the yes still stands for the
// first call alone.
//
// Two bindings the issue's numbered tests may not tell apart, both through a real hub and the agent's `deep-actions`:
//  1. the WHOLE input: A and B have the same first 500 characters (all the question shows) and the same length, and
//     differ only past that preview. Only A is approved.
//  2. the plug-in VERSION: the same action name, request ID and input offered by another version of the plug-in after
//     the yes, switched the way a person does, by `deep install` of the other version (which loads it at once).
// A refusal here is an error result naming the request ID, with no `action.entered` for it and no handler run. The
// approved call alone keeps its yes: it runs once afterwards.
//
// Reuses #363's real-hub tools and its `stocks` test plug-in (send-digest is a send; `runs` counts handler runs). The
// yes is given as a person gives it, `deep inbox answer <ask> approve`, the OS confirmation stubbed by the hub's own
// test file as #363's installs are.
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI, eventMatching, hubWorld, NODE, REPO, type HubWorld, type Line, type Outcome } from '../363/hub.ts';
import { pkg, requestId, sleep } from '../363/helpers.ts';

const SEND = 'ext.stocks.send_digest';

/** A `deep` command from the person's terminal against this world's hub (as #363's hub tools run `deep install`). */
function deep(w: HubWorld, args: string[]): Promise<{ code: number; out: string }> {
  const home = w.hub.home;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('TMUX') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  return new Promise((resolve) => {
    execFile(NODE, [CLI, ...args], { cwd: REPO, env, timeout: 120_000 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
      resolve({ code, out: `${stdout}${stderr}` });
    });
  });
}

const call = (w: HubWorld, action: string, request: string, inputText: string): Promise<Outcome> =>
  w.agent.callTool('deep-actions', 'call_action', { action, request, input: inputText }, 60_000);

const entered = async (w: HubWorld, request: string): Promise<Line[]> =>
  (await w.events()).filter((e) => e.kind === 'action.entered' && e.data?.request === request);
const asksRaised = async (w: HubWorld): Promise<number> =>
  (await w.events()).filter((e) => e.kind === 'ask.created' && e.session === w.session.id).length;
/** How many times send-digest ran in the plug-in's current load, through its `runs` read. */
const sendRuns = async (w: HubWorld): Promise<number> => {
  const o = await w.agent.callTool('deep-actions', 'call_action', { action: 'ext.stocks.runs', request: requestId(), input: '{}' }, 60_000);
  expect(o.isError, `runs, a read, must succeed: ${JSON.stringify(o.reply).slice(0, 800)}`).toBe(false);
  return o.value?.output?.send_digest as number;
};

/** The send held behind its ask, then your yes to that ask; returns the ask. */
async function heldThenYes(w: HubWorld, request: string, inputText: string): Promise<string> {
  await w.agent.initialize('deep-actions');
  const first = await call(w, SEND, request, inputText);
  expect(first.isError, `a send is held, not an error: ${JSON.stringify(first.reply).slice(0, 800)}`).toBe(false);
  expect(first.value?.status, `the send is held behind an ask: ${JSON.stringify(first.value)}`).toBe('held');
  const ask = first.value.ask as string;
  const said = await deep(w, ['inbox', 'answer', ask, 'approve']);
  if (said.code !== 0) throw Error(`BLOCKED: \`deep inbox answer ${ask} approve\` exited ${said.code}: ${said.out.slice(0, 1500)}`);
  const answered = await eventMatching(w, (e) => e.kind === 'ask.answered' && e.subject === ask);
  if (!answered) throw Error(`BLOCKED: the hub recorded no ask.answered for ${ask} after the yes`);
  return ask;
}

/** The refusal: an error result naming the request ID; nothing ran, nothing entered, no new ask. */
async function expectRefused(w: HubWorld, o: Outcome, request: string, asksBefore: number, what: string): Promise<void> {
  expect(o.isError, `${what} must be refused, not held, done or run: ${JSON.stringify(o.reply).slice(0, 1200)}`).toBe(true);
  expect(JSON.stringify(o.reply), `${what}: the refusal names the request ID ${request}`).toContain(request);
  await sleep(500);
  expect((await entered(w, request)).length, `${what}: no action.entered is written for it`).toBe(0);
  expect(await sendRuns(w), `${what}: the handler didn't run`).toBe(0);
  expect(await asksRaised(w), `${what}: refused, not asked again: your yes still stands`).toBe(asksBefore);
}

// A and B: the same first 500 characters of their JSON, the same length, different only past the preview.
const FILL = 'x'.repeat(1500);
const A = { to: `${FILL}A` };
const B = { to: `${FILL}B` };

describe('#2072 scope: the ask is kept with the digest of the action, its plug-in and version, and the whole input', () => {
  it('the whole input: B, equal to A in its first 500 characters and in length, is refused after A\'s yes, and A alone then runs once', async () => {
    const textA = JSON.stringify(A);
    const textB = JSON.stringify(B);
    expect(textB.length, 'B is as long as A').toBe(textA.length);
    expect(textB.slice(0, 500), 'B shows what A shows in the question\'s 500 characters').toBe(textA.slice(0, 500));
    expect(textB, 'B differs from A').not.toBe(textA);

    const w = await hubWorld([await pkg('stocks')]);
    const request = requestId();
    await heldThenYes(w, request, textA);
    const asks = await asksRaised(w);

    await expectRefused(w, await call(w, SEND, request, textB), request, asks, `B (the same ${SEND} and request ID, input differing past the 500-character preview)`);

    const ran = await call(w, SEND, request, textA);
    expect(ran.isError, `A, the call approved, runs: ${JSON.stringify(ran.reply).slice(0, 1200)}`).toBe(false);
    expect(ran.value?.status, `A runs: ${JSON.stringify(ran.value).slice(0, 800)}`).toBe('done');
    expect((await entered(w, request)).length, 'A entered once').toBe(1);
    expect(await sendRuns(w), 'the handler ran once, for A').toBe(1);
  }, 300_000);

  it('positive control: the same input as A in other JSON formatting is A, so it runs once and enters no second call', async () => {
    const w = await hubWorld([await pkg('stocks')]);
    const request = requestId();
    await heldThenYes(w, request, JSON.stringify(A));
    const asks = await asksRaised(w);

    const reformatted = await call(w, SEND, request, JSON.stringify(A, null, 2));
    expect(reformatted.isError, `the same input in other formatting is the approved call, not a refusal: ${JSON.stringify(reformatted.reply).slice(0, 1200)}`).toBe(false);
    expect(reformatted.value?.status, `it runs: ${JSON.stringify(reformatted.value).slice(0, 800)}`).toBe('done');
    expect((await entered(w, request)).length, 'one call entered').toBe(1);
    expect(await sendRuns(w), 'the handler ran once').toBe(1);
    expect(await asksRaised(w), 'no new ask').toBe(asks);
  }, 300_000);

  it('the plug-in version: the same action, request ID and input from another version is refused after the yes at the first, which alone then runs once', async () => {
    const w = await hubWorld([await pkg('stocks')]);
    const request = requestId();
    const text = JSON.stringify({ to: 'you@example.invalid' });
    await heldThenYes(w, request, text);
    const asks = await asksRaised(w);

    // Another version of the same plug-in, installed and loaded the way a person does (`deep install`, which loads it).
    const up = await deep(w, ['install', await pkg('stocks', { manifest: { version: '2.0.0' } })]);
    if (up.code !== 0) throw Error(`BLOCKED: \`deep install\` of stocks 2.0.0 exited ${up.code}: ${up.out.slice(0, 1500)}`);

    await expectRefused(w, await call(w, SEND, request, text), request, asks, 'the same call offered by stocks 2.0.0 (approved at 1.0.0)');

    // Back at the version asked about, the one approved call keeps its yes.
    const back = await deep(w, ['install', await pkg('stocks')]);
    if (back.code !== 0) throw Error(`BLOCKED: \`deep install\` of stocks 1.0.0 again exited ${back.code}: ${back.out.slice(0, 1500)}`);
    const ran = await call(w, SEND, request, text);
    expect(ran.isError, `at 1.0.0 the approved call runs: ${JSON.stringify(ran.reply).slice(0, 1200)}`).toBe(false);
    expect(ran.value?.status, `it runs: ${JSON.stringify(ran.value).slice(0, 800)}`).toBe('done');
    expect((await entered(w, request)).length, 'it entered once').toBe(1);
    expect(await sendRuns(w), 'the handler ran once, at 1.0.0').toBe(1);
  }, 400_000);
});
