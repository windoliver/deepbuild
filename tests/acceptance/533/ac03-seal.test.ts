// #533.40063163: the logic module names logic@1 and its implementation, bit and canonical, and the shipped set
// seals with it; a test logic implementation that changes only its own patch version and passes the logic kit bit
// for bit seals in its place with logic@1's digest unchanged; and a planted interface digest that also covers the
// implementation's version changes with that patch and fails this, naming logic@1.
//
// deep-show `full` holds the shipped logic module; `full,test-logic-patch` holds the test implementation in its
// place; `--planted digest_covers_version` is the twin (README: deep-show).
import { describe, expect, it } from 'vitest';
import {
  AC, DIGEST, REGISTRY, SCHEDULE, SEMVER, TIMEOUT, arr, deepShow, kitCall, obj, prebuild, refusalLine, runShow, scenario, show, started, startup, str, useTemp,
  type JsonObject, type ShowFeature,
} from './helpers.ts';

const ID = AC[3];
const SHIPPED: ShowFeature[] = ['full'];
const PATCH: ShowFeature[] = ['full', 'test-logic-patch'];
prebuild(() => { deepShow(SHIPPED); deepShow(PATCH); });
const temp = useTemp();

interface Build { modules: string[]; logic: JsonObject; impl: JsonObject; text: JsonObject; sandbox: JsonObject; kit: JsonObject }
const runs = new Map<string, Build>();
/** One startup of a build: its registry, logic@1's interface record and the kit over the logic module. */
function build(features: ShowFeature[]): Build {
  const key = features.join('+');
  const known = runs.get(key);
  if (known) return known;
  const [reg, sched, kit] = runShow(deepShow(features), scenario(temp(), [REGISTRY, SCHEDULE, kitCall('logic')]));
  const ifaces = obj(sched!['interfaces'], `${key}: schedule.interfaces`);
  const logic = obj(ifaces['logic@1'], `${key}: schedule.interfaces["logic@1"] (the interfaces are ${show(Object.keys(ifaces))})`);
  const b: Build = {
    modules: arr(reg!['modules'], `${key}: registry.modules`).map(String),
    logic, impl: obj(logic['implementation'], `${key}: logic@1.implementation`),
    text: obj(ifaces['text@1'], `${key}: interfaces["text@1"]`), sandbox: obj(ifaces['sandbox@1'], `${key}: interfaces["sandbox@1"]`),
    kit: kit!,
  };
  runs.set(key, b);
  return b;
}
/** The logic module's record in a kit reply: its verdict and its parts by name. */
function logicKit(reply: JsonObject, what: string): { verdict: string; parts: Map<string, JsonObject> } {
  const m = arr(reply['modules'], `${what}: modules`).map((x, i) => obj(x, `${what}: modules[${i}]`)).find((x) => x['module'] === 'logic');
  expect(m, `${what} ran the logic module: ${show(reply)}`).toBeDefined();
  const parts = new Map(arr(m!['parts'], `${what}: logic.parts`).map((x, i) => { const o = obj(x, `${what}: parts[${i}]`); return [str(o['part'], `${what}: parts[${i}].part`), o] as const; }));
  return { verdict: String(m!['verdict']), parts };
}
const pins = (impl: JsonObject, what: string): string => str(obj(obj(impl['pins'], `${what}.pins`)['wasmtime'], `${what}.pins.wasmtime`)['version'], `${what}.pins.wasmtime.version`);
const casesOf = (part: JsonObject | undefined): string[] => (part ? arr(part['cases'], 'cases').map((c) => JSON.stringify(c)) : []);

