// Test-side tools for the #3604 circuit@2 tests (README: The surface), on #190's, #416's and #1181's suites' tools,
// imported unchanged: ../190/helpers.ts (the `deep-logic` build, its calls and reply readers, headless Chrome),
// ../416/interfaces/ (its assembler, its layout probe and its asset reader) and ../1181/helpers.ts (`playback`'s and
// `judge`'s readers). This file reads circuit@2, its reference library, its planted libraries and its kind kit from the
// build's first-party packs, and builds pieces whose logic item declares a circuit. Nothing here stands in for the
// library, the check or the kind rules.

import { expect } from 'vitest';
import {
  arr, isObject, layoutFor, obj, onHost, sha256, show, str, type JsonObject, type JsonValue, type Layout, type Program,
} from '../190/helpers.ts';
import { bytesOf } from '../416/interfaces/helpers.ts';
import { layoutProbe } from '../416/interfaces/programs.ts';
import { OWN_CIRCUIT, type Fix } from './circuits.ts';
import { EXPORTS, circuitProgram, offsets, writesOf, type Writes } from './programs.ts';

export { judgeCall, judged, nums, playbackCall, played, rule, type Arrays, type Rule } from '../1181/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#3604.078b075a', 2: '#3604.25e37a8c', 3: '#3604.7de81c1e', 4: '#3604.455db5a3', 5: '#3604.60102bcb',
  6: '#3604.ff1304f0', 7: '#3604.e20080d5', 8: '#3604.9e3754a5', 9: '#3604.806e872b', 10: '#3604.6b0e4105',
  11: '#3604.8a2d3993', 12: '#3604.1a449f4f', 13: '#3604.56962e6a', 14: '#3604.5cb1ae24', 15: '#3604.8683c04d',
  16: '#3604.726c5f11',
} as const;

export const CIRCUIT = 'circuit@2';
export const INTERFACE = `lib:${CIRCUIT}`;
export const LAYOUT = 'circuit.state@2';
export const KCL = 'circuit.kcl', POWER = 'circuit.power', FUSE = 'circuit.fuse', BREAKER = 'circuit.breaker', RCD = 'circuit.rcd', RANGE = 'circuit.range';
/** The interface's kind rules (the issue's Fields), with their params' defaults. */
export const RULES = { [KCL]: { tolerance: 1e-9 }, [POWER]: { tolerance: 1e-6 }, [FUSE]: {}, [BREAKER]: {}, [RCD]: {}, [RANGE]: {} };
/** The planted libraries the issue's Proof names, by the name the interface's `plants` gives each (README: Planted libraries). */
export const PLANTS = ['no_magnetic', 'cold_reset', 'one_pole', 'both_ways', 'primary_current'] as const;
export type Plant = typeof PLANTS[number];

