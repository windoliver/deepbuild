import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { factsAdapter, registry, shipped } from '../../../packages/adapters/src/index.ts';
import type { Adapter, AdapterParts, TurnUsage } from '../../../packages/adapters/src/index.ts';
import { lintSchemas, listSchemas, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import {
  asAdapter, ATTENTION, CAP_NAMES, claudeFacts, codexFacts, cursorFacts, cursorParts, deleteAt, eventFixture, expectAccepted, expectRefused,
  expectThrown, FACTS_SECTIONS, getAt, isObject, kindSchema, NO_CAPS, setAt,
} from './helpers.ts';

const FACTS = 'adapter.facts@1';
const CAPS = 'adapter.caps@1';
const UNSUPPORTED = 'adapter.unsupported@1';
const cursor = (): Adapter => factsAdapter(cursorFacts(), cursorParts());
const register = (name: string, adapter: Adapter) => () => registry().register(name, adapter);

describe('the adapter contract publishes its shapes beside the core schemas', () => {
  it('adapter.facts@1, adapter.caps@1, adapter.unsupported@1, adapter.event@1, permission.answer@1, permission.request and turn.usage are published, linted and frozen', () => {
    const names = new Set(listSchemas().map((e) => e.name));
    for (const name of [FACTS, CAPS, UNSUPPORTED, 'adapter.event@1', 'permission.answer@1']) expect(names.has(name), `${name} is published`).toBe(true);
    expect(names.has(kindSchema('permission.request'))).toBe(true);
    expect(names.has(kindSchema('turn.usage'))).toBe(true);
    expect(lintSchemas(listSchemas())).toEqual([]);
  });
});

describe('adapter.facts@1 names the agent versions it covers, and each field names the core rule that reads it with a conformance case', () => {
  it.each([['claude', claudeFacts], ['codex', codexFacts], ['cursor', cursorFacts]] as const)('the %s facts file is a valid adapter.facts@1 naming versions', (agent, read) => {
    const facts = read();
    expectAccepted(validate(FACTS, facts), `${agent} facts`);
    expect(getAt(facts, '/schema')).toBe(FACTS);
    const versions = getAt(facts, '/versions');
    expect(Array.isArray(versions) && versions.length > 0, `${agent} facts name at least one version`).toBe(true);
    for (const version of versions as JsonValue[]) {
      expect(typeof version).toBe('string');
      expect(isObject(getAt(facts, `/events/versions/${String(version)}`)), `${agent} facts carry ${String(version)}'s payload schemas`).toBe(true);
    }
  });

  it('facts without versions, with none, or with one that is not a version string, fail naming /versions', () => {
    const facts = cursorFacts();
    expectRefused(validate(FACTS, deleteAt(facts, '/versions')), '/versions', 'facts with no versions');
    expectRefused(validate(FACTS, setAt(facts, '/versions', [])), '/versions', 'facts covering no version');
    expectRefused(validate(FACTS, setAt(facts, '/versions', '1.7.0')), '/versions', 'versions as one string');
    expectRefused(validate(FACTS, setAt(facts, '/versions', [7])), '/versions/0', 'a version as a number');
    expectThrown(register('cursor', factsAdapter(deleteAt(facts, '/versions'), cursorParts())), '/facts/versions', 'registering facts with no versions');
  });

  it.each(FACTS_SECTIONS)('the %s field is required, names the rule that reads it (readBy) and its conformance case', (section) => {
    const facts = cursorFacts();
    expect(isObject(getAt(facts, `/${section}`)), `the cursor facts carry ${section}`).toBe(true);
    // A schema that leaves the field or its readBy optional accepts these and fails here.
    expectRefused(validate(FACTS, deleteAt(facts, `/${section}`)), `/${section}`, `facts without ${section}`);
    expectRefused(validate(FACTS, deleteAt(facts, `/${section}/readBy`)), `/${section}/readBy`, `${section} naming no core rule`);
    expectRefused(validate(FACTS, setAt(facts, `/${section}/readBy`, '')), `/${section}/readBy`, `${section} with an empty readBy`);
    expectRefused(validate(FACTS, deleteAt(facts, `/${section}/conformance`)), `/${section}/conformance`, `${section} naming no conformance case`);
    expectRefused(validate(FACTS, setAt(facts, `/${section}/conformance`, '')), `/${section}/conformance`, `${section} with an empty conformance case`);
    expectThrown(register('cursor', factsAdapter(deleteAt(facts, `/${section}/readBy`), cursorParts())), `/facts/${section}/readBy`, `registering ${section} with no readBy`);
  });

  it('the shipped facts carry every listed field with its readBy and conformance case', () => {
    for (const [agent, facts] of [['claude', claudeFacts()], ['codex', codexFacts()]] as const) {
      for (const section of FACTS_SECTIONS) {
        expect(typeof getAt(facts, `/${section}/readBy`), `${agent} ${section}.readBy`).toBe('string');
        expect(typeof getAt(facts, `/${section}/conformance`), `${agent} ${section}.conformance`).toBe('string');
      }
    }
  });

  it('a facts file with an unlisted field fails, naming it, and a facts file for another schema fails at /schema', () => {
    expectRefused(validate(FACTS, setAt(cursorFacts(), '/planted', { readBy: 'nobody', conformance: 'none' })), '/planted', 'an unlisted facts field');
    expectRefused(validate(FACTS, setAt(cursorFacts(), '/schema', 'adapter.facts@2')), '/schema', 'facts of another version');
  });
});

describe('an adapter registers with facts, caps, what it can\'t do and doctor(), each held to its shape', () => {
  it('adapter.caps@1 names every flag, followUp, rewrite, editInput, errorTurnHook and startTurn among them, each a boolean', () => {
    expectAccepted(validate(CAPS, { ...NO_CAPS }), 'no caps');
    expectAccepted(validate(CAPS, Object.fromEntries(CAP_NAMES.map((c) => [c, true]))), 'every cap');
    for (const cap of ['followUp', 'rewrite', 'editInput', 'errorTurnHook', 'startTurn', 'holdStop', 'wakeIdle', 'steer', 'answerPermission', 'nativeTools', 'mcp']) {
      expect(CAP_NAMES as readonly string[]).toContain(cap);
      expectRefused(validate(CAPS, deleteAt({ ...NO_CAPS }, `/${cap}`)), `/${cap}`, `caps without ${cap}`);
      expectRefused(validate(CAPS, setAt({ ...NO_CAPS }, `/${cap}`, 'yes')), `/${cap}`, `${cap} as text`);
    }
    expectRefused(validate(CAPS, { ...NO_CAPS, planted: true }), '/planted', 'a cap outside the closed set');
    expectThrown(register('cursor', { ...cursor(), caps: deleteAt({ ...NO_CAPS }, '/startTurn') as unknown as Adapter['caps'] }), '/caps/startTurn', 'registering without startTurn');
  });

  it('adapter.unsupported@1 lists, per surface, the driven operations the adapter can\'t do', () => {
    expectAccepted(validate(UNSUPPORTED, { terminal: ['steer', 'interrupt'] }), 'a terminal that cannot steer or interrupt');
    expectAccepted(validate(UNSUPPORTED, {}), 'nothing unsupported');
    expectAccepted(validate(UNSUPPORTED, { 'app-server': [], desktop: ['startTurn', 'followUp', 'respond', 'history'] }), 'two surfaces');
    expectRefused(validate(UNSUPPORTED, { terminal: ['fly'] }), '/terminal/0', 'an operation outside the driven contract');
    expectRefused(validate(UNSUPPORTED, { terminal: 'steer' }), '/terminal', 'operations not as a list');
    expectThrown(register('cursor', { ...cursor(), unsupported: { terminal: ['fly'] } }), '/unsupported/terminal/0', 'registering an unknown operation');
    expect(shipped().get('codex').unsupported).toBeDefined();
    expectAccepted(validate(UNSUPPORTED, shipped().get('codex').unsupported), 'the shipped Codex adapter\'s unsupported list');
    expectAccepted(validate(UNSUPPORTED, shipped().get('claude').unsupported), 'the shipped Claude Code adapter\'s unsupported list');
  });

  it('doctor() is required: an adapter without it is refused naming /doctor, and each finding is ok, warn, fail or skip with its evidence and one fix', () => {
    const noDoctor: Partial<Adapter> = { ...cursor() };
    delete noDoctor.doctor;
    expectThrown(register('cursor', asAdapter(noDoctor)), '/doctor', 'an adapter with no doctor');
    for (const adapter of [cursor(), shipped().get('claude'), shipped().get('codex')]) {
      const items = adapter.doctor();
      expect(Array.isArray(items)).toBe(true);
      for (const item of items) {
        expect(item.code).toMatch(/^[a-z][a-z0-9_.-]*$/);
        expect(['ok', 'warn', 'fail', 'skip']).toContain(item.level);
        expect(item.evidence.length).toBeGreaterThan(0);
        expect(item.fix.length).toBeGreaterThan(0);
      }
    }
    // The cursor doctor never ran its check, so it reads not checked, never ok.
    expect(cursor().doctor().map((i) => i.level)).toEqual(['skip']);
  });

  it('facts are required: an adapter without facts, or with facts that are not adapter.facts@1, is refused naming /facts', () => {
    const noFacts: Partial<Adapter> = { ...cursor() };
    delete noFacts.facts;
    expectThrown(register('cursor', asAdapter(noFacts)), '/facts', 'an adapter with no facts');
    expectThrown(register('cursor', { ...cursor(), facts: { schema: 'adapter.facts@1' } }), '/facts/versions', 'facts with nothing in them');
  });

  it('a registry name is one lower-case word; deep is reserved for the hub\'s own events; one adapter fills a name once', () => {
    expectThrown(register('deep', cursor()), '/name', 'registering as deep');
    for (const bad of ['Cursor', 'cursor adapter', 'cursor_1', '', '-cursor', 'cursor/1']) expectThrown(register(bad, cursor()), '/name', `name ${JSON.stringify(bad)}`);
    const reg = registry();
    reg.register('cursor', cursor());
    expectThrown(() => reg.register('cursor', cursor()), '/name', 'a second adapter under one name');
    fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9-]{0,23}$/).filter((n) => n !== 'deep'), (name) => {
      const fresh = registry();
      fresh.register(name, cursor());
      expect(fresh.names()).toEqual([name]);
    }), { numRuns: 1000 });
  });
});

