// Test-side tools for the #953 tests (README: The surface), on #190's and #416's suites' tools, imported unchanged:
// the `deep-logic` build and its JSON-lines calls (../190/helpers.ts), #416's assembler and pack writer
// (../416/interfaces/). This file reads the build's first-party pack modslib@1, puts this suite's driver and its
// scripts into pieces linking mods.lib@1's reference library or a twin, bakes them, and judges every total a bake
// wrote against the brute-force recompute (model.ts). Nothing here stands in for the logic module or a library.

import { spawnSync } from 'node:child_process';
import { expect } from 'vitest';
import { REPO, arr, isObject, layoutFor, logicBin, obj, replies, sha256, show, start, str, type JsonObject, type JsonValue, type Layout, type Program } from '../190/helpers.ts';
import { pack, packJson, type Lib, type OwnFixture, type PackSpec } from '../416/interfaces/helpers.ts';
import { catalogBytes } from './catalog.ts';
import { expectedOf, type Edit, type Expected, type Plan } from './model.ts';
import { EXPORTS, EXPORT_NAMES, driver, driverWrites, layoutProbe, library, scriptBytes, type Twin } from './programs.ts';

/** Each criterion's ID (scripts/proof-change.mjs: `#953.` and the first eight hex of the SHA-256 of its text). */
export const AC = { 1: '#953.ab5c01d3', 2: '#953.cfdaeec8', 3: '#953.a587d88d', 4: '#953.e5d20c0f', 5: '#953.7fa9a285' } as const;
export const IFACE = 'mods.lib@1';
/** The interface's import module (#416's surface: `lib:<name>@<major>.<export>`). */
export const BY_INTERFACE = `lib:${IFACE}`;
/** Every driver item's fuel budget: the logic subset's cap. */
export const FUEL = 10_000_000;
/** The release preflight's switch (scripts/preflight.mjs: DEEP_PREFLIGHT=release). */
export const RELEASE = process.env['DEEP_PREFLIGHT'] === 'release';

export type Assets = Record<string, string>;
const put = (assets: Assets, bytes: Buffer): string => { const s = sha256(bytes); assets[s] = bytes.toString('base64'); return s; };

let catalog: Buffer | undefined;
export const catalogAsset = (): Buffer => (catalog ??= catalogBytes());
const layouts = new Map<number, Layout>();
/** The layout `check` gives a driver item that writes `reads` totals (#190's layoutFor on this suite's probe), once per file. */
export function layoutOf(reads: number): Layout {
  let l = layouts.get(reads);
  if (!l) { l = layoutFor(layoutProbe(), driverWrites(reads) as never); layouts.set(reads, l); }
  return l;
}

// ---------------------------------------------------------------------------------------------------
// The build's first-party pack (README: modslib@1).