describe(`${ID} logic@1: the shipped implementation, bit and canonical, and a patch release of it that seals in its place`, () => {
  it(`${ID} the shipped set seals with the logic module implementing logic@1, bit and canonical, its engine sandbox@1's pin, its kit every part of the canvas kit with no behavior part, passed`, () => {
    const b = build(SHIPPED);
    expect(b.modules, 'the shipped set holds the logic module and the sandbox module').toEqual(expect.arrayContaining(['logic', 'sandbox']));
    expect(b.logic['module'], 'logic@1 is implemented by the logic module').toBe('logic');
    expect(str(b.logic['digest'], 'logic@1.digest'), 'logic@1 has a digest').toMatch(DIGEST);
    expect([b.impl['equivalence'], b.impl['state']], 'the implementation is bit and canonical').toEqual(['bit', 'canonical']);
    expect(str(b.impl['name'], 'implementation.name').length, 'the implementation is named').toBeGreaterThan(0);
    expect(b.logic['reference'], 'the shipped implementation is logic@1\'s reference').toBe(b.impl['name']);
    expect(str(b.impl['version'], 'implementation.version'), 'its version is semver').toMatch(SEMVER);
    expect(pins(b.impl, 'logic@1.implementation'), 'its engine is sandbox@1\'s pin').toBe(pins(obj(b.sandbox['implementation'], 'sandbox@1.implementation'), 'sandbox@1.implementation'));
    expect(pins(b.impl, 'logic@1.implementation'), 'sandbox@1 pins wasmtime =49.0.5').toBe('=49.0.5');
    expect(b.logic['behavior'], 'logic@1 has no behavior part').toBe('none');
    const kitParts = arr(b.logic['kit'], 'logic@1.kit').map(String);
    expect(kitParts, 'logic@1\'s kit is every part of the canvas kit').toEqual(expect.arrayContaining(arr(b.text['kit'], 'text@1.kit').map(String)));
    expect(kitParts, 'logic@1\'s kit has no behavior part').not.toContain('behavior');

    const k = logicKit(b.kit, 'the shipped build\'s kit');
    const failing = [...k.parts].filter(([, p]) => p['verdict'] !== 'PASS').map(([name, p]) => `${name}: ${show(p['failures'] ?? null)}`);
    expect(failing, 'every part the kit ran on the logic module passes').toEqual([]);
    expect(k.verdict, 'the logic module passes its kit').toBe('PASS');
    expect([...k.parts.keys()].filter((p) => !kitParts.includes(p)), 'the kit ran only parts of logic@1\'s kit').toEqual([]);
    expect([...k.parts.keys()], 'the kit ran the logic module\'s fixtures and its carried state').toEqual(expect.arrayContaining(['fixtures', 'carried_state']));
  }, TIMEOUT);

  it(`${ID} a test implementation that changes only its own patch version passes the logic kit bit for bit and seals in the shipped one's place with logic@1's digest unchanged`, () => {
    const s = build(SHIPPED);
    const t = build(PATCH);
    expect(t.modules, 'the test build holds the logic module').toContain('logic');
    const [, sMaj, sMin, sPat] = SEMVER.exec(str(s.impl['version'], 'shipped version'))!;
    const tv = SEMVER.exec(str(t.impl['version'], 'test version'));
    expect(tv, 'the test implementation\'s version is semver').not.toBe(null);
    expect([tv![1], tv![2]], 'the test implementation keeps the shipped major and minor').toEqual([sMaj, sMin]);
    expect(tv![3], 'the test implementation changes its patch version').not.toBe(sPat);
    const { version: _a, ...shippedRest } = s.impl;
    const { version: _b, ...testRest } = t.impl;
    expect(testRest, 'nothing else of the implementation record changes').toEqual(shippedRest);
    expect(t.logic['module'], 'it implements logic@1 as the logic module').toBe('logic');
    expect(t.logic['digest'], 'logic@1\'s digest is unchanged by the patch version').toBe(s.logic['digest']);

    const a = logicKit(s.kit, 'the shipped build\'s kit');
    const b = logicKit(t.kit, 'the test build\'s kit');
    expect(b.verdict, `the test implementation passes the logic kit: ${show(t.kit).slice(0, 800)}`).toBe('PASS');
    const bit = b.parts.get('bit');
    expect(bit, 'the kit compares the test implementation with the reference (the bit part)').toBeDefined();
    const bitCases = arr(bit!['cases'], 'bit.cases').map((c, i) => obj(c, `bit.cases[${i}]`));
    const fixtures = arr(a.parts.get('fixtures')?.['cases'] ?? [], 'fixtures.cases').map((c) => String(obj(c, 'fixtures case')['fixture']));
    expect(bitCases.length, 'the bit part compared at least one fixture').toBeGreaterThan(0);
    expect(bitCases.filter((c) => c['verdict'] !== 'PASS').map((c) => show(c)), 'every fixture gives the reference\'s results bit for bit').toEqual([]);
    expect([...new Set(bitCases.map((c) => String(c['fixture'])))].sort(), 'the bit part covers every logic kit fixture').toEqual([...new Set(fixtures)].sort());
    const differ = [...a.parts].filter(([name]) => name !== 'bit').filter(([name, p]) => JSON.stringify(casesOf(p)) !== JSON.stringify(casesOf(b.parts.get(name)))).map(([name]) => name);
    expect(differ, 'every other part gives the shipped implementation\'s cases exactly').toEqual([]);
  }, TIMEOUT);

  it(`${ID} a planted interface digest that also covers the implementation's version (digest_covers_version) refuses the patch at the seal, naming logic@1, while the shipped build still seals`, () => {
    expect(started(startup(deepShow(SHIPPED), 'digest_covers_version')), 'the shipped build seals under the planted digest (it is the reference)').toBe(true);
    const line = refusalLine(startup(deepShow(PATCH), 'digest_covers_version'), 'the patch build under the planted digest');
    expect([line['reason'], line['interface']], `the seal refuses the patch's digest, naming logic@1: ${show(line)}`).toEqual(['interface_digest', 'logic@1']);
  }, TIMEOUT);
});