describe('optional readUsage(), classifyStop() and skills() ship only with their conformance case', () => {
  const noUsage = (): TurnUsage => ({ turn: 't', model: 'm', covers: 'turn', tokens: { input: 0, cached: 0, output: 0, exact: false }, cost: { basis: 'unpriced' } });
  const withOptional = (facts: JsonValue, parts: Partial<AdapterParts>): Adapter => factsAdapter(facts, { ...cursorParts(), ...parts });
  const optional: [string, Partial<AdapterParts>][] = [
    ['readUsage', { readUsage: () => [noUsage()] }],
    ['classifyStop', { classifyStop: () => ({ cause: 'unknown' }) }],
    ['skills', { skills: () => [] }],
  ];

  it.each(optional)('an adapter that implements %s registers only when its facts name that operation\'s conformance case', (operation, parts) => {
    const facts = cursorFacts();
    // The cursor facts name no case for the operation, so the adapter can't ship it.
    expectThrown(register('cursor', withOptional(facts, parts)), `/facts/${operation}`, `${operation} with no conformance case`);
    const partial = setAt(facts, `/${operation}`, { readBy: 'the rule that reads this operation' });
    expectThrown(register('cursor', withOptional(partial, parts)), `/facts/${operation}/conformance`, `${operation} naming no case`);
    const named = setAt(facts, `/${operation}`, { readBy: 'the rule that reads this operation', conformance: `cursor/${operation}/case` });
    expect(register('cursor', withOptional(named, parts))).not.toThrow();
    // Without the operation, the case is not required.
    expect(register('cursor', factsAdapter(facts, cursorParts()))).not.toThrow();
  });

  it('the shipped adapters that read usage name their conformance case in their facts', () => {
    for (const [name, facts] of [['claude', claudeFacts()], ['codex', codexFacts()]] as const) {
      const adapter = shipped().get(name);
      for (const operation of ['readUsage', 'classifyStop', 'skills'] as const) {
        if (adapter[operation] === undefined) continue;
        expect(typeof getAt(facts, `/${operation}/conformance`), `${name} ${operation} names its conformance case`).toBe('string');
        expect(typeof getAt(adapter.facts, `/${operation}/conformance`), `${name}'s registered facts are the file's`).toBe('string');
      }
      expect(adapter.readUsage, `${name} reads usage (AC5 and AC4 are proven through it)`).toBeDefined();
    }
  });
});

