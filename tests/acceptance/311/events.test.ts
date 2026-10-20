import { describe, expect, it } from 'vitest';
import { catalogue, fixtures, getSchema, listSchemas, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import {
  catalogueTableKinds, clone, deleteAt, DESIGN_KINDS, eventFixture, expectAccepted, expectRefused, firstFixture,
  getAt, isObject, kindSchema, setAt,
} from './helpers.ts';

describe('AC1 every event kind in the design has a schema with a version field', () => {
  it('AC1 the kinds the design documents (and the live catalogue table) are catalogued, each with a schema and a version', () => {
    const tableKinds = catalogueTableKinds();
    // The base's table has every hard-coded kind; a live table that grew adds its own rows here.
    expect(tableKinds).toEqual(expect.arrayContaining([...DESIGN_KINDS]));
    const names = new Set(listSchemas().map((e) => e.name));
    for (const kind of new Set([...DESIGN_KINDS, ...tableKinds])) {
      const entry = catalogue().find((e) => e.kind === kind);
      expect(entry, `${kind} is in the catalogue`).toBeDefined();
      expect(Number.isInteger(entry!.version) && entry!.version >= 1, `${kind} has a version ≥ 1`).toBe(true);
      expect(names.has(entry!.schema), `${kind}'s schema ${entry!.schema} is a published schema`).toBe(true);
      expect(isObject(getSchema(entry!.schema)), `${kind}'s schema is a JSON Schema object`).toBe(true);
    }
  });

  it.each(DESIGN_KINDS)('AC1 %s: every fixture carries its version in v, and an event without v or at another version fails', (kind) => {
    const name = kindSchema(kind);
    const version = catalogue().find((e) => e.kind === kind)!.version;
    const all = fixtures(name);
    expect(all.length, `${name} has at least one valid fixture`).toBeGreaterThan(0);
    for (const event of all) {
      expectAccepted(validate(name, event), `${kind} fixture`);
      expect(getAt(event, '/kind'), `${kind} fixture's kind`).toBe(kind);
      expect(getAt(event, '/v'), `${kind} fixture's v is the catalogued version`).toBe(version);
    }
    const event = all[0]!;
    // A schema with no version field accepts the event with v removed.
    expectRefused(validate(name, deleteAt(event, '/v')), '/v', `${kind} without v`);
    expectRefused(validate(name, setAt(event, '/v', version + 1)), '/v', `${kind} at version ${version + 1}`);
    expectRefused(validate(name, setAt(event, '/v', String(version))), '/v', `${kind} with v as a string`);
  });
});

describe('AC2 an event without an actor and a scope, or an ask without an addressee, fails its schema', () => {
  it.each(DESIGN_KINDS)('AC2 %s without actor, or without scope, fails naming the field', (kind) => {
    const name = kindSchema(kind);
    const event = eventFixture(kind);
    expect(typeof getAt(event, '/actor'), `${kind} fixture names its actor`).toBe('string');
    expect(typeof getAt(event, '/scope'), `${kind} fixture names its scope`).toBe('string');
    // A schema that leaves actor or scope optional accepts these.
    expectRefused(validate(name, deleteAt(event, '/actor')), '/actor', `${kind} without actor`);
    expectRefused(validate(name, deleteAt(event, '/scope')), '/scope', `${kind} without scope`);
  });

  it('AC2 an ask without its owner (who it is for) fails, and so does a task', () => {
    const ask = eventFixture('ask.created');
    expectAccepted(validate(kindSchema('ask.created'), ask), 'ask.created fixture');
    expectRefused(validate(kindSchema('ask.created'), deleteAt(ask, '/data/owner')), '/data/owner', 'ask without owner');
    const task = eventFixture('task.created');
    expectRefused(validate(kindSchema('task.created'), deleteAt(task, '/data/owner')), '/data/owner', 'task without owner');
  });

  it('AC22 / Added Oct 9: every event kind schema refuses an event that adds a field it does not list', () => {
    for (const kind of DESIGN_KINDS) {
      const event = eventFixture(kind);
      expectRefused(validate(kindSchema(kind), setAt(event, '/planted_extra', 'x')), '/planted_extra', `${kind} with an unlisted field`);
    }
  });
});

describe('AC4 an assertion without an oracle, or an ask without a deadline, a fallback and a default, fails its schema', () => {
  const oracles = ['code', 'model', 'person'];

  it.each([
    ['definition.locked', '/data/requirements/0/oracle'],
    ['verdict.made', '/data/requirements/0/oracle'],
  ])('AC4 %s: a requirement without its oracle, or with one outside code, model and person, fails naming %s', (kind, path) => {
    const name = kindSchema(kind);
    const event = eventFixture(kind);
    expect(oracles, `${kind} fixture's requirement names an oracle`).toContain(getAt(event, path));
    for (const oracle of oracles) expectAccepted(validate(name, setAt(event, path, oracle)), `${kind} oracle ${oracle}`);
    expectRefused(validate(name, deleteAt(event, path)), path, `${kind} requirement without an oracle`);
    expectRefused(validate(name, setAt(event, path, 'agent')), path, `${kind} requirement with oracle agent`);
  });

  it('AC4 check@1: a check without its oracle fails naming /oracle', () => {
    const check = firstFixture('check@1');
    expectAccepted(validate('check@1', check), 'check@1 fixture');
    for (const oracle of oracles) expectAccepted(validate('check@1', setAt(check, '/oracle', oracle)), `check oracle ${oracle}`);
    expectRefused(validate('check@1', deleteAt(check, '/oracle')), '/oracle', 'check without an oracle');
    expectRefused(validate('check@1', setAt(check, '/oracle', 'agent')), '/oracle', 'check with oracle agent');
  });

  it.each(['deadline', 'fallback', 'default'])('AC4 an ask without its %s fails naming the field', (field) => {
    const ask = eventFixture('ask.created');
    const path = `/data/${field}`;
    expect(getAt(ask, path), `ask.created fixture has a ${field}`).toBeDefined();
    // A schema that leaves the field optional accepts this.
    expectRefused(validate(kindSchema('ask.created'), deleteAt(ask, path)), path, `ask without ${field}`);
  });

  it("AC4 an ask's kind comes from the one closed list of six", () => {
    const ask = eventFixture('ask.created');
    expect(['authority', 'unblock', 'taste', 'exception', 'choice', 'definition']).toContain(getAt(ask, '/data/kind'));
    expectRefused(validate(kindSchema('ask.created'), setAt(ask, '/data/kind', 'favor')), '/data/kind', 'ask kind favor');
  });
});

describe('AC6 an ask without what it is pinned to fails its schema', () => {
  it('AC6 ask.created without pinned_to fails naming /data/pinned_to', () => {
    const ask = eventFixture('ask.created');
    expect(getAt(ask, '/data/pinned_to'), 'the ask.created fixture is pinned').toBeDefined();
    expectRefused(validate(kindSchema('ask.created'), deleteAt(ask, '/data/pinned_to')), '/data/pinned_to', 'ask without pinned_to');
    expectRefused(validate(kindSchema('ask.created'), setAt(ask, '/data/pinned_to', null)), '/data/pinned_to', 'ask pinned to null');
  });
});

describe('AC11 user.ask names where it came from', () => {
  const FROM = ['person', 'scheduled', 'subagent', 'session', 'continuation', 'unknown'];
  const name = () => kindSchema('user.ask');

  it('AC11 a user.ask without from fails, naming the field', () => {
    // The first fixture: a schema that leaves from optional passes it, and fails this test.
    expectRefused(validate(name(), deleteAt(eventFixture('user.ask'), '/data/from')), '/data/from', 'user.ask without from');
  });

  it.each(['robot', 'agent', 'Person', '', 'person '])('AC11 a user.ask with from %j fails, naming the field', (from) => {
    expectRefused(validate(name(), setAt(eventFixture('user.ask'), '/data/from', from)), '/data/from', `user.ask from ${JSON.stringify(from)}`);
  });

  it.each(FROM)('AC11 one fixture with from %s passes', (from) => {
    const event: JsonValue = setAt(eventFixture('user.ask'), '/data/from', from);
    expectAccepted(validate(name(), event), `user.ask from ${from}`);
  });
});

describe('Scope: guard@1 is {match, scope, mode: watch | warn | block, reason, next_step, fail_closed}', () => {
  it('guard@1 takes each mode, refuses any other, and needs each named field', () => {
    const guard = firstFixture('guard@1');
    expectAccepted(validate('guard@1', guard), 'guard@1 fixture');
    for (const mode of ['watch', 'warn', 'block']) expectAccepted(validate('guard@1', setAt(guard, '/mode', mode)), `mode ${mode}`);
    expectRefused(validate('guard@1', setAt(guard, '/mode', 'deny')), '/mode', 'mode deny');
    for (const field of ['match', 'scope', 'mode', 'reason', 'next_step', 'fail_closed']) {
      expect(isObject(guard) && Object.hasOwn(guard, field), `guard@1 fixture has ${field}`).toBe(true);
      expectRefused(validate('guard@1', deleteAt(clone(guard), `/${field}`)), `/${field}`, `guard without ${field}`);
    }
    expectRefused(validate('guard@1', setAt(guard, '/fail_closed', 'yes')), '/fail_closed', 'fail_closed as a string');
  });
});
