// #34 AC1 and AC3: who can reach the App API on the hub's socket. Every request needs the control token, new at
// each launch, and any request carrying a browser Origin is refused (design: the App API row of Five ways in;
// Threats: Injected answers). Each test starts its own hub on a temp home, with the OS confirmation's stand-in
// saying no, so no test ever reaches a real Touch ID or polkit prompt.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asApp, cleanup, Confirmer, confirmEnv, Conn, makeHome, newDevice, result, sleep, startHub, stopHub, tokenOf, ulid, type Hub, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const start = async (): Promise<Hub> => startHub({ home: makeHome(), env: confirmEnv(new Confirmer()) });

/** Every App API method with params it can be served with (README, The socket: App API methods). */
const METHODS: [string, Line][] = [
  ['inbox.read', {}],
  ['sessions.read', {}],
  ['changes.read', { id: `claim:${ulid()}` }],
  ['evidence.read', { sha: '0'.repeat(64) }],
  ['numbers.read', {}],
  ['events.read', { after: 0, limit: 10 }],
  ['stream.subscribe', { after: 0 }],
  ['ask.answer', { ask: `ask:${ulid()}`, option: 'approve' }],
  ['decision.overrule', { decision: `decision:${ulid()}` }],
  ['device.pair', { name: 'a test device', public_key: newDevice('a test device').publicKey }],
];
/** Codes that say a request wasn't served at all: no credential, the wrong role, or no such method. */
const NOT_SERVED = ['credential', 'role', 'unknown_method'];

/** Waits for the line answering `id`, or for any refusal or the connection's end, then a moment for what follows. */
async function answered(conn: Conn, id: string): Promise<void> {
  await conn.seek((l) => l.id === id || 'error' in l, 1, 1500);
  await sleep(50);
}
/** What came back after line `from` that serves something: a result, a role, or a stream frame. */
const served = (conn: Conn, from = 1): Line[] => conn.received.slice(from).flatMap((r) => (r.json && ('result' in r.json || 'role' in r.json || 'event' in r.json) ? [r.json] : []));

describe('AC1 #34.e5ab40cc a request without the token is refused', () => {
  it('AC1 each App API method is served on a connection that presented the control token', async () => {
    const hub = await start();
    const app = await asApp(hub);
    const refused: string[] = [];
    for (const [method, params] of METHODS) {
      const reply = await app.call(method, params, 20_000);
      if ('error' in reply && NOT_SERVED.includes(reply.error.code as string)) refused.push(`${method}: ${reply.error.code}`);
    }
    expect(refused, `with the control token, each method is served (an unknown ask may still be not_found): ${refused.join('; ')}`).toEqual([]);
  }, 120_000);

  it.each([
    ['no hello at all: the method call is the first line', null],
    ['a hello as the app with no token', { v: 1, hello: 'app' }],
    ['a hello as the CLI with no token', { v: 1, hello: 'cli' }],
    ['a hello as the app with a wrong token', 'wrong'],
    ['a hello as the app with an empty token', { v: 1, hello: 'app', token: '' }],
  ] as const)('AC1 %s: every App API method is refused and nothing is served', async (_name, hello) => {
    const hub = await start();
    const leaks: string[] = [];
    for (const [method, params] of METHODS) {
      const conn = await Conn.open(hub.socket);
      if (hello === 'wrong') conn.send({ v: 1, hello: 'app', token: `${tokenOf(hub.root).slice(0, -2)}xx` });
      else if (hello) conn.send(hello);
      conn.send({ v: 1, id: method, method, params });
      await answered(conn, method);
      const got = served(conn);
      if (got.length) leaks.push(`${method}: ${JSON.stringify(got).slice(0, 300)}`);
      conn.close();
    }
    expect(leaks, `without the token, nothing is served: ${leaks.join('\n')}`).toEqual([]);
    // The hub itself is still serving: the token's connection reads.
    const app = await asApp(hub);
    expect('result' in (await app.call('inbox.read', {})), 'the app, with the token, still reads the inbox').toBe(true);
  }, 120_000);

  it('AC1 the token is new at each launch, in control.token at mode 0600; the last launch\'s is refused', async () => {
    const home = makeHome();
    const env = confirmEnv(new Confirmer());
    let hub = await startHub({ home, env });
    const first = tokenOf(hub.root);
    expect(statSync(join(hub.root, 'control.token')).mode & 0o777, 'control.token is readable only by you').toBe(0o600);
    await stopHub(hub);
    hub = await startHub({ home, env });
    const second = tokenOf(hub.root);
    expect(second, 'a new launch writes a new token').not.toBe(first);
    expect(statSync(join(hub.root, 'control.token')).mode & 0o777).toBe(0o600);
    const old = await Conn.open(hub.socket);
    old.send({ v: 1, hello: 'app', token: first });
    old.send({ v: 1, id: 'r', method: 'inbox.read', params: {} });
    await answered(old, 'r');
    expect(served(old), 'the last launch\'s token serves nothing').toEqual([]);
    const app = await asApp(hub);
    expect(result(await app.call('inbox.read', {})).log_pos, 'the new token reads').toEqual(expect.any(Number));
  }, 60_000);
});

