// #1337's gaps beyond its blind suite (tests/acceptance/1337, whose world this reuses by path): a person's credential
// reads, and does nothing a person may not; a hook presenting a credential this hub never issued is refused, with
// nothing recorded under it; and the owner's stream, like the owner's reads, carries nothing of a person's own scope.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, connectAs, joinBob, owner, readWith, settled, sleep, work, world } from '../../../tests/acceptance/1337/helpers.ts';

afterAll(cleanup);

describe('#1337 what a person\'s credential can do', () => {
  it("a person's connection reads, and is refused every method of the owner's", async () => {
    const w = await world();
    const bob = await joinBob(w);
    const conn = await connectAs(w, bob.token);
    try {
      for (const [method, params] of [['hub.stop', {}], ['ask.answer', { ask: 'ask:0', option: 'x' }], ['stream.subscribe', {}], ['person.add', { person: 'eve', repo: w.repos.shop }], ['inbox.read', {}]] as const) {
        const reply = await conn.call(method, params, 30_000);
        expect((reply as { error?: { code?: string } }).error?.code, `${method} from bob's connection: ${JSON.stringify(reply)}`).toBe('role');
      }
      const health = await conn.call('hub.health', {}, 30_000);
      expect('result' in health, `bob's hub.health: ${JSON.stringify(health)}`).toBe(true);
    } finally {
      conn.close();
    }
  }, 120_000);

  it('a hook presenting a credential the hub never issued is refused, and none of its events is recorded', async () => {
    const w = await world();
    await joinBob(w);
    const { sent } = await work(w, { home: w.bob, cwd: w.repos.bobShop, token: 'not-a-credential-this-hub-issued', events: ['SessionStart'] });
    expect(sent[0]!.error?.code, `the hook ended ${JSON.stringify(sent[0])}`).toBe('credential');
    const read = await settled(w, []);
    expect(read.events.some((e) => e.id === sent[0]!.id), 'the refused hook reached the record').toBe(false);
  }, 120_000);

  it("the owner's stream carries the project's events and none of a person's own folder", async () => {
    const w = await world();
    const bob = await joinBob(w);
    const own = join(w.bob, 'scratch');
    mkdirSync(own, { recursive: true });
    const personal = await work(w, { home: w.bob, cwd: own, token: bob.token });
    const project = await work(w, { home: w.maya, cwd: w.repos.shop });
    await settled(w, project.sent.map((s) => s.id));
    // bob's own read holds his folder's events, so their absence below is the stream's filter, not a missing event.
    const bobConn = await connectAs(w, bob.token);
    const bobRead = await readWith(bobConn).finally(() => bobConn.close());
    for (const s of personal.sent) expect(bobRead.events.map((e) => e.id), `BLOCKED: bob's read lacks his event ${s.id} (${s.event})`).toContain(s.id);
    const conn = await owner(w);
    try {
      const sub = (await conn.call('stream.subscribe', { after: 0 }, 30_000)).id;
      const streamed = (): string[] => conn.received.flatMap((r) => (r.json && r.json.id === sub && r.json.event ? [String((r.json.event as { id: string }).id)] : []));
      for (const deadline = Date.now() + 15_000; !project.sent.every((s) => streamed().includes(s.id)) && Date.now() < deadline;) await sleep(200);
      for (const s of project.sent) expect(streamed(), `the owner's stream lacks event ${s.id} (${s.event}) of the project`).toContain(s.id);
      for (const s of personal.sent) expect(streamed(), `the owner's stream carried event ${s.id} (${s.event}) of bob's own folder`).not.toContain(s.id);
    } finally {
      conn.close();
    }
  }, 120_000);
});
