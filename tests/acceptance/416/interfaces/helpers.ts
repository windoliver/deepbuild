// Test-side tools for the #416 interface tests (README: The surface), on #190's suite's tools, imported unchanged
// (../../190/helpers.ts: the `deep-logic` builds on this host, at the merge base and in a linux/amd64 container, its
// calls and reply readers, and headless Chrome; the assembler is wat.ts). This file adds what interfaces need: the
// build's first-party packs, packs that declare interfaces and libraries that implement them, the claim on an
// interface, and the receipts' interface runs. Nothing here stands in for the logic module: every link, run, refusal
// and verdict read here is the implementation's.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { REPO, arr, int, isObject, layoutFor, logicBin, obj, onHost, replies, sha256, show, start, str, type JsonObject, type JsonValue, type Layout, type Program } from '../../190/helpers.ts';
import { TARGET, cargoEnv } from './wat.ts';
import {
  COUNT_WRITES, DOOR_STEPS, DOOR_WRITES, ORACLE_WRITES, SLIDE, SLIDE_WRITES, doorProgram, doorRun, f32Bytes, fsmSwitch, fsmTable, layoutProbe, mlp, mlpRun,
  netBytes, netProgram, netWrites, ownNet, physics2d, slideProgram, slideRun, type Export,
} from './programs.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#416.8421965e', 2: '#416.cdd4134d', 3: '#416.6ca0cd2d', 4: '#416.9dfa9973', 7: '#416.0e66795c' } as const;

export type Writes = Record<string, { type: 'bool' | 'i32' | 'f64'; count?: number }>;
/** An asset an item names: bytes this suite puts in the piece, or an ID the piece already carries. */
type AssetRef = Buffer | string;
/** A library's own fixture (#190's): an item linking only it, its steps and the arrays it expects, exactly. */
export interface OwnFixture { program: Program; writes: Writes; stepRate?: number; assets?: AssetRef[]; steps: number; expect: Record<string, Record<string, JsonValue[]>> }
/** A library as its pack carries it (README: LibEntry), with `implements`. */
export interface Lib { name: string; program: Program; exports: string[]; fixtures: OwnFixture[]; implements?: string[] }
/** An interface as a pack declares it (README: Interface). */
export interface Interface { exports: Export[]; layout?: string; fixtures: string[]; planted: string[]; digest: string }
export interface PackSpec { name: string; version: string; origin: 'installed' | 'agent'; libs: Lib[]; interfaces?: Record<string, Interface> }
export interface ItemSpec { program: Program; writes: Writes; stepRate?: number; assets?: AssetRef[]; links?: Lib[] }
export type Assets = Record<string, string>;

const put = (assets: Assets, bytes: Buffer): string => { const s = sha256(bytes); assets[s] = bytes.toString('base64'); return s; };
const ref = (assets: Assets, a: AssetRef): string => (typeof a === 'string' ? a : put(assets, a));
/** A logic item's params, every asset it names put in `assets`. */
function params(spec: ItemSpec, assets: Assets): JsonObject {
  put(assets, spec.program.bytes);
  const p: JsonObject = { program: spec.program.sha, writes: spec.writes as unknown as JsonObject };
  if (spec.stepRate !== undefined) p['step_rate'] = spec.stepRate;
  if (spec.assets) p['assets'] = spec.assets.map((a) => ref(assets, a));
  if (spec.links) {
    p['links'] = spec.links.map((l) => ({ name: l.name, asset: l.program.sha }));
    for (const l of spec.links) put(assets, l.program.bytes);
  }
  return p;
}
/** A library's own fixture as its asset holds it (#190's Fixture). */
function ownFixtureBytes(lib: Lib, f: OwnFixture, assets: Assets): Buffer {
  const item = { kind: 'logic@1', params: params({ program: f.program, writes: f.writes, ...(f.stepRate ? { stepRate: f.stepRate } : {}), ...(f.assets ? { assets: f.assets } : {}), links: [lib] }, assets) };
  return Buffer.from(JSON.stringify({ item, track: [], steps: f.steps, expect: { arrays: f.expect } }));
}
/** A pack as `deep-logic` takes it in a piece's `packs` or a `pack_check` (README: Pack). */
export function packJson(p: PackSpec, assets: Assets): JsonObject {
  const libs: JsonObject = {};
  for (const l of p.libs) {
    put(assets, l.program.bytes);
    libs[l.name] = { asset: l.program.sha, exports: l.exports, fixtures: l.fixtures.map((f) => put(assets, ownFixtureBytes(l, f, assets))), ...(l.implements ? { implements: l.implements } : {}) };
  }
  return { name: p.name, version: p.version, origin: p.origin, libs, ...(p.interfaces ? { interfaces: p.interfaces as unknown as JsonObject } : {}) };
}
export const pack = (name: string, libs: Lib[], version = '1.0.0', origin: 'installed' | 'agent' = 'installed', interfaces?: Record<string, Interface>): PackSpec =>
  ({ name, version, origin, libs, ...(interfaces ? { interfaces } : {}) });