export type Assets = Record<string, string>;
export interface Link { name: string; asset: string }
/** A twin of the interface's kind kit (README: The kind kit): a planted library (none for an example twin), the fixture it runs, the rule it must raise. */
export interface Twin { planted: string | null; example: string; expect: string }
export interface CircuitLib {
  assets: Assets;
  pack: JsonObject; entry: JsonObject;
  fixtures: string[]; planted: string[];
  plants: Record<Plant, string>;
  /** The reference library: the first-party pack's one library that implements circuit@2. */
  ref: Link;
  program(id: string): Program;
  fixture(id: string): JsonObject;
}
const byName = <T extends { name: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.name < b.name ? -1 : 1));
let party: CircuitLib | undefined;
/** circuit@2 as the build's first-party packs declare it (README: The first-party pack), once per file. */
export function circuitLib(): CircuitLib {
  if (party) return party;
  const [reply] = onHost([{ call: 'first_party' }]);
  expect(reply!['ok'], `first_party lists the build's first-party packs: ${show(reply)}`).toBe(true);
  const packs = arr(reply!['packs'], 'first_party.packs').map((p, i) => obj(p, `first_party.packs[${i}]`));
  const assets = Object.fromEntries(Object.entries(obj(reply!['assets'], 'first_party.assets')).map(([k, v]) => [k, str(v, `first_party.assets.${k}`)]));
  const pack = packs.find((p) => isObject(p['interfaces']) && isObject((p['interfaces'] as JsonObject)[CIRCUIT]));
  expect(pack, `a first-party pack declares ${CIRCUIT} (packs: ${packs.map((p) => `${p['name']}@${p['version']}`).join(', ')})`).toBeDefined();
  expect(pack!['origin'], `the pack declaring ${CIRCUIT} is first-party`).toBe('first_party');
  const entry = obj((pack!['interfaces'] as JsonObject)[CIRCUIT], CIRCUIT);
  const ids = (k: string): string[] => arr(entry[k], `${CIRCUIT}.${k}`).map((x, j) => str(x, `${CIRCUIT}.${k}[${j}]`));
  const exports = arr(entry['exports'], `${CIRCUIT}.exports`).map((e) => obj(e, 'an export')) as unknown as typeof EXPORTS;
  expect(byName(exports), `${CIRCUIT} declares exactly circuit@1's twelve exports and breaker, rcd, changeover and transformer, with README: Exports' signatures`).toEqual(byName(EXPORTS));
  expect(entry['layout'], `${CIRCUIT}'s state layout is ${LAYOUT}`).toBe(LAYOUT);
  expect(entry['rules'], `${CIRCUIT}'s pack declares circuit@1's three kind rules and circuit.breaker, circuit.rcd and circuit.range`).toEqual(RULES);
  expect(ids('fixtures').length, `${CIRCUIT} ships fixtures`).toBeGreaterThan(0);
  const planted = ids('planted');
  const named = obj(entry['plants'], `${CIRCUIT}.plants (its planted libraries by name)`);
  for (const p of PLANTS) expect(planted, `${CIRCUIT}'s planted library ${p} is one of its planted libraries: ${show(named)}`).toContain(named[p]);
  const libs = Object.entries(obj(pack!['libs'] ?? {}, `${pack!['name']}.libs`)).filter(([, e]) => isObject(e) && Array.isArray(e['implements']) && (e['implements'] as JsonValue[]).includes(CIRCUIT));
  expect(libs.length, `the first-party pack carries one reference library that implements ${CIRCUIT}: ${show(pack!['libs'])}`).toBe(1);
  const [refName, refEntry] = libs[0]!;
  party = {
    assets, pack: pack!, entry, fixtures: ids('fixtures'), planted,
    plants: Object.fromEntries(PLANTS.map((p) => [p, str(named[p], `${CIRCUIT}.plants.${p}`)])) as Record<Plant, string>,
    ref: { name: refName, asset: str(obj(refEntry, refName)['asset'], `${refName}.asset`) },
    program(id) { const bytes = bytesOf(assets, id); return { name: id.slice(0, 12), bytes, b64: bytes.toString('base64'), sha: id }; },
    fixture(id) { return obj(JSON.parse(bytesOf(assets, id).toString('utf8')) as JsonValue, `fixture ${id}`); },
  };
  return party;
}

/** The interface's kind kit (README: The kind kit): its `twins`, one for each kind rule. */
export function twins(L: CircuitLib): Twin[] {
  const list = arr(L.entry['twins'], `${CIRCUIT}.twins (its kind kit's planted twins)`).map((t, i) => {
    const o = obj(t, `${CIRCUIT}.twins[${i}]`);
    return { planted: typeof o['planted'] === 'string' ? o['planted'] : null, example: str(o['example'], `twins[${i}].example`), expect: str(o['expect'], `twins[${i}].expect`) };
  });
  expect(list.map((t) => t.expect).sort(), `${CIRCUIT}'s kit holds one planted twin for each of its six kind rules`).toEqual(Object.keys(RULES).sort());
  for (const t of list) {
    if (t.expect !== RANGE) expect(t.planted, `the twin for ${t.expect} names a planted library`).not.toBeNull();
    if (t.planted !== null) expect(L.planted, `the twin for ${t.expect} is one of ${CIRCUIT}'s planted libraries`).toContain(t.planted);
    expect(L.fixtures.includes(t.example) || typeof L.assets[t.example] === 'string', `the twin for ${t.expect} names a fixture the pack carries (${t.example})`).toBe(true);
  }
  return list;
}
/** The planted library the interface names `name` (README: Planted libraries). */
export const plantedLib = (L: CircuitLib, name: Plant): Program => L.program(L.plants[name]);
/** The name this suite links a planted library by, from its own pack `plants`. */
export const linkName = (name: Plant): string => `${name}@1`;
export const moduleOf = (name: string): string => `lib:${name.split('@')[0]!}`;

const layouts = new Map<string, Layout>();
/** The layout `check` gives an item of these writes (#190's layoutFor, on #416's probe), once per file: each array where offsets() puts it. */
export function layout(writes: Writes): Layout {
  const key = JSON.stringify(writes);
  const known = layouts.get(key);
  if (known) return known;
  const l = layoutFor(layoutProbe(), writes as never);
  for (const [name, at] of Object.entries(offsets(writes).at)) expect(l.entries.find((e) => e.region === 'writes' && e.name === name)?.offset, `${name} sits at ${at} in the write region`).toBe(at);
  layouts.set(key, l);
  return l;
}

// ---------------------------------------------------------------------------------------------------
// Pieces (README: Pieces).

