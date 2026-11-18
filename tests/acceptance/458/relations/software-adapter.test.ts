// #458, criterion 12: with the full lane forced onto a software adapter by its loader setting, every GPU fixture
// reports BLOCKED, naming the adapter and its device type, and no golden is compared or blessed; a planted lane that
// reads the adapter from its configuration rather than from the device passes on the software adapter and fails this
// test, naming the adapter.
//
// Two legs (README: Readings):
//   1. The seam's software adapter, on this Mac: #140's `--adapters <file>` (test-seam) makes the GPU seam enumerate
//      one test adapter of type `cpu` that reports a software rasterizer's identity. The lane's configuration
//      (`configured.adapter`) names this Mac's own hardware adapter, as a lane file or a hosts block would.
//   2. A real software adapter through the Vulkan loader's driver setting: Linux only, with a loader and a software
//      rasterizer's driver manifest installed. Anywhere else this leg is BLOCKED, never a pass.
// Wrong programs: the base (no `full_lane` call) and `--planted lane_adapter_from_configuration`.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, RELATIONS, TIMEOUT, answered, arr, blocked, failsNaming, fixtureName, inconclusive, listing, noisePng, none, obj, runGpu, shown, str,
  useBuilds, useDir, writeJson,
  type JsonObject, type Startup,
} from './helpers.ts';

const bin = useBuilds(['test-seam']);
const dir = useDir();

/** A software rasterizer's identity as a Vulkan loader reports it: its name, its driver and the device type `cpu`. */
const SOFTWARE = { name: 'llvmpipe (LLVM 19.1.7, 256 bits)', driver: 'llvmpipe', type: 'cpu' };
/** The golden fixtures this test blesses and compares; any name of the kit's scheme. */
const BLESSED_ON_HARDWARE = 'parity/scene/software-adapter-blessed.scene';
const ASKED_ON_SOFTWARE = 'parity/scene/software-adapter-asked.scene';

interface Identity { name: string; driver: string; type: string }
function identity(v: JsonObject, what: string): Identity {
  return { name: str(v['name'], `${what}.name`), driver: str(v['driver'], `${what}.driver`), type: str(v['type'], `${what}.type`) };
}

/** The calls one lane run makes: who the seam says the device is, the full lane, a blessing asked as yours, and a
 * comparison against the golden blessed on hardware. */
function laneCalls(store: string, configured: Identity, askedPng: string, blessedPng: string): JsonObject[] {
  return [
    { call: 'adapter' },
    { call: 'full_lane', store, configured: { adapter: { ...configured } } },
    { call: 'decide', via: 'you', store, decision: { bless: { fixture: ASKED_ON_SOFTWARE, png: askedPng } } },
    { call: 'golden', store, fixture: BLESSED_ON_HARDWARE, png: blessedPng, oracle: 'hash' },
  ];
}