/** A piece: the document's seed, its outside packs, its logic items and every asset they name, after `carried`. */
export function piece(seed: number, items: Record<string, ItemSpec>, packs: PackSpec[] = [], carried: Assets = {}): JsonObject {
  const assets: Assets = { ...carried };
  const its: JsonObject = {};
  for (const [id, spec] of Object.entries(items)) its[id] = { kind: 'logic@1', params: params(spec, assets) };
  const ps = packs.map((p) => packJson(p, assets));
  return { seed, packs: ps, items: its, assets };
}
export function packCheckCall(p: PackSpec, carried: Assets = {}): JsonObject {
  const assets: Assets = { ...carried };
  return { call: 'pack_check', pack: packJson(p, assets), assets };
}
/** The claim that `library` implements `iface`, decided from the interface's fixtures (README: claim). */
export const claimCall = (p: JsonObject, library: string, iface: string): JsonObject => ({ call: 'claim', piece: p, library, interface: iface });
/** Runs `calls` through one `deep-logic --planted <p>...` process on this host (this suite's planted names). */
export function onHostPlanted(calls: JsonObject[], planted: string[]): JsonObject[] {
  const args = planted.flatMap((p) => ['--planted', p]);
  return replies(start(logicBin(), args, calls), calls, `deep-logic ${args.join(' ')}`);
}

// The merge base (criterion 7): `git merge-base HEAD origin/main`, as the repo's scripts take it. #190's helpers take
// the local `main`, which can lag far behind (in this suite's worktree, 998 commits, before #190's links). Its tree is
// exported with `git archive` (no worktree is added) and `deep-logic` built from it into target/acceptance-416-base.
let built: { bin: string; rev: string; error: string } | undefined;
export function baseBin(): { bin: string; rev: string } {
  if (!built) {
    const mb = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    const rev = mb.stdout.trim();
    let error = mb.status === 0 && rev ? '' : `git merge-base HEAD origin/main failed: ${mb.stderr}`;
    const target = join(TARGET, 'acceptance-416-base');
    if (!error) {
      const src = mkdtempSync(join(tmpdir(), 'deep-416-base-'));
      try {
        const tar = `${src}.tar`;
        const a = spawnSync('git', ['archive', '--format=tar', '-o', tar, rev], { cwd: REPO, encoding: 'utf8' });
        const x = a.status === 0 ? spawnSync('tar', ['-xf', tar, '-C', src], { encoding: 'utf8' }) : a;
        rmSync(tar, { force: true });
        if (x.status !== 0) error = `exporting the merge base ${rev} failed: ${x.stderr}`;
        else {
          const b = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-logic'], { cwd: src, encoding: 'utf8', maxBuffer: 1 << 26, env: cargoEnv({ CARGO_TARGET_DIR: target }) });
          if (b.error || b.status !== 0) error = `cargo build --locked --bin deep-logic at ${rev} failed: ${b.error?.message ?? b.stderr.slice(-3000)}`;
        }
      } finally {
        rmSync(src, { recursive: true, force: true });
      }
    }
    built = { bin: join(target, 'debug', process.platform === 'win32' ? 'deep-logic.exe' : 'deep-logic'), rev, error };
  }
  expect(built.error, `deep-logic builds at the merge base ${built.rev}`).toBe('');
  return { bin: built.bin, rev: built.rev };
}
/** One process of the merge base's `deep-logic`. */
export const onBase = (calls: JsonObject[]): JsonObject[] => replies(start(baseBin().bin, [], calls), calls, `deep-logic at the merge base ${baseBin().rev.slice(0, 9)}`);
/** One process's wall time for `calls`, from this checkout's binary or the merge base's. */
export function timed(which: 'head' | 'base', calls: JsonObject[]): number {
  const s = start(which === 'head' ? logicBin() : baseBin().bin, [], calls);
  replies(s, calls, `deep-logic (${which}) timed`);
  return s.ms;
}

