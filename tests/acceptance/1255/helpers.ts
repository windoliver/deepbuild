// Test-side tools for the #1255 separation@1 tests (README: The surface), on #190's and #416's suites' tools, imported
// unchanged: ../190/helpers.ts (the `deep-logic` build, its calls and reply readers, Linux in Docker, headless Chrome)
// and ../416/interfaces/ (its assembler arrangement, its layout probe and its asset reader). This file reads
// separation@1, its reference library and its planted twins from the build's first-party packs, builds pieces whose
// logic item declares movers and minima, and reads the arrays of separation.state@1 and the `judge` call's reply.
// Nothing here stands in for the library, the check or the kind rules.

import { expect } from 'vitest';
import {
  arr, int, isObject, layoutFor, num, obj, onHost, sha256, show, str, type JsonObject, type JsonValue, type Layout, type Program,
} from '../190/helpers.ts';
import { bytesOf } from '../416/interfaces/helpers.ts';
import { layoutProbe } from '../416/interfaces/programs.ts';
import type { Control, Scene, Slot, Vec3, Window } from './model.ts';
import { EXPORTS, RECORD, SLOTS, WINDOWS, offsets, script, scriptWrites, type Writes } from './programs.ts';
import { CITED, HEAVY_LIGHT, WIDE, approach } from './scenes.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#1255.34150321', 2: '#1255.6e2a9493', 3: '#1255.cfaf0d3e', 4: '#1255.32464096',
  5: '#1255.a22f4ff6', 6: '#1255.eba2ab94', 7: '#1255.fcafb56d',
} as const;

export const SEPARATION = 'separation@1';
export const INTERFACE = `lib:${SEPARATION}`;
export const LAYOUT = 'separation.state@1';
/** The interface's kind rules (the issue's Fields). */
export const CLEAR = 'separation.clear', EXACT = 'separation.exact';

export type Assets = Record<string, string>;
export interface Link { name: string; asset: string }
/** A planted twin of the interface's kind kit (README: The kind kit): a planted library, the fixture it runs, the rule it must raise. */
export interface Twin { planted: string; example: string; expect: string }
export interface Separation {
  assets: Assets;
  /** The first-party pack that declares separation@1, as first_party gives it, its entry for the interface, and its `name@version`. */
  pack: JsonObject; entry: JsonObject; packId: string;
  fixtures: string[]; planted: string[];
  /** The reference library: the first-party pack's one library that implements separation@1. */
  ref: Link;
  program(id: string): Program;
}
const byName = <T extends { name: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.name < b.name ? -1 : 1));
let party: Separation | undefined;
/** separation@1 as the build's first-party packs declare it (README: The first-party pack), once per file. */
export function separation(): Separation {
  if (party) return party;
  const [reply] = onHost([{ call: 'first_party' }]);
  expect(reply!['ok'], `first_party lists the build's first-party packs: ${show(reply)}`).toBe(true);
  const packs = arr(reply!['packs'], 'first_party.packs').map((p, i) => obj(p, `first_party.packs[${i}]`));
  const assets = Object.fromEntries(Object.entries(obj(reply!['assets'], 'first_party.assets')).map(([k, v]) => [k, str(v, `first_party.assets.${k}`)]));
  const pack = packs.find((p) => isObject(p['interfaces']) && isObject((p['interfaces'] as JsonObject)[SEPARATION]));
  expect(pack, `a first-party pack declares ${SEPARATION} (packs: ${packs.map((p) => `${p['name']}@${p['version']}`).join(', ')})`).toBeDefined();
  expect(pack!['origin'], `the pack declaring ${SEPARATION} is first-party`).toBe('first_party');
  const entry = obj((pack!['interfaces'] as JsonObject)[SEPARATION], SEPARATION);
  const ids = (k: string): string[] => arr(entry[k], `${SEPARATION}.${k}`).map((x, j) => str(x, `${SEPARATION}.${k}[${j}]`));
  const exports = arr(entry['exports'], `${SEPARATION}.exports`).map((e) => obj(e, 'an export')) as unknown as typeof EXPORTS;
  expect(byName(exports), `${SEPARATION} declares exactly README: Exports' seven exports and their signatures`).toEqual(byName(EXPORTS));
  expect(entry['layout'], `${SEPARATION}'s state layout is ${LAYOUT}`).toBe(LAYOUT);
  const rules = obj(entry['rules'], `${SEPARATION}.rules (its pack's kind rules)`);
  expect(Object.keys(rules).sort(), `${SEPARATION}'s pack declares the kind rules ${CLEAR} and ${EXACT}`).toEqual([CLEAR, EXACT]);
  expect(obj(rules[EXACT], EXACT)['tolerance'], `${EXACT}'s tolerance is 0.5 s by default`).toBe(0.5);
  expect(ids('fixtures').length, `${SEPARATION} ships fixtures`).toBeGreaterThan(0);
  const libs = Object.entries(obj(pack!['libs'] ?? {}, `${pack!['name']}.libs`)).filter(([, e]) => isObject(e) && Array.isArray(e['implements']) && (e['implements'] as JsonValue[]).includes(SEPARATION));
  expect(libs.length, `the first-party pack carries one reference library that implements ${SEPARATION}: ${show(pack!['libs'])}`).toBe(1);
  const [refName, refEntry] = libs[0]!;
  party = {
    assets, pack: pack!, entry, packId: `${pack!['name']}@${pack!['version']}`, fixtures: ids('fixtures'), planted: ids('planted'),
    ref: { name: refName, asset: str(obj(refEntry, refName)['asset'], `${refName}.asset`) },
    program(id) { const bytes = bytesOf(assets, id); return { name: id.slice(0, 12), bytes, b64: bytes.toString('base64'), sha: id }; },
  };
  return party;
}
/**
 * The interface's kind kit (README: The kind kit): its `twins`, one for each kind rule, each naming one of the
 * interface's planted libraries and a fixture the pack carries.
 */