describe('AC3 #34.e685e92c a request carrying a browser Origin is refused, so no web page can reach it', () => {
  const ORIGINS = ['https://example.com', 'null'];

  it.each(ORIGINS)('AC3 a hello with the right token that carries Origin %s is refused, and nothing is served on it', async (origin) => {
    const hub = await start();
    for (const key of ['origin', 'Origin']) {
      const conn = await Conn.open(hub.socket);
      conn.send({ v: 1, hello: 'app', token: tokenOf(hub.root), [key]: origin });
      conn.send({ v: 1, id: 'r', method: 'inbox.read', params: {} });
      await answered(conn, 'r');
      expect(served(conn), `a hello carrying "${key}": "${origin}" serves nothing`).toEqual([]);
      conn.close();
    }
  }, 60_000);

  it.each(ORIGINS)('AC3 on a connection that presented the token, a request line carrying Origin %s is refused', async (origin) => {
    const hub = await start();
    const app = await asApp(hub);
    // The same request without an Origin is served, so a refusal below is the Origin's.
    expect('result' in (await app.call('inbox.read', {})), 'without an Origin, the request is served').toBe(true);
    for (const key of ['origin', 'Origin']) {
      const from = app.received.length;
      app.send({ v: 1, [key]: origin, id: `o-${key}`, method: 'inbox.read', params: {} });
      const reply = await app.seek((l) => l.id === `o-${key}`, from, 3000);
      expect(reply?.json && 'result' in reply.json ? reply.json : null, `a request carrying "${key}": "${origin}" is refused`).toBeNull();
      expect(served(app, from), 'nothing is served for it').toEqual([]);
    }
  }, 60_000);

  it('AC3 an HTTP request or a WebSocket upgrade from a page, with an Origin and the token, is refused and changes nothing', async () => {
    const hub = await start();
    const token = tokenOf(hub.root);
    const before = result(await (await asApp(hub)).call('events.read', { after: 0, limit: 1000 })).events.length as number;
    const body = `${JSON.stringify({ v: 1, hello: 'app', token })}\n${JSON.stringify({ v: 1, id: 'h', method: 'inbox.read', params: {} })}\n`;
    const requests = [
      `POST / HTTP/1.1\r\nHost: localhost\r\nOrigin: https://example.com\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
      `GET /stream HTTP/1.1\r\nHost: localhost\r\nOrigin: https://example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: ${token}\r\n\r\n`,
    ];
    for (const request of requests) {
      const conn = await Conn.open(hub.socket);
      conn.write(request);
      await conn.closed(1500);
      await sleep(100);
      const text = conn.received.slice(1).map((r) => r.raw).join('\n') + conn.partial;
      expect(text, 'no HTTP answer: no switch to a WebSocket, no 200').not.toMatch(/HTTP\/1\.[01] (101|200)/);
      expect(served(conn), 'nothing is served to the page').toEqual([]);
      conn.close();
    }
    const after = result(await (await asApp(hub)).call('events.read', { after: 0, limit: 1000 })).events.length as number;
    expect(after, 'nothing was appended for the page\'s requests').toBe(before);
  }, 60_000);
});
