import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { Agent } from '../26/helpers.ts';
import { cleanup, handle, initialize, lineOf, makeRepo, makeWorld, openWiki, seedSession, trustProject, withHub } from '../355/helpers.ts';
import { withRecord } from '../355-redraft-1894/helpers.ts';
import { AC, API, learn, namedIn, noSourceHolds, search } from '../3460/helpers.ts';

afterAll(cleanup, 60_000);

const PORTS = { page: 'repos/web', id: 'preview-ports', text: 'web previews listen on ports 5173 and 5174' };

test(`AC3 ${AC[3]} with ports held only by a claim scoped to another session, a call bound to this session is told that nothing holds ports`, async () => {
  const w = makeWorld();
  const api = makeRepo(join(w.tmp, 'api'), [{ Procfile: 'api: node server.js --port 3000\n' }]);
  const web = makeRepo(join(w.tmp, 'web'), [{ 'package.json': '{ "name": "web" }\n' }]);
  let A = '';
  await withRecord(w, async (o) => {
    await trustProject(w, o, api.dir);
    await learn(w, o, [API]);
    A = await seedSession(w, o, 'web', web.dir, [{ id: 'said', from: 'you', text: `Remember this: ${PORTS.text}.` }]);
    const wiki = await openWiki({ record: o.record, folder: w.wiki, now: w.clock.now });
    const learned = await wiki.learn([{ ...PORTS, scope: `session:${A}`, sources: [{ at: `session:${A}#said`, quote: PORTS.text }] }]);
    expect(learned.written, `the wiki writes ${handle(PORTS)} at the scope of session A (${A}): ${JSON.stringify(learned)}`).toContain(handle(PORTS));
    await wiki.write();
  });
  expect(lineOf(w, handle(PORTS)).text, `${handle(PORTS)} is a claim line on its page, holding "ports"`).toBe(PORTS.text);

  await withHub(w, {}, async (hub) => {
    const agent = Agent.start(w.home, api.dir);
    const B = agent.session(api.dir);
    await agent.establish(hub, B);
    await initialize(agent);
    const reach = (await search(agent, 'api port')).value;
    expect(reach.hits.map((h) => h.source), `session B's deep_search "api port" finds ${handle(API)}, in force at scope all: ${JSON.stringify(reach).slice(0, 1500)}`).toContain(handle(API));

    const { value } = await search(agent, 'ports');
    expect(value.hits, `session B's deep_search "ports" returns no hit: ${handle(PORTS)} is scoped to session A`).toEqual([]);
    expect(typeof value.note, `session B's deep_search "ports" returns no hit and says nothing of why: its reply ${JSON.stringify(value).slice(0, 1500)} carries no note`).toBe('string');
    expect(namedIn(value.note), `session B's note counts ${handle(PORTS)} ("${PORTS.text}"), a claim scoped to session A that this call may not read, as holding "ports": ${JSON.stringify(value.note)}`).toContain('ports');
    expect(value.note, 'session B is told that nothing holds "ports", word for word').toBe(noSourceHolds(['ports']));
  });
}, 480_000);