export interface Link { name: string; asset: string; bytes: Buffer }
export interface Mods {
  assets: Assets;
  iface: { exports: { name: string; params: string[]; results: string[] }[]; layout?: string; fixtures: string[]; planted: string[]; digest: string };
  /** The reference library: the pack's library that implements mods.lib@1. */
  ref: Link;
}
export function bytesOf(assets: Assets, id: string): Buffer {
  const b64 = assets[id];
  expect(typeof b64, `the first-party packs carry asset ${id}`).toBe('string');
  const bytes = Buffer.from(b64!, 'base64');
  expect(sha256(bytes), `asset ${id}'s bytes hash to its ID`).toBe(id);
  return bytes;
}
let mods: Mods | undefined;
/** `first_party`: the pack modslib (version 1.x), its interface mods.lib@1 and its reference library mods.tree. */
export function modsPack(): Mods {
  if (mods) return mods;
  const [reply] = run([{ call: 'first_party' }]);
  expect(reply!['ok'], `first_party lists the build's first-party packs: ${show(reply)}`).toBe(true);
  const packs = arr(reply!['packs'], 'first_party.packs').map((p, i) => obj(p, `first_party.packs[${i}]`));
  const found = packs.find((p) => p['name'] === 'modslib' && typeof p['version'] === 'string' && /^1\.\d+\.\d+/.test(p['version']));
  expect(found, `a first-party pack modslib@1 (name modslib, version 1.x) ships mods.lib@1; the packs are ${packs.map((p) => `${p['name']}@${p['version']}`).join(', ')}`).toBeDefined();
  const p = found!;
  expect(p['origin'], 'modslib is first party').toBe('first_party');
  const ifaces = isObject(p['interfaces']) ? p['interfaces'] : {};
  expect(Object.keys(ifaces), 'modslib declares the interface mods.lib@1').toContain(IFACE);
  const i = obj(ifaces[IFACE], IFACE);
  const ids = (k: string): string[] => arr(i[k], `${IFACE}.${k}`).map((x, j) => str(x, `${IFACE}.${k}[${j}]`));
  const iface = {
    exports: arr(i['exports'], `${IFACE}.exports`).map((e, j) => {
      const x = obj(e, `${IFACE}.exports[${j}]`);
      return { name: str(x['name'], 'name'), params: arr(x['params'], 'params').map((t) => str(t, 'a param type')), results: arr(x['results'], 'results').map((t) => str(t, 'a result type')) };
    }),
    ...(typeof i['layout'] === 'string' ? { layout: i['layout'] } : {}),
    fixtures: ids('fixtures'), planted: ids('planted'), digest: str(i['digest'], `${IFACE}.digest`),
  };
  const byName = (xs: typeof EXPORTS): string => JSON.stringify([...xs].sort((a, b) => a.name.localeCompare(b.name)));
  expect(byName(iface.exports), 'mods.lib@1 declares exactly the exports README: The surface gives, with their signatures').toBe(byName(EXPORTS));
  expect(iface.fixtures.length, 'mods.lib@1 ships fixtures').toBeGreaterThan(0);
  const libs = isObject(p['libs']) ? p['libs'] : {};
  const refName = Object.keys(libs).find((n) => n.startsWith('mods.tree@'));
  expect(refName, `modslib carries the reference library mods.tree; its libraries are ${Object.keys(libs).join(', ') || 'none'}`).toBeDefined();
  const entry = obj(libs[refName!], refName!);
  expect(arr(entry['implements'] ?? [], `${refName}.implements`), `${refName} implements mods.lib@1`).toContain(IFACE);
  const assets = Object.fromEntries(Object.entries(obj(reply!['assets'], 'first_party.assets')).map(([k, v]) => [k, str(v, `first_party.assets.${k}`)]));
  const asset = str(entry['asset'], `${refName}.asset`);
  mods = { assets, iface, ref: { name: refName!, asset, bytes: bytesOf(assets, asset) } };
  return mods;
}

// ---------------------------------------------------------------------------------------------------
// Pieces of driver items, and this suite's twins (README: Planted twins).

/** A driver item: its script's plan, the nodes it holds, the most totals a step reads, the module it imports from, its link. */
export interface DriverItem { plan: Plan; nodes: number; reads: number; module: string; link: Link }
function itemParams(d: DriverItem, assets: Assets): JsonObject {
  const program = driver(d.module, layoutOf(d.reads), d.reads);
  put(assets, program.bytes);
  put(assets, d.link.bytes);
  return {
    program: program.sha, writes: driverWrites(d.reads) as unknown as JsonObject,
    assets: [put(assets, scriptBytes(d.plan)), put(assets, catalogAsset())],
    links: [{ name: d.link.name, asset: d.link.asset }], budget: { fuel: FUEL },
  };
}
/** A piece of seed 953: its driver items, the outside packs given (as #416's packJson writes them), its budget class if any. */
export function piece(items: Record<string, DriverItem>, packs: PackSpec[] = [], cls?: string): JsonObject {
  const assets: Assets = {};
  const its: JsonObject = {};
  for (const [id, d] of Object.entries(items)) its[id] = { kind: 'logic@1', params: itemParams(d, assets) };
  const ps = packs.map((p) => packJson(p, assets));
  return { seed: 953, ...(cls ? { class: cls } : {}), ...(packs.length ? { packs: ps } : {}), items: its, assets };
}
export const bakeCall = (p: JsonObject, steps: number): JsonObject => ({ call: 'bake', piece: p, track: [], steps });
export const checkCall = (p: JsonObject): JsonObject => ({ call: 'check', piece: p });
/** One `deep-logic` process on this host for `calls`. */
export const run = (calls: JsonObject[]): JsonObject[] => replies(start(logicBin(), [], calls), calls, 'deep-logic');

