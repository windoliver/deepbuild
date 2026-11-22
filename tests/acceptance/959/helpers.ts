// Test-side tools for the #959 tests (README: The surface), on #190's and #416's suites' tools, imported unchanged:
// the `deep-logic` build and its JSON-lines calls (../190/helpers.ts), #416's assembler and pack writer
// (../416/interfaces/). This file reads the build's first-party packs for sense.lib@1 and its reference library, puts
// this suite's driver and a fixture's script and heights into pieces linking that library or a twin, bakes them, and
// judges every grid, seen bit, blip bit and ghost row a bake wrote against the reference (model.ts). Nothing here
// stands in for the logic module or a library, and nothing here asserts what a criterion asks: the test files do.

import { expect } from 'vitest';
import { arr, isObject, logicBin, obj, replies, sha256, show, start, str, type JsonObject, type JsonValue, type Program } from '../190/helpers.ts';
import { pack, packJson, type Lib, type OwnFixture, type PackSpec } from '../416/interfaces/helpers.ts';
import { assemble } from '../416/interfaces/wat.ts';
import { CELL, RADAR_CELL } from './fixtures.ts';
import { KIND, STATE_NAMES, gridsOf, runPlan, stateOf, type Params, type Plan, type Plate, type Stepped, type Wrong } from './model.ts';
import { EXPORTS, EXPORT_NAMES, countsOf, driverText, heightsBytes, libraryText, pagesOf, scriptBytes, writesOf, type Text } from './programs.ts';

/** Each criterion's ID (scripts/proof-change.mjs: `#959.` and the first eight hex of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #959.cff22b0c', 2: 'AC2 #959.9f68d843', 3: 'AC3 #959.7485f12b', 4: 'AC4 #959.5f8a3deb', 5: 'AC5 #959.3faaa651',
} as const;
export const IFACE = 'sense.lib@1';
/** The interface's import module (#416's surface: `lib:<name>@<major>.<export>`). */
export const BY_INTERFACE = `lib:${IFACE}`;
/** Every driver item's fuel budget: the logic subset's cap for one step. */
export const FUEL_CAP = 10_000_000;

export type Assets = Record<string, string>;
const put = (assets: Assets, bytes: Buffer): string => { const s = sha256(bytes); assets[s] = bytes.toString('base64'); return s; };
/** One `deep-logic` process on this host for `calls`. */
export const run = (calls: JsonObject[]): JsonObject[] => replies(start(logicBin(), [], calls), calls, 'deep-logic');
const assembled = (t: Text, form: 'program' | 'library'): Program => assemble(t.name, t.text, form);

// ---------------------------------------------------------------------------------------------------
// The build's first-party pack that declares sense.lib@1 (README: The first-party pack).

export interface Link { name: string; asset: string; bytes: Buffer }
export interface SensePack {
  pack: string; assets: Assets;
  iface: { exports: { name: string; params: string[]; results: string[] }[]; fixtures: string[]; planted: string[] };
  /** The reference library: the pack's library whose `implements` names sense.lib@1. */
  ref: Link;
}
export interface Found { packs: string[]; problems: string[]; sense: SensePack | null }
let found: Found | undefined;
/**
 * `first_party`, read for sense.lib@1: `problems` lists what the build lacks (an empty list: the interface with exactly
 * README's exports, at least one fixture, and one library that implements it, its object among the assets). It asserts
 * nothing of the pack: each test does, in its own file.
 */
