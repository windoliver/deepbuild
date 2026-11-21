// Test-side tools for the #981 lanes@1 tests (README: The surface), on #190's and #416's suites' tools, imported
// unchanged: ../../190/helpers.ts (the `deep-logic` build, its calls and reply readers, headless Chrome) and
// ../../416/interfaces/ (its assembler arrangement, its layout probe and its receipt readers). This file reads lanes@1
// and its reference library from the build's first-party packs, builds pieces with floor paths and lane graphs, and
// reads the `judge` call's reply. Nothing here stands in for the library, the check or the kind rules.

import { expect } from 'vitest';
import {
  arr, int, isObject, layoutFor, num, obj, onHost, sha256, show, str, type Bake, type JsonObject, type JsonValue, type Layout, type Program,
} from '../190/helpers.ts';
import { bytesOf } from '../416/interfaces/helpers.ts';
import { layoutProbe } from '../416/interfaces/programs.ts';
import { STRAIGHT_STEPS, itemParams, pathItems, type Fixture, type ItemSpec } from './fixtures.ts';
import { dispatchProgram, lanesOffsets, lanesWrites, type Writes } from './programs.ts';
import { STATE, STRAIGHT, bay } from './scenes.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#981.9c475355', 2: '#981.c3385bed', 3: '#981.86bc7d66', 4: '#981.2e8beefa',
  5: '#981.78e60032', 6: '#981.ba627540', 7: '#981.0e3bb315', 8: '#981.7c601cf2',
} as const;

export const LANES = 'lanes@1';
export const INTERFACE = `lib:${LANES}`;
/** lanes@1's exports (README: Exports). */
const EXPORTS = [
  { name: 'graph', params: ['i32', 'i32'], results: ['i32'] },
  { name: 'vehicle', params: ['i32', 'i32'], results: ['i32'] },
  { name: 'route', params: ['i32', 'i32', 'i32'], results: ['f64'] },
  { name: 'go', params: ['i32', 'f64', 'i32'], results: [] },
  { name: 'lift', params: ['i32', 'i32', 'f64'], results: [] },
  { name: 'carry', params: ['i32', 'i32'], results: [] },
  { name: 'set_down', params: ['i32', 'i32'], results: [] },
  { name: 'park', params: ['i32', 'i32', 'i32'], results: ['f64'] },
];
const byName = <T extends { name: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.name < b.name ? -1 : 1));

export type Assets = Record<string, string>;
export interface Link { name: string; asset: string }
interface Lanes {
  assets: Assets;
  /** The first-party pack that declares lanes@1, as first_party gives it, and its `name@version`. */
  pack: JsonObject; packId: string;
  iface: { exports: JsonValue; layout: JsonValue; fixtures: string[]; planted: string[]; digest: string; rules: JsonObject };
  /** The reference library: the first-party pack's library that implements lanes@1. */
  ref: Link;
  program(id: string): Program;
  /** An interface fixture's JSON, by asset ID. */
  fixture(id: string): JsonObject;
}
let party: Lanes | undefined;
/** lanes@1 as the build's first-party packs declare it (README: First-party pack), once per file. */
export function lanes(): Lanes {
  if (party) return party;
  const [reply] = onHost([{ call: 'first_party' }]);
  expect(reply!['ok'], `first_party lists the build's first-party packs: ${show(reply)}`).toBe(true);
  const packs = arr(reply!['packs'], 'first_party.packs').map((p, i) => obj(p, `first_party.packs[${i}]`));
  const assets = Object.fromEntries(Object.entries(obj(reply!['assets'], 'first_party.assets')).map(([k, v]) => [k, str(v, `first_party.assets.${k}`)]));
  const pack = packs.find((p) => isObject(p['interfaces']) && isObject((p['interfaces'] as JsonObject)[LANES]));
  expect(pack, `a first-party pack declares ${LANES} (packs: ${packs.map((p) => `${p['name']}@${p['version']}`).join(', ')})`).toBeDefined();
  expect(pack!['origin'], `the pack declaring ${LANES} is first-party`).toBe('first_party');
  const i = obj((pack!['interfaces'] as JsonObject)[LANES], LANES);
  const ids = (k: string): string[] => arr(i[k], `${LANES}.${k}`).map((x, j) => str(x, `${LANES}.${k}[${j}]`));
  const exports = arr(i['exports'], `${LANES}.exports`).map((e) => obj(e, 'an export')) as unknown as typeof EXPORTS;
  expect(byName(exports), `${LANES} declares exactly README: Exports' exports and signatures`).toEqual(byName(EXPORTS));
  expect(i['layout'], `${LANES}'s state layout is lanes.state@1`).toBe('lanes.state@1');
  const rules = obj(i['rules'], `${LANES}.rules (its pack's kind rules)`);
  expect(Object.keys(rules).sort(), `${LANES}'s pack declares the kind rules lanes.clear and lanes.stuck`).toEqual(['lanes.clear', 'lanes.stuck']);
  expect(obj(rules['lanes.stuck'], 'lanes.stuck')['max_wait'], 'lanes.stuck\'s max_wait is 60 s by default').toBe(60);
  expect(ids('fixtures').length, `${LANES} ships fixtures`).toBeGreaterThan(0);
  expect(ids('planted').length, `${LANES} ships a planted library`).toBeGreaterThan(0);
  const libs = Object.entries(obj(pack!['libs'] ?? {}, `${pack!['name']}.libs`)).filter(([, e]) => isObject(e) && Array.isArray(e['implements']) && (e['implements'] as JsonValue[]).includes(LANES));
  expect(libs.length, `the first-party pack carries one reference library that implements ${LANES}: ${show(pack!['libs'])}`).toBe(1);
  const [refName, refEntry] = libs[0]!;
  party = {
    assets, pack: pack!, packId: `${pack!['name']}@${pack!['version']}`,
    iface: { exports: i['exports']!, layout: i['layout']!, fixtures: ids('fixtures'), planted: ids('planted'), digest: str(i['digest'], `${LANES}.digest`), rules },
    ref: { name: refName, asset: str(obj(refEntry, refName)['asset'], `${refName}.asset`) },
    program(id) { const bytes = bytesOf(assets, id); return { name: id.slice(0, 12), bytes, b64: bytes.toString('base64'), sha: id }; },
    fixture(id) { return obj(JSON.parse(bytesOf(assets, id).toString('utf8')) as JsonValue, `fixture ${id}`); },
  };
  return party;
}

