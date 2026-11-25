// Test-side tools for the #1181 circuit@1 tests (README: The surface), on #190's and #416's suites' tools, imported
// unchanged: ../190/helpers.ts (the `deep-logic` build, its calls and reply readers, headless Chrome) and
// ../416/interfaces/ (its assembler arrangement, its layout probe and its asset reader). This file reads circuit@1, its
// reference library, its planted libraries and its kind kit from the build's first-party packs, builds pieces whose
// logic item declares a circuit, and reads `playback`'s arrays and the `judge` call's reply. Nothing here stands in
// for the library, the check or the kind rules.

import { expect } from 'vitest';
import {
  arr, int, isObject, layoutFor, num, obj, onHost, sha256, show, str, type Entry, type JsonObject, type JsonValue, type Layout, type Program,
} from '../190/helpers.ts';
import { bytesOf } from '../416/interfaces/helpers.ts';
import { layoutProbe } from '../416/interfaces/programs.ts';
import { OWN_CIRCUIT, type Fixture } from './circuits.ts';
import { EXPORTS, circuitProgram, offsets, writesOf, type Writes } from './programs.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#1181.08b7e139', 2: '#1181.44ca3e33', 3: '#1181.9a9ac998', 4: '#1181.5880f671', 5: '#1181.d116aeee',
  6: '#1181.9ae37d13', 7: '#1181.eb06b860', 8: '#1181.9b64dca3', 9: '#1181.c7d086b8', 10: '#1181.726c5f11',
} as const;

export const CIRCUIT = 'circuit@1';
export const INTERFACE = `lib:${CIRCUIT}`;
export const LAYOUT = 'circuit.state@1';
/** The interface's kind rules (the issue's Fields), with their params' defaults. */
export const KCL = 'circuit.kcl', POWER = 'circuit.power', FUSE = 'circuit.fuse';
export const RULES = { [KCL]: { tolerance: 1e-9 }, [POWER]: { tolerance: 1e-6 }, [FUSE]: {} };

export type Assets = Record<string, string>;
export interface Link { name: string; asset: string }
/** A planted twin of the interface's kind kit (README: The kind kit): a planted library, the fixture it runs, the rule it must raise. */
export interface Twin { planted: string; example: string; expect: string }
export interface CircuitLib {
  assets: Assets;
  /** The first-party pack that declares circuit@1, as first_party gives it, and its entry for the interface. */
  pack: JsonObject; entry: JsonObject;
  fixtures: string[]; planted: string[];
  /** The reference library: the first-party pack's one library that implements circuit@1. */
  ref: Link;
  program(id: string): Program;
  fixture(id: string): JsonObject;
}
const byName = <T extends { name: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.name < b.name ? -1 : 1));
let party: CircuitLib | undefined;
/** circuit@1 as the build's first-party packs declare it (README: The first-party pack), once per file. */
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
  expect(byName(exports), `${CIRCUIT} declares exactly README: Exports' twelve exports and their signatures`).toEqual(byName(EXPORTS));
  expect(entry['layout'], `${CIRCUIT}'s state layout is ${LAYOUT}`).toBe(LAYOUT);
  expect(entry['rules'], `${CIRCUIT}'s pack declares the kind rules circuit.kcl (tolerance 1e-9 A), circuit.power (tolerance 1e-6 relative) and circuit.fuse`).toEqual(RULES);
  expect(ids('fixtures').length, `${CIRCUIT} ships fixtures`).toBeGreaterThan(0);
  const libs = Object.entries(obj(pack!['libs'] ?? {}, `${pack!['name']}.libs`)).filter(([, e]) => isObject(e) && Array.isArray(e['implements']) && (e['implements'] as JsonValue[]).includes(CIRCUIT));
  expect(libs.length, `the first-party pack carries one reference library that implements ${CIRCUIT}: ${show(pack!['libs'])}`).toBe(1);
  const [refName, refEntry] = libs[0]!;
  party = {
    assets, pack: pack!, entry, fixtures: ids('fixtures'), planted: ids('planted'),
    ref: { name: refName, asset: str(obj(refEntry, refName)['asset'], `${refName}.asset`) },
    program(id) { const bytes = bytesOf(assets, id); return { name: id.slice(0, 12), bytes, b64: bytes.toString('base64'), sha: id }; },
    fixture(id) { return obj(JSON.parse(bytesOf(assets, id).toString('utf8')) as JsonValue, `fixture ${id}`); },
  };
  return party;
}