export function findSense(): Found {
  if (found) return found;
  const [reply] = run([{ call: 'first_party' }]);
  const packs = (Array.isArray(reply!['packs']) ? reply!['packs'] : []).filter(isObject);
  const names = packs.map((p) => `${String(p['name'])}@${String(p['version'])}`);
  const assets: Assets = Object.fromEntries(Object.entries(isObject(reply!['assets']) ? reply!['assets'] : {}).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const problems: string[] = [];
  const p = packs.find((x) => isObject(x['interfaces']) && isObject(x['interfaces'][IFACE]));
  if (!p) return (found = { packs: names, problems: [`no first-party pack declares ${IFACE}: first_party lists ${names.join(', ') || 'no pack'}`], sense: null });
  const id = `${String(p['name'])}@${String(p['version'])}`;
  if (p['origin'] !== 'first_party') problems.push(`${id} has origin ${show(p['origin'])}, not first_party`);
  const i = (p['interfaces'] as JsonObject)[IFACE] as JsonObject;
  const list = (k: string): string[] => (Array.isArray(i[k]) ? i[k].filter((x): x is string => typeof x === 'string') : []);
  const exports = (Array.isArray(i['exports']) ? i['exports'] : []).filter(isObject).map((e) => ({
    name: String(e['name']), params: Array.isArray(e['params']) ? e['params'].map(String) : [], results: Array.isArray(e['results']) ? e['results'].map(String) : [],
  }));
  if (JSON.stringify(exports) !== JSON.stringify(EXPORTS)) problems.push(`${IFACE} declares the exports ${JSON.stringify(exports)}, not exactly ${JSON.stringify(EXPORTS)} (README: The export)`);
  if (list('fixtures').length === 0) problems.push(`${IFACE} ships no fixture`);
  const libs = isObject(p['libs']) ? p['libs'] : {};
  const refs = Object.entries(libs).filter(([, e]) => isObject(e) && Array.isArray(e['implements']) && e['implements'].includes(IFACE));
  if (refs.length !== 1) problems.push(`${id} carries ${refs.length} libraries that implement ${IFACE} (${refs.map(([n]) => n).join(', ') || 'none'}), not exactly one reference library`);
  let ref: Link | null = null;
  if (refs.length >= 1) {
    const [name, entry] = refs[0]!;
    const asset = String((entry as JsonObject)['asset']);
    const b64 = assets[asset];
    if (b64 === undefined) problems.push(`first_party's assets hold no object ${asset} for the reference library ${name}`);
    else {
      const bytes = Buffer.from(b64, 'base64');
      if (sha256(bytes) !== asset) problems.push(`the reference library ${name}'s bytes don't hash to its asset ID ${asset}`);
      else ref = { name, asset, bytes };
    }
  }
  const sense = ref ? { pack: id, assets, iface: { exports, fixtures: list('fixtures'), planted: list('planted') }, ref } : null;
  return (found = { packs: names, problems, sense });
}

// ---------------------------------------------------------------------------------------------------
// Pieces: this suite's driver on a fixture, linking the reference library or a twin (README: Planted twins).

/** A fixture as a driver item runs it: the plate, the header's numbers and what the program does each step. */
export interface Fixture { plate: Plate; params: Params; plan: Plan }
export const TWINS = {
  flat: { label: 'sense_ignores_heights@1', twin: { flat: true } },
  jamOwn: { label: 'sense_jams_own_side@1', twin: { jamOwn: true } },
  cloakAlways: { label: 'sense_cloak_ignores_radius@1', twin: { cloakAlways: true } },
  ghostRadar: { label: 'sense_ghost_clears_on_radar@1', twin: { ghostRadar: true } },
  spreadOne: { label: 'sense_rebuilds_in_one_step@1', twin: { spreadOne: true } },
} as const satisfies Record<string, { label: string; twin: Wrong }>;
export type TwinName = keyof typeof TWINS;
const bare = (label: string): string => label.split('@')[0]!;

/** A driver item's params: the driver for this fixture's counts, importing `sight` from `module`, with its two assets. */
export function itemParams(f: Fixture, module: string, link: { name: string; asset: string }, assets: Assets, o: { stepRate?: number; drawY?: number } = {}): JsonObject {
  const script = scriptBytes(f.plate, f.params, f.plan, o.drawY ?? 1);
  const heights = heightsBytes(f.plate);
  const pages = pagesOf(script.length, heights.length);
  const c = countsOf(f.plate, f.params, f.plan);
  const program = assembled(driverText(module, c, pages), 'program');
  put(assets, program.bytes);
  return {
    program: program.sha, ...(o.stepRate ? { step_rate: o.stepRate } : {}), writes: writesOf(c) as unknown as JsonObject,
    assets: [put(assets, script), put(assets, heights)], links: [{ name: link.name, asset: link.asset }],
    budget: { fuel: FUEL_CAP, memory: pages / 16 },
  };
}
/** The trivial own fixture a library needs to sit in a pack (#190): a flat 16 m plate, one eye that sees all of it. */
function ownFixture(label: string): OwnFixture {
  const heights = new Float32Array(17 * 17);
  const f: Fixture = {
    plate: { cols: 17, rows: 17, spacing: 1, x0: -8, z0: -8, heights },
    params: { cell: CELL, radarCell: RADAR_CELL, spread: 1, players: [1], seed: 959n },
    plan: {
      sensors: 1, units: 1,
      steps: [[{ op: 'sensor', i: 0, row: { x: 0, z: 0, height: 2, range: 100, kind: KIND.eye, side: 0 } }, { op: 'unit', i: 0, row: { x: 0, z: 0, decloak: 0, side: 0, kind: 1, flags: 0 } }]],
    },
  };
  const script = scriptBytes(f.plate, f.params, f.plan);
  const bytes = heightsBytes(f.plate);
  const c = countsOf(f.plate, f.params, f.plan);
  return {
    program: assembled(driverText(`lib:${bare(label)}`, c, pagesOf(script.length, bytes.length)), 'program'), writes: writesOf(c) as never,
    assets: [script, bytes], steps: 1, expect: { '0': { fog: Array.from({ length: c.fog }, () => 2), seen: [1] } },
  };
}
/** This suite's library under `label` as a pack carries it: its object, sense.lib@1's export, its own trivial fixture. */
const libOf = (label: string, twin: Wrong): Lib => ({ name: label, program: assembled(libraryText(twin), 'library'), exports: EXPORT_NAMES, fixtures: [ownFixture(label)] });
const twinLib = (name: TwinName): Lib => libOf(TWINS[name].label, TWINS[name].twin);
/** The pack this suite carries a twin in: it implements nothing and is linked by its own name (#953's twins). */
export const twinPack = (name: TwinName): PackSpec => pack('sensetwins', [twinLib(name)], '1.0.0', 'installed');
/** The link and import module for the reference library (by the interface) or a twin (by its own name). */
export function linkOf(which: SensePack | TwinName): { module: string; link: Link; packs: PackSpec[] } {
  if (typeof which !== 'string') return { module: BY_INTERFACE, link: which.ref, packs: [] };
  const lib = twinLib(which);
  return { module: `lib:${bare(lib.name)}`, link: { name: lib.name, asset: lib.program.sha, bytes: lib.program.bytes }, packs: [twinPack(which)] };
}
/** A piece of one driver item, `sense`: seed 959, the outside packs given, its budget class and step rate if any. */
export const ITEM = 'sense';
export function piece(f: Fixture, which: SensePack | TwinName, o: { class?: string; stepRate?: number } = {}): JsonObject {
  const { module, link, packs } = linkOf(which);
  const assets: Assets = {};
  put(assets, link.bytes);
  const params = itemParams(f, module, link, assets, o.stepRate ? { stepRate: o.stepRate } : {});
  const ps = packs.map((p) => packJson(p, assets));
  return { seed: 959, ...(o.class ? { class: o.class } : {}), ...(ps.length ? { packs: ps } : {}), items: { [ITEM]: { kind: 'logic@1', params } }, assets };
}
/** The arrays a judgement reads, so a bake's reply holds no others. */
export const READ = ['fog', 'seen', 'blip', 'ghost', 'ghost_pos', 'ghost_kind'] as const;
export const bakeCall = (p: JsonObject, steps: number): JsonObject => ({ call: 'bake', piece: p, track: [], steps, arrays: READ.map((n) => `${ITEM}.${n}`) });
export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });

// ---------------------------------------------------------------------------------------------------
// Judging what a run wrote against the reference (README: Criteria to tests).

export interface Miss {
  step: number; array: 'run' | 'fog' | 'seen' | 'blip' | 'ghost';
  /** For a fog miss: the fog cell, the sight cell that holds it, the side and one of its players. */
  cell?: [number, number]; sightCell?: [number, number]; side?: number;
  /** For a seen or blip miss: the unit row. For a ghost miss: the ghost row, its unit and its side. */
  unit?: number; row?: number;
  expected: string; actual: string; message: string;
}
const numbers = (v: JsonValue | undefined): number[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'number') ? (v as number[]) : null);
const lowest = (mask: number): number => { for (let p = 1; p <= 16; p++) if ((mask >> (p - 1)) & 1) return p; return 1; };
const bits = (v: number): string => `0b${(v >>> 0).toString(2)}`;
/**
 * The differences between the arrays each step's row holds (`arrays["<item>.<name>"]`, as a bake's steps and a match
 * copy's steps both give them) and the reference's, in step order and at most `most`: a fog cell names its cell, its
 * sight cell and the side; a seen or blip bit its unit; a ghost its row. Exact: every value is an integer or a place
 * the rows gave.
 */
export function misses(rows: JsonValue[], want: Stepped[], f: Fixture, label: string, most = 12): Miss[] {
  const g = gridsOf(f.plate, f.params);
  const S = f.params.players.length;
  const out: Miss[] = [];
  const add = (m: Omit<Miss, 'message'> & { what: string }): void => {
    const { what, ...rest } = m;
    out.push({ ...rest, message: `${label}, step ${m.step}: ${what}: the reference gives ${m.expected}, the library wrote ${m.actual}` });
  };
  for (let k = 0; k < want.length && out.length < most; k++) {
    const row = rows.find((r) => isObject(r) && r['step'] === k);
    const arrays = isObject(row) && isObject(row['arrays']) ? row['arrays'] : null;
    const read = (name: string): number[] | null => numbers(arrays?.[`${ITEM}.${name}`]);
    const w = want[k]!.out;
    const fog = read('fog'); const seen = read('seen'); const blip = read('blip'); const ghost = read('ghost'); const kind = read('ghost_kind');
    const places = arrays && Array.isArray(arrays[`${ITEM}.ghost_pos`]) ? (arrays[`${ITEM}.ghost_pos`] as JsonValue[]) : null;
    if (!fog || !seen || !blip || !ghost || !kind || !places || fog.length !== w.fog.length || seen.length !== w.seen.length || ghost.length !== w.ghost.length) {
      add({ step: k, array: 'run', expected: `fog × ${w.fog.length}, seen × ${w.seen.length}, blip, ghost × ${w.ghost.length}, ghost_pos and ghost_kind`, actual: show(arrays ? Object.fromEntries(Object.entries(arrays).map(([n, v]) => [n, Array.isArray(v) ? v.length : v])) : (row ?? null)), what: 'the step\'s arrays' });
      continue;
    }
    for (let i = 0; i < fog.length && out.length < most; i++) {
      if (fog[i] === w.fog[i]) continue;
      const cell: [number, number] = [i % g.fc, Math.floor(i / g.fc)];
      const sightCell: [number, number] = [Math.floor(cell[0] / g.q), Math.floor(cell[1] / g.q)];
      let named = false;
      for (let s = 0; s < S; s++) {
        const p = lowest(f.params.players[s]!);
        const a = stateOf(fog[i]!, p); const e = stateOf(w.fog[i]!, p);
        if (a === e) continue;
        named = true;
        add({ step: k, array: 'fog', cell, sightCell, side: s, expected: STATE_NAMES[e] ?? String(e), actual: STATE_NAMES[a] ?? String(a), what: `fog cell (${cell.join(', ')}), in sight cell (${sightCell.join(', ')}), for side ${s} (player ${p})` });
      }
      if (!named) add({ step: k, array: 'fog', cell, sightCell, expected: bits(w.fog[i]!), actual: bits(fog[i]!), what: `fog cell (${cell.join(', ')}), in sight cell (${sightCell.join(', ')}), in the bits of its sides' other players` });
    }
    for (const [name, got, exp] of [['seen', seen, w.seen], ['blip', blip, w.blip]] as const) {
      for (let u = 0; u < exp.length && out.length < most; u++) {
        if (got[u] !== exp[u]) add({ step: k, array: name, unit: u, expected: bits(exp[u]!), actual: bits(got[u] ?? -1), what: `unit ${u}'s ${name} bits` });
      }
    }
    for (let r = 0; r < w.ghost.length && out.length < most; r++) {
      const unit = Math.floor(r / S);
      const place = numbers(places[r]);
      const e = w.ghost[r] ? `a ghost for ${bits(w.ghost[r]!)} at (${w.ghostPos[2 * r]}, ${w.ghostPos[2 * r + 1]}) of kind ${w.ghostKind[r]}` : 'no ghost';
      const a = ghost[r] ? `a ghost for ${bits(ghost[r]!)} at (${place?.join(', ') ?? '?'}) of kind ${kind[r]}` : 'no ghost';
      if (e !== a) add({ step: k, array: 'ghost', row: r, unit, side: r % S, expected: e, actual: a, what: `ghost row ${r} (unit ${unit}, side ${r % S})` });
    }
  }
  return out;
}
export interface Judged { misses: Miss[]; reply: JsonObject; want: Stepped[]; steps: JsonValue[] }
/** A bake's reply against the reference on the same fixture: a refusal or a trap is a miss of the run itself. */
export function judge(reply: JsonObject, f: Fixture, steps: number, label: string): Judged {
  const want = runPlan(f.plate, f.params, f.plan, steps);
  const rows = Array.isArray(reply['steps']) ? reply['steps'] : [];
  const traps = Array.isArray(reply['traps']) ? reply['traps'].filter(isObject) : [];
  const bad = (what: string): Judged => ({ misses: [{ step: -1, array: 'run', expected: `a bake of ${steps} steps without a trap`, actual: what, message: `${label}: ${what}` }], reply, want, steps: rows });
  if (reply['ok'] !== true) return bad(`the bake is refused: ${show(reply)}`);
  if (traps.length) return bad(`item ${String(traps[0]!['item'])} traps at step ${String(traps[0]!['step'])} (${String(traps[0]!['kind'])})`);
  return { misses: misses(rows, want, f, label), reply, want, steps: rows };
}
/** Bakes `f` linked to `which` for `steps` steps in one process and judges it. */
export function bakeAndJudge(f: Fixture, which: SensePack | TwinName, steps: number, label: string): Judged {
  const [reply] = run([bakeCall(piece(f, which), steps)]);
  return judge(reply!, f, steps, label);
}
/** The interface fixtures a `check` ran on the reference library, as `[fixture, verdict]` pairs (#416's receipt). */
export function interfaceRuns(checked: JsonObject, library: string): [string, string][] | string {
  if (checked['ok'] !== true) return `the check refuses the piece: ${show(checked)}`;
  const item = isObject(checked['items']) ? checked['items'][ITEM] : undefined;
  const lib = (isObject(item) && Array.isArray(item['libraries']) ? item['libraries'] : []).filter(isObject).find((l) => l['name'] === library);
  if (!lib) return `the receipt names no library ${library}: ${show(item)}`;
  const runs = (Array.isArray(lib['interfaces']) ? lib['interfaces'] : []).filter(isObject).find((x) => x['interface'] === IFACE);
  if (!runs) return `the receipt lists no run of ${IFACE}'s fixtures on ${library}: ${show(lib['interfaces'])}`;
  return arr(runs['fixtures'], 'the interface run\'s fixtures').map((x) => { const r = obj(x, 'a fixture run'); return [str(r['fixture'], 'fixture'), str(r['verdict'], 'verdict')] as [string, string]; }).sort();
}

