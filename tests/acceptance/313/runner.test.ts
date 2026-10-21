// AC1, AC2, AC5 and AC6: the runner rejects an invalid reply, refuses an adapter the contract can't load, holds
// an adapter to the truth both ways (unsupported never a no-op success, a declared flag never unsupported), and
// reads declared coverage never reached as INVALID and a probe the backend can't make as BLOCKED.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { registry } from '../../../packages/adapters/src/index.ts';
import type { Adapter, Mapped } from '../../../packages/adapters/src/index.ts';
import { runKit } from '../../../packages/conformance/src/index.ts';
import type { Driven, Fill, Operation, Report } from '../../../packages/conformance/src/index.ts';
import {
  adapterKit, clean, countingRunKit, deleteAt, expectThrown, failing, FLAGS, isObject, kitWith, OPERATIONS, resultOf, run, RUNS, setAt, testCase,
  withAdapter,
} from './helpers.ts';

const kit = adapterKit();
const refusalCode = (codes: string[]) => codes.find((c) => ERROR_CODES.includes(c));

describe('the clean fill passes the kit, so every failure below is the fault planted and nothing else', () => {
  it('the kit\'s reference fill reads PASS on every case, headless', () => {
    const report = run(kit, clean(kit));
    expect(report.cases.length, 'the kit has cases').toBeGreaterThan(0);
    expect(report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id}: ${c.outcome} ${c.message}`)).toEqual([]);
    expect(report.verdict).toBe('PASS');
    expect(report.revision).toBe(kit.revision);
  });
});

describe('AC1 the conformance runner rejects a sample adapter that returns an invalid reply', () => {
  it('AC1 a mapHook reply whose event has a number for its kind fails its case with the refusal code and the path into the reply', () => {
    const base = clean(kit);
    const invalid = withAdapter(base, {
      mapHook: (request, version, transcript) => {
        const mapped = base.adapter.mapHook(request, version, transcript);
        return { ...mapped, events: [{ agent: request.agent, kind: 7, data: {}, rule: '/planted' }, ...mapped.events] } as unknown as Mapped;
      },
    });
    const report = run(kit, invalid);
    expect(report.verdict, 'an invalid reply is never a PASS').not.toBe('PASS');
    const rejected = failing(report).filter((c) => c.message.includes('/events/0/kind'));
    expect(rejected.length, `a case names the refused field /events/0/kind (failures: ${failing(report).map((c) => c.message).join(' | ')})`).toBeGreaterThan(0);
    for (const c of rejected) expect(refusalCode(c.codes), `${c.id} carries a refusal code from error@1`).toBeDefined();
  });

  it('AC1 a driven reply outside the typed outcomes (ok or unsupported) fails its case, naming /outcome', () => {
    const base = clean(kit);
    const invalid: Fill = { ...base, drive: () => ({ outcome: 'maybe' }) as unknown as Driven };
    const report = run(kit, invalid);
    expect(report.verdict).not.toBe('PASS');
    const rejected = failing(report).filter((c) => c.message.includes('/outcome'));
    expect(rejected.length, `a case names the refused field /outcome (failures: ${failing(report).map((c) => c.message).join(' | ')})`).toBeGreaterThan(0);
    for (const c of rejected) expect(refusalCode(c.codes)).toBeDefined();
  });

  it('AC1 a mapHook reply that is not a mapping at all (null) is rejected the same way, never a PASS', () => {
    const invalid = withAdapter(clean(kit), { mapHook: () => null as unknown as Mapped });
    const report = run(kit, invalid);
    expect(report.verdict).not.toBe('PASS');
    expect(failing(report).some((c) => refusalCode(c.codes) !== undefined), 'the null reply is refused with an error@1 code').toBe(true);
  });
});

describe('AC2 an adapter without doctor() or facts that name the versions they cover fails conformance; an optional method declared without its conformance test is refused at load', () => {
  it('AC2 an adapter with no doctor() is refused at /adapter/doctor before any case runs', () => {
    const fill = withAdapter(clean(kit), { doctor: undefined as unknown as Adapter['doctor'] });
    expectThrown(() => run(kit, fill), '/adapter/doctor', 'a fill whose adapter has no doctor()');
  });

  it('AC2 facts with no versions, or an empty list, are refused at /adapter/facts/versions', () => {
    const base = clean(kit);
    expectThrown(() => run(kit, withAdapter(base, { facts: deleteAt(base.adapter.facts, '/versions') })), '/adapter/facts/versions', 'facts naming no versions');
    expectThrown(() => run(kit, withAdapter(base, { facts: setAt(base.adapter.facts, '/versions', []) })), '/adapter/facts/versions', 'facts covering no version');
  });

  it('AC2 readUsage implemented with no facts section naming its conformance case is refused at load, at the kit and at the registry', () => {
    const base = clean(kit);
    const facts = base.adapter.facts;
    const withoutCase = isObject(facts) && isObject(facts.readUsage) ? deleteAt(facts, '/readUsage/conformance') : deleteAt(setAt(facts, '/readUsage', { readBy: 'usage', conformance: 'x' }), '/readUsage/conformance');
    const fill = withAdapter(base, { facts: withoutCase, readUsage: () => [] });
    expectThrown(() => run(kit, fill), '/adapter/facts/readUsage/conformance', 'readUsage declared with no conformance case');
    // The same refusal at the registry (#312's load), so the two loads agree on the field.
    expectThrown(() => registry().register('planted', fill.adapter), '/facts/readUsage/conformance', 'registering it');
    // With the section absent altogether the refusal names the section.
    const noSection = withAdapter(base, { facts: isObject(facts) && 'readUsage' in facts ? deleteAt(facts, '/readUsage') : facts, readUsage: () => [] });
    expectThrown(() => run(kit, noSection), '/adapter/facts/readUsage', 'readUsage declared with no facts section');
  });

  it('AC2 the clean fill\'s doctor() answers in the doctor shape, so the refusals above are about absence, not shape', () => {
    const items = clean(kit).adapter.doctor();
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(typeof item.code).toBe('string');
      expect(['ok', 'warn', 'fail', 'skip']).toContain(item.level);
    }
  });
});

describe('AC5 an operation listed in adapter.unsupported returns the typed unsupported outcome, never a no-op success; a declared flag never returns unsupported', () => {
  const surface = 'cli';
  /** The clean fill moved to the cli surface with followUp listed as unsupported there and its flag down. */
  const listing = (base: Fill, operation: Operation, reply: Driven): Fill => ({
    ...base,
    surface,
    adapter: { ...base.adapter, caps: { ...base.adapter.caps, [operation]: false }, unsupported: { ...base.adapter.unsupported, [surface]: [operation] } },
    drive: (op, input, session) => (op === operation ? reply : base.drive(op, input, session)),
  });
  const okReply: Driven = { outcome: 'ok', events: [] };

  it('AC5 a fake listing followUp unsupported for cli that returns ok from followUp fails, naming followUp and cli', () => {
    const report = run(kit, listing(clean(kit), 'followUp', okReply));
    expect(report.verdict).not.toBe('PASS');
    const named = failing(report).filter((c) => c.message.includes('followUp') && c.message.includes(surface));
    expect(named.length, `a failure names followUp and cli (failures: ${failing(report).map((c) => c.message).join(' | ')})`).toBeGreaterThan(0);
  });

  it('AC5 the same fake returning {outcome: unsupported, operation: followUp, surface: cli} passes', () => {
    const report = run(kit, listing(clean(kit), 'followUp', { outcome: 'unsupported', operation: 'followUp', surface }));
    expect(report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id}: ${c.outcome} ${c.message}`)).toEqual([]);
    expect(report.verdict).toBe('PASS');
  });

  it('AC5 an unsupported reply that names another operation or another surface is not the typed outcome for followUp on cli', () => {
    for (const reply of [
      { outcome: 'unsupported', operation: 'steer', surface } as Driven,
      { outcome: 'unsupported', operation: 'followUp', surface: 'app-server' } as Driven,
    ]) {
      const report = run(kit, listing(clean(kit), 'followUp', reply));
      expect(report.verdict, `reply ${JSON.stringify(reply)}`).not.toBe('PASS');
      expect(failing(report).some((c) => c.message.includes('followUp')), 'the failure names followUp').toBe(true);
    }
  });

  it('AC5 a fake whose caps declare followUp but whose followUp returns unsupported fails, naming the flag', () => {
    const base = clean(kit);
    const declared: Fill = {
      ...base,
      adapter: { ...base.adapter, caps: { ...base.adapter.caps, followUp: true }, unsupported: { ...base.adapter.unsupported, [base.surface]: [] } },
      drive: (op, input, session) => (op === 'followUp' ? { outcome: 'unsupported', operation: 'followUp', surface: base.surface } : base.drive(op, input, session)),
    };
    const report = run(kit, declared);
    expect(report.verdict).not.toBe('PASS');
    expect(failing(report).some((c) => c.message.includes('followUp')), `a failure names the flag followUp (failures: ${failing(report).map((c) => c.message).join(' | ')})`).toBe(true);
  });

  it('AC5 for every driven operation and any surface name, listing it unsupported and answering ok fails naming both (1,000 cases)', () => {
    const base = clean(kit);
    fc.assert(fc.property(fc.constantFrom(...OPERATIONS), fc.stringMatching(/^[a-z][a-z-]{0,11}$/), (operation, name) => {
      const fill: Fill = {
        ...base,
        surface: name,
        adapter: { ...base.adapter, caps: { ...base.adapter.caps, [operation]: false }, unsupported: { ...base.adapter.unsupported, [name]: [operation] } },
        drive: (op, input, session) => (op === operation ? okReply : base.drive(op, input, session)),
      };
      const report = run(kit, fill);
      expect(report.verdict, `${operation} on ${name}`).not.toBe('PASS');
      expect(failing(report).some((c) => c.message.includes(operation) && c.message.includes(name)), `a failure names ${operation} and ${name}`).toBe(true);
    }), RUNS);
  });
});