/** The trivial own fixture a library needs to sit in a pack (#190): a lone side of row archer, its attack 10. */
const OWN_PLAN: Plan = { stats: ['attack'], steps: [{ edits: [{ kind: 'attach', node: 0, parent: -1, row: 'archer' }], reads: [{ node: 0, stat: 0 }], note: 'a lone archer' }] };
function ownFixture(label: string): OwnFixture {
  const bare = label.split('@')[0]!;
  return {
    program: driver(`lib:${bare}`, layoutOf(1), 1), writes: driverWrites(1) as never,
    assets: [scriptBytes(OWN_PLAN), catalogAsset()], steps: 1, expect: { '0': { totals: [10] } },
  };
}
/** A library under `label` in a pack entry: its object, mods.lib@1's export names, its own trivial fixture, its claims. */
export const libEntry = (label: string, program: Program, impl?: string[]): Lib =>
  ({ name: label, program, exports: EXPORT_NAMES, fixtures: [ownFixture(label)], ...(impl ? { implements: impl } : {}) });

export const TWINS = {
  stale: { label: 'mods_stale@1', twin: { stale: true } },
  onSource: { label: 'mods_on_source@1', twin: { onSource: true } },
  pctFirst: { label: 'mods_pct_first@1', twin: { pctFirst: true } },
  roundEach: { label: 'mods_round_each@1', twin: { roundEach: true } },
} as const satisfies Record<string, { label: string; twin: Twin }>;
export type TwinName = keyof typeof TWINS;
/** The pack this suite carries its twins in, each implementing nothing and linked by its own name (#416's planted_fsm@1). */
export function twinPack(name: TwinName): PackSpec {
  const t = TWINS[name];
  return pack('modstwins', [libEntry(t.label, library(t.twin))], '1.0.0', 'installed');
}
/** The link and import module for the reference library (by the interface) or a twin (by its own name). */
export function linkOf(which: 'ref' | TwinName): { module: string; link: Link; packs: PackSpec[] } {
  if (which === 'ref') return { module: BY_INTERFACE, link: modsPack().ref, packs: [] };
  const t = TWINS[which];
  const program = library(t.twin);
  return { module: `lib:${t.label.split('@')[0]}`, link: { name: t.label, asset: program.sha, bytes: program.bytes }, packs: [twinPack(which)] };
}

// ---------------------------------------------------------------------------------------------------
// Judging a bake (README: Criteria to tests).