// ---------------------------------------------------------------------------------------------------
// logic.budget (#546's reply: README: logic.budget).

export interface Failure { rule: string; item: string | null; step: number | null; host: string | null; ceiling: number | null; fuel: number | null }
export interface Budget { verdict: string; failures: Failure[]; blocked: string[]; ceiling: Record<string, number>; pipelined: JsonValue | undefined; cls: JsonValue | undefined }
export const budgetCall = (p: JsonObject, steps: number): JsonObject => ({ call: 'budget', piece: p, track: [], steps, fuel_share: 1, on: ['app', 'web'] });
export function budgetOf(reply: JsonObject, what: string): Budget {
  expect([reply['ok'], reply['kind']], `${what}: logic.budget ran: ${show(reply)}`).toEqual([true, 'logic.budget']);
  const n = (v: JsonValue | undefined): number | null => (typeof v === 'number' ? v : null);
  const s = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);
  const report = isObject(reply['report']) ? reply['report'] : {};
  const item = isObject(report['items']) && isObject(report['items'][ITEM]) ? report['items'][ITEM] : {};
  const held = isObject(item['ceiling']) ? item['ceiling'] : {};
  return {
    verdict: str(reply['verdict'], `${what}: verdict`),
    failures: arr(reply['failures'], `${what}: failures`).filter(isObject).map((f) => ({ rule: String(f['rule']), item: s(f['item']), step: n(f['step']), host: s(f['host']), ceiling: n(f['ceiling']), fuel: n(f['fuel']) })),
    blocked: arr(reply['blocked'] ?? [], `${what}: blocked`).filter(isObject).map((b) => String(b['host'])),
    ceiling: Object.fromEntries(Object.entries(held).filter((e): e is [string, number] => typeof e[1] === 'number')),
    pipelined: item['pipelined'], cls: report['class'],
  };
}
/** Each step's fuel for the item, from a bake's step records. */
export function fuelOf(reply: JsonObject): { step: number; fuel: number }[] {
  return (Array.isArray(reply['steps']) ? reply['steps'] : []).filter(isObject).map((r) => {
    const it = isObject(r['items']) && isObject(r['items'][ITEM]) ? r['items'][ITEM] : {};
    return { step: Number(r['step']), fuel: typeof it['fuel'] === 'number' ? it['fuel'] : Number.NaN };
  });
}