describe('attention events say a session finished, failed, waits on a permission or is unknown', () => {
  it.each(ATTENTION)('state %s passes', (state) => {
    expectAccepted(validate(kindSchema('session.attention'), setAt(eventFixture('session.attention'), '/data/state', state)), `attention ${state}`);
  });
  it.each(['done', 'idle', 'waiting', 'silent'])('state %j fails, naming /data/state', (state) => {
    expectRefused(validate(kindSchema('session.attention'), setAt(eventFixture('session.attention'), '/data/state', state)), '/data/state', `attention ${state}`);
  });
});

describe('a tool call by kind carries its paths and command, and an mcp call its server and tool', () => {
  it('an mcp call without its server or tool fails, naming the field; a shell call carries its command', () => {
    const mcp = setAt(eventFixture('tool.before'), '/data', { kind: 'mcp', paths: [], command: null, server: 'deep', tool: 'deep_ask' });
    expectAccepted(validate(kindSchema('tool.before'), mcp), 'an mcp call');
    expectRefused(validate(kindSchema('tool.before'), deleteAt(mcp, '/data/server')), '/data/server', 'an mcp call with no server');
    expectRefused(validate(kindSchema('tool.before'), deleteAt(mcp, '/data/tool')), '/data/tool', 'an mcp call with no tool');
    const shell = setAt(eventFixture('tool.before'), '/data', { kind: 'shell', paths: [], command: 'npm test' });
    expectAccepted(validate(kindSchema('tool.before'), shell), 'a shell call');
    expectRefused(validate(kindSchema('tool.before'), deleteAt(shell, '/data/command')), '/data/command', 'a shell call with no command field');
  });

  it('the Claude Code adapter records an MCP call as kind mcp with its server and tool', () => {
    const payload: JsonValue = {
      session_id: '91f2090e-a2d2-4a41-8794-29ef39f50422', transcript_path: '~/.claude/projects/-work/91f2090e.jsonl', cwd: '/work',
      hook_event_name: 'PreToolUse', tool_name: 'mcp__deep__deep_ask', tool_input: { question: 'merge?' }, tool_use_id: 'toolu_01Mcp0000000000000000001',
    };
    const mapped = shipped().mapHook({ v: 1, agent: 'claude', event: 'PreToolUse', seq: '1760013451123456789', id: '01K74FKZVK8Q2X5R7M3N9P4T6W', pid: 1, ppid: 1, matched: [], payload }, '2.1.304');
    const [event] = mapped.events.filter((e) => e.kind === 'tool.before');
    expect(event?.data.kind).toBe('mcp');
    expect(event?.data.server).toBe('deep');
    expect(event?.data.tool).toBe('deep_ask');
  });
});