// ---------------------------------------------------------------------------------------------------
// The build's first-party packs (README: first_party).

/** An interface fixture, as its asset holds it (README: Interface fixture). */
export interface InterfaceFixture {
  id: string; name: string; params: JsonObject; controls: JsonValue | undefined; track: JsonValue[]; steps: number;
  arrays: Record<string, Record<string, JsonValue[]>>; tolerance: JsonValue;
}
export interface FirstParty {
  assets: Assets;
  /** The interface a first-party pack declares under `name`, with that pack's `name@version`. */
  iface(name: string): Interface & { pack: string };
  fixture(i: Interface, name: string): InterfaceFixture;
  program(id: string): Program;
}
export const bytesOf = (assets: Assets, id: string): Buffer => {
  const b64 = assets[id];
  expect(typeof b64, `the first-party packs carry asset ${id}`).toBe('string');
  const bytes = Buffer.from(b64!, 'base64');
  expect(sha256(bytes), `asset ${id}'s bytes hash to its ID`).toBe(id);
  return bytes;
};
let fp: FirstParty | undefined;
/** `first_party` on this host, once per file. */
export function firstParty(): FirstParty {
  if (fp) return fp;
  const [reply] = onHost([{ call: 'first_party' }]);
  expect(reply!['ok'], `first_party lists the build's first-party packs: ${show(reply)}`).toBe(true);
  const packs = arr(reply!['packs'], 'first_party.packs').map((p, i) => obj(p, `first_party.packs[${i}]`));
  const assets = Object.fromEntries(Object.entries(obj(reply!['assets'], 'first_party.assets')).map(([k, v]) => [k, str(v, `first_party.assets.${k}`)]));
  for (const p of packs) expect(p['origin'], `first-party pack ${p['name']}@${p['version']} has origin first_party`).toBe('first_party');
  fp = {
    assets,
    iface(name) {
      const p = packs.find((x) => isObject(x['interfaces']) && isObject((x['interfaces'] as JsonObject)[name]));
      expect(p, `a first-party pack declares ${name} (packs: ${packs.map((x) => `${x['name']}@${x['version']}`).join(', ')})`).toBeDefined();
      const i = obj((p!['interfaces'] as JsonObject)[name], `${name}`);
      const ids = (k: string): string[] => arr(i[k], `${name}.${k}`).map((x, j) => str(x, `${name}.${k}[${j}]`));
      return {
        pack: `${p!['name']}@${p!['version']}`,
        exports: arr(i['exports'], `${name}.exports`).map((e, j) => {
          const x = obj(e, `${name}.exports[${j}]`);
          return { name: str(x['name'], `${name}.exports[${j}].name`), params: arr(x['params'], 'params').map((t) => str(t, 'a param type')), results: arr(x['results'], 'results').map((t) => str(t, 'a result type')) };
        }),
        ...(typeof i['layout'] === 'string' ? { layout: i['layout'] } : {}),
        fixtures: ids('fixtures'), planted: ids('planted'), digest: str(i['digest'], `${name}.digest`),
      };
    },
    fixture(i, name) {
      const all = i.fixtures.map((id) => ({ id, json: obj(JSON.parse(bytesOf(assets, id).toString('utf8')) as JsonValue, `fixture ${id}`) }));
      const found = all.find((f) => f.json['name'] === name);
      expect(found, `the interface ships a fixture named ${name} (its fixtures are named ${all.map((f) => JSON.stringify(f.json['name'])).join(', ')})`).toBeDefined();
      const f = found!.json;
      const item = obj(f['item'], `fixture ${name}.item`);
      const ex = obj(f['expect'], `fixture ${name}.expect`);
      return {
        id: found!.id, name, params: obj(item['params'], `fixture ${name}.item.params`), controls: f['controls'],
        track: arr(f['track'] ?? [], `fixture ${name}.track`), steps: int(f['steps'], `fixture ${name}.steps`),
        arrays: Object.fromEntries(Object.entries(obj(ex['arrays'], `fixture ${name}.expect.arrays`)).map(([k, v]) =>
          [k, Object.fromEntries(Object.entries(obj(v, `fixture ${name}.expect.arrays.${k}`)).map(([a, xs]) => [a, arr(xs, `${a} at step ${k}`)]))])),
        tolerance: ex['tolerance'] ?? null,
      };
    },
    program(id) { const bytes = bytesOf(assets, id); return { name: id.slice(0, 12), bytes, b64: bytes.toString('base64'), sha: id }; },
  };
  return fp;
}
/** Exports in name order, to compare as sets. */
export const byName = (xs: Export[]): Export[] => [...xs].sort((a, b) => a.name.localeCompare(b.name));
/** The steps a fixture expects `array` at, ascending, each with its values. */
export const expectedAt = (f: InterfaceFixture, array: string): [number, JsonValue[]][] =>
  Object.entries(f.arrays).filter(([, a]) => a[array] !== undefined).map(([k, a]) => [Number(k), a[array]!] as [number, JsonValue[]]).sort((a, b) => a[0] - b[0]);
