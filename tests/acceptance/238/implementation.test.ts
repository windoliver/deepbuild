// #238.46afd887: a test sandbox implementation that pins another wasmtime patch version and passes sandbox@1's
// kit bit for bit seals in the shipped one's place with sandbox@1's digest unchanged; a planted interface digest
// that also covers the implementation's pins changes with that patch and fails this, naming sandbox@1.
//
// deep-show `full` holds the shipped implementation (sandbox); `full,test-sandbox-alt` holds the test
// implementation sandbox.alt in its place (README: Test builds); `--planted digest_covers_pins` is the twin.
import { describe, expect, it } from 'vitest';
import {
  DIGEST, PATCH, SCHEDULE, arr, caseKey, deepShow, kitOf, obj, prebuild, refusalLine, runShow, scenario, show, started, startup, str, useTemp,
  type JsonObject, type Kit, type ShowFeature,
} from './helpers.ts';

const ID = '#238.46afd887';
const SHIPPED: ShowFeature[] = ['full'];
const ALT: ShowFeature[] = ['full', 'test-sandbox-alt'];
prebuild(() => { deepShow(SHIPPED); deepShow(ALT); });
const temp = useTemp();

const KIT_CALL: JsonObject = { call: 'kit', modules: ['sandbox'], parts: ['sandbox'] };
function sandboxPart(reply: JsonObject, what: string): Kit {
  const module = arr(reply['modules'], `${what}: modules`).map((m, i) => obj(m, `${what}: modules[${i}]`)).find((m) => m['module'] === 'sandbox');
  expect(module, `${what} reports the sandbox module: ${show(reply)}`).toBeDefined();
  const part = arr(module!['parts'], `${what}: sandbox.parts`).map((p, i) => obj(p, `${what}: parts[${i}]`)).find((p) => p['part'] === 'sandbox');
  expect(part, `${what}: the sandbox module's kit has the part sandbox`).toBeDefined();
  return kitOf({ interface: 'sandbox@1', verdict: part!['verdict'] ?? null, cases: part!['cases'] ?? [], failures: part!['failures'] ?? [] }, `${what}: part sandbox`);
}
const sandboxIface = (sched: JsonObject, what: string): JsonObject => obj(obj(sched['interfaces'], `${what}: interfaces`)['sandbox@1'], `${what}: interfaces["sandbox@1"]`);

describe(`${ID} a test sandbox implementation pinning another wasmtime patch seals in the shipped one's place with sandbox@1's digest unchanged`, () => {
  it(`${ID} sandbox.alt, pinning another wasmtime patch, passes sandbox@1's kit bit for bit and seals in sandbox's place with sandbox@1's digest unchanged`, () => {
    const [shippedSched, shippedKit] = runShow(deepShow(SHIPPED), scenario(temp(), [SCHEDULE, KIT_CALL]));
    const [altSched, altKit] = runShow(deepShow(ALT), scenario(temp(), [SCHEDULE, KIT_CALL]));
    const shipped = sandboxIface(shippedSched!, 'the shipped build');
    const alt = sandboxIface(altSched!, 'the sandbox.alt build');
    const si = obj(shipped['implementation'], 'shipped implementation');
    const ai = obj(alt['implementation'], 'sandbox.alt implementation');
    expect([si['name'], ai['name']], 'the shipped build chose sandbox, the test build sandbox.alt').toEqual(['sandbox', 'sandbox.alt']);
    expect([alt['module'], ai['equivalence'], ai['state']], 'sandbox.alt is the sandbox module\'s implementation, bit and canonical').toEqual(['sandbox', 'bit', 'canonical']);
    const sv = str(obj(obj(si['pins'], 'shipped pins')['wasmtime'], 'shipped pins.wasmtime')['version'], 'shipped wasmtime pin');
    const av = str(obj(obj(ai['pins'], 'alt pins')['wasmtime'], 'alt pins.wasmtime')['version'], 'sandbox.alt wasmtime pin');
    expect(sv, 'the shipped implementation pins wasmtime =49.0.5').toBe('=49.0.5');
    expect(av, 'sandbox.alt pins an exact wasmtime patch release').toMatch(PATCH);
    expect(av.replace(/^=/, ''), 'sandbox.alt pins another patch than 49.0.5').not.toBe('49.0.5');
    expect(str(shipped['digest'], 'shipped digest'), 'sandbox@1\'s digest').toMatch(DIGEST);
    expect(alt['digest'], 'sandbox@1\'s digest is unchanged by the other implementation and its pins').toBe(shipped['digest']);

    const a = sandboxPart(shippedKit!, 'the shipped build\'s kit');
    const b = sandboxPart(altKit!, 'the sandbox.alt build\'s kit');
    expect([a.verdict, b.verdict], `both implementations pass sandbox@1's kit: ${show(b.failures)}`).toEqual(['PASS', 'PASS']);
    expect(b.cases.length, 'sandbox.alt runs every fixture the shipped one runs').toBe(a.cases.length);
    const differ = a.cases.filter((c) => { const d = b.cases.find((x) => x.fixture === c.fixture); return !d || caseKey(d) !== caseKey(c); }).map((c) => c.fixture);
    expect(differ, 'sandbox.alt gives the shipped implementation\'s results bit for bit on every fixture').toEqual([]);
  }, 5_400_000);

  it(`${ID} a planted interface digest that also covers the implementation's pins refuses sandbox.alt at the seal, naming sandbox@1, while the shipped build still seals`, () => {
    expect(started(startup(deepShow(SHIPPED), 'digest_covers_pins')), 'the shipped build seals under the planted digest (it is the reference)').toBe(true);
    const line = refusalLine(startup(deepShow(ALT), 'digest_covers_pins'), 'the sandbox.alt build under the planted digest');
    expect([line['reason'], line['interface']], `the seal refuses sandbox.alt's digest, naming sandbox@1: ${show(line)}`).toEqual(['interface_digest', 'sandbox@1']);
  }, 3_600_000);
});
