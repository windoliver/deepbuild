// What the blind suite leaves open, on real pi with the real package and hub: only the model is scripted. Without
// DEEP_PI_CLI (pi's dist/cli.js) these don't run; the #40 suite, which blocks on it, stands for the package then.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLI, Client, NODE, Pi, answer, askCreated, askStep, childEnv, cleanup, openWorld, outcomesOf, pendingAsk, run, sleep, startHub, tempDir, waitFor, word } from '../../../tests/acceptance/40/helpers.ts';

afterEach(cleanup, 60_000);

describe.skipIf(!process.env.DEEP_PI_CLI)('the pi package', () => {
  it('runs with no hub, and adds no wait', async () => {
    const tmp = tempDir();
    const [home, cwd] = [join(tmp, 'h'), join(tmp, 'w')];
    mkdirSync(home);
    mkdirSync(cwd);
    const pi = await Pi.start(home, cwd, { steps: [{ tools: [{ name: 'read', arguments: { path: 'none' } }] }, { text: 'ok' }] });
    const t0 = Date.now();
    await pi.call({ type: 'prompt', message: 'go' });
    await pi.until('agent_settled', 1, 60_000);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(pi.events.filter((e) => e.type === 'extension_error')).toEqual([]);
    await pi.stop();
  }, 120_000);

  it('a running deep_ask answered in time returns the answer, with one outcome and no second message', async () => {
    const question = `Which ${word()} road?`;
    const w = await openWorld({ steps: [askStep(question, 'North'), { text: 'Going north.' }] });
    await w.pi.call({ type: 'prompt', message: 'Ask.' });
    const created = await askCreated(w, question);
    const handle = `ask:${String(created.id)}`;
    await answer(w, handle);
    await w.pi.until('agent_settled', 1, 60_000);
    await sleep(1500);
    expect((await outcomesOf(w, handle)).map((e) => e.data.outcome)).toEqual(['delivered']);
    expect(w.pi.userMessagesWith('North'), 'the call carried it').toEqual([]);
    expect(w.pi.count('agent_start')).toBe(1);
  }, 150_000);

  it('the answer goes only to the session that asked, of two in one folder', async () => {
    const question = `Which ${word()} tree?`;
    const w = await openWorld({ steps: [askStep(question, 'Oak')] });
    const other = await Pi.start(w.home, w.cwd, { steps: [{ text: 'other' }] });
    const handle = await pendingAsk(w, question);
    await answer(w, handle);
    await w.pi.until('agent_settled', 2, 30_000);
    await sleep(1000);
    expect(other.count('agent_start')).toBe(0);
    expect(w.pi.userMessagesWith('Oak')).toHaveLength(1);
    await other.stop();
  }, 180_000);

  it('a hub restarted while pi is idle still reaches it with the answer', async () => {
    const question = `Which ${word()} lake?`;
    const w = await openWorld({ steps: [askStep(question, 'Blue'), { text: 'ok' }] });
    const handle = await pendingAsk(w, question);
    process.kill(w.hub.pid);
    await sleep(1000);
    const hub = await startHub(w.home);
    const client = await Client.open(hub);
    // Bound again, by what the package says on its own: no prompt, no hook of a run.
    await sleep(4000);
    const done = await run(NODE, [CLI, 'inbox', 'answer', handle, 'first'], { env: childEnv(w.home), timeoutMs: 30_000 });
    expect(done.code, done.stderr).toBe(0);
    const outcome = await waitFor(async () => (await client.events()).find((e) => e.kind === 'delivery.outcome' && e.data?.delivery === handle), 30_000, 'the answer\'s outcome after the restart');
    expect(outcome.data.outcome).toBe('delivered');
    await w.pi.until('agent_settled', 2, 30_000);
    expect(w.pi.userMessagesWith('Blue')).toHaveLength(1);
    process.kill(hub.pid);
  }, 240_000);

  it('a session replaced and then resumed takes its answer', async () => {
    const question = `Which ${word()} hill?`;
    const w = await openWorld({ steps: [askStep(question, 'Tall'), { text: 'ok' }] });
    const handle = await pendingAsk(w, question);
    const old = w.pi.session;
    const { data } = await w.pi.call({ type: 'get_state' });
    await w.pi.call({ type: 'new_session' });
    await sleep(500);
    await w.pi.call({ type: 'switch_session', sessionPath: String(data.sessionFile) });
    await sleep(1000);
    expect((await w.pi.call({ type: 'get_state' })).data.sessionId).toBe(old);
    await answer(w, handle);
    const outcome = await waitFor(async () => (await outcomesOf(w, handle))[0], 15_000, 'the outcome');
    expect(outcome.data.outcome).toBe('delivered');
  }, 180_000);

  it('an answer steered in and cleared from pi\'s queue goes again as a turn, reported only once it landed', async () => {
    const question = `Which ${word()} gate?`;
    const label = `Gate ${word()}`;
    const w = await openWorld({ steps: [askStep(question, label), { tools: [{ name: 'bash', arguments: { command: 'sleep 4' } }] }, { text: 'ok' }, { text: 'ok' }] });
    const handle = await pendingAsk(w, question);
    await w.pi.call({ type: 'prompt', message: 'Work.' });
    await w.pi.until('tool_execution_start', 2, 15_000);
    await answer(w, handle);
    await sleep(1000);
    expect(await outcomesOf(w, handle), 'queued is not delivered').toEqual([]);
    await w.pi.call({ type: 'clear_queue' });
    await w.pi.until('agent_settled', 3, 30_000);
    await sleep(1000);
    expect((await outcomesOf(w, handle)).map((e) => e.data.outcome)).toEqual(['delivered']);
    expect(w.pi.userMessagesWith(label)).toHaveLength(1);
  }, 180_000);
});
