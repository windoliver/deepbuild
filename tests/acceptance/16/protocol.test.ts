// #16 AC11 and AC13: `seq` read as a canonical decimal string into a bigint and refused in any other form;
// every socket message one JSON line with a version field (README, The socket).
import { execFileSync } from 'node:child_process';
import fc from 'fast-check';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import {
  allEvents, cleanup, Conn, control, fromHere, hookRequest, makeHome, newSession, png, result, SEED, sendHook, shared, startHub, tokenOf, waitFor,
  type Hub, type HookRequest, type Line, type Session,
} from './helpers.ts';

const MAX = 9_223_372_036_854_775_807n;
let hub: Hub;
let s: Session;
// One hub for the file, started by the first test; if it can't start, each test fails with that.
const setup = shared(async () => {
  const home = makeHome();
  hub = await startHub({ home });
  s = newSession(home, 'claude-code');
});
beforeEach(setup, 60_000);
afterAll(cleanup, 60_000);

/** The request as one JSON line, with `seq` written as given: a string, or a JSON number's literal digits. */
function line(request: HookRequest, seq: string | { number: string }): string {
  const text = JSON.stringify({ ...request, seq: '__SEQ__' });
  return `${text.replace('"__SEQ__"', typeof seq === 'string' ? JSON.stringify(seq) : seq.number)}\n`;
}
/** What the contracts say about this line's seq: the code a refusal of it carries. */
function contractCode(text: string): string | undefined {
  const v = validate('hook.request@1', JSON.parse(text));
  return v.ok ? undefined : v.issues.find((i) => i.path === '/seq')?.code;
}

describe('AC11 #16.7fa39565 a seq outside 0..2^63-1 or in any other form is refused at the hub, naming the field and why', () => {
  const CASES: { name: string; seq: string | { number: string } }[] = [
    { name: '"9223372036854775808"', seq: '9223372036854775808' },
    { name: '"-1"', seq: '-1' },
    { name: '"0123"', seq: '0123' },
    { name: 'the JSON number 1760013451123456789', seq: { number: '1760013451123456789' } },
  ];
  it.each(CASES)('AC11 $name is refused naming /seq and why, with no ack, and nothing is appended for it', async ({ seq }) => {
    const request = fromHere(hookRequest(s, 'PreToolUse'));
    const text = line(request, seq);
    const h = await sendHook(hub.socket, text);
    expect(h.ack, `no acknowledgement for a refused request: ${JSON.stringify(h.lines)}`).toBeUndefined();
    expect(h.error, `a refusal line: ${JSON.stringify(h.lines)}`).toBeDefined();
    expect(h.error!.path, 'the refusal names the field').toBe('/seq');
    expect(h.error!.code, 'the refusal says why, as the contracts code it').toBe(contractCode(text));
    expect(String(h.error!.remediation ?? '').length, 'the refusal says why in words').toBeGreaterThan(0);
    if (typeof seq === 'string') expect(h.error!.actual, 'the refusal quotes the value as sent').toBe(seq);
    // A request after it, accepted, is the barrier: once it is in the log, the refused one never will be.
    const after = fromHere(hookRequest(s, 'PreToolUse'));
    expect((await sendHook(hub.socket, after)).ack).toBeDefined();
    const cli = await control(hub);
    const events = await waitFor(async () => { const all = await allEvents(cli); return all.some((e) => e.id === after.id) ? all : undefined; }, 10_000, 'the accepted request after it to be appended');
    expect(events.filter((e) => e.id === request.id), `nothing appended for ${request.id}`).toEqual([]);
    cli.close();
  }, 30_000);

  it('AC11 the stamps 1760013451123456789 and 1760013451123456790, 0 and 9223372036854775807 are taken and read back as the same strings', async () => {
    const seqs = ['1760013451123456789', '1760013451123456790', '0', '9223372036854775807'];
    const sent = seqs.map((seq) => ({ ...fromHere(hookRequest(s, 'PreToolUse')), seq }));
    for (const r of sent) expect((await sendHook(hub.socket, r)).ack, `seq ${r.seq} is acknowledged`).toBeDefined();
    const cli = await control(hub);
    const events = await waitFor(async () => { const all = await allEvents(cli); return sent.every((r) => all.some((e) => e.id === r.id)) ? all : undefined; }, 10_000, 'the four events');
    for (const r of sent) {
      const e = events.find((x) => x.id === r.id)!;
      expect(e.seq, `the event ${r.id} carries its seq as the same decimal string`).toBe(r.seq);
    }
    const page = await cli.call('events.read', { after: 0, limit: 1000 });
    const rawLine = cli.received.find((x) => x.json?.id === page.id)!.raw;
    expect(rawLine, 'the reply carries the stamp as a string, never as a number').toContain('"seq":"1760013451123456789"');
    cli.close();
  }, 30_000);

  it('AC11 every seq is taken exactly when it is a canonical decimal from 0 to 2^63-1, and otherwise refused naming /seq (1,000 cases, seed 16)', async () => {
    const taken: { id: string; seq: string }[] = [];
    const refused: string[] = [];
    const canonical = fc.bigInt({ min: 0n, max: MAX }).map((b) => ({ seq: b.toString() as string | { number: string }, ok: true }));
    const bad = fc.oneof(
      fc.bigInt({ min: MAX + 1n, max: MAX * 1000n }).map((b) => b.toString()),
      fc.bigInt({ min: 0n, max: MAX }).map((b) => `0${b}`),
      fc.bigInt({ min: 0n, max: MAX }).chain((b) => fc.constantFrom('-', '+', ' ').map((p) => `${p}${b}`)),
      fc.bigInt({ min: 0n, max: MAX }).map((b) => `${b}.0`),
      fc.integer({ min: 1, max: 30 }).map((e) => `1e${e}`),
      fc.string({ maxLength: 24 }).filter((t) => !/^(0|[1-9][0-9]*)$/.test(t)),
    ).map((seq) => ({ seq: seq as string | { number: string }, ok: false }));
    const number = fc.integer({ min: 0, max: 2 ** 31 }).map((n) => ({ seq: { number: String(n) } as string | { number: string }, ok: false }));
    await fc.assert(fc.asyncProperty(fc.oneof(canonical, bad, number), async ({ seq, ok }) => {
      const request = fromHere(hookRequest(s, 'PreToolUse'));
      const h = await sendHook(hub.socket, line(request, seq));
      if (ok) {
        expect(h.ack, `seq ${JSON.stringify(seq)} must be taken: ${JSON.stringify(h.lines)}`).toBeDefined();
        taken.push({ id: request.id, seq: seq as string });
      } else {
        expect(h.ack, `seq ${JSON.stringify(seq)} must not be acknowledged`).toBeUndefined();
        expect(h.error?.path, `seq ${JSON.stringify(seq)} must be refused naming /seq: ${JSON.stringify(h.lines)}`).toBe('/seq');
        refused.push(request.id);
      }
    }), { seed: SEED, numRuns: 1000 });
    const cli = await control(hub);
    const events = await waitFor(async () => { const all = await allEvents(cli); return taken.every((t) => all.some((e) => e.id === t.id)) ? all : undefined; }, 30_000, 'every taken event');
    const byId = new Map(events.map((e) => [e.id, e]));
    for (const t of taken) expect(byId.get(t.id)!.seq, `${t.id} reads back as ${t.seq}`).toBe(t.seq);
    expect(refused.filter((id) => byId.has(id)), 'no refused request was appended').toEqual([]);
    cli.close();
  }, 300_000);
});

