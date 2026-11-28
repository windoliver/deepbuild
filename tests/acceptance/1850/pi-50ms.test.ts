import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  CALLS, Client, Pi, callId, cleanup, closeFakes, guardKillByName, helloOf, holdingHub, place, readSteps, resultText, settle, spooled, spooledCall, spooledStop, startHub, stuckHub, word, type Line,
} from './helpers.ts';

afterEach(async () => {
  await closeFakes();
  await cleanup();
}, 60_000);

const ofType = (pi: Pi, type: string, id?: string): Line | undefined => pi.events.find((e) => e.type === type && (id === undefined || e.toolCallId === id));

it('#1850.081fc261 against a hub that accepts connections and never writes, ten pi tool calls in a row each return within 60 ms of the call', async () => {
  const p = place();
  const hub = await stuckHub(p.socket);
  const pi = await Pi.start(p.home, p.cwd, { steps: readSteps(CALLS) });
  await pi.call({ type: 'prompt', message: 'Read a.txt ten times, one call after another.' }, 60_000);
  for (let n = 1; n <= CALLS; n++) {
    const id = callId(n);
    const fired = await settle(() => ofType(pi, 'tool_execution_start', id), 60_000);
    expect(fired, `tool call ${n} of ${CALLS} (${id}) never fired; pi's events: ${[...new Set(pi.events.map((e) => e.type))].join(', ')}`).toBeDefined();
    const returned = await settle(() => ofType(pi, 'tool_execution_end', id), 60_000);
    const took = returned ? returned.at - fired!.at : Number.POSITIVE_INFINITY;
    expect(took, `tool call ${n} of ${CALLS} (${id}, read) returned ${returned ? `${took} ms` : 'not within 60000 ms'} after pi fired it, against a hub that accepted and never wrote`).toBeLessThanOrEqual(60);
  }
  expect(hub.accepted(), 'the package never connected to the hub that accepts and never writes').toBeGreaterThan(0);
}, 300_000);

it("#1850.8ddd247a with the same stuck hub, a call that matches no-kill-by-name is still blocked with that entry's words", async () => {
  const p = place();
  const entry = guardKillByName(p.home);
  const hub = await stuckHub(p.socket);
  const pi = await Pi.start(p.home, p.cwd, { steps: [{ tools: [{ name: 'bash', arguments: { command: 'pkill -x dh1850none; touch ran.txt' } }] }, { text: 'Done.' }] });
  await pi.call({ type: 'prompt', message: 'Stop the process by name.' }, 60_000);
  const returned = await settle(() => ofType(pi, 'tool_execution_end', callId(1)), 120_000);
  expect(returned, `the call ${callId(1)} (bash: pkill -x dh1850none) never returned`).toBeDefined();
  const said = resultText(returned!);
  expect(returned!.isError, `the call ${callId(1)} that no-kill-by-name matches went on with the hub stuck: ${said}`).toBe(true);
  expect(said, `the block of ${callId(1)} doesn't say no-kill-by-name's reason`).toContain(entry.reason);
  expect(said, `the block of ${callId(1)} doesn't say no-kill-by-name's next step`).toContain(entry.next_step);
  expect(existsSync(join(p.cwd, 'ran.txt')), `the blocked command of ${callId(1)} ran`).toBe(false);
  expect(hub.accepted(), 'the package never connected to the hub that accepts and never writes').toBeGreaterThan(0);
}, 300_000);