const layouts = new Map<string, Layout>();
/**
 * The layout `check` gives an item of these writes (#190's layoutFor, on #416's probe), once per file; lanes@1's arrays
 * must sit where README: Arrays says the library writes them.
 */
export function layout(writes: Writes): Layout {
  const key = JSON.stringify(writes);
  const known = layouts.get(key);
  if (known) return known;
  const l = layoutFor(layoutProbe(), writes as never);
  const v = writes['pos']!.count!;
  for (const [name, at] of Object.entries(lanesOffsets(v))) expect(l.entries.find((e) => e.region === 'writes' && e.name === name)?.offset, `${name} sits at ${at} in the write region`).toBe(at);
  layouts.set(key, l);
  return l;
}

// ---------------------------------------------------------------------------------------------------
// Pieces (README: Piece).

interface Item extends ItemSpec { links: Link[] }
const put = (assets: Assets, bytes: Buffer): string => { const s = sha256(bytes); assets[s] = bytes.toString('base64'); return s; };
/** A piece: its floor paths (every item's scene's, which share none here), its logic items, packs and assets. */
export function piece(items: Record<string, Item>, packs: JsonObject[] = [], carried: Assets = {}, seed = 981): JsonObject {
  const assets: Assets = { ...carried };
  const its: JsonObject = {};
  for (const i of Object.values(items)) Object.assign(its, pathItems(i.scene));
  for (const [id, i] of Object.entries(items)) {
    put(assets, i.program.bytes);
    its[id] = { kind: 'logic@1', params: { ...itemParams(i), links: i.links as unknown as JsonValue } };
  }
  return { seed, packs, items: its, assets };
}
/** The piece an interface fixture runs as (#416's, README: Fixtures): seed 0, the fixture's items, and its item as `fixture` linking `link`. */
export function fixturePiece(f: Fixture | JsonObject, link: Link, carried: Assets, packs: JsonObject[] = []): JsonObject {
  const o = f as unknown as JsonObject;
  const params = { ...obj(obj(o['item'], 'the fixture\'s item')['params'], 'the fixture\'s params'), links: [link] as unknown as JsonValue };
  const p: JsonObject = { seed: 0, packs, items: { ...(isObject(o['items']) ? o['items'] : {}), fixture: { kind: 'logic@1', params } }, assets: { ...carried } };
  if (o['controls'] !== undefined) p['controls'] = o['controls'];
  return p;
}
/** A fixture's program, put in `assets`. */
export const carry = (assets: Assets, ...programs: Program[]): Assets => { for (const p of programs) put(assets, p.bytes); return assets; };

/** The name this suite links lanes@1's planted library by (README: Planted). */
export const PLANTED = 'planted_lanes@1';
/**
 * A pack `plants` carrying `planted` as planted_lanes@1, with a fixture of its own (#190's rule), which it passes: the
 * straight run imported by its own name, whose state is driving at step 0 and parked at step 125 (README: Planted).
 * `claims`: its entry implements lanes@1.
 */