/** The interface's kind kit (README: The kind kit): its `twins`, one for each kind rule, each a planted library of its own and a fixture the pack carries. */
export function twins(L: CircuitLib): Twin[] {
  const list = arr(L.entry['twins'], `${CIRCUIT}.twins (its kind kit's planted twins)`).map((t, i) => {
    const o = obj(t, `${CIRCUIT}.twins[${i}]`);
    return { planted: str(o['planted'], `twins[${i}].planted`), example: str(o['example'], `twins[${i}].example`), expect: str(o['expect'], `twins[${i}].expect`) };
  });
  expect(list.map((t) => t.expect).sort(), `${CIRCUIT}'s kit holds one planted twin for each kind rule`).toEqual([FUSE, KCL, POWER]);
  for (const t of list) {
    expect(L.planted, `the twin for ${t.expect} is one of ${CIRCUIT}'s planted libraries`).toContain(t.planted);
    expect(L.fixtures.includes(t.example) || typeof L.assets[t.example] === 'string', `the twin for ${t.expect} names a fixture the pack carries (${t.example})`).toBe(true);
  }
  expect(new Set(list.map((t) => t.planted)).size, 'the three twins are three libraries').toBe(3);
  return list;
}
/** The planted library the kit holds to `rule` (README: Planted twins). */
export const plantedFor = (L: CircuitLib, rule: string): Program => L.program(twins(L).find((t) => t.expect === rule)!.planted);
/** The names this suite links the kit's planted libraries by, each after what it does wrong (README: Planted twins). */
export const PLANTED = { [KCL]: 'kept_current@1', [POWER]: 'rated_meter@1', [FUSE]: 'late_fuse@1' } as const;
export const moduleOf = (name: string): string => `lib:${name.split('@')[0]!}`;