it('#1850.517fa524 with a working hub, a stop the hub acknowledges with a hold is still held until its reply', async () => {
  const real = await startHub(place().home);
  const hello = await helloOf(real);
  const p = place();
  const said = `held-${word()}`;
  const hub = await holdingHub(p.socket, hello, said, 1500, 20_000);
  const pi = await Pi.start(p.home, p.cwd, { steps: [{ text: 'First.' }, { text: 'Second.' }] });
  await pi.call({ type: 'prompt', message: 'Say something.' }, 60_000);
  const settled = await settle(() => ofType(pi, 'agent_settled'), 60_000);
  const stop = hub.stops[0];
  expect(stop, `the stop never reached the hub; it got ${hub.requests.map((r) => r.event).join(', ')}`).toBeDefined();
  expect(settled, 'the run never settled').toBeDefined();
  expect(settled!.at, `the stop ${stop!.id}, acknowledged with a hold until ${stop!.holdUntil}, let its run settle ${stop!.replyAt === undefined ? 'before the hub replied' : `${stop!.replyAt - settled!.at} ms before the hub's reply`}`).toBeGreaterThanOrEqual(stop!.replyAt ?? Number.POSITIVE_INFINITY);
  const back = pi.requests().some((r) => (r.messages as Line[]).some((m) => String(m.text).includes(said)));
  expect(back, `the hub's reply to the held stop ${stop!.id}, sending the run back with "${said}", never reached the model`).toBe(true);
}, 300_000);

it('#1850.3d9c6d57 with the hub stopped, a scripted pi session\'s tool calls and its stop land in the record once the hub starts, once each, with the seq and id their spool lines carry', async () => {
  const p = place();
  const calls = [callId(1), callId(2)];
  const pi = await Pi.start(p.home, p.cwd, { steps: readSteps(calls.length) });
  await pi.call({ type: 'prompt', message: 'Read a.txt twice.' }, 60_000);
  expect(await settle(() => ofType(pi, 'agent_settled'), 60_000), 'the session never settled with the hub stopped').toBeDefined();
  const all = spooled(p.home);
  const wanted = [
    ...calls.map((id) => ({ name: `the tool call ${id}`, kind: 'tool.before', lines: spooledCall(all, id), mine: (e: Line) => e.kind === 'tool.before' && (e.data as Line).call === id })),
    { name: 'the stop (agent_before_settle)', kind: 'agent.stop', lines: spooledStop(all), mine: (e: Line) => e.kind === 'agent.stop' },
  ];
  for (const w of wanted) expect(w.lines.length, `${w.name} should be in the spool once; the spool holds ${all.length} lines${all.length ? `: ${all.map((s) => s.line.event).join(', ')}` : ''}`).toBe(1);
  const client = await Client.open(await startHub(p.home));
  for (const w of wanted) {
    const line = w.lines[0]!.line;
    const got = await settle(async () => {
      const found = (await client.events()).filter((e) => e.id === line.id);
      return found.length ? found : undefined;
    }, 30_000);
    expect(got?.length ?? 0, `${w.name} (id ${String(line.id)}, seq ${String(line.seq)}) is not in the record once after the hub started`).toBe(1);
    expect(got![0]!.kind, `${w.name} (id ${String(line.id)}) recorded as another kind`).toBe(w.kind);
    expect(got![0]!.seq, `${w.name} (id ${String(line.id)}) recorded with another seq`).toBe(line.seq);
  }
  const events = (await client.events()).filter((e) => e.session === pi.session);
  for (const w of wanted) expect(events.filter(w.mine).length, `${w.name} recorded other than once`).toBe(1);
}, 300_000);

it('#1850.33ec08d6 with the fake hub that never writes, each of the ten calls is in the spool marked late, and once a working hub starts each is recorded once, marked late', async () => {
  const p = place();
  const hub = await stuckHub(p.socket);
  const pi = await Pi.start(p.home, p.cwd, { steps: readSteps(CALLS) });
  await pi.call({ type: 'prompt', message: 'Read a.txt ten times, one call after another.' }, 60_000);
  await settle(() => ofType(pi, 'agent_settled'), 30_000);
  const all = spooled(p.home);
  const lines: Line[] = [];
  for (let n = 1; n <= CALLS; n++) {
    const id = callId(n);
    const found = spooledCall(all, id);
    expect(found.length, `tool call ${n} of ${CALLS} (${id}) should be in the spool once; the spool holds ${all.length} lines`).toBe(1);
    expect(found[0]!.line.late, `tool call ${n} of ${CALLS} (${id}) was spooled unmarked: ${found[0]!.text}`).toBe(true);
    expect(found[0]!.text.startsWith('{"v":1,"agent":"pi"'), `tool call ${n} of ${CALLS} (${id}) isn't spooled as a hook request line: ${found[0]!.text}`).toBe(true);
    lines.push(found[0]!.line);
  }
  await hub.close();
  const client = await Client.open(await startHub(p.home));
  for (let n = 1; n <= CALLS; n++) {
    const line = lines[n - 1]!;
    const got = await settle(async () => {
      const found = (await client.events()).filter((e) => e.id === line.id);
      return found.length ? found : undefined;
    }, 30_000);
    expect(got?.length ?? 0, `tool call ${n} of ${CALLS} (${callId(n)}, id ${String(line.id)}) is not in the record once after a working hub started`).toBe(1);
    expect(got![0]!.kind).toBe('tool.before');
    expect(got![0]!.seq, `tool call ${n} of ${CALLS} (${callId(n)}) recorded with another seq`).toBe(line.seq);
    expect((got![0]!.data as Line).late, `tool call ${n} of ${CALLS} (${callId(n)}) recorded unmarked`).toBe(true);
  }
  const events = (await client.events()).filter((e) => e.session === pi.session && e.kind === 'tool.before');
  for (let n = 1; n <= CALLS; n++) expect(events.filter((e) => (e.data as Line).call === callId(n)).length, `tool call ${n} of ${CALLS} (${callId(n)}) recorded other than once`).toBe(1);
}, 300_000);
