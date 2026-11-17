// #2068 regression: an off-chain issue read must not reorder its own session or deadlock a prompt's late transcript.
// Real hook protocol, record and work source; only the external forge is planted by the acceptance fixture.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { openAs, ulid } from '../../../tests/acceptance/16/helpers.js';
import { forge, prompt, taskFor, until, world, type World } from '../../../tests/acceptance/2068/helpers.js';

it('records an issue prompt before a later tool event of the same session while other sessions remain independent', async () => {
  const f = await forge('five-seconds');
  let w: World | undefined;
  try {
    w = await world(f);
    const session = await w.startSession();
    await w.rpc('rows.read');
    const tool = await w.prepare(session, 'PostToolUse', {
      tool_name: 'Read', tool_use_id: 'same-session-read', tool_input: { file_path: join(session.cwd, 'fixture.txt') },
      tool_response: { type: 'text', file: { content: 'fixture', numLines: 1 } },
    });
    const asked = (await w.typed(session, prompt())).send();
    await until(() => f.requests.length > 0, 10_000);
    expect(f.requests.length, 'the issue read started').toBeGreaterThan(0);
    const after = tool.send();
    await until(() => w!.events.some((e) => e.id === asked.id) && w!.events.some((e) => e.id === after.id), 10_000);
    const order = w.events.filter((e) => e.id === asked.id || e.id === after.id).map((e) => e.id);
    expect(order, 'a later hook must not overtake its own issue prompt and change its task/turn').toEqual([asked.id, after.id]);
    expect(taskFor(w, session), 'the prompt still opens its fallback task').toBeDefined();
  } finally { await w?.stop(); await f.close(); }
}, 60_000);

it('does not read the forge again for a spooled copy of a prompt whose live read is still pending', async () => {
  const f = await forge('five-seconds');
  let w: World | undefined;
  try {
    w = await world(f);
    const a = await w.startSession(), b = await w.startSession();
    await w.rpc('rows.read');
    const asking = await w.typed(a, prompt());
    const send = asking.conn.send.bind(asking.conn);
    let wire = '';
    asking.conn.send = (line) => { wire = JSON.stringify(line); return send(line); };
    const sent = asking.send();
    await until(() => f.requests.length > 0, 10_000);
    const spool = resolve(dirname(a.transcript), '../../../.deepbuild/spool');
    mkdirSync(spool, { recursive: true });
    writeFileSync(join(spool, 'spool.jsonl'), `${wire}\n`);
    const later = (await w.prepare(b, 'PostToolUse', { tool_name: 'Read', tool_use_id: 'replay-other',
      tool_input: { file_path: join(b.cwd, 'fixture.txt') }, tool_response: { content: 'fixture' } })).send();
    await until(() => w!.events.some((e) => e.id === later.id), 10_000);
    expect(w.events.some((e) => e.id === later.id), 'the hook triggering replay settles').toBe(true);
    expect(w.events.filter((e) => e.id === sent.id), 'live and spool retain one event identity').toHaveLength(1);
    expect(f.requests, 'a duplicate of an in-flight prompt must join its read, not start another forge wait').toHaveLength(1);
  } finally { await w?.stop(); await f.close(); }
}, 60_000);

it('records a prompt whose spooled copy starts replay before its live read joins intake', async () => {
  const f = await forge('instant');
  let w: World | undefined;
  try {
    w = await world(f);
    const session = await w.startSession();
    const asking = await w.typed(session, prompt());
    const send = asking.conn.send.bind(asking.conn);
    const spool = resolve(dirname(session.transcript), '../../../.deepbuild/spool');
    mkdirSync(spool, { recursive: true });
    asking.conn.send = (line) => { writeFileSync(join(spool, 'spool.jsonl'), `${JSON.stringify(line)}\n`); return send(line); };
    const sent = asking.send();
    await until(() => w!.events.some((e) => e.id === sent.id), 5000);
    expect(w.events.filter((e) => e.id === sent.id), 'replay and live copies must not wait on each other before recording the prompt').toHaveLength(1);
    await until(() => Boolean(taskFor(w!, session)), 5000);
    expect(taskFor(w, session), 'the once-recorded prompt opens its task').toBeDefined();
  } finally { await w?.stop(); await f.close(); }
}, 60_000);

