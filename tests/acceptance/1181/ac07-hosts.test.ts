// Criterion 7: "The same fixtures give the same step hashes on this core and in headless Chrome (#531), and the same
// input track gives the same outputs byte for byte twice. The interface's pack is refused without its planted
// library."
//
// Through `deep-logic first_party`, `bake`, `web_plan`, `web_runner` and `pack_check`, and the web runner's `bake` in
// headless Chrome (#190's helpers: inChrome), as #531, #416 and #980 run them (README: The surface).
// - "The same fixtures": each of circuit@1's own fixtures (first_party), as #416 runs one (its item linking the
//   reference library, with its controls, on its track), and two of this suite's, the plug in and out (REPLUGGED) and
//   the fault that blows the fuse (FAULTY), each checkpointing every 100 steps. Each bake on this core and the web
//   runner's bake of web_plan's request for it give the same step hash at every step and the same full-state hash at
//   every checkpoint. BLOCKED without Chrome, never a pass.
// - "Byte for byte twice": the two pieces of this suite, each baked by two deep-logic processes on its input track,
//   give the same step hash, the same arrays as JSON text (every f64 printed to round-trip, so equal text is equal bits)
//   and the same checkpoints at every step.
// - "Refused without its planted library": circuit@1's entry copied into an installed pack `circuitcopy` with no
//   planted library is `pack_refused`, naming the interface; the same copy with them installs.
// The wrong programs: a library or runner whose float work differs between engines (a host's own sine, fused
// multiply-adds, an unordered sum), a run that reads the clock or keeps state across runs, and a pack check that lets
// an interface ship without a planted library.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, WEB_RUNNER, arr, bakeCall, bakeOf, cps, inChrome, isObject, logicBin, obj, onHost, prebuild, refusedOf, show, str, webPlanCall,
  type Bake, type Entry, type JsonObject, type JsonValue,
} from '../190/helpers.ts';
import { FAULTY, REPLUGGED } from './circuits.ts';
import { AC, CIRCUIT, INTERFACE, circuitLib, fixturePiece, type CircuitLib } from './helpers.ts';

prebuild(() => { logicBin(); });

interface Run { name: string; item: string; piece: JsonObject; steps: number; track: Entry[] }
/** This suite's two pieces, each checkpointing every 100 steps. */
function ours(L: CircuitLib): Run[] {
  return [REPLUGGED, FAULTY].map((f) => ({ name: f.item, item: f.item, piece: fixturePiece(f, INTERFACE, [L.ref], L.assets, { checkpoint: 100 }), steps: f.steps, track: f.track }));
}
/** circuit@1's own fixtures, each as #416 runs one: its item as `fixture`, linking the reference library, with the fixture's other items and controls. */
function theirs(L: CircuitLib): Run[] {
  return L.fixtures.map((id) => {
    const f = L.fixture(id);
    const item = obj(f['item'], `fixture ${id}'s item`);
    const items: JsonObject = { ...(isObject(f['items']) ? f['items'] : {}), fixture: { ...item, params: { ...obj(item['params'], `fixture ${id}'s params`), links: [L.ref] as unknown as JsonValue } } };
    const piece: JsonObject = { seed: 0, packs: [], items, assets: { ...L.assets }, ...(isObject(f['controls']) ? { controls: f['controls'] } : {}) };
    return { name: typeof f['name'] === 'string' ? f['name'] : id.slice(0, 12), item: 'fixture', piece, steps: Number(f['steps'] ?? 1), track: (f['track'] ?? []) as unknown as Entry[] };
  });
}
const stepHashes = (b: Bake, item: string): (string | null)[] => b.steps.map((s) => s.items[item]?.hash ?? null);
/** Every step's hash and arrays as text: what "byte for byte" compares. */
const outputs = (b: Bake, item: string): string[] => b.steps.map((s) => `${s.step} ${s.items[item]?.hash ?? 'none'} ${JSON.stringify(Object.entries(s.arrays).filter(([k]) => k.startsWith(`${item}.`)))}`);