/** What criterion 12 asks of a lane run on the software adapter `soft`; each failure names the adapter. */
function problems(replies: JsonObject[], soft: Identity, storeBefore: string[], store: string): string[] {
  const p: string[] = []; const on = `on the software adapter ${soft.name}`;
  const lane = answered(replies[1]!, 'full_lane');
  expect(lane['lane'], `full_lane names its lane: ${shown(lane, 400)}`).toBe('full');
  const recorded = identity(obj(lane['adapter'], 'full_lane: adapter'), 'full_lane: adapter');
  if (recorded.name !== soft.name || recorded.type !== soft.type) p.push(`${on}: the run records the adapter ${recorded.name} (${recorded.type}), not the device's own ${soft.name} (${soft.type})`);
  const fixtures = arr(lane['fixtures'], 'full_lane: fixtures').map((f, i) => obj(f, `full_lane: fixtures[${i}]`));
  expect(fixtures.length, 'full_lane lists every GPU fixture of the full lane, at least the eight relations').toBeGreaterThanOrEqual(RELATIONS.length);
  const names = fixtures.map((f) => str(f['fixture'], 'full_lane: fixtures[].fixture'));
  for (const r of RELATIONS) expect(names, `the full lane's GPU fixtures hold the relation ${r}`).toContain(fixtureName(r));
  for (const f of fixtures) {
    const name = str(f['fixture'], 'fixture'); const reason = typeof f['reason'] === 'string' ? f['reason'] : '';
    if (f['result'] !== 'BLOCKED') p.push(`${on}: ${name} reports ${shown(f['result'])}, not BLOCKED`);
    else if (!reason.includes(soft.name) || !reason.includes(soft.type)) p.push(`${on}: ${name} is BLOCKED but its reason doesn't name the adapter and its device type ${soft.type}: ${reason}`);
  }
  const goldens = obj(lane['goldens'], 'full_lane: goldens');
  const compared = arr(goldens['compared'], 'full_lane: goldens.compared'); const blessedNow = arr(goldens['blessed'], 'full_lane: goldens.blessed');
  if (compared.length > 0) p.push(`${on}: the lane compared goldens: ${shown(compared, 300)}`);
  if (blessedNow.length > 0) p.push(`${on}: the lane blessed goldens: ${shown(blessedNow, 300)}`);
  const decided = replies[2]!;
  if (decided['outcome'] !== 'refused') p.push(`${on}: a blessing was taken: ${shown(decided, 300)}`);
  else if (!shown(decided).includes(soft.name)) p.push(`${on}: the blessing is refused without naming the adapter: ${shown(decided, 300)}`);
  const after = listing(store);
  if (JSON.stringify(after) !== JSON.stringify(storeBefore)) p.push(`${on}: the golden store changed: ${after.filter((l) => !storeBefore.includes(l)).join(', ') || 'files removed'}`);
  const golden = replies[3]!;
  if (golden['verdict'] !== 'BLOCKED') p.push(`${on}: the golden blessed on hardware was judged ${shown(golden['verdict'])}, not BLOCKED: ${shown(golden, 300)}`);
  else if (!String(golden['reason']).includes(soft.name)) p.push(`${on}: the golden's BLOCKED doesn't name the adapter: ${shown(golden, 300)}`);
  return p;
}

/** The planted lane "passes on the software adapter": it records the configured adapter and judges fixtures. */
function passesOn(replies: JsonObject[], configured: Identity, what: string): void {
  const lane = answered(replies[1]!, `${what}: full_lane`);
  expect(identity(obj(lane['adapter'], `${what}: adapter`), `${what}: adapter`).name, `${what}: the planted lane records the adapter its configuration names`).toBe(configured.name);
  const results = arr(lane['fixtures'], `${what}: fixtures`).map((f) => obj(f, 'fixture')['result']);
  expect(results.includes('PASS'), `${what}: the planted lane passes fixtures on the software adapter (results: ${[...new Set(results)].join(', ')})`).toBe(true);
}