export function twins(s: Separation): Twin[] {
  const list = arr(s.entry['twins'], `${SEPARATION}.twins (its kind kit's planted twins)`).map((t, i) => {
    const o = obj(t, `${SEPARATION}.twins[${i}]`);
    return { planted: str(o['planted'], `twins[${i}].planted`), example: str(o['example'], `twins[${i}].example`), expect: str(o['expect'], `twins[${i}].expect`) };
  });
  expect(list.map((t) => t.expect).sort(), `${SEPARATION}'s kit holds one planted twin for each kind rule`).toEqual([CLEAR, EXACT]);
  for (const t of list) {
    expect(s.planted, `the twin for ${t.expect} is one of ${SEPARATION}'s planted libraries`).toContain(t.planted);
    expect(typeof s.assets[t.example], `the twin for ${t.expect} names a fixture the pack carries (${t.example})`).toBe('string');
  }
  expect(new Set(list.map((t) => t.planted)).size, 'the two twins are two libraries').toBe(2);
  return list;
}
/** The planted library the kit holds to `rule`: for separation.clear the once-a-second sampler, for separation.exact the solver that leaves the band. */
export const plantedFor = (s: Separation, rule: string): Program => s.program(twins(s).find((t) => t.expect === rule)!.planted);

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

export interface Item { program: Program; writes: Writes; scene: Scene; links: Link[]; checkpoint?: number }
const put = (assets: Assets, bytes: Buffer): string => { const s = sha256(bytes); assets[s] = bytes.toString('base64'); return s; };
/** A logic item's params with no links: its program, its arrays, its movers and minima, and the largest fuel a step may take. */
export const itemParams = (i: Omit<Item, 'links'>): JsonObject => ({
  program: i.program.sha, writes: i.writes as unknown as JsonObject, separation: i.scene as unknown as JsonObject,
  budget: { fuel: 10_000_000 }, ...(i.checkpoint ? { checkpoint: { every: i.checkpoint } } : {}),
});
/** A piece: its logic items, packs and assets (the first-party packs' among them). */
export function piece(items: Record<string, Item>, packs: JsonObject[] = [], carried: Assets = {}): JsonObject {
  const assets: Assets = { ...carried };
  const its: JsonObject = {};
  for (const [id, i] of Object.entries(items)) {
    put(assets, i.program.bytes);
    its[id] = { kind: 'logic@1', params: { ...itemParams(i), links: i.links as unknown as JsonValue } };
  }
  return { seed: 1255, packs, items: its, assets };
}

/** The names this suite links the kit's planted libraries by, each after what it does wrong (README: Planted twins). */
export const PLANTED = { [CLEAR]: 'once_a_second@1', [EXACT]: 'leaves_band@1' } as const;
/**
 * A pack `plants` carrying a planted library under `name`, with a fixture of its own (#190's rule) that any
 * separation@1 library passes: the approach scene loaded, importing the library by its own name, whose movers hold
 * 3, 3 and 2 fixes at step 0 (README: Planted twins).
 */
export function plantsPack(planted: Program, name: string, assets: Assets): JsonObject {
  const scene = approach(WIDE, [HEAVY_LIGHT(CITED)]);
  const writes = scriptWrites(scene.movers.length);
  const program = script({ name: 'own', movers: scene.movers.length }, `lib:${name.split('@')[0]!}`);
  layout(writes);
  put(assets, program.bytes);
  put(assets, planted.bytes);
  const own = {
    item: { kind: 'logic@1', params: { ...itemParams({ program, writes, scene }), links: [{ name, asset: planted.sha }] } },
    track: [], steps: 1, expect: { arrays: { '0': { fix_count: scene.movers.map((m) => m.route.length) } } },
  };
  const fixture = put(assets, Buffer.from(JSON.stringify(own)));
  return { name: 'plants', version: '1.0.0', origin: 'installed', libs: { [name]: { asset: planted.sha, exports: EXPORTS.map((e) => e.name), fixtures: [fixture] } } };
}

// ---------------------------------------------------------------------------------------------------
// The judge (README: The judge).