it('processes a fresh hook normally after the spool it triggers, including queued words', async () => {
  const f = await forge('instant');
  let w: World | undefined;
  try {
    w = await world(f);
    const session = await w.startSession();
    const text = 'Also reject empty tokens.';
    appendFileSync(session.transcript, `${JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date().toISOString(), sessionId: session.id, content: text })}\n`);
    const after = await w.prepare(session, 'PostToolUse', { tool_name: 'Read', tool_use_id: 'fresh-after-spool', tool_input: { file_path: join(session.cwd, 'fixture.txt') }, tool_response: { content: 'fixture' } });
    const send = after.conn.send.bind(after.conn);
    const spool = resolve(dirname(session.transcript), '../../../.deepbuild/spool');
    mkdirSync(spool, { recursive: true });
    after.conn.send = (line) => { writeFileSync(join(spool, 'spool.jsonl'), `${JSON.stringify({ ...(line as object), id: ulid(Date.now() - 1000) })}\n`); return send(line); };
    const sent = after.send();
    await until(() => w!.events.some((e) => e.id === sent.id), 5000);
    expect(w.events.some((e) => e.id === sent.id), 'the fresh hook is recorded').toBe(true);
    await until(() => w!.events.some((e) => e.kind === 'user.ask' && e.data.text === text), 5000);
    expect(w.events.find((e) => e.kind === 'user.ask' && e.data.text === text)?.data.from, 'a live hook following replay still harvests queued words').toBe('person');
  } finally { await w?.stop(); await f.close(); }
}, 60_000);

it('retains criteria when GitHub returns a canonical HTTPS link for an HTTP prompt link', async () => {
  const f = await forge('instant');
  let w: World | undefined;
  try {
    w = await world(f);
    const session = await w.startSession();
    const sent = (await w.typed(session, prompt().replace('https:', 'http:'))).send();
    await until(() => w!.events.some((e) => e.kind === 'definition.locked' && e.session === session.id), 5000);
    expect(w.events.some((e) => e.id === sent.id), 'the HTTP issue prompt is recorded').toBe(true);
    expect(w.events.find((e) => e.kind === 'definition.locked' && e.session === session.id), 'canonical response URLs must not discard prepared criteria').toBeDefined();
  } finally { await w?.stop(); await f.close(); }
}, 60_000);

it('keeps issue criteria when an authenticated app note is carried by the prompt', async () => {
  const f = await forge('instant');
  let w: World | undefined;
  let app: Awaited<ReturnType<typeof openAs>> | undefined;
  try {
    w = await world(f);
    const session = await w.startSession();
    const root = resolve(dirname(session.transcript), '../../../.deepbuild');
    app = await openAs(join(root, 'hub.sock'), 'app', readFileSync(join(root, 'control.token'), 'utf8').trim());
    (await w.prepare(session, 'Stop', { last_assistant_message: 'Ready.' })).send();
    await until(() => w!.events.some((e) => e.kind === 'agent.stop' && e.session === session.id), 5000);
    const waiting = w.rpc('session.wait', { session: session.id, cwd: session.cwd, since: Date.now() });
    const request = randomUUID();
    const note = await app.call('session.note', { session: session.id, text: prompt(), request });
    expect(note.error, 'app note is accepted through its real role').toBeUndefined();
    const wake = await waiting;
    expect(wake.text, 'the waiter carries the app note').toContain(request);
    const sent = (await w.typed(session, String(wake.text))).send();
    await until(() => w!.events.some((e) => e.id === sent.id), 5000);
    expect(w.events.find((e) => e.id === sent.id)?.data.from, 'request binding places the words as app-origin').toBe('app');
    await until(() => w!.events.some((e) => e.kind === 'definition.locked' && e.session === session.id), 5000);
    expect(w.events.find((e) => e.kind === 'definition.locked' && e.session === session.id), 'the prepared issue remains attached after app-origin placement').toBeDefined();
  } finally { app?.close(); await w?.stop(); await f.close(); }
}, 60_000);

it('returns an issue prompt reply before waiting for the transcript entry that reply allows Claude to write', async () => {
  const f = await forge('instant');
  let w: World | undefined;
  try {
    w = await world(f);
    const session = await w.startSession();
    const promptId = randomUUID();
    const sent = (await w.prepare(session, 'UserPromptSubmit', { prompt: prompt(), prompt_id: promptId })).send();
    const reply = await sent.conn.seek((line) => typeof line.exit === 'number', 1, 10_000);
    expect(reply?.json?.exit, 'the missing transcript entry must not hold its own hook reply').toBe(0);
    appendFileSync(session.transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, sessionId: session.id, cwd: session.cwd,
      timestamp: new Date().toISOString(), message: { role: 'user', content: prompt() }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' })}\n`);
    await until(() => w!.events.some((e) => e.id === sent.id), 10_000);
    expect(w.events.find((e) => e.id === sent.id)?.data.from, 'the later entry places the prompt as the person’s').toBe('person');
    await until(() => w!.events.some((e) => e.kind === 'definition.locked' && e.session === session.id), 10_000);
    expect(w.events.find((e) => e.kind === 'definition.locked' && e.session === session.id), 'late placement retains its issue criteria').toBeDefined();
  } finally { await w?.stop(); await f.close(); }
}, 60_000);
