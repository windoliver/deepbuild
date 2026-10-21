// AC9: a fake adapter whose facts leave out a field a core rule reads (the Stop hook's timeout) fails conformance,
// naming the field and the rule that reads it; a facts field that names no core rule fails the schema, naming
// the field. A facts schema of free-form fields would pass the first fake and fails this test.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getSchema, registry as schemaRegistry, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Schema } from '../../../packages/contracts/src/index.ts';
import { adapterKit, clean, deleteAt, expectAccepted, expectRefused, FACTS, failing, getAt, isObject, run, RUNS, setAt, withAdapter } from './helpers.ts';

const kit = adapterKit();
const STOP_TIMEOUT = '/hookTimeouts/perHook/Stop';
const facts = (): JsonValue => clean(kit).adapter.facts;

describe('AC9 facts leaving out a field a core rule reads fail conformance, naming the field and the rule', () => {
  it('AC9 the clean fill\'s facts carry the Stop hook\'s timeout and the rule that reads hook timeouts, and validate', () => {
    const f = facts();
    expectAccepted(validate(FACTS, f), 'the clean fill\'s facts');
    expect(typeof getAt(f, STOP_TIMEOUT), 'the Stop hook\'s timeout is a number of ms').toBe('number');
    expect(typeof getAt(f, '/hookTimeouts/readBy')).toBe('string');
  });

  it('AC9 with the Stop hook\'s timeout left out, the fill fails conformance, naming the field and the rule that reads it', () => {
    const base = clean(kit);
    const rule = String(getAt(base.adapter.facts, '/hookTimeouts/readBy'));
    const report = run(kit, withAdapter(base, { facts: deleteAt(base.adapter.facts, STOP_TIMEOUT) }));
    expect(report.verdict).not.toBe('PASS');
    const named = failing(report).filter((c) => c.message.includes('hookTimeouts') && c.message.includes('Stop'));
    expect(named.length, `a failure names the field hookTimeouts.perHook.Stop (failures: ${failing(report).map((c) => c.message).join(' | ')})`).toBeGreaterThan(0);
    expect(named.some((c) => c.message.includes(rule)), `a failure names the rule that reads it: "${rule}"`).toBe(true);
  });

  it('AC9 with the whole hookTimeouts section left out, the fill is refused at load, naming the section', () => {
    const base = clean(kit);
    let thrown: unknown;
    try { run(kit, withAdapter(base, { facts: deleteAt(base.adapter.facts, '/hookTimeouts') })); } catch (error) { thrown = error; }
    expect(thrown, 'facts without hookTimeouts are refused').toBeDefined();
    expect(String((thrown as Error).message)).toContain('hookTimeouts');
  });

  it('AC9 a facts field that names no core rule fails the schema, naming the field: an empty or missing readBy, and a field the schema does not list', () => {
    const f = facts();
    expectRefused(validate(FACTS, setAt(f, '/hookTimeouts/readBy', '')), '/hookTimeouts/readBy', 'hookTimeouts naming no core rule');
    expectRefused(validate(FACTS, deleteAt(f, '/hookTimeouts/readBy')), '/hookTimeouts/readBy', 'hookTimeouts with no readBy');
    expectRefused(validate(FACTS, setAt(f, '/hookTimeouts/freeForm', 'anything')), '/hookTimeouts/freeForm', 'a field no rule reads inside a section');
    expectRefused(validate(FACTS, setAt(f, '/mood', { readBy: 'nothing', conformance: 'none' })), '/mood', 'a section the schema does not list');
  });

  it('AC9 for any field name the schema does not list, at the root or in a section, the facts are refused at that field (1,000 cases)', () => {
    const f = facts() as { [k: string]: JsonValue };
    const sections = Object.keys(f).filter((k) => isObject(f[k]) && !Array.isArray(f[k]));
    fc.assert(fc.property(fc.stringMatching(/^[a-z][A-Za-z0-9]{2,12}$/), fc.constantFrom('', ...sections.map((s) => `/${s}`)), (name, at) => {
      const parent = at === '' ? f : getAt(f, at)!;
      fc.pre(isObject(parent) && !Object.hasOwn(parent, name));
      expectRefused(validate(FACTS, setAt(f, `${at}/${name}`, 'free-form')), `${at}/${name}`, `an unlisted field ${at}/${name}`);
    }), RUNS);
  });

  it('AC9 (wrong program) a facts schema of free-form fields passes the first fake and fails this test', () => {
    // A twin of adapter.facts@1 that opens hookTimeouts to any field and requires none of them: the fake with no
    // Stop timeout and the field no rule reads both validate against it, which this test refuses.
    const open = setAt(setAt(getSchema(FACTS), '/properties/hookTimeouts/additionalProperties', true), '/properties/hookTimeouts/required', []) as Schema;
    const twin = schemaRegistry([{ name: 'facts.open@1', schema: open }]);
    expect(twin.validate('facts.open@1', deleteAt(facts(), STOP_TIMEOUT)).ok, 'the free-form twin passes the first fake').toBe(true);
    const freeForm = setAt(facts(), '/hookTimeouts/freeForm', 1);
    expect(twin.validate('facts.open@1', freeForm).ok, 'the free-form twin passes a field no rule reads').toBe(true);
    expect(() => expectRefused(twin.validate('facts.open@1', freeForm), '/hookTimeouts/freeForm', 'the free-form twin')).toThrow(/should be refused/);
  });
});
