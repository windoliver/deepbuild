// AC3: each tool listed read-only, called in every form its schema takes on a hub holding a document, an ask and a
// claim, changes nothing but the record of the call; a planted deep_query that records an open item fails, naming
// the tool and the event's kind; a planted table that lists deep_kinds read-only fails on its fetch, naming the asset
// it brought in (README).
import { afterAll, describe, expect, it } from 'vitest';
import { DOC as LIBRARY_DOC, LIB, events as libraryEvents, onWorld, search } from '../1731/helpers.ts';
import {
  AC, CLI, NODE, PLANT, Raw, TEST_MS, brief, callsWorld, cleanup, listedAs, readOnlyFailures, t26, tableSays,
  type Ev, type Line, type Reader, type Rig,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const rig = (server: { call(tool: string, args: Line): Promise<t26.Outcome> }, tools: readonly Line[], events: Reader): Rig =>
  ({ call: (tool, args) => server.call(tool, args), events, schema: (tool) => tools.find((t) => t.name === tool)?.inputSchema as Line | undefined });

describe('a tool listed read-only changes nothing', () => {
  it(`AC3 ${AC.reads} each tool listed read-only is called in every form its schema takes on a hub with a document, an ask and a claim, and the record gains no ask, claim, open item, revision, job, evidence or proposal and no process starts; a planted deep_query that records an open item fails, naming the tool and the event's kind; a planted table that lists deep_kinds read-only fails on its fetch, naming the asset it brought in`, async () => {
    const w = await callsWorld([{ label: 'agent' }, { label: 'records', plant: { kind: 'records', tool: 'deep_query' } }]);
    const agent = w.sessions.get('agent')!;
    const read: Reader = async () => (await t26.events(w.hub)) as unknown as Ev[];
    const servers = [
      { server: agent.server, tools: await agent.server.tools(), name: 'deep mcp' },
      { server: w.actions, tools: await w.actions.tools(), name: 'deep mcp actions' },
      { server: w.actionsHook, tools: await w.actionsHook.tools(), name: 'deep-hook mcp actions' },
      { server: w.reading, tools: await w.reading.tools(), name: 'the reading tools' },
    ];
    const listed = [...new Set(servers.flatMap((s) => listedAs(s.tools, 'readOnlyHint')))].sort();
    expect(listed, `the servers list read-only the tools the table does (${servers.map((s) => `${s.name}: ${listedAs(s.tools, 'readOnlyHint').join(', ') || 'none'}`).join('; ')})`).toEqual(tableSays('readOnlyHint'));

    const ctx = { doc: w.doc, ask: agent.ask, revision: w.revision };
    const failures: string[] = [];
    const calls: string[] = [];
    for (const s of servers) {
      const r = await readOnlyFailures(rig(s.server, s.tools, read), listedAs(s.tools, 'readOnlyHint'), ctx);
      failures.push(...r.failures.map((f) => `${s.name}: ${f}`));
      calls.push(...r.calls);
    }
    expect(failures, `every call of a tool listed read-only leaves the record as it was (calls: ${calls.join(' | ')})`).toEqual([]);

    // The planted deep_query: the change's deep mcp, each deep_query also recording an open item.
    const records = w.sessions.get('records')!;
    const planted = await readOnlyFailures(rig(records.server, await records.server.tools(), read), ['deep_query'], { ...ctx, ask: records.ask });
    expect(planted.failures.filter((f) => f.startsWith('deep_query') && f.includes('open_item.opened')), `the same check fails the planted deep_query that records an open item, naming the tool and the event's kind: ${planted.failures.join(' | ') || planted.calls.join(' | ')}`).not.toEqual([]);
    await w.close();

    // The planted table: the change's deep mcp in a hub with a model library on, listing deep_kinds read-only.
    const lib = await onWorld();
    const kinds = Raw.start('deep mcp with a planted table', [NODE, '--import', PLANT, CLI, 'mcp'], lib.home, lib.work, { PLANT_2898: JSON.stringify({ kind: 'hint', tool: 'deep_kinds', hint: 'readOnlyHint', value: true }) });
    await kinds.initialize();
    const kindsTools = await kinds.tools();
    expect(listedAs(kindsTools, 'readOnlyHint'), 'BLOCKED: the planted table lists deep_kinds read-only').toContain('deep_kinds');
    const { rows } = await search(lib);
    const asset = rows.find((r) => r.from?.library === LIB);
    expect(asset, `BLOCKED: the model library offers an asset to fetch: ${brief(rows)}`).toBeDefined();
    const libRead: Reader = async () => (await libraryEvents(lib)) as unknown as Ev[];
    const table = await readOnlyFailures(rig(kinds, kindsTools, libRead), ['deep_kinds'], { doc: LIBRARY_DOC, ask: '', revision: '' }, { library: LIB, id: asset!.id });
    expect(table.failures.filter((f) => f.startsWith('deep_kinds (op: fetch') && f.includes(String(asset!.id))), `the same check fails the planted table on deep_kinds' fetch, naming the asset it brought in (${String(asset!.id)}): ${table.failures.join(' | ') || table.calls.join(' | ')}`).not.toEqual([]);
  }, TEST_MS);
});
