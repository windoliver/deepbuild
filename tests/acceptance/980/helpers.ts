// Test-side tools for the #980 process@1 tests (README: The surface), on #190's, #416's and #981's suites' tools,
// imported unchanged: ../190/helpers.ts (the `deep-logic` build, its calls and reply readers, headless Chrome) and
// ../416/interfaces/ (its assembler arrangement, its layout probe and its asset reader). This file reads process@1 and
// its reference library from the build's first-party packs, builds pieces whose logic items carry `process`, and
// reads the `judge` call's reply. Nothing here stands in for the library, the check or the kind rules.

import { expect } from 'vitest';
import {
  arr, int, isObject, layoutFor, num, obj, onHost, sha256, show, str, type Bake, type JsonObject, type JsonValue, type Layout, type Program,
} from '../190/helpers.ts';
import { bytesOf } from '../416/interfaces/helpers.ts';
import { layoutProbe } from '../416/interfaces/programs.ts';
import { EXPORTS, MEMORY_MIB, offsets, processWrites, sceneProgram, type Writes } from './programs.ts';
import { STEADY, type Scene } from './scenes.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#980.9b7dca8c', 2: '#980.042465a7', 3: '#980.dc043458', 4: '#980.20657dee', 5: '#980.dd638207',
  6: '#980.764570b6', 7: '#980.2ee8b80a', 8: '#980.0e3bb315', 9: '#980.238de3e1', 10: '#980.755cceac',
} as const;

export const PROCESS = 'process@1';
export const INTERFACE = `lib:${PROCESS}`;
/** process@1's kind rules with their params' defaults, as its pack declares them (README: The first-party pack). */
export const RULES = { 'process.conserve': {}, 'process.busy': {}, 'process.little': { tolerance: 0.02 } };
const byName = <T extends { name: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.name < b.name ? -1 : 1));

export type Assets = Record<string, string>;
export interface Link { name: string; asset: string }
interface Process {
  assets: Assets;
  /** The first-party pack that declares process@1, as first_party gives it. */
  pack: JsonObject;
  iface: { fixtures: string[]; planted: string[]; digest: string };
  /** The reference library: the first-party pack's one library that implements process@1. */
  ref: Link;
  program(id: string): Program;
  fixture(id: string): JsonObject;
}
let party: Process | undefined;
/** process@1 as the build's first-party packs declare it (README: The first-party pack), once per file. */
export function processLib(): Process {
  if (party) return party;
  const [reply] = onHost([{ call: 'first_party' }]);
  expect(reply!['ok'], `first_party lists the build's first-party packs: ${show(reply)}`).toBe(true);
  const packs = arr(reply!['packs'], 'first_party.packs').map((p, i) => obj(p, `first_party.packs[${i}]`));
  const assets = Object.fromEntries(Object.entries(obj(reply!['assets'], 'first_party.assets')).map(([k, v]) => [k, str(v, `first_party.assets.${k}`)]));
  const pack = packs.find((p) => isObject(p['interfaces']) && isObject((p['interfaces'] as JsonObject)[PROCESS]));
  expect(pack, `a first-party pack declares ${PROCESS} (packs: ${packs.map((p) => `${p['name']}@${p['version']}`).join(', ')})`).toBeDefined();
  expect(pack!['origin'], `the pack declaring ${PROCESS} is first-party`).toBe('first_party');
  const i = obj((pack!['interfaces'] as JsonObject)[PROCESS], PROCESS);
  const ids = (k: string): string[] => arr(i[k], `${PROCESS}.${k}`).map((x, j) => str(x, `${PROCESS}.${k}[${j}]`));
  const exports = arr(i['exports'], `${PROCESS}.exports`).map((e) => obj(e, 'an export')) as unknown as typeof EXPORTS;
  expect(byName(exports), `${PROCESS} declares exactly README: Exports' ten exports and signatures`).toEqual(byName(EXPORTS));
  expect(i['layout'], `${PROCESS}'s state layout is process.state@1`).toBe('process.state@1');
  expect(i['rules'], `${PROCESS}'s pack declares the kind rules process.conserve, process.busy and process.little (tolerance 0.02)`).toEqual(RULES);
  expect(ids('fixtures').length, `${PROCESS} ships fixtures`).toBeGreaterThan(0);
  expect(ids('planted').length, `${PROCESS} ships the two planted libraries criterion 6 names (README: Planted)`).toBeGreaterThanOrEqual(2);
  const libs = Object.entries(obj(pack!['libs'] ?? {}, `${pack!['name']}.libs`)).filter(([, e]) => isObject(e) && Array.isArray(e['implements']) && (e['implements'] as JsonValue[]).includes(PROCESS));
  expect(libs.length, `the first-party pack carries one reference library that implements ${PROCESS}: ${show(pack!['libs'])}`).toBe(1);
  const [refName, refEntry] = libs[0]!;
  party = {
    assets, pack: pack!,
    iface: { fixtures: ids('fixtures'), planted: ids('planted'), digest: str(i['digest'], `${PROCESS}.digest`) },
    ref: { name: refName, asset: str(obj(refEntry, refName)['asset'], `${refName}.asset`) },
    program(id) { const bytes = bytesOf(assets, id); return { name: id.slice(0, 12), bytes, b64: bytes.toString('base64'), sha: id }; },
    fixture(id) { return obj(JSON.parse(bytesOf(assets, id).toString('utf8')) as JsonValue, `fixture ${id}`); },
  };
  return party;
}