export function plantsPack(planted: Program, claims: boolean, version: string, assets: Assets): JsonObject {
  const writes = lanesWrites(1);
  const program = dispatchProgram('planted_own', 'lib:planted_lanes', [bay(STRAIGHT, 'park.a')], [{ at: 0, v: 0, bay: bay(STRAIGHT, 'rack.b') }], 0.1);
  layout(writes);
  put(assets, program.bytes);
  put(assets, planted.bytes);
  const own = {
    item: { kind: 'logic@1', params: { ...itemParams({ program, writes, scene: STRAIGHT }), links: [{ name: PLANTED, asset: planted.sha }] } },
    items: pathItems(STRAIGHT), track: [], steps: STRAIGHT_STEPS - 10,
    expect: { arrays: { '0': { state: [STATE.driving] }, '125': { state: [STATE.parked] } } },
  };
  const fixture = put(assets, Buffer.from(JSON.stringify(own)));
  return {
    name: 'plants', version, origin: 'installed',
    libs: { [PLANTED]: { asset: planted.sha, exports: EXPORTS.map((e) => e.name), fixtures: [fixture], ...(claims ? { implements: [LANES] } : {}) } },
  };
}

// ---------------------------------------------------------------------------------------------------
// The judge (README: Judge) and bakes.

export const judgeCall = (p: JsonObject, steps: number): JsonObject => ({ call: 'judge', piece: p, track: [], steps });
interface Rule { verdict: string; steps: number; fails: JsonObject[] }
interface Judged { rules: Record<string, Rule>; audit: { max: number; vehicle: number; step: number }; last: Record<string, JsonValue[]> }
/** An item's judgement from a `judge` reply. */
export function judged(reply: JsonObject, item: string): Judged {
  expect(reply['ok'], `judge ran the piece (ok: true): ${show(reply)}`).toBe(true);
  const it = obj(obj(reply['items'], 'judge.items')[item], `judge.items.${item}`);
  const rules = Object.fromEntries(Object.entries(obj(it['rules'], `${item}.rules`)).map(([code, r]) => {
    const o = obj(r, `${item}.rules.${code}`);
    return [code, { verdict: str(o['verdict'], `${code}.verdict`), steps: int(o['steps'], `${code}.steps`), fails: arr(o['fails'], `${code}.fails`).map((f, i) => obj(f, `${code}.fails[${i}]`)) }];
  }));
  const a = obj(obj(it['audit'], `${item}.audit`)['on_graph'], `${item}.audit.on_graph`);
  const last = Object.fromEntries(Object.entries(obj(it['last'], `${item}.last`)).map(([k, v]) => [k, arr(v, `${item}.last.${k}`)]));
  return { rules, audit: { max: num(a['max'], 'on_graph.max'), vehicle: int(a['vehicle'], 'on_graph.vehicle'), step: int(a['step'], 'on_graph.step') }, last };
}
/** One of a judgement's rules, or a failure naming the rules it has. */
export function rule(j: Judged, code: string): Rule {
  expect(j.rules[code], `the judgement has ${code}: ${Object.keys(j.rules).join(', ')}`).toBeDefined();
  return j.rules[code]!;
}
/** An item's array at every step of a bake, step by step. */
export function series(b: Bake, item: string, name: string): JsonValue[][] {
  return b.steps.map((s) => arr(s.arrays[`${item}.${name}`], `${item}.${name} at step ${s.step}`));
}
/** Element v of each step's array, as numbers (a vec2 or vec3 element as its list). */
export const nums = (xs: JsonValue[][], v: number): number[][] => xs.map((x) => (Array.isArray(x[v]) ? (x[v] as number[]) : [x[v] as number]));
/** The distance between two points of one dimension. */
export const gap = (a: number[], b: number[]): number => Math.hypot(...a.map((x, i) => x - b[i]!));
/** Every step at which `got` is farther than `tol` from `want`, as lines, the first 20. */
export function offBy(got: number[][], want: (k: number) => number[] | null, tol: number, what: string): string[] {
  const out: string[] = [];
  got.forEach((g, k) => { const w = want(k); if (w && !(gap(g, w) <= tol)) out.push(`${what} at step ${k}: ${JSON.stringify(g)}, expected ${JSON.stringify(w)}`); });
  return out.slice(0, 20);
}
/** A bake's arrays against a fixture's expectations, within its tolerance: the differences, the first 20. */
export function fixtureDiffers(b: Bake, f: Fixture): string[] {
  const out: string[] = [];
  const tol = (f.expect.tolerance as JsonObject)['abs'] as number;
  for (const [k, arrays] of Object.entries(f.expect.arrays)) {
    const s = b.steps.find((x) => x.step === Number(k));
    for (const [name, want] of Object.entries(arrays)) {
      const got = s?.arrays[`fixture.${name}`];
      want.forEach((w, i) => {
        const g = Array.isArray(got) ? got[i] : undefined;
        const ws = Array.isArray(w) ? (w as number[]) : [w as number];
        const gs = Array.isArray(g) ? (g as number[]) : typeof g === 'number' ? [g] : null;
        if (!gs || gs.length !== ws.length || !(gap(gs, ws) <= tol)) out.push(`${name}[${i}] at step ${k}: ${JSON.stringify(g)}, expected ${JSON.stringify(w)} within ${tol}`);
      });
    }
  }
  return out.slice(0, 20);
}