describe('#458 criterion 12: the full lane on a software adapter', () => {
  it(`${AC[12]}: on the seam's software adapter every GPU fixture reports BLOCKED, naming the adapter and its device type, and no golden is compared or blessed; a planted lane that reads the adapter from its configuration passes there and fails, naming the adapter`, () => {
    if (process.platform !== 'darwin') inconclusive(`test-seam's adapters stand on macOS's Metal adapter; this is ${process.platform}`);
    const out = dir(); const store = join(out, 'goldens'); mkdirSync(join(store, 'parity', 'scene'), { recursive: true });
    const blessedPng = join(out, 'blessed.png'); writeFileSync(blessedPng, noisePng(458));
    const askedPng = join(out, 'asked.png'); writeFileSync(askedPng, noisePng(459));
    // On this Mac's own adapter: who the device is, and a golden blessed under it, as #380's `decide` records one.
    const hardware = runGpu(bin('test-seam'), out, [{ call: 'adapter' }, { call: 'decide', via: 'you', store, decision: { bless: { fixture: BLESSED_ON_HARDWARE, png: blessedPng } } }]);
    const seam = answered(hardware[0]!, 'adapter');
    const configured = identity(obj(seam['adapter'], 'adapter: adapter'), 'adapter: adapter');
    expect(configured.type, 'this Mac\'s adapter is hardware').not.toBe('cpu');
    expect(hardware[1]!['outcome'], `a blessing on the hardware adapter is recorded: ${shown(hardware[1])}`).toBe('decided');
    const storeBefore = listing(store);
    expect(storeBefore.length, 'the store holds the golden blessed on hardware').toBeGreaterThan(0);
    // The seam's software adapter: one test adapter of type cpu, with every feature of the tier's table.
    const features = arr(seam['table'], 'adapter: table').map((r) => str(obj(r, 'row')['feature'], 'feature'));
    const adapters = writeJson(out, 'adapters', { adapters: [{ name: SOFTWARE.name, type: SOFTWARE.type, vendor: 65541, device: 0, driver: SOFTWARE.driver, memory: 8 * 1024 ** 3, features }] });
    const calls = laneCalls(store, configured, askedPng, blessedPng);

    const honest = runGpu(bin('test-seam'), out, calls, { adapters });
    expect(identity(obj(answered(honest[0]!, 'adapter')['adapter'], 'adapter'), 'adapter'), 'the seam reads the software adapter from the device').toEqual(SOFTWARE);
    none(problems(honest, SOFTWARE, storeBefore, store), 'the full lane on the software adapter');

    const planted = runGpu(bin('test-seam'), out, calls, { adapters, planted: 'lane_adapter_from_configuration' });
    passesOn(planted, configured, '--planted lane_adapter_from_configuration');
    failsNaming(problems(planted, SOFTWARE, storeBefore, store), [SOFTWARE.name], '--planted lane_adapter_from_configuration');
  }, TIMEOUT);

  it(`${AC[12]}: forced onto a real software adapter by the Vulkan loader's driver setting, every GPU fixture reports BLOCKED, naming the adapter and its device type, and the planted lane passes there and fails, naming the adapter`, () => {
    // The loader's setting: the driver manifest of a software rasterizer, the only driver the loader may load.
    const manifests = ['/usr/share/vulkan/icd.d', '/etc/vulkan/icd.d'].filter((d) => existsSync(d)).flatMap((d) => readdirSync(d).filter((n) => /^lvp_icd.*\.json$/.test(n)).map((n) => join(d, n)));
    if (process.platform !== 'linux' || manifests.length === 0) {
      blocked(`a real software adapter needs Linux with the Vulkan loader and a software rasterizer's driver manifest (lvp_icd.*.json under /usr/share/vulkan/icd.d); this is ${process.platform} with ${manifests.length} such manifest${manifests.length === 1 ? '' : 's'}. Run this file on such a machine`);
    }
    const forced: Startup = { env: { VK_DRIVER_FILES: manifests[0]!, VK_ICD_FILENAMES: manifests[0]! } };
    const out = dir(); const store = join(out, 'goldens'); mkdirSync(join(store, 'parity', 'scene'), { recursive: true });
    const blessedPng = join(out, 'blessed.png'); writeFileSync(blessedPng, noisePng(458));
    const askedPng = join(out, 'asked.png'); writeFileSync(askedPng, noisePng(459));
    const seam = answered(runGpu(bin('test-seam'), out, [{ call: 'adapter' }], forced)[0]!, 'adapter');
    const soft = identity(obj(seam['adapter'], 'adapter: adapter'), 'adapter: adapter');
    expect(soft.type, `the loader's setting forces a software adapter: the device reports ${soft.name} (${soft.type})`).toBe('cpu');
    // The lane's configuration names a hardware adapter; no golden was blessed on hardware here, so the store is empty.
    const configured: Identity = { name: 'A hardware adapter the lane is configured for', driver: 'configured', type: 'discrete_gpu' };
    const calls = laneCalls(store, configured, askedPng, blessedPng);
    none(problems(runGpu(bin('test-seam'), out, calls, forced), soft, [], store), 'the full lane on the software adapter');
    const planted = runGpu(bin('test-seam'), out, calls, { ...forced, planted: 'lane_adapter_from_configuration' });
    passesOn(planted, configured, '--planted lane_adapter_from_configuration');
    failsNaming(problems(planted, soft, [], store), [soft.name], '--planted lane_adapter_from_configuration');
  }, TIMEOUT);
});