const layouts = new Map<string, Layout>();
/**
 * The layout `check` gives an item of these writes (#190's layoutFor, on #416's probe), once per file: process@1's
 * arrays must sit where README: Arrays says the library writes them, and a program's own arrays where it reads them.
 */
export function layout(writes: Writes): Layout {
  const key = JSON.stringify(writes);
  const known = layouts.get(key);
  if (known) return known;
  const l = layoutFor(layoutProbe(), writes as never);
  for (const [name, at] of Object.entries(offsets(writes))) expect(l.entries.find((e) => e.region === 'writes' && e.name === name)?.offset, `${name} sits at ${at} in the write region`).toBe(at);
  layouts.set(key, l);
  return l;
}

// ---------------------------------------------------------------------------------------------------
// Pieces (README: Pieces).

/** A logic item's params with no links: program, rate, writes, `process` and the budget a model needs. */
export const itemParams = (program: Program, s: Scene, writes: Writes): JsonObject => ({
  program: program.sha, step_rate: s.rate, writes: writes as unknown as JsonObject, process: { kinds: s.kinds },
  budget: { fuel: 10_000_000, memory: MEMORY_MIB },
});
export interface Item { program: Program; scene: Scene; writes: Writes; links: Link[] }
const put = (assets: Assets, bytes: Buffer): string => { const s = sha256(bytes); assets[s] = bytes.toString('base64'); return s; };
/** A piece of logic items, packs and assets. */
export function piece(items: Record<string, Item>, packs: JsonObject[] = [], carried: Assets = {}, seed = 980): JsonObject {
  const assets: Assets = { ...carried };
  const its: JsonObject = {};
  for (const [id, i] of Object.entries(items)) {
    put(assets, i.program.bytes);
    its[id] = { kind: 'logic@1', params: { ...itemParams(i.program, i.scene, i.writes), links: i.links as unknown as JsonValue } };
  }
  return { seed, packs, items: its, assets };
}
/** A scene's piece: one item `id`, its scene program importing `module`, linking `links`. */
export function scenePiece(s: Scene, id: string, module: string, links: Link[], assets: Assets, packs: JsonObject[] = [], seed = 980): JsonObject {
  const writes = processWrites(s);
  layout(writes);
  return piece({ [id]: { program: sceneProgram(s, module), scene: s, writes, links } }, packs, assets, seed);
}
/** The piece an interface fixture runs as (#416's): seed 0, its item as `fixture` linking `link`. */
export function fixturePiece(f: JsonObject, link: Link, carried: Assets, packs: JsonObject[] = []): JsonObject {
  const params = { ...obj(obj(f['item'], 'the fixture\'s item')['params'], 'the fixture\'s params'), links: [link] as unknown as JsonValue };
  return { seed: 0, packs, items: { fixture: { kind: 'logic@1', params } }, assets: { ...carried } };
}
/** Programs, put in `assets`. */
export const carry = (assets: Assets, ...programs: Program[]): Assets => { for (const p of programs) put(assets, p.bytes); return assets; };

/** The name this suite links process@1's planted libraries by (README: Planted). */
export const PLANTED = 'planted_process@1';
export const PLANTED_MODULE = 'lib:planted_process';
/** The own fixture's steps: three minutes of criterion 1's model, which neither planted library changes. */
const OWN_STEPS = 3;
/**
 * A pack `plants` carrying `planted` as planted_process@1, with a fixture of its own (#190's rule) that any process@1
 * library passes: criterion 1's model for three one-minute steps, importing by the library's own name, with one record
 * of 45 s a minute. `claims`: its entry implements process@1.
 */