describe('AC6 declared coverage never reached reads INVALID; a probe the headless harness can\'t make reads BLOCKED, naming the probe', () => {
  const only = (report: Report, id: string) => resultOf(report, id);

  it('AC6 a case that declares answerPermission but returns before any permission request reaches the adapter reads INVALID, "declared answerPermission, never reached"', () => {
    const early = testCase('test/early-return', { flags: ['answerPermission'] }, () => {});
    const report = run(kitWith(kit, { cases: [early] }), clean(kit));
    const result = only(report, early.id);
    expect(result.outcome).toBe('INVALID');
    expect(result.message).toContain('declared answerPermission, never reached');
    expect(result.reached.flags).not.toContain('answerPermission');
    expect(report.verdict, 'a runner that counts it as passed fails here').not.toBe('PASS');
  });

  it('AC6 the same case that sends a permission request reaches answerPermission and is not INVALID for coverage', () => {
    const request: JsonValue = { kind: 'tool', tool: 'Bash', command: 'npm test' };
    const reaching = testCase('test/reaching', { flags: ['answerPermission'] }, (h) => { h.permission(request, 'sess_01'); });
    const result = only(run(kitWith(kit, { cases: [reaching] }), clean(kit)), reaching.id);
    expect(result.reached.flags).toContain('answerPermission');
    expect(result.message).not.toContain('never reached');
  });

  it('AC6 a panel case whose bounds probe gets no geometry from the headless harness reads BLOCKED, naming the probe', () => {
    const panel = testCase('test/panel-bounds', {}, (h) => { h.bounds('panel'); });
    const report = runKit(kitWith(kit, { cases: [panel] }), clean(kit), { headless: true });
    const result = only(report, panel.id);
    expect(result.outcome).toBe('BLOCKED');
    expect(result.message).toContain('bounds');
    expect(result.probes).toContain('bounds');
    expect(report.verdict, 'a runner that counts it as passed fails here').not.toBe('PASS');
  });

  it('AC6 for every non-empty set of declared flags, operations and kinds a case never reaches, the case is INVALID naming each (1,000 cases)', () => {
    const base = clean(kit);
    const kinds = ['session.start', 'tool.before', 'tool.after', 'agent.stop', 'permission.request', 'user.ask'];
    fc.assert(fc.property(fc.subarray([...FLAGS]), fc.subarray([...OPERATIONS]), fc.subarray(kinds), (flags, operations, declaredKinds) => {
      fc.pre(flags.length + operations.length + declaredKinds.length > 0);
      const idle = testCase('test/idle', { flags, operations, kinds: declaredKinds }, () => {});
      const result = only(run(kitWith(kit, { cases: [idle] }), base), idle.id);
      expect(result.outcome).toBe('INVALID');
      for (const item of [...flags, ...operations, ...declaredKinds]) expect(result.message).toContain(`declared ${item}, never reached`);
    }), RUNS);
  });

  it('AC6 (wrong program) a runner that counts INVALID or BLOCKED as passed is caught by this test\'s assertions', () => {
    const early = testCase('test/early-return', { flags: ['answerPermission'] }, () => {});
    const panel = testCase('test/panel-bounds', {}, (h) => { h.bounds('panel'); });
    const report = countingRunKit(kitWith(kit, { cases: [early, panel] }), clean(kit));
    // The assertions above, applied to the counting runner's report, fail on both cases.
    expect(() => expect(only(report, early.id).outcome).toBe('INVALID')).toThrow();
    expect(() => expect(only(report, panel.id).outcome).toBe('BLOCKED')).toThrow();
    expect(() => expect(report.verdict).not.toBe('PASS')).toThrow();
  });
});