describe(`${AC[7]} the same steps on every host, twice, and a pack that needs its planted libraries`, () => {
  it(`${AC[7]} the same fixtures give the same step hashes on this core and in headless Chrome`, async () => {
    const L = circuitLib();
    const all = [...ours(L), ...theirs(L)];
    expect(all.length, 'this suite\'s two pieces and circuit@1\'s own fixtures').toBeGreaterThan(2);
    const replies = onHost([WEB_RUNNER, ...all.map((r) => bakeCall(r.piece, r.steps, r.track)), ...all.map((r) => webPlanCall(r.piece, r.steps, r.track))]);
    const bakes = all.map((r, i) => bakeOf(replies[1 + i]!, `${r.name}'s bake on this core`));
    const plans = all.map((r, i) => { const x = replies[1 + all.length + i]!; expect(x['ok'], `web_plan gave ${r.name}'s request: ${show(x)}`).toBe(true); return x['request']!; });
    for (const [i, r] of all.entries()) {
      expect(bakes[i]!.traps, `${r.name} runs without a trap: ${show(bakes[i]!.traps as never)}`).toEqual([]);
      expect(stepHashes(bakes[i]!, r.item).every((h) => typeof h === 'string'), `${r.name}: every step has a hash on this core`).toBe(true);
    }
    const chrome = await inChrome(str(replies[0]!['source'], 'web_runner.source'), plans);
    expect(chrome.userAgent, 'the page ran in headless Chrome').toMatch(/HeadlessChrome|Chrome/);
    for (const [i, r] of all.entries()) {
      const web = bakeOf(obj(chrome.replies[i], `${r.name} in Chrome`), `${r.name}'s bake in headless Chrome`, true);
      expect(stepHashes(web, r.item), `${r.name}: the same step hash at every step in headless Chrome`).toEqual(stepHashes(bakes[i]!, r.item));
      expect(cps(web, r.item), `${r.name}: the same full-state hash at every checkpoint in headless Chrome`).toEqual(cps(bakes[i]!, r.item));
    }
  }, TIMEOUT);

  it(`${AC[7]} the same input track gives the same outputs byte for byte twice`, () => {
    const L = circuitLib();
    const runs = ours(L);
    const calls = runs.map((r) => bakeCall(r.piece, r.steps, r.track));
    const [first, second] = [onHost(calls), onHost(calls)];
    for (const [i, r] of runs.entries()) {
      const [a, b] = [bakeOf(first[i]!, `${r.name}'s first bake`), bakeOf(second[i]!, `${r.name}'s second bake, in another process`)];
      expect(a.steps.length, `${r.name}: ${r.steps} steps`).toBe(r.steps);
      const [x, y] = [outputs(a, r.item), outputs(b, r.item)];
      const differ = x.map((line, k) => (line === y[k] ? null : `step ${k}: ${line.slice(0, 200)} | ${(y[k] ?? '').slice(0, 200)}`)).filter((d) => d !== null);
      expect(differ.slice(0, 3), `${r.name}: the same step hash and the same arrays, byte for byte, at every step`).toEqual([]);
      expect(cps(b, r.item), `${r.name}: the same checkpoints`).toEqual(cps(a, r.item));
    }
  }, TIMEOUT);

  it(`${AC[7]} the interface's pack is refused without its planted library`, () => {
    const L = circuitLib();
    expect(L.planted.length, `${CIRCUIT} ships planted libraries`).toBeGreaterThan(0);
    const copy = (version: string, planted: string[]): JsonObject => ({
      call: 'pack_check', assets: L.assets,
      pack: { name: 'circuitcopy', version, origin: 'installed', libs: {}, interfaces: { [CIRCUIT]: { ...L.entry, planted } } },
    });
    const [without, withThem] = onHost([copy('1.0.0', []), copy('1.0.1', L.planted)]);
    const r = refusedOf(without!, `the pack check of circuitcopy@1.0.0, ${CIRCUIT} without its planted libraries`);
    expect([r.code, r.pack], 'the pack is refused, naming it').toEqual(['pack_refused', 'circuitcopy@1.0.0']);
    expect(r.refusals.some((x) => x['interface'] === CIRCUIT || x['interface'] === `circuitcopy.${CIRCUIT}`), `a refusal names the interface: ${show(r.refusals as never)}`).toBe(true);
    expect([withThem!['ok'], withThem!['installed'], withThem!['pack']], `the same copy with ${CIRCUIT}'s planted libraries installs: ${show(withThem)}`).toEqual([true, true, 'circuitcopy@1.0.1']);
    expect(arr(withThem!['interfaces'] ?? [], 'pack_check.interfaces').length, 'and its check lists the interface').toBeGreaterThan(0);
  }, TIMEOUT);
});
