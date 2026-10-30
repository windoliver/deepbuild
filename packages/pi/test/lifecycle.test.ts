// What the blind suite leaves open, on real pi with the real package and hub: only the model is scripted. Without
// DEEP_PI_CLI (pi's dist/cli.js) these don't run; the #40 suite, which blocks on it, stands for the package then.
import { mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
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

  it('an answer delivered as a turn is recorded as a continuation, not the person\'s words', async () => {
    const question = `Which ${word()} bay?`;
    const w = await openWorld({ steps: [askStep(question, 'Wide'), { text: 'ok' }] });
    const handle = await pendingAsk(w, question);
    await answer(w, handle);
    await w.pi.until('agent_settled', 2, 30_000);
    await sleep(1000);
    const client = await Client.open(w.hub);
    const asked = (await client.events()).filter((e) => e.kind === 'user.ask' && String(e.data?.text).includes('Wide'));
    expect(asked.map((e) => e.data.from)).toEqual(['continuation']);
  }, 150_000);

  it('two answers that come during a compaction wait it out, and go as one turn', async () => {
    const [q1, q2] = [`Which ${word()} pond?`, `Which ${word()} pond?`];
    const [l1, l2] = [`Pond ${word()}`, `Pond ${word()}`];
    const w = await openWorld({ steps: [{ text: 'read' }, { text: 'read' }, { tools: [...askStep(q1, l1).tools!, ...askStep(q2, l2).tools!] }, { holdMs: 10_000, text: 'summary' }, { text: 'ok' }, { text: 'ok' }] });
    // A turn for pi to compact, and enough after it for pi to keep.
    await w.pi.call({ type: 'prompt', message: 'Start.' });
    await w.pi.until('agent_settled', 1, 30_000);
    await w.pi.call({ type: 'prompt', message: 'x '.repeat(100_000) });
    await w.pi.until('agent_settled', 2, 30_000);
    // Both raised in one run: a prompt of the person's own would itself answer an open ask.
    await w.pi.call({ type: 'prompt', message: 'Ask both.' });
    const [h1, h2] = (await Promise.all([askCreated(w, q1), askCreated(w, q2)])).map((created) => `ask:${String(created.id)}`);
    await w.pi.call({ type: 'abort' });
    await w.pi.until('agent_settled', 3, 30_000);
    void w.pi.call({ type: 'compact' }).catch(() => undefined);
    await sleep(500);
    await answer(w, h1!);
    await answer(w, h2!);
    expect(w.pi.count('agent_start'), 'nothing starts during the compaction').toBe(3);
    await w.pi.until('agent_settled', 4, 60_000);
    await sleep(1000);
    expect((await outcomesOf(w, h1!)).map((e) => e.data.outcome)).toEqual(['delivered']);
    expect((await outcomesOf(w, h2!)).map((e) => e.data.outcome)).toEqual(['delivered']);
    expect(w.pi.count('agent_start')).toBe(4);
    expect(w.pi.userMessagesWith(l1)).toHaveLength(1);
    expect(w.pi.userMessagesWith(l2)).toHaveLength(1);
  }, 180_000);

  it('a replaced session\'s answer is refused by a hub restarted since', async () => {
    const question = `Which ${word()} moor?`;
    const w = await openWorld({ steps: [askStep(question, 'Dry'), { text: 'ok' }] });
    const handle = await pendingAsk(w, question);
    await w.pi.call({ type: 'new_session' });
    await sleep(1000);
    process.kill(w.hub.pid);
    await sleep(1000);
    const hub = await startHub(w.home);
    const client = await Client.open(hub);
    await sleep(4000);
    const done = await run(NODE, [CLI, 'inbox', 'answer', handle, 'first'], { env: childEnv(w.home), timeoutMs: 30_000 });
    expect(done.code, done.stderr).toBe(0);
    const outcome = await waitFor(async () => (await client.events()).find((e) => e.kind === 'delivery.outcome' && e.data?.delivery === handle), 30_000, 'the refusal');
    expect(outcome.data.outcome).toBe('replaced');
    process.kill(hub.pid);
  }, 240_000);

  it('a stop the hub holds past 15 s still gets its send-back', async () => {
    const tmp = tempDir();
    const [home, cwd] = [join(tmp, 'h'), join(tmp, 'w')];
    mkdirSync(join(home, '.deepbuild'), { recursive: true });
    mkdirSync(cwd);
    // Only what a slow check looks like from the package: the acknowledgement, then the reply much later.
    const server = net.createServer((sock) => {
      sock.on('error', () => undefined);
      sock.write('{"v":1,"hub":true}\n');
      let buffer = '';
      sock.setEncoding('utf8').on('data', (chunk: string) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const m = JSON.parse(buffer.slice(0, i)) as { hello?: string; event?: string; id?: string };
          buffer = buffer.slice(i + 1);
          if (m.hello) sock.write('{"v":1,"role":"mcp"}\n');
          else if (m.event) {
            sock.write('{"v":1,"ack":true}\n');
            const block = m.event === 'agent_before_settle' && !sent;
            if (block) sent = true;
            setTimeout(() => { if (!sock.destroyed) sock.write(`${JSON.stringify({ v: 1, exit: 0, stderr: '', stdout: block ? '{"decision":"block","reason":"Check failed: again."}' : '' })}\n`); }, block ? 17_000 : 0);
          } else setTimeout(() => { if (!sock.destroyed) sock.write(`${JSON.stringify({ v: 1, id: m.id, error: {} })}\n`); }, 1000);
        }
      });
    });
    let sent = false;
    await new Promise<void>((done) => server.listen(join(home, '.deepbuild', 'hub.sock'), done));
    const pi = await Pi.start(home, cwd, { steps: [{ text: 'first' }, { text: 'second' }] });
    await pi.call({ type: 'prompt', message: 'go' });
    await pi.until('agent_settled', 1, 60_000);
    expect(pi.requests(), 'the send-back continued the run').toHaveLength(2);
    await pi.stop();
    server.close();
    rmSync(join(home, '.deepbuild', 'hub.sock'), { force: true });
  }, 120_000);

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