export interface Judged { item: string; label: string; plan: Plan; nodes: number }
export interface Mismatch {
  item: string; label: string; plan: Plan; nodes: number; step: number; note: string; edit: Edit | null; node: number; stat: number;
  expected: number; actual: JsonValue; previous: number | null; message: string;
}
/** The first difference between what each item's bake wrote and the rule's totals, per item; [] when every total agrees. */
export function judge(reply: JsonObject, items: Judged[], what: string): Mismatch[] {
  expect(reply['ok'], `${what} baked (ok: true): ${show(reply)}`).toBe(true);
  const traps = arr(reply['traps'] ?? [], `${what}.traps`);
  const steps = arr(reply['steps'], `${what}.steps`).map((s, i) => obj(s, `${what}.steps[${i}]`));
  const out: Mismatch[] = [];
  for (const it of items) {
    const trap = traps.find((t) => isObject(t) && t['item'] === it.item);
    expect(trap, `${it.label}: item ${it.item} runs every step without a trap: ${show(trap)}`).toBeUndefined();
    const exp = expectedOf(it.plan, it.nodes);
    let prev: Expected | null = null;
    found: for (let k = 0; k < exp.length; k++) {
      const e = exp[k]!;
      const st = steps.find((s) => s['step'] === k);
      expect(st, `${what} has step ${k}`).toBeDefined();
      const arrays = obj(st!['arrays'], `${what}.steps[${k}].arrays`);
      const totals = arr(arrays[`${it.item}.totals`], `${it.item}.totals at step ${k}`);
      const reads = arr(arrays[`${it.item}.reads`], `${it.item}.reads at step ${k}`)[0];
      const lastId = arr(arrays[`${it.item}.last_id`], `${it.item}.last_id at step ${k}`)[0];
      const note = it.plan.steps[k]!.note;
      const edit = it.plan.steps[k]!.edits.length === 1 ? it.plan.steps[k]!.edits[0]! : null;
      expect(reads, `${it.label}: step ${k} (${note}) reads ${e.values.length} totals`).toBe(e.values.length);
      expect(lastId, `${it.label}: step ${k} (${note}): the latest add's id is ${e.lastId} (ids 0, 1, 2, … in add order)`).toBe(e.lastId);
      for (let i = 0; i < e.values.length; i++) {
        if (totals[i] === e.values[i]) continue;
        const { node, stat } = e.at[i]!;
        const statName = it.plan.stats[stat] ?? `stat ${stat}`;
        const before = prev ? prev.at.findIndex((a) => a.node === node && a.stat === stat) : -1;
        out.push({
          item: it.item, label: it.label, plan: it.plan, nodes: it.nodes, step: k, note, edit, node, stat, expected: e.values[i]!, actual: totals[i] ?? null,
          previous: before >= 0 ? prev!.values[before]! : null,
          message: `${it.label}, step ${k} (${note}): node ${node}, stat ${statName}: the brute-force recompute gives ${e.values[i]}, the library read ${show(totals[i])}`,
        });
        break found;
      }
      prev = e;
    }
  }
  return out;
}

/** Bakes `groups` (each a piece and the items it holds), `perProcess` bakes a process, and judges each; stops after the first process with a mismatch when `untilMismatch`. */
export function bakeAndJudge(groups: Iterable<{ piece: JsonObject; steps: number; items: Judged[] }>, perProcess: number, untilMismatch = false): Mismatch[] {
  const found: Mismatch[] = [];
  let batch: { piece: JsonObject; steps: number; items: Judged[] }[] = [];
  let done = 0;
  const flush = (): void => {
    const out = run(batch.map((b) => bakeCall(b.piece, b.steps)));
    batch.forEach((b, i) => found.push(...judge(out[i]!, b.items, `bake ${done + i} (${b.items[0]?.label ?? ''} …)`)));
    done += batch.length;
    batch = [];
  };
  for (const g of groups) {
    batch.push(g);
    if (batch.length < perProcess) continue;
    flush();
    if (untilMismatch && found.length) return found;
  }
  if (batch.length) flush();
  return found;
}


// ---------------------------------------------------------------------------------------------------
// Gates and the merge base (criterion 5).

export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}`); };
export const onReferenceMac = (): boolean => process.platform === 'darwin' && process.arch === 'arm64';
/** The merge base's metering record (`git merge-base HEAD origin/main`, as the repo's scripts take it), or why it can't be read. */
export function mergeBaseMetering(): { rev: string; nsPerFuelApp: number } | string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|COMMON_DIR|PREFIX)$/.test(k)));
  const mb = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8', env });
  const rev = mb.stdout.trim();
  if (mb.status !== 0 || !rev) return `git merge-base HEAD origin/main failed: ${mb.stderr.trim()}`;
  const shown = spawnSync('git', ['show', `${rev}:crates/deep-logic/metering.json`], { cwd: REPO, encoding: 'utf8', env, maxBuffer: 1 << 24 });
  if (shown.status !== 0) return `the merge base ${rev.slice(0, 12)} holds no crates/deep-logic/metering.json: ${shown.stderr.trim()}`;
  try {
    const v = (JSON.parse(shown.stdout) as { ns_per_fuel?: { app?: unknown } }).ns_per_fuel?.app;
    return typeof v === 'number' ? { rev, nsPerFuelApp: v } : `the merge base's metering record has no ns_per_fuel.app`;
  } catch (e) {
    return `the merge base's metering record isn't JSON: ${String(e)}`;
  }
}