/** The test process's parent's start time, as `ps -o lstart=` prints it (an unbound deep mcp hello). */
const parentStart = () => execFileSync('ps', ['-o', 'lstart=', '-p', String(process.ppid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
const framed = (raw: string): string | null => {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return `not JSON: ${raw.slice(0, 200)}`; }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return `not a JSON object: ${raw.slice(0, 200)}`;
  const v = (json as Line).v;
  return Number.isInteger(v) && v >= 1 ? null : `no version field: ${raw.slice(0, 200)}`;
};

describe('AC13 #16.4e090bc0 every socket message is one JSON line with a version field', () => {
  it('AC13 every line the hub writes to a hook, an unbound deep mcp, the app and the CLI, refusals and stream frames included, is one JSON object with v', async () => {
    const raws: string[] = [];
    const conns: Conn[] = [];
    const keep = (c: Conn) => { conns.push(c); return c; };
    // Hook: an accepted request, a refused one, and a method line on a connection with no credential.
    const ok = await sendHook(hub.socket, fromHere(hookRequest(s, 'PreToolUse')));
    raws.push(...ok.raw);
    raws.push(...(await sendHook(hub.socket, line(fromHere(hookRequest(s, 'PreToolUse')), '-1'))).raw);
    const bare = keep(await Conn.open(hub.socket));
    await bare.call('hub.health').catch(() => undefined);
    // The CLI: reads, a stream with frames, refusals of an unknown method, an unknown ask and a line that isn't JSON.
    const cli = keep(await control(hub));
    await cli.call('hub.health');
    await cli.call('events.read', { after: 0, limit: 5 });
    const sub = await cli.call('stream.subscribe', { after: 0 });
    result(sub);
    await sendHook(hub.socket, fromHere(hookRequest(s, 'PostToolUse')));
    await waitFor(() => cli.received.some((r) => r.json?.id === sub.id && 'event' in r.json!) || undefined, 10_000, 'a stream frame');
    await cli.call('no.such.method');
    await cli.call('ask.answer', { ask: 'ask:none', option: 'yes' });
    cli.write('{"v":1,"id":"broken",\n');
    await cli.until((l) => 'error' in l, 5000);
    // The app: a paste.
    const app = keep(await control(hub, 'app'));
    await app.call('evidence.paste', { bytes: Buffer.from(png(4, 4, 3)).toString('base64'), type: 'png' });
    // An unbound deep mcp (this process's parent is no agent's), and a hello with a wrong token.
    const mcp = keep(await Conn.open(hub.socket));
    mcp.send({ v: 1, hello: 'mcp', parent: { pid: process.ppid, start: parentStart() } });
    await mcp.next();
    await mcp.call('mcp.call', { tool: 'deep_claim', arguments: { task_ref: 'task:x', attempt: 1, commit: '0'.repeat(40), scope: 'session' } });
    const wrong = keep(await Conn.open(hub.socket));
    wrong.send({ v: 1, hello: 'cli', token: `${tokenOf(hub.root)}x` });
    await wrong.next();
    for (const c of conns) {
      raws.push(...c.received.map((r) => r.raw));
      expect(c.partial, 'no line is left unfinished').toBe('');
    }
    expect(raws.length).toBeGreaterThan(15);
    expect(raws.map(framed).filter(Boolean), 'lines that are not one JSON object with a version field').toEqual([]);
    for (const c of conns) c.close();
  }, 60_000);

  it('AC13 a request line without a version field is refused naming /v: a method call, a hello and a hook request', async () => {
    const cli = await control(hub);
    cli.send({ id: 'no-v', method: 'hub.health', params: {} });
    const r1 = (await cli.until((l) => l.id === 'no-v' || 'error' in l))!.json!;
    expect(r1.error?.path, `method call without v: ${JSON.stringify(r1)}`).toBe('/v');
    cli.close();
    const hello = await Conn.open(hub.socket);
    hello.send({ hello: 'cli', token: tokenOf(hub.root) });
    const r2 = await hello.next();
    expect(r2?.error?.path, `hello without v: ${JSON.stringify(r2)}`).toBe('/v');
    hello.close();
    const { v: _v, ...noV } = fromHere(hookRequest(s, 'PreToolUse'));
    const h = await sendHook(hub.socket, `${JSON.stringify(noV)}\n`);
    expect(h.ack).toBeUndefined();
    expect(h.error?.path, `hook request without v: ${JSON.stringify(h.lines)}`).toBe('/v');
  }, 30_000);

  it('AC13 a line is read whole however it arrives: one request in single bytes, two requests in one write', async () => {
    const cli = await control(hub);
    const one = `${JSON.stringify({ v: 1, id: 'bytes', method: 'hub.health', params: {} })}\n`;
    for (const ch of one) { cli.write(ch); await new Promise((r) => setTimeout(r, 1)); }
    expect((await cli.until((l) => l.id === 'bytes'))?.json?.result, 'a request sent a byte at a time is answered once').toBeDefined();
    cli.write(`${JSON.stringify({ v: 1, id: 'a', method: 'hub.health', params: {} })}\n${JSON.stringify({ v: 1, id: 'b', method: 'events.read', params: { after: 0, limit: 1 } })}\n`);
    expect(await cli.seek((l) => l.id === 'a')).toBeDefined();
    expect(await cli.seek((l) => l.id === 'b')).toBeDefined();
    cli.close();
  }, 30_000);

  it('AC13 any sequence of requests, cut into writes anywhere, gets one framed, versioned reply per request (1,000 cases, seed 16)', async () => {
    const cli = await control(hub);
    let n = 0;
    const request = fc.oneof(
      fc.constant({ method: 'hub.health', params: {} as Line }),
      fc.record({ method: fc.constant('events.read'), params: fc.record({ after: fc.integer({ min: 0, max: 5000 }), limit: fc.integer({ min: 1, max: 50 }) }) }),
      fc.record({ method: fc.constant('ask.answer'), params: fc.record({ ask: fc.string({ maxLength: 12 }), option: fc.string({ maxLength: 8 }) }) }),
      fc.record({ method: fc.string({ minLength: 1, maxLength: 16 }).filter((m) => !['hub.stop', 'gates.off', 'run.start', 'test.load', 'evidence.paste', 'stream.subscribe'].includes(m)), params: fc.constant({} as Line) }),
    );
    await fc.assert(fc.asyncProperty(fc.array(request, { minLength: 1, maxLength: 5 }), fc.array(fc.nat(), { maxLength: 6 }), async (requests, cuts) => {
      const ids = requests.map(() => `p${++n}`);
      const text = requests.map((r, i) => `${JSON.stringify({ v: 1, id: ids[i], ...r })}\n`).join('');
      const points = [...new Set(cuts.map((c) => c % text.length))].sort((a, b) => a - b);
      const from = cli.received.length;
      let at = 0;
      for (const p of [...points, text.length]) { if (p > at) cli.write(text.slice(at, p)); at = p; }
      for (const id of ids) expect(await cli.seek((l) => l.id === id, from, 5000), `a reply to ${id}`).toBeDefined();
      const replies = cli.received.slice(from).map((r) => r.raw);
      expect(replies.map(framed).filter(Boolean)).toEqual([]);
      expect(cli.partial).toBe('');
    }), { seed: SEED, numRuns: 1000 });
    cli.close();
  }, 300_000);
});