const layouts = new Map<string, Layout>();
/**
 * The layout `check` gives an item of these writes (#190's layoutFor, on #416's probe), once per file: each array must
 * sit where README: The state and its arrays says the state's head holds it, so a program's one copy publishes them.
 */
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
export interface Item { program: Program; fixture: Fixture; links: Link[]; checkpoint?: number }
/** A logic item's params with no links: its program, its rate, the controls it reads, its arrays, its circuit and the largest fuel a step may take. */
export const itemParams = (program: Program, f: Fixture, checkpoint?: number): JsonObject => ({
  program: program.sha, step_rate: f.rate, ...(f.inputs.length ? { reads: f.inputs } : {}), writes: writesOf(f.circuit) as unknown as JsonObject,
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
  return { seed: 1181, ...(controls.size ? { controls: Object.fromEntries([...controls].map((c) => [c, { kind: 'slider' }])) } : {}), packs, items: its, assets };
}
/** A fixture's piece: its one item, its program importing `module` with `solves` a step, linking `links`. */
export function fixturePiece(f: Fixture, module: string, links: Link[], carried: Assets, o: { packs?: JsonObject[]; solves?: number; per?: number; checkpoint?: number } = {}): JsonObject {
  layout(writesOf(f.circuit));
  const program = circuitProgram({ name: f.item, circuit: f.circuit, per: o.per ?? f.rate, ...(o.solves !== undefined ? { solves: o.solves } : {}) }, module);
  return piece({ [f.item]: { program, fixture: f, links, ...(o.checkpoint ? { checkpoint: o.checkpoint } : {}) } }, o.packs ?? [], carried);
}

/**
 * A pack `plants` carrying a planted library under `name`, with a fixture of its own (#190's rule) that any circuit@1
 * library passes: a lamp straight on the mains (circuits.ts: OWN_CIRCUIT), importing the library by its own name, both
 * parts conducting at step 0 (README: Planted twins).
 */
export function plantsPack(planted: Program, name: string, assets: Assets): JsonObject {
  const own: Fixture = { item: 'fixture', circuit: OWN_CIRCUIT, rate: 1000, inputs: [], track: [], steps: 1 };
  layout(writesOf(OWN_CIRCUIT));
  const program = circuitProgram({ name: 'own', circuit: OWN_CIRCUIT, per: 1000 }, moduleOf(name));
  put(assets, program.bytes);
  put(assets, planted.bytes);
  const fixture = put(assets, Buffer.from(JSON.stringify({
    item: { kind: 'logic@1', params: { ...itemParams(program, own), links: [{ name, asset: planted.sha }] } },
    track: [], steps: 1, expect: { arrays: { '0': { on: [1, 1] } } },
  })));
  return { name: 'plants', version: '1.0.0', origin: 'installed', libs: { [name]: { asset: planted.sha, exports: EXPORTS.map((e) => e.name), fixtures: [fixture] } } };
}
/** `f`'s piece linking the kit's planted library for `rule` by its own name, from a `plants` pack. */
export function plantedPiece(L: CircuitLib, rule: keyof typeof PLANTED, f: Fixture, o: { per?: number } = {}): JsonObject {
  const planted = plantedFor(L, rule);
  const assets: Assets = { ...L.assets };
  const plants = plantsPack(planted, PLANTED[rule], assets);
  return fixturePiece(f, moduleOf(PLANTED[rule]), [{ name: PLANTED[rule], asset: planted.sha }], assets, { packs: [plants], ...o });
}

// ---------------------------------------------------------------------------------------------------
// Playback and the judge (README: The judge).

export type Arrays = Record<string, JsonValue[]>;
/** `playback` of `steps` steps on `f`'s track, its arrays at the steps `at`. */
export const playbackCall = (p: JsonObject, f: Fixture, at: number[], steps = f.steps): JsonObject =>
  ({ call: 'playback', piece: p, track: f.track as unknown as JsonValue, steps, at });
/** An item's arrays by step from a `playback` reply, each keyed by the array's name. */
export function played(reply: JsonObject, item: string): Map<number, Arrays> {
  expect(reply['ok'], `playback ran the piece (ok: true): ${show(reply)}`).toBe(true);
  return new Map(arr(reply['arrays'], 'playback.arrays').map((x) => {
    const o = obj(x, 'a step');
    const a = obj(o['arrays'], 'arrays');
    return [int(o['step'], 'step'), Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith(`${item}.`)).map(([k, v]) => [k.slice(item.length + 1), arr(v, k)]))];
  }));
}
/** An array of an item's arrays at a step, as numbers. */
export function nums(a: Arrays | undefined, name: string): number[] {
  expect(a, `the step's arrays are there (${name})`).toBeDefined();
  return arr(a![name], `the item's array ${name}`).map((x, i) => num(x, `${name}[${i}]`));
}
/** `judge` of `steps` steps of `f`'s track: each kind rule at its pack's defaults. */
export const judgeCall = (p: JsonObject, f: Fixture, steps = f.steps): JsonObject => ({ call: 'judge', piece: p, track: f.track as unknown as JsonValue, steps });
export interface Rule { verdict: string; steps: number; fails: JsonObject[] }
/** An item's rules from a `judge` reply. */
export function judged(reply: JsonObject, item: string): Record<string, Rule> {
  expect(reply['ok'], `judge ran the piece (ok: true): ${show(reply)}`).toBe(true);
  const it = obj(obj(reply['items'], 'judge.items')[item], `judge.items.${item}`);
  return Object.fromEntries(Object.entries(obj(it['rules'], `${item}.rules`)).map(([code, r]) => {
    const o = obj(r, `${item}.rules.${code}`);
    return [code, { verdict: str(o['verdict'], `${code}.verdict`), steps: int(o['steps'], `${code}.steps`), fails: arr(o['fails'], `${code}.fails`).map((f, i) => obj(f, `${code}.fails[${i}]`)) }];
  }));
}
/** One of a judgement's rules, or a failure naming the rules it has. */
export function rule(j: Record<string, Rule>, code: string): Rule {
  expect(j[code], `the judgement has ${code}: ${Object.keys(j).join(', ')}`).toBeDefined();
  return j[code]!;
}
/** Each rule's verdict, as `code: verdict`, sorted. */
export const verdicts = (j: Record<string, Rule>): string[] => Object.entries(j).map(([c, r]) => `${c}: ${r.verdict}`).sort();
export type { Entry };