export function plantsPack(planted: Program, claims: boolean, version: string, assets: Assets): JsonObject {
  const writes = processWrites(STEADY);
  layout(writes);
  const program = sceneProgram(STEADY, PLANTED_MODULE);
  put(assets, program.bytes);
  put(assets, planted.bytes);
  const own = {
    name: 'planted_own', item: { kind: 'logic@1', params: { ...itemParams(program, STEADY, writes), links: [{ name: PLANTED, asset: planted.sha }] } },
    track: [], steps: OWN_STEPS,
    expect: { arrays: { '0': { rec_n: [1], busy_area: [45] }, '2': { rec_n: [3], out_n: [3], busy_area: [135] } }, tolerance: { abs: 1e-9 } },
  };
  const fixture = put(assets, Buffer.from(JSON.stringify(own)));
  return {
    name: 'plants', version, origin: 'installed',
    libs: { [PLANTED]: { asset: planted.sha, exports: EXPORTS.map((e) => e.name), fixtures: [fixture], ...(claims ? { implements: [PROCESS] } : {}) } },
  };
}

// ---------------------------------------------------------------------------------------------------
// The judge (README: The judge) and bakes.

export const judgeCall = (p: JsonObject, steps: number): JsonObject => ({ call: 'judge', piece: p, track: [], steps });
export interface Rule { verdict: string; steps: number; fails: JsonObject[]; values: JsonObject[] }
export interface Judged { rules: Record<string, Rule>; last: Record<string, JsonValue[]> }
/** An item's judgement from a `judge` reply. */
export function judged(reply: JsonObject, item: string): Judged {
  expect(reply['ok'], `judge ran the piece (ok: true): ${show(reply)}`).toBe(true);
  const it = obj(obj(reply['items'], 'judge.items')[item], `judge.items.${item}`);
  const rules = Object.fromEntries(Object.entries(obj(it['rules'], `${item}.rules`)).map(([code, r]) => {
    const o = obj(r, `${item}.rules.${code}`);
    return [code, {
      verdict: str(o['verdict'], `${code}.verdict`), steps: int(o['steps'], `${code}.steps`),
      fails: arr(o['fails'], `${code}.fails`).map((f, i) => obj(f, `${code}.fails[${i}]`)),
      values: Array.isArray(o['values']) ? o['values'].map((v, i) => obj(v, `${code}.values[${i}]`)) : [],
    }];
  }));
  const last = Object.fromEntries(Object.entries(obj(it['last'], `${item}.last`)).map(([k, v]) => [k, arr(v, `${item}.last.${k}`)]));
  return { rules, last };
}
/** One of a judgement's rules, or a failure naming the rules it has. */
export function rule(j: Judged, code: string): Rule {
  expect(j.rules[code], `the judgement has ${code}: ${Object.keys(j.rules).join(', ')}`).toBeDefined();
  return j.rules[code]!;
}
/** A rule's verdict and the steps it read, with its first fails in the message. */
export function passes(r: Rule, code: string, steps: number): void {
  expect([r.verdict, r.steps], `${code} passes, read at ${steps} step(s): ${show(r.fails.slice(0, 4) as never)}`).toEqual(['PASS', steps]);
}
/** An item's array at every step of a bake, step by step. */
export function series(b: Bake, item: string, name: string): JsonValue[][] {
  return b.steps.map((s) => arr(s.arrays[`${item}.${name}`], `${item}.${name} at step ${s.step}`));
}
/** Every step's value of one array as numbers. */
export const numbers = (xs: JsonValue[][], what: string): number[][] => xs.map((x, k) => x.map((v, i) => (typeof v === 'boolean' ? Number(v) : num(v, `${what}[${i}] at step ${k}`))));
/** A bake's arrays against a fixture's expectations, within its tolerance: the differences, the first 20. */
export function fixtureDiffers(b: Bake, f: JsonObject, item = 'fixture'): string[] {
  const out: string[] = [];
  const ex = obj(f['expect'], 'expect');
  const tol = num(obj(ex['tolerance'], 'tolerance')['abs'], 'tolerance.abs');
  for (const [k, arrays] of Object.entries(obj(ex['arrays'], 'expect.arrays'))) {
    const s = b.steps.find((x) => x.step === Number(k));
    for (const [name, want] of Object.entries(obj(arrays, `arrays at ${k}`))) {
      const got = s?.arrays[`${item}.${name}`];
      arr(want, name).forEach((w, i) => {
        const g = Array.isArray(got) ? got[i] : undefined;
        if (typeof g !== 'number' || !(Math.abs(g - (w as number)) <= tol)) out.push(`${name}[${i}] at step ${k}: ${JSON.stringify(g)}, expected ${JSON.stringify(w)} within ${tol}`);
      });
    }
  }
  return out.slice(0, 20);
}
