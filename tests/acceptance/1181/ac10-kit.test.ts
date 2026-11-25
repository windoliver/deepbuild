// Criterion 10: "The kind kit passes: every example builds to the same bytes twice, every clean example passes, and each
// rule's planted twin fails with that rule's code."
//
// Through `deep-logic first_party`, `bake`, `judge` and `pack_check` (README: The kind kit). The kit is the interface's
// `twins`, one for each kind rule: a planted library of the interface, an example (a fixture the pack carries) and the
// rule it must raise, run at pack check (#202: the kit runs at pack check; #1255's arrangement for an interface).
// - "Each rule's planted twin fails with that rule's code": circuit@1's entry copied into an installed pack
//   `circuitcopy` installs, and its `kit` reads each twin raising the rule it names and that rule alone; the same entry
//   with the twins' rules turned one place round (kcl's twin asked for power's code, power's for fuse's, fuse's for
//   kcl's) is refused, naming the interface, a twin and the rule it didn't raise.
// - "Every example builds to the same bytes twice": each twin's example, its item linking the reference library, baked
//   by two deep-logic processes on its track: the same step hash, the same arrays as JSON text and the same checkpoints.
// - "Every clean example passes": each example on the reference library, judged: circuit.kcl, circuit.power and
//   circuit.fuse all PASS.
// Criteria 2, 4 and 5 run the three planted libraries on this suite's own pieces. The wrong programs: a pack check that
// runs no kit, or takes any rule's failure for a twin's own; an example whose run differs between two runs; an example
// the reference library fails, so a twin's failure proves nothing.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, arr, bakeCall, bakeOf, cps, isObject, logicBin, obj, onHost, prebuild, refusedOf, show, type Bake, type Entry, type JsonObject, type JsonValue,
} from '../190/helpers.ts';
import { AC, CIRCUIT, FUSE, KCL, POWER, circuitLib, judged, twins, type CircuitLib, type Twin } from './helpers.ts';

prebuild(() => { logicBin(); });

/** An example as #416 runs a fixture: its item as `fixture`, linking the reference library, with its other items and controls. */
function example(L: CircuitLib, id: string): { piece: JsonObject; steps: number; track: Entry[] } {
  const f = L.fixture(id);
  const item = obj(f['item'], `example ${id}'s item`);
  const items: JsonObject = { ...(isObject(f['items']) ? f['items'] : {}), fixture: { ...item, params: { ...obj(item['params'], `example ${id}'s params`), links: [L.ref] as unknown as JsonValue } } };
  return { piece: { seed: 0, packs: [], items, assets: { ...L.assets }, ...(isObject(f['controls']) ? { controls: f['controls'] } : {}) }, steps: Number(f['steps'] ?? 1), track: (f['track'] ?? []) as unknown as Entry[] };
}
const outputs = (b: Bake): string[] => b.steps.map((s) => `${s.step} ${s.items['fixture']?.hash ?? 'none'} ${JSON.stringify(Object.entries(s.arrays).filter(([k]) => k.startsWith('fixture.')))}`);
const NEXT: Record<string, string> = { [KCL]: POWER, [POWER]: FUSE, [FUSE]: KCL };

describe(`${AC[10]} circuit@1's kind kit`, () => {
  it(`${AC[10]} each rule's planted twin fails with that rule's code`, () => {
    const L = circuitLib();
    const kit = twins(L);
    const copy = (version: string, list: Twin[]): JsonObject => ({
      call: 'pack_check', assets: L.assets,
      pack: { name: 'circuitcopy', version, origin: 'installed', libs: {}, interfaces: { [CIRCUIT]: { ...L.entry, twins: list as unknown as JsonObject[] } } },
    });
    const turned = kit.map((t) => ({ ...t, expect: NEXT[t.expect]! }));
    const [held, broken] = onHost([copy('1.0.0', kit), copy('1.0.1', turned)]);

    expect([held!['ok'], held!['installed'], held!['pack']], `the interface's pack installs with its kit: ${show(held)}`).toEqual([true, true, 'circuitcopy@1.0.0']);
    const judgedKit = arr(held!['interfaces'], 'pack_check.interfaces').map((i) => obj(i, 'an interface')).find((i) => i['label'] === CIRCUIT);
    expect(judgedKit, `the pack check judged ${CIRCUIT}: ${show(held!['interfaces'])}`).toBeDefined();
    const ran = arr(judgedKit!['kit'], `${CIRCUIT}'s kit as the pack check ran it`).map((t, i) => obj(t, `kit[${i}]`));
    expect(ran.map((t) => [t['planted'], t['expect'], t['raised']]).sort(), 'each planted twin raises the rule it names, and that rule alone').toEqual(kit.map((t) => [t.planted, t.expect, [t.expect]]).sort());

    const r = refusedOf(broken!, 'the pack check of the kit with its twins\' rules turned round');
    expect([r.code, r.pack], 'the pack is refused, naming it').toEqual(['pack_refused', 'circuitcopy@1.0.1']);
    const named = r.refusals.filter((x) => (x['interface'] === CIRCUIT || x['interface'] === `circuitcopy.${CIRCUIT}`) && typeof x['planted'] === 'string' && typeof x['expect'] === 'string');
    expect(named.length, `a refusal names the interface, a twin and the rule it didn't raise: ${show(r.refusals as never)}`).toBeGreaterThan(0);
    for (const x of named) {
      const twin = turned.find((t) => t.planted === x['planted']);
      expect([twin?.expect, Array.isArray(x['raised']) && !(x['raised'] as unknown[]).includes(x['expect'])], `the refusal's twin is one of the kit's, with the rule the turned kit asks of it, which it didn't raise: ${show(x)}`).toEqual([x['expect'], true]);
    }
  }, TIMEOUT);

  it(`${AC[10]} every example builds to the same bytes twice, and every clean example passes`, () => {
    const L = circuitLib();
    const runs = twins(L).map((t) => ({ t, ...example(L, t.example) }));
    const bakes = runs.map((r) => bakeCall(r.piece, r.steps, r.track));
    const [first, second] = [onHost(bakes), onHost(bakes)];
    const verdicts = onHost(runs.map((r) => ({ call: 'judge', piece: r.piece, track: r.track as unknown as JsonValue, steps: r.steps })));
    for (const [i, r] of runs.entries()) {
      const [a, b] = [bakeOf(first[i]!, `the ${r.t.expect} twin's example, first bake`), bakeOf(second[i]!, `the ${r.t.expect} twin's example, second bake in another process`)];
      expect(a.traps, `the ${r.t.expect} twin's example runs on the reference library without a trap: ${show(a.traps as never)}`).toEqual([]);
      const [x, y] = [outputs(a), outputs(b)];
      expect(x.length, `the ${r.t.expect} twin's example runs its ${r.steps} steps`).toBe(r.steps);
      expect(x.map((line, k) => (line === y[k] ? null : `step ${k}`)).filter((d) => d !== null).slice(0, 3), `the ${r.t.expect} twin's example builds to the same bytes twice: step hashes and arrays`).toEqual([]);
      expect(cps(b, 'fixture'), `and the same checkpoints`).toEqual(cps(a, 'fixture'));
      const j = judged(verdicts[i]!, 'fixture');
      expect(Object.entries(j).map(([c, v]) => `${c}: ${v.verdict}`).sort(), `the ${r.t.expect} twin's example is clean on the reference library: every rule passes (${show(Object.fromEntries(Object.entries(j).map(([c, v]) => [c, v.fails])) as never)})`).toEqual([`${FUSE}: PASS`, `${KCL}: PASS`, `${POWER}: PASS`]);
    }
  }, TIMEOUT);
});
