import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { factsAdapter, registry, shipped } from '../../../packages/adapters/src/index.ts';
import type { AdapterEvent } from '../../../packages/adapters/src/index.ts';
import { frozenDigests, frozenDrift, getSchema, listSchemas, registry as schemaRegistry, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import {
  CURSOR_VERSION, cursorCases, cursorFacts, cursorParts, eventFixture, expectAccepted, expectRefused, expectThrown, fixture, getAt, isObject,
  kindSchema, request, setAt, TOOL_KINDS,
} from './helpers.ts';
import type { JsonObject, PlantedSchema } from './helpers.ts';

const EVENT = 'adapter.event@1';
const withCursor = () => {
  const reg = registry();
  reg.register('cursor', factsAdapter(cursorFacts(), cursorParts()));
  return reg;
};
const mapAll = (): { payload: JsonObject; expect: { kind: string; data: JsonObject }; event: AdapterEvent }[] => {
  const reg = withCursor();
  return cursorCases().map((c) => {
    const mapped = reg.mapHook(request('cursor', c.payload), CURSOR_VERSION);
    expect(mapped.verified, `cursor ${String(c.payload.hook_event_name)} payload is verified against its facts`).toBe(true);
    const events = mapped.events.filter((e) => e.kind === c.expect.kind);
    expect(events.length, `one ${c.expect.kind} from ${String(c.payload.hook_event_name)}`).toBe(1);
    return { ...c, event: events[0]! };
  });
};
const asJson = (event: AdapterEvent): JsonValue => event as unknown as JsonValue;

describe('AC7 a test adapter registered as cursor records its events with agent: cursor and a call it can\'t place as kind unknown', () => {
  it('AC7 the adapter registers under cursor beside the shipped ones, and the registry names it', () => {
    const reg = withCursor();
    expect(reg.names()).toContain('cursor');
    expect(reg.get('cursor').facts).toEqual(cursorFacts());
    // The shipped registry does not know cursor; nothing in it was changed for the test adapter to exist.
    expect(shipped().names().sort()).toEqual(['claude', 'codex']);
  });

  it('AC7 every recorded cursor hook maps to its event with agent cursor and the fields the facts decide', () => {
    for (const { payload, expect: want, event } of mapAll()) {
      expect(event.agent, `${String(payload.hook_event_name)}: agent`).toBe('cursor');
      expect(event.kind).toBe(want.kind);
      for (const [key, value] of Object.entries(want.data)) expect(event.data[key], `${String(payload.hook_event_name)}: data.${key}`).toEqual(value);
      expect(event.rule.startsWith('/'), 'the rule is a JSON Pointer into the facts').toBe(true);
    }
  });

  it('AC7 a call the adapter can\'t place (SemanticSearch) is kind unknown, which guards treat as change; an mcp call names its server', () => {
    const byTool = new Map(mapAll().filter((c) => c.event.kind === 'tool.before').map((c) => [String(c.payload.tool_name), c.event.data]));
    expect(byTool.get('SemanticSearch')?.kind).toBe('unknown');
    expect(byTool.get('Shell')?.kind).toBe('shell');
    expect(byTool.get('EditFile')?.kind).toBe('edit');
    expect(byTool.get('EditFile')?.paths).toEqual(['/work/notes.md']);
    expect(byTool.get('mcp__deep__deep_ask')?.kind).toBe('mcp');
    expect(byTool.get('mcp__deep__deep_ask')?.server).toBe('deep');
  });

  it('AC7 every mapped cursor event passes the published adapter event shape, with no change to the schemas', () => {
    const before = { names: listSchemas().map((e) => e.name), frozen: frozenDigests() };
    for (const { event } of mapAll()) expectAccepted(validate(EVENT, asJson(event)), `adapter.event@1 for ${event.kind} from cursor`);
    // Registering cursor added no schema and moved no frozen digest.
    expect(listSchemas().map((e) => e.name)).toEqual(before.names);
    expect(frozenDrift(listSchemas(), before.frozen)).toEqual([]);
    expect(before.names).not.toContain('cursor');
  });

  it('AC7 the published shape\'s agent is not a closed list: any registry-shaped name passes, deep among them (1,000 cases)', () => {
    const event = mapAll()[0]!.event;
    expect(getAt(getSchema(EVENT), '/properties/agent/enum'), 'adapter.event@1 lists no agents at /properties/agent').toBeUndefined();
    fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9-]{0,23}$/), (agent) => {
      expectAccepted(validate(EVENT, setAt(asJson(event), '/agent', agent)), `agent ${agent}`);
    }), { numRuns: 1000 });
    expectAccepted(validate(EVENT, setAt(asJson(event), '/agent', 'deep')), 'agent deep');
    expectRefused(validate(EVENT, setAt(asJson(event), '/agent', '')), '/agent', 'an empty agent');
    expectRefused(validate(EVENT, setAt(asJson(event), '/agent', 'Cursor')), '/agent', 'an agent outside the registry name form');
  });

  it('AC7 a schema whose agent is a closed list refuses the cursor events, naming /agent: the planted twin fails this criterion', () => {
    const planted = fixture('planted', 'adapter-event-closed-agent.json') as unknown as PlantedSchema;
    const twin = schemaRegistry([{ name: planted.name, schema: planted.schema }]);
    for (const { event } of mapAll()) expectRefused(twin.validate(planted.name, asJson(event)), planted.field, `${planted.name} on a cursor ${event.kind}`);
    // The same events pass the published shape, so only the closed list stands between them and the record.
    for (const { event } of mapAll()) expectAccepted(validate(EVENT, asJson(event)), 'the published shape');
  });

  it('AC7 the published tool-call shape takes the unplaced call as kind unknown; a schema whose kinds are a closed list without it refuses, naming /data/kind', () => {
    const unknownCall = mapAll().find((c) => c.payload.tool_name === 'SemanticSearch')!.event;
    const shaped = setAt(eventFixture('tool.before'), '/data', { kind: unknownCall.data.kind!, paths: [], command: null });
    expectAccepted(validate(kindSchema('tool.before'), shaped), 'tool.before with kind unknown');
    const planted = fixture('planted', 'tool-before-closed-kinds.json') as unknown as PlantedSchema;
    const twin = schemaRegistry([{ name: planted.name, schema: planted.schema }]);
    expectRefused(twin.validate(planted.name, shaped), planted.field, `${planted.name} on an unplaced call`);
    for (const kind of TOOL_KINDS) {
      const data: JsonValue = kind === 'mcp' ? { kind, paths: [], command: null, server: 'deep', tool: 'deep_ask' } : { kind, paths: [], command: null };
      expectAccepted(validate(kindSchema('tool.before'), setAt(shaped, '/data', data)), `kind ${kind}`);
    }
    expectRefused(validate(kindSchema('tool.before'), setAt(shaped, '/data/kind', 'semantic_search')), '/data/kind', 'a kind outside the eight');
  });

  it('AC7 agent on an event names an adapter the registry holds, or deep; a request from an unregistered agent is refused, naming /agent', () => {
    const reg = withCursor();
    const payload = cursorCases()[0]!.payload;
    expectThrown(() => reg.mapHook(request('grok', payload), CURSOR_VERSION), '/agent', 'a hook from an agent no adapter was registered for');
    expectThrown(() => shipped().mapHook(request('cursor', payload), CURSOR_VERSION), '/agent', 'cursor against the shipped registry alone');
    expectThrown(() => reg.get('grok'), '/name', 'an adapter nobody registered');
  });

  it('AC7 the facts file is the whole of what cursor added: its data names no core rule by agent, and the adapter maps by its facts alone', () => {
    const facts = cursorFacts();
    expect(isObject(facts) && facts.schema).toBe('adapter.facts@1');
    expect(getAt(facts, '/agent')).toBe('cursor');
    expectAccepted(validate('adapter.facts@1', facts), 'the cursor facts against adapter.facts@1');
    // Renaming the agent in the facts changes nothing about how its payloads map: no rule reads the name.
    const renamed = setAt(facts, '/agent', 'other');
    const reg = registry();
    reg.register('other', factsAdapter(renamed, cursorParts()));
    const [, shell] = cursorCases();
    const mapped = reg.mapHook(request('other', shell!.payload), CURSOR_VERSION).events.map((e) => ({ kind: e.kind, data: e.data }));
    const expected = withCursor().mapHook(request('cursor', shell!.payload), CURSOR_VERSION).events.map((e) => ({ kind: e.kind, data: e.data }));
    expect(mapped).toEqual(expected);
  });
});