/** A piece whose one item, `fixture`, is an interface fixture's item with `lib` as its one link (README: Interface fixture). */
export function fixturePiece(f: InterfaceFixture, lib: Lib, packs: PackSpec[], carried: Assets): JsonObject {
  const assets: Assets = { ...carried };
  put(assets, lib.program.bytes);
  const p: JsonObject = { seed: 0, packs: packs.map((x) => packJson(x, assets)), items: { fixture: { kind: 'logic@1', params: { ...f.params, links: [{ name: lib.name, asset: lib.program.sha }] } } }, assets };
  if (f.controls !== undefined) p['controls'] = f.controls;
  return p;
}

// ---------------------------------------------------------------------------------------------------
// Receipts and refusals.

export interface Run { fixture: string; verdict: string; ran: boolean; ns: number }
/** The interface runs a receipt records for one linked library of one item (README: LibRecord.interfaces). */
export function interfaceRuns(reply: JsonObject, item: string, library: string): Record<string, Run[]> {
  const it = obj(obj(reply['items'], 'the reply\'s items')[item], `items.${item}`);
  const lib = arr(it['libraries'], `items.${item}.libraries`).map((l, i) => obj(l, `items.${item}.libraries[${i}]`)).find((l) => l['name'] === library);
  expect(lib, `${item}'s receipt names ${library}: ${show(it['libraries'])}`).toBeDefined();
  const w = `items.${item}.libraries[${library}].interfaces`;
  return Object.fromEntries(arr(lib!['interfaces'], w).map((x, i) => {
    const o = obj(x, `${w}[${i}]`);
    return [str(o['interface'], `${w}[${i}].interface`), arr(o['fixtures'], `${w}[${i}].fixtures`).map((f, j) => {
      const r = obj(f, `${w}[${i}].fixtures[${j}]`);
      return { fixture: str(r['fixture'], 'fixture'), verdict: str(r['verdict'], 'verdict'), ran: r['ran'] === true, ns: typeof r['ns'] === 'number' ? r['ns'] : NaN };
    })];
  }));
}
/** The first refusal `pick` accepts, or a failure that lists them all. */
export function refusalWhere(refusals: JsonObject[], pick: (r: JsonObject) => boolean, what: string): JsonObject {
  const r = refusals.find(pick);
  expect(r, `${what}: ${show(refusals as never)}`).toBeDefined();
  return r!;
}

// ---------------------------------------------------------------------------------------------------
// This suite's libraries as packs carry them, each with its own fixture (#190's rule), worked in programs.ts.