/** `judge` with each rule's params: separation.clear's span, and separation.exact's tolerance where the pack's default isn't meant. */
export const judgeCall = (p: JsonObject, steps: number, span: [number, number]): JsonObject => ({ call: 'judge', piece: p, track: [], steps, rules: { [CLEAR]: { span } } });
export interface Rule { verdict: string; fails: JsonObject[] }
/** An item's rules from a `judge` reply. */
export function judged(reply: JsonObject, item: string): Record<string, Rule> {
  expect(reply['ok'], `judge ran the piece (ok: true): ${show(reply)}`).toBe(true);
  const it = obj(obj(reply['items'], 'judge.items')[item], `judge.items.${item}`);
  return Object.fromEntries(Object.entries(obj(it['rules'], `${item}.rules`)).map(([code, r]) => {
    const o = obj(r, `${item}.rules.${code}`);
    return [code, { verdict: str(o['verdict'], `${code}.verdict`), fails: arr(o['fails'], `${code}.fails`).map((f, i) => obj(f, `${code}.fails[${i}]`)) }];
  }));
}
/** One of a judgement's rules, or a failure naming the rules it has. */
export function rule(j: Record<string, Rule>, code: string): Rule {
  expect(j[code], `the judgement has ${code}: ${Object.keys(j).join(', ')}`).toBeDefined();
  return j[code]!;
}

// ---------------------------------------------------------------------------------------------------
// The arrays of separation.state@1, as a bake's step holds them (README: The state and its arrays).

type Arrays = Record<string, JsonValue[]>;
const list = (a: Arrays, name: string): JsonValue[] => arr(a[name], `the item's array ${name}`);
const ints = (a: Arrays, name: string): number[] => list(a, name).map((x, i) => int(x, `${name}[${i}]`));
const nums = (a: Arrays, name: string): number[] => list(a, name).map((x, i) => num(x, `${name}[${i}]`));
/** The windows the state holds: its first `win_count` slots. */
export function windowsOf(a: Arrays): Window[] {
  const n = int(list(a, 'win_count')[0], 'win_count');
  expect(n >= 0 && n <= WINDOWS, `win_count ${n} is within the ${WINDOWS} windows the state writes`).toBe(true);
  const wa = ints(a, 'win_a'), wb = ints(a, 'win_b'), from = nums(a, 'win_from'), to = nums(a, 'win_to'), min = nums(a, 'win_min'), row = ints(a, 'win_row'), basis = ints(a, 'win_basis');
  return Array.from({ length: n }, (_, i) => ({ a: wa[i]!, b: wb[i]!, from: from[i]!, to: to[i]!, min: min[i]!, row: row[i]!, basis: basis[i]! }));
}
/** Mover `m` as the state holds it: its slots in the order flown. */
export function slotsOf(a: Arrays, m: number): Slot[] {
  const n = ints(a, 'fix_count')[m]!;
  expect(n >= 0 && n <= SLOTS, `mover ${m} holds ${n} slots, within ${SLOTS}`).toBe(true);
  const ref = ints(a, 'fix_ref'), pos = list(a, 'fix_pos'), speed = nums(a, 'fix_speed'), time = nums(a, 'fix_time');
  return Array.from({ length: n }, (_, q) => ({ ref: ref[SLOTS * m + q]!, at: arr(pos[SLOTS * m + q], `fix_pos[${SLOTS * m + q}]`).map((x) => num(x, 'a coordinate')) as Vec3, speed: speed[SLOTS * m + q]!, time: time[SLOTS * m + q]! }));
}
/** The closest pair the state holds. */
export const closestOf = (a: Arrays): { a: number; b: number; dist: number; time: number } =>
  ({ a: ints(a, 'closest_a')[0]!, b: ints(a, 'closest_b')[0]!, dist: nums(a, 'closest_dist')[0]!, time: nums(a, 'closest_time')[0]! });
/** A control record a script wrote as `name`, with what `delay` and `apply` returned for it. */
export function recordOf(a: Arrays, name: string): Control & { ret: number; did: number } {
  const f = Object.fromEntries(RECORD.map((k) => [k, num(list(a, `${name}_${k}`)[0], `${name}_${k}`)])) as Record<typeof RECORD[number], number>;
  return { kind: f.kind, mover: f.mover, from: f.from, to: f.to, value: f.value, why: f.why, ret: f.ret, did: f.did };
}
/** How two lists of windows differ, each taken by pair and then start: the pair, the minimum, the row and the basis exactly, the ends within `tol` seconds. */
export function windowsDiffer(got: Window[], want: Window[], tol: number): string[] {
  const order = (w: Window[]): Window[] => [...w].sort((x, y) => x.a - y.a || x.b - y.b || x.from - y.from);
  const g = order(got), w = order(want), out: string[] = [];
  if (g.length !== w.length) out.push(`${g.length} windows, expected ${w.length}`);
  w.forEach((x, i) => {
    const y = g[i];
    if (!y || y.a !== x.a || y.b !== x.b || y.min !== x.min || y.row !== x.row || y.basis !== x.basis || !(Math.abs(y.from - x.from) <= tol) || !(Math.abs(y.to - x.to) <= tol)) out.push(`window ${i}: ${JSON.stringify(y)}, expected ${JSON.stringify(x)} within ${tol} s`);
  });
  return out.slice(0, 20);
}