const put = (assets: Assets, bytes: Buffer): string => { const s = sha256(bytes); assets[s] = bytes.toString('base64'); return s; };
export interface Item { program: Program; fixture: Fix; links: Link[]; checkpoint?: number }
/** A logic item's params with no links: its program, its rate, the controls it reads, its arrays, its circuit and the largest fuel a step may take. */
export const itemParams = (program: Program, f: Fix, checkpoint?: number): JsonObject => ({
  program: program.sha, step_rate: f.rate, ...(f.inputs.length ? { reads: f.inputs } : {}), writes: writesOf(f) as unknown as JsonObject,
  circuit: f.circuit as unknown as JsonObject, budget: { fuel: 10_000_000 }, ...(checkpoint ? { checkpoint: { every: checkpoint } } : {}),
});
/** A piece: its controls (each input its items read, a slider), its logic items, packs and assets (the first-party packs' among them). */
export function piece(items: Record<string, Item>, packs: JsonObject[] = [], carried: Assets = {}): JsonObject {
  const assets: Assets = { ...carried };
  const its: JsonObject = {};
  const controls = new Set<string>();
  for (const [id, i] of Object.entries(items)) {
    put(assets, i.program.bytes);
    for (const c of i.fixture.inputs) controls.add(c);
    its[id] = { kind: 'logic@1', params: { ...itemParams(i.program, i.fixture, i.checkpoint), links: i.links as unknown as JsonValue } };
  }
  return { seed: 3604, ...(controls.size ? { controls: Object.fromEntries([...controls].map((c) => [c, { kind: 'slider' }])) } : {}), packs, items: its, assets };
}
/** An item of `f`, its program importing `module`, linking `links`. */
export function item(f: Fix, module: string, links: Link[], checkpoint?: number): Item {
  layout(writesOf(f));
  return { program: circuitProgram(f, module), fixture: f, links, ...(checkpoint ? { checkpoint } : {}) };
}
/** A piece of fixtures' items, each linking the reference library through the interface. */
export const refPiece = (L: CircuitLib, fs: Fix[], checkpoint?: number): JsonObject =>
  piece(Object.fromEntries(fs.map((f) => [f.item, item(f, INTERFACE, [L.ref], checkpoint)])), [], L.assets);

/**
 * A pack `plants` carrying a planted library under `name`, with a fixture of its own (#190's rule) that any circuit@2
 * library passes: a lamp straight on the mains (circuits.ts: OWN_CIRCUIT), importing the library by its own name, both
 * parts conducting at step 0. With `claims`, its entry says it implements circuit@2, so linking it runs the
 * interface's fixtures on it (#416).
 */
export function plantsPack(planted: Program, name: string, assets: Assets, claims = false): JsonObject {
  const own: Fix = { item: 'fixture', circuit: OWN_CIRCUIT, rate: 1000, inputs: [], track: [], steps: 1 };
  layout(writesOf(own));
  const program = circuitProgram(own, moduleOf(name), 'own');
  put(assets, program.bytes);
  put(assets, planted.bytes);
  const fixture = put(assets, Buffer.from(JSON.stringify({
    item: { kind: 'logic@1', params: { ...itemParams(program, own), links: [{ name, asset: planted.sha }] } },
    track: [], steps: 1, expect: { arrays: { '0': { on: [1, 1] } } },
  })));
  return {
    name: 'plants', version: '1.0.0', origin: 'installed',
    libs: { [name]: { asset: planted.sha, exports: EXPORTS.map((e) => e.name), fixtures: [fixture], ...(claims ? { implements: [CIRCUIT] } : {}) } },
  };
}
/** `f`'s piece linking the planted library `name` by its own name, from a `plants` pack. */
export function plantedPiece(L: CircuitLib, name: Plant, f: Fix): JsonObject {
  const planted = plantedLib(L, name);
  const assets: Assets = { ...L.assets };
  const plants = plantsPack(planted, linkName(name), assets);
  return piece({ [f.item]: item(f, moduleOf(linkName(name)), [{ name: linkName(name), asset: planted.sha }]) }, [plants], assets);
}

/** Relative difference. */
export const rel = (got: number, want: number): number => Math.abs(got - want) / Math.abs(want);
/** An item's tallies at a step (README: Programs: tallies), for the parts it watches, by part ID. */
export function tallies(a: Record<string, JsonValue[]> | undefined, f: Fix): Record<string, { first: number; last: number; off: number }> {
  expect(a, 'the step\'s arrays are there (the tallies)').toBeDefined();
  const n = (name: string, j: number): number => Number(arr(a![name], `the item's array ${name}`)[j]);
  return Object.fromEntries((f.watch ?? []).map((id, j) => [id, { first: n('first_off', j), last: n('last_off', j), off: n('off_steps', j) }]));
}
/** The element a fixture's program follows as peak j (README: Programs: tallies). */
export const peakOf = (a: Record<string, JsonValue[]> | undefined, f: Fix, array: string, part: string): number => {
  const j = (f.peaks ?? []).findIndex((p) => p.array === array && p.part === part);
  expect(j, `the fixture follows ${array} of ${part}`).toBeGreaterThanOrEqual(0);
  return Number(arr(a!['peak'], 'the item\'s array peak')[j]);
};