const layouts: Record<string, Layout> = {};
/** The layout `check` gives an item of these writes (#190's layoutFor, on this suite's probe), once per file. */
const layout = (key: string, writes: Writes): Layout => (layouts[key] ??= layoutFor(layoutProbe(), writes as never));
export const slideLayout = (): Layout => layout('slide', SLIDE_WRITES);
export const doorLayout = (): Layout => layout('door', DOOR_WRITES);
export const netLayout = (n: number): Layout => layout(`net${n}`, netWrites(n));
export const oracleLayout = (): Layout => layout('oracle', ORACLE_WRITES);
export const countLayout = (): Layout => layout('count', COUNT_WRITES);

const bare = (label: string): string => label.split('@')[0]!;
/** The slide as an item of `module`'s physics (an interface's name or a library's). */
export const slideItem = (module: string, links: Lib[]): ItemSpec => ({ program: slideProgram(slideLayout(), module), writes: SLIDE_WRITES, stepRate: SLIDE.rate, links });
// Each library's `impl` is the `implements` its pack entry declares; null declares none (an explicit undefined would
// take the default).
/** physics2d.lib@1 as this suite writes it (`phys2d@1`), or the planted one that averages friction (`phys2d_avg@1`). */
export function phys2d(average = false, impl: string[] | null = ['physics2d.lib@1']): Lib {
  const name = average ? 'phys2d_avg@1' : 'phys2d@1';
  const last = SLIDE.steps - 1;
  return {
    name, program: physics2d(average), exports: ['world', 'body', 'step', 'x', 'y'], ...(impl ? { implements: impl } : {}),
    fixtures: [{ program: slideProgram(slideLayout(), `lib:${bare(name)}`), writes: SLIDE_WRITES, stepRate: SLIDE.rate, steps: SLIDE.steps, expect: { [String(last)]: { distance: [slideRun(average)[last]!] } } }],
  };
}
/** The door as an item of `module`'s state machine. */
export const doorItem = (module: string, links: Lib[]): ItemSpec => ({ program: doorProgram(doorLayout(), module), writes: DOOR_WRITES, links });
/** The door's own fixture for a library named `label`: every step's state, by fsm@1's rule (or the planted, lazy one). */
const doorFixture = (label: string, lazy = false): OwnFixture => ({
  program: doorProgram(doorLayout(), `lib:${bare(label)}`), writes: DOOR_WRITES, steps: DOOR_STEPS,
  expect: Object.fromEntries(doorRun(DOOR_STEPS, lazy).map((s, k) => [String(k), { state: [s] }])),
});
/** fsm@1 as this suite writes it, two ways: `fsm_table@1` and `fsm_switch@1`. */
export function fsmLib(which: 'table' | 'switch', impl: string[] | null = ['fsm@1']): Lib {
  const name = `fsm_${which}@1`;
  return { name, program: which === 'table' ? fsmTable() : fsmSwitch(), exports: ['start', 'step'], ...(impl ? { implements: impl } : {}), fixtures: [doorFixture(name)] };
}
/** A library of fsm@1's exports under the name `planted_fsm@1`, with the door's own fixture worked by the planted rule. */
export const plantedFsm = (program: Program, impl?: string[]): Lib =>
  ({ name: 'planted_fsm@1', program, exports: ['start', 'step'], ...(impl ? { implements: impl } : {}), fixtures: [doorFixture('planted_fsm@1', true)] });
/** The network as an item of `module`'s forward, on the given network and input assets. */
export const netItem = (module: string, net: AssetRef, input: AssetRef, n: number, links: Lib[]): ItemSpec =>
  ({ program: netProgram(netLayout(n), module, n), writes: netWrites(n), assets: [net, input], links });
/** nn.mlp@1 as this suite writes it (`mlp@1`), or the planted one that fuses each multiply and add (`mlp_fused@1`). */
export function nnLib(fused = false, impl: string[] | null = ['nn.mlp@1']): Lib {
  const name = fused ? 'mlp_fused@1' : 'mlp@1';
  const own = ownNet();
  return {
    name, program: mlp(fused), exports: ['forward'], ...(impl ? { implements: impl } : {}),
    fixtures: [{ program: netProgram(netLayout(2), `lib:${bare(name)}`, 2), writes: netWrites(2), assets: [netBytes(own.net), f32Bytes(own.input)], steps: 1, expect: { '0': { out: mlpRun(own.net, own.input, fused) } } }],
  };
}
