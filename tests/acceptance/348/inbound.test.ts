// AC12 (moved here from #16's AC10): inbound traffic reaches the hub only through a plug-in you turned on, exposing
// only the routes you chose. #16 proves the hub's own half: no TCP or UDP socket of its own. Here the plug-in half:
// the inbound plug-in (fixtures/inbound) registers two routes; until you turn it on, nothing new listens, in the
// hub's process (this one, where the host runs) or the plug-in's, and its own try at a port is refused. Turned on
// with one route chosen, one listener on 127.0.0.1 serves that route only; turned off, it's gone. README, The
// surface under test: `deep.registerRoute`, `host.turnOn`, `host.turnOff`.
import http from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExtensionHost, Installed } from '../../../packages/extension-host/src/index.ts';
import { listeners, openHost, openWorld, pkg, report, sleep, type World } from './helpers.ts';

const opened: ExtensionHost[] = [];
afterAll(async () => { for (const h of opened.splice(0)) await h.close(); });

interface Seen { pid: number; hits: Record<string, number>; ownListen: string }

function request(address: string, method: string, path: string, body: string): Promise<{ status: number; body: string }> {
  const [host, port] = address.split(':');
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port: Number(port), method, path, headers: { 'content-type': 'text/plain' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function loadedPlugin(): Promise<{ w: World; h: ExtensionHost; p: Installed; baseline: string[] }> {
  const baseline = listeners([process.pid]);
  const w = await openWorld();
  const h = await openHost(w);
  opened.push(h);
  await h.ready();
  const p = await h.install({ from: await pkg('inbound'), builtBy: null });
  expect((await h.check(p)).passed).toBe(true);
  const load = await h.load(p);
  expect(load.status, JSON.stringify(load)).toBe('loaded');
  await sleep(300);
  return { w, h, p, baseline };
}

describe('AC12 #348.fad7f4f9 inbound traffic reaches the hub only through a plug-in you turned on, exposing only the routes you chose', () => {
  it('AC12 a loaded plug-in you haven\'t turned on opens nothing: no new listener in the hub\'s process or the plug-in\'s, and its own try at a port is refused', async () => {
    const { h, baseline } = await loadedPlugin();
    const seen = await report<Seen>(h, 'ext.inbound.report');
    expect(listeners([process.pid]), 'the hub\'s process listens on nothing new').toEqual(baseline);
    expect(listeners([seen.pid]), 'the plug-in\'s process listens on nothing').toEqual([]);
    expect(seen.ownListen, 'the plug-in\'s own listen').toMatch(/^refused/);
  }, 60_000);

  it('AC12 turned on with POST /v1/traces chosen: one listener on 127.0.0.1 serves that route to the plug-in; POST /admin/exec, which it registered, and GET /v1/traces never reach it; turned off, nothing listens', async () => {
    const { h, p, baseline } = await loadedPlugin();
    const before = await report<Seen>(h, 'ext.inbound.report');
    const { address } = await h.turnOn(p.id, ['POST /v1/traces']);
    expect(address).toMatch(/^127\.0\.0\.1:\d+$/);
    const port = address.split(':')[1];
    const added = [...listeners([process.pid]).filter((l) => !baseline.includes(l)), ...listeners([before.pid])];
    expect(added, 'exactly one new listener, on 127.0.0.1 at the address turnOn gave').toEqual([`TCP 127.0.0.1:${port} (LISTEN)`]);

    const traced = await request(address, 'POST', '/v1/traces', 'span-1');
    expect(traced).toEqual({ status: 200, body: 'traces got span-1' });
    const admin = await request(address, 'POST', '/admin/exec', 'rm -rf /');
    expect(admin.status, 'a route you didn\'t choose is refused').toBeGreaterThanOrEqual(400);
    const wrongMethod = await request(address, 'GET', '/v1/traces', '');
    expect(wrongMethod.status, 'the chosen path with another method is refused').toBeGreaterThanOrEqual(400);
    const seen = await report<Seen>(h, 'ext.inbound.report');
    expect(seen.hits, 'only the chosen route reached the plug-in, once').toEqual({ 'POST /v1/traces': 1, 'POST /admin/exec': 0 });

    await h.turnOff(p.id);
    await sleep(200);
    expect(listeners([process.pid]), 'turned off, the hub\'s process is back to listening on nothing new').toEqual(baseline);
    expect(listeners([before.pid])).toEqual([]);
    await expect(request(address, 'POST', '/v1/traces', 'span-2'), 'turned off, the address refuses connections').rejects.toThrow(/ECONNREFUSED/);
  }, 60_000);
});
