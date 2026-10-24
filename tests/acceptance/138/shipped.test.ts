// The kit over the R2 canvas modules (the canvas modules the shipped `full` build holds), with its defaults:
// every part, Vello CPU and noop, seed 138, 10,000 fuzzed sequences per module. One run, read by the tests of
// every criterion it bears on; each test names its criterion. At the base there is no `kit` call.
import { describe, expect, it } from 'vitest';
import {
  EVERY_MODULE_PARTS, MANIFEST, REGISTRY, SEQUENCES, SHUFFLED_ORDERS, arr, fullRuns, isObject, kit, matching, num, obj, partIn, report,
  run, scenario, show, sorted, str, strs, useBuilds, useEvidence,
  type Build, type JsonObject, type Report,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();

let cached: { report: Report; manifest: JsonObject; modules: string[] } | Error | undefined;
/** The default kit over the shipped build, run once for the file, with the registry and the manifest. */
function shipped(): { report: Report; manifest: JsonObject; modules: string[] } {
  if (cached === undefined) {
    try {
      const bin = builds.bin(FULL);
      const [reg, manifest, reply] = run(bin, scenario(evidence(), [REGISTRY, MANIFEST, { call: 'kit' }]));
      const modules = strs(reg!['modules'], 'registry.modules');
      expect(modules.length, 'the shipped build holds canvas modules').toBeGreaterThan(0);
      cached = { report: report(reply!, 'the default kit'), manifest: manifest!, modules };
    } catch (e) {
      cached = e as Error;
    }
  }
  if (cached instanceof Error) throw cached;
  return cached;
}

describe('#138 the default kit over the R2 canvas modules', () => {
  it('#138.a5815177 10,000 fuzzed patch sequences per R2 canvas module end equal to their clean rebuild in every array, cache, key and snapshot', () => {
    const { report: r, modules } = shipped();
    expect(r.seed, 'the kit records its seed, 138 by default').toBe(138);
    expect(sorted(r.backends), 'the kit ran on Vello CPU and noop by default').toEqual(['noop', 'vello_cpu']);
    for (const name of modules) {
      const m = r.modules.find((x) => x.module === name);
      expect(m, `the kit ran ${name}`).toBeDefined();
      const p = partIn(m!, 'clean_rebuild');
      expect(p.declared, `${name}: clean_rebuild declares 10,000 sequences`).toBe(SEQUENCES);
      expect(p.ran, `${name}: clean_rebuild ran 10,000 sequences`).toBe(SEQUENCES);
      expect(p.verdict, `${name}: every sequence ends equal to its clean rebuild: ${show(p.failures)}`).toBe('PASS');
      expect(p.cases.every((c) => c.verdict === 'PASS'), `${name}: every clean_rebuild case passed`).toBe(true);
      const compared = obj(obj(p.raw['stats'], `${name}: clean_rebuild stats`)['compared'], `${name}: stats.compared`);
      for (const what of ['arrays', 'keys', 'snapshots']) expect(num(compared[what], `${name}: compared.${what}`), `${name}: the shadow compared ${what}`).toBeGreaterThan(0);
      num(compared['caches'], `${name}: compared.caches`);
    }
    expect(r.corpus, 'no crash, so no corpus file').toEqual([]);
  }, 3_600_000);

  it('#138.b4f429ff the patch fuzzer finds no panic, every refusal carries a code, a refused patch leaves the document byte-identical and an accepted one round-trips, over every op and every kind', () => {
    const { report: r, modules, manifest } = shipped();
    const kinds = new Set<string>();
    for (const name of modules) {
      const p = partIn(r.modules.find((x) => x.module === name)!, 'patch_fuzz');
      expect([p.declared, p.ran], `${name}: patch_fuzz declares and runs 10,000 sequences`).toEqual([SEQUENCES, SEQUENCES]);
      expect(p.verdict, `${name}: patch_fuzz passes: ${show(p.failures)}`).toBe('PASS');
      const s = obj(p.raw['stats'], `${name}: patch_fuzz stats`);
      for (const zero of ['panics', 'refused_without_code', 'refused_changed', 'roundtrip_failed']) expect(num(s[zero], `${name}: stats.${zero}`), `${name}: ${zero}`).toBe(0);
      expect(num(s['accepted'], `${name}: stats.accepted`), `${name}: some drawn patches were accepted`).toBeGreaterThan(0);
      expect(num(s['refused'], `${name}: stats.refused`), `${name}: some drawn patches were refused (invalid ones are drawn)`).toBeGreaterThan(0);
      const ops = obj(s['ops'], `${name}: stats.ops`);
      for (const op of ['create', 'set', 'unset', 'delete', 'move', 'reorder']) expect(num(ops[op] ?? 0, `${name}: ops.${op}`), `${name}: the fuzzer drew ${op} ops`).toBeGreaterThan(0);
      expect(str(s['digest'], `${name}: stats.digest`), `${name}: the drawn sequences' digest`).toMatch(/^[0-9a-f]{64}$/);
      for (const k of strs(s['kinds'], `${name}: stats.kinds`)) kinds.add(k);
    }
    const all = strs(manifest['kinds'], 'manifest.kinds');
    expect(all.length, 'the manifest lists the build\'s kinds').toBeGreaterThan(0);
    expect(all.filter((k) => !kinds.has(k)), 'the fuzzer drew patches over every kind the build registers').toEqual([]);
  }, 3_600_000);

  it('#138.b4f429ff the fuzzer is replayable from its seed: one seed draws one sequence digest twice, another seed another', () => {
    const { modules } = shipped();
    const bin = builds.bin(FULL);
    const digest = (seed: number): string => {
      const r = kit(bin, evidence(), { modules: [modules[0]!], parts: ['patch_fuzz'], sequences: 200, seed });
      expect(r.seed, 'the kit records the seed it was given').toBe(seed);
      return str(obj(partIn(r.modules[0]!, 'patch_fuzz').raw['stats'], 'stats')['digest'], 'stats.digest');
    };
    const first = digest(7);
    expect(digest(7), 'seed 7 again draws the same sequences').toBe(first);
    expect(digest(8), 'seed 8 draws other sequences').not.toBe(first);
  }, 3_600_000);

  it('#138.ca6ad34d over the fuzzed sequences each of Patch\'s five laws holds on every patch drawn', () => {
    const { report: r, modules } = shipped();
    for (const name of modules) {
      const s = obj(partIn(r.modules.find((x) => x.module === name)!, 'patch_fuzz').raw['stats'], `${name}: stats`);
      const laws = obj(s['laws'], `${name}: stats.laws`);
      for (const law of ['1', '2', '3', '4', '5']) {
        const l = obj(laws[law], `${name}: laws.${law}`);
        expect(num(l['checked'], `${name}: law ${law} checked`), `${name}: law ${law} was checked on drawn patches`).toBeGreaterThan(0);
        expect(num(l['failed'], `${name}: law ${law} failed`), `${name}: law ${law} held on every patch`).toBe(0);
      }
    }
  }, 3_600_000);

  it('#138.028c56e3 every comparison of two outputs in the kit ran its planted-mismatch twin, and every twin failed', () => {
    const { report: r, modules } = shipped();
    for (const name of modules) {
      const m = r.modules.find((x) => x.module === name)!;
      const compared = m.parts.flatMap((p) => p.cases.filter((c) => c.twin !== undefined).map((c) => ({ part: p.part, c })));
      expect(compared.length, `${name}: the kit's comparisons carry their twins`).toBeGreaterThan(0);
      for (const { part, c } of compared) expect(c.twin!.verdict, `${name}: ${part} ${c.case}: its planted-mismatch twin fails`).toBe('FAIL');
      expect(matching(m.parts.flatMap((p) => p.failures), 'twin_passed'), `${name}: no comparison is blind`).toEqual([]);
    }
  }, 3_600_000);

  it('#138.5aef0e9f every part of every R2 module ran every case it declares, at least one, and the module\'s verdict follows its cases', () => {
    const { report: r, modules } = shipped();
    expect(r.verdict, `the kit passes over the R2 modules: ${show(r.modules.filter((m) => m.verdict !== 'PASS').map((m) => [m.module, m.failures, m.parts.filter((p) => p.verdict !== 'PASS').map((p) => [p.part, p.failures.slice(0, 3)])]), 4000)}`).toBe('PASS');
    for (const name of modules) {
      const m = r.modules.find((x) => x.module === name)!;
      for (const part of EVERY_MODULE_PARTS) partIn(m, part);
      expect(fullRuns(m), `${name}: no part ran fewer cases than it declares`).toEqual([]);
      for (const p of m.parts) {
        expect(p.exit, `${name}: ${p.part} exited 0`).toBe(0);
        expect(p.verdict, `${name}: ${p.part} passes`).toBe('PASS');
        expect(p.cases.filter((c) => c.verdict === 'FAIL' || c.verdict === 'INVALID').map((c) => c.case), `${name}: ${p.part} passed with no failed or invalid case`).toEqual([]);
      }
    }
  }, 3_600_000);

  it('#138.97027c5b every R2 snapshot case reads BLOCKED on noop, naming its probe, and passes on Vello CPU', () => {
    const { report: r } = shipped();
    let pairs = 0;
    for (const m of r.modules) {
      for (const p of m.parts) {
        for (const c of p.cases.filter((x) => x.backend === 'noop' && x.probe !== undefined)) {
          expect(c.verdict, `${m.module}: ${p.part} ${c.case} on noop reads BLOCKED`).toBe('BLOCKED');
          expect(c.probe, `${m.module}: ${c.case} on noop names its probe`).toMatch(/pixel/);
          const cpu = p.cases.find((x) => x.case === c.case && x.backend === 'vello_cpu');
          expect(cpu, `${m.module}: ${c.case} also ran on Vello CPU`).toBeDefined();
          expect(cpu!.verdict, `${m.module}: ${c.case} passes on Vello CPU`).toBe('PASS');
          pairs++;
        }
      }
    }
    expect(pairs, 'the R2 modules have snapshot cases, blocked on noop and proved on Vello CPU').toBeGreaterThan(0);
  }, 3_600_000);

  it(`#138.417c9663 each R2 module's order part runs ${SHUFFLED_ORDERS} distinct shuffle seeds and its read-set part passes`, () => {
    const { report: r, modules } = shipped();
    for (const name of modules) {
      const m = r.modules.find((x) => x.module === name)!;
      const order = partIn(m, 'order');
      const seeds = arr(order.raw['seeds'], `${name}: order.seeds`).map((s, i) => num(s, `${name}: seeds[${i}]`));
      expect(new Set(seeds).size, `${name}: ${SHUFFLED_ORDERS} distinct shuffled legal orders`).toBe(SHUFFLED_ORDERS);
      expect(order.verdict, `${name}: every key and result equal under the 8 orders`).toBe('PASS');
      expect(partIn(m, 'read_set').verdict, `${name}: read-set perturbation passes`).toBe('PASS');
    }
  }, 3_600_000);

  it('#138.11bef137 every tolerance class with a share of pixels in the shipped fixtures names a ceiling, a window bound and its size, and a reason', () => {
    const { manifest } = shipped();
    let classes = 0;
    for (const f of arr(manifest['fixtures'], 'manifest.fixtures').map((x, i) => obj(x, `fixtures[${i}]`))) {
      const name = str(f['name'], 'fixture name');
      for (const check of arr(obj(f['sidecar'], `${name}: sidecar`)['checks'] ?? [], `${name}: checks`).map((c, i) => obj(c, `${name}: checks[${i}]`))) {
        if (!isObject(check['tolerance'])) continue;
        const t = check['tolerance'] as JsonObject;
        if (typeof t['on'] !== 'number' || t['on'] >= 100) continue;
        classes++;
        num(t['within'], `${name}: tolerance.within`);
        num(t['ceiling'], `${name}: tolerance.ceiling`);
        const w = obj(t['window'], `${name}: tolerance.window`);
        expect(num(w['size'], `${name}: window.size`), `${name}: a window size`).toBeGreaterThan(0);
        num(w['off'], `${name}: window.off`);
        expect(str(t['reason'], `${name}: tolerance.reason`).trim().length, `${name}: the class gives its reason`).toBeGreaterThan(0);
      }
    }
    console.log(`${classes} share tolerance classes in the shipped fixtures`);
  }, 3_600_000);

  it('#138.0b7b2ee5 every planted fault, clean twin and code fixture of the R2 modules raised exactly the codes it names', () => {
    const { report: r } = shipped();
    let named = 0;
    for (const m of r.modules) {
      for (const p of m.parts) {
        for (const c of p.cases.filter((x) => x.expected_codes !== undefined)) {
          named++;
          expect(c.raised_codes, `${m.module}: ${p.part} ${c.case} lists the codes it raised`).toBeDefined();
          expect(sorted(c.raised_codes!), `${m.module}: ${p.part} ${c.case} raised exactly ${show(c.expected_codes)}`).toEqual(sorted(c.expected_codes!));
        }
      }
    }
    expect(named, 'the R2 modules\' code fixtures name their codes').toBeGreaterThan(0);
  }, 3_600_000);
});
