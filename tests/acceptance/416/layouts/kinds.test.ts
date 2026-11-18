// #416.d1f5f8b8: "deep_kinds returns physics2d.lib@1, fsm@1 and nn.mlp@1 with their exports and fixtures, and
// nav.graph@1, table.layout@1 and pages@1 with their docs and caps; and a plug-in that tries to fill data.layout@1
// outside a pack is refused, naming the registry's fill"
//
// The three interfaces ship in first-party packs (the issue's Scope): every packs/<name>-<version>/pack.json whose
// `interfaces` declares one is installed as deepbuild/<name>. With a plug-in's data.layout@1 entry in the scenario's
// `plugin_entries` (#412), its kit passed, deep_kinds' `list` of lib.interface@1 holds each interface from its
// first-party pack with the exports and fixtures its pack declares; its list of data.layout@1 holds nav.graph@1,
// table.layout@1 and pages@1, each with a doc and the cap `validate` enforces for it (pages@1's own, 268,451,852
// bytes), and the plug-in's entry listed unavailable with a refusal naming data.layout@1 and its fill, module,
// first_party_pack and pack; and the plug-in's layout validates nothing.
//
// Wrong programs it fails on: no lib.interface@1 or an interface missing from it, an interface listed without its
// exports or fixtures or with others than its pack's, a layout listed without its doc or with another cap than the one
// enforced, and a plug-in's fill admitted, or refused without naming the registry's fill.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIGEST, REPO, TIMEOUT, arr, deepShow, installPack, isObject, kindsList, num, obj, runShow, scenario, show, str, sub, useTemp, validate,
  type JsonObject, type JsonValue, type PackDir,
} from './helpers.ts';
import { pluginLayout } from './fixtures.ts';

const ID = '#416.d1f5f8b8';
const temp = useTemp();
const INTERFACES = ['physics2d.lib@1', 'fsm@1', 'nn.mlp@1'] as const;
const LAYOUTS = ['nav.graph@1', 'table.layout@1', 'pages@1'] as const;
/** pages@1's own cap: a 12-byte header and 4,096 pages of a u32 number and 64 KiB (design: Logic: data layouts; #415). */
const PAGES_MAX_BYTES = 12 + 4_096 * (4 + 65_536);
/** data.layout@1's fill (design: Logic: data layouts). */
const FILL = ['module', 'first_party_pack', 'pack'];

/** A first-party pack whose `interfaces` declares one of the three, as packs/ ships it. */
interface Declared { pack: PackDir; interfaces: JsonObject; assets: string[] }
function declaringPacks(): Declared[] {
  const root = join(REPO, 'packs');
  return readdirSync(root).filter((d) => existsSync(join(root, d, 'pack.json'))).flatMap((d) => {
    const manifest = JSON.parse(readFileSync(join(root, d, 'pack.json'), 'utf8')) as JsonValue;
    if (!isObject(manifest) || !isObject(manifest['interfaces'])) return [];
    const interfaces = manifest['interfaces'];
    if (!INTERFACES.some((n) => n in interfaces)) return [];
    const assets = (Array.isArray(manifest['assets']) ? manifest['assets'] : []).filter(isObject).map((a) => String(a['sha256']));
    return [{ pack: { id: `deepbuild/${String(manifest['name'])}`, version: String(manifest['version']), dir: join(root, d) }, interfaces, assets }];
  });
}

/** JSON with every object's keys sorted, so two values compare by content. */
const canon = (v: JsonValue | undefined): string => JSON.stringify(v, (_, x: JsonValue) => (isObject(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]!])) : x));
const sorted = (vs: JsonValue[]): string[] => vs.map(canon).sort();

/** A registry's row and its entries, from a `list` reply and the pages after it (`next`, #412). */
function listed(first: JsonObject, registry: string, page: (cursor: string) => JsonObject): { row: JsonObject; entries: JsonObject[] } {
  let reply = first;
  let row: JsonObject | undefined;
  const entries: JsonObject[] = [];
  for (let n = 0; ; n++) {
    expect(reply['error'], `deep_kinds lists ${registry}: ${show(reply)}`).toBeUndefined();
    const rows = arr(reply['registries'], `deep_kinds list ${registry}: registries`).filter(isObject).filter((r) => r['kind'] === 'registry' && r['name'] === registry);
    if (rows[0]) {
      row ??= rows[0];
      entries.push(...arr(rows[0]['entries'], `deep_kinds list: ${registry}.entries`).filter(isObject));
    }
    if (typeof reply['next'] !== 'string') break;
    expect(n, `deep_kinds list ${registry}'s pages end`).toBeLessThan(20);
    reply = page(reply['next']);
  }
  expect(row, `deep_kinds lists the registry ${registry}: ${show(first, 2000)}`).toBeDefined();
  return { row: row!, entries };
}

describe(`${ID} deep_kinds lists the first-party interfaces and layouts, and refuses a plug-in's layout`, () => {
  it(`${ID} physics2d.lib@1, fsm@1 and nn.mlp@1 with their exports and fixtures; nav.graph@1, table.layout@1 and pages@1 with their docs and caps; a plug-in's data.layout@1 entry refused, naming the registry's fill`, () => {
    const declared = declaringPacks();
    for (const name of INTERFACES) {
      expect(declared.filter((d) => name in d.interfaces).map((d) => d.pack.id), `exactly one first-party pack under packs/ declares ${name} in its interfaces`).toHaveLength(1);
    }
    const root = temp();
    const tiny = join(sub(root, 'files'), 'one-byte.bin');
    writeFileSync(tiny, Buffer.from([1]));
    const plugin = pluginLayout();
    const pluginName = String(obj(plugin['entry'], 'the plug-in entry')['name']);
    const installs = declared.map((d) => installPack(d.pack));
    const run = (calls: JsonObject[]): JsonObject[] => {
      const replies = runShow(deepShow(), scenario(sub(root, 'evidence'), [], [...installs, ...calls], { plugin_entries: [plugin] }));
      declared.forEach((d, i) => expect(replies[i]!['outcome'], `the first-party pack ${d.pack.id}@${d.pack.version} installs: ${show(replies[i])}`).toBe('installed'));
      return replies.slice(installs.length);
    };
    const [interfacesListed, layoutsListed, ...validated] = run([
      kindsList('lib.interface@1'), kindsList('data.layout@1'), ...LAYOUTS.map((l) => validate(l, tiny)), validate(pluginName, tiny),
    ]);
    const page = (registry: string) => (cursor: string): JsonObject => run([kindsList(registry, cursor)])[0]!;

    // The interfaces, each from its first-party pack with the exports and fixtures the pack declares.
    const ifs = listed(interfacesListed!, 'lib.interface@1', page('lib.interface@1'));
    for (const name of INTERFACES) {
      const entry = ifs.entries.find((e) => e['name'] === name);
      expect(entry, `lib.interface@1 lists ${name}; it lists ${ifs.entries.map((e) => String(e['name'])).join(', ')}`).toBeDefined();
      expect(entry!['origin'], `${name} is a first-party pack's entry: ${show(entry)}`).toBe('first_party');
      const value = obj(entry!['value'], `${name}'s value`);
      const decl = obj(declared.find((d) => name in d.interfaces)!.interfaces[name], `${name} as its pack declares it`);
      const exports = arr(value['exports'], `${name}'s listed exports`);
      expect(exports.length, `${name} lists at least one export`).toBeGreaterThan(0);
      for (const [i, x] of exports.entries()) {
        const e = obj(x, `${name}.exports[${i}]`);
        expect(str(e['name'], `${name}.exports[${i}].name`).length, `${name}.exports[${i}] has a name`).toBeGreaterThan(0);
        for (const side of ['params', 'results'] as const) {
          for (const [j, t] of arr(e[side], `${name}.exports[${i}].${side}`).entries()) expect(str(t, `${name}.exports[${i}].${side}[${j}]`).length, `a type`).toBeGreaterThan(0);
        }
      }
      expect(sorted(exports), `${name}'s listed exports are the ones its pack declares`).toEqual(sorted(arr(decl['exports'], `${name}'s declared exports`)));
      const fixtures = arr(value['fixtures'], `${name}'s listed fixtures`);
      expect(fixtures.length, `${name} lists at least one fixture`).toBeGreaterThan(0);
      const pack = declared.find((d) => name in d.interfaces)!;
      for (const f of fixtures) {
        expect(str(f, `a fixture of ${name}`), `a fixture of ${name} is an asset ID`).toMatch(DIGEST);
        expect(pack.assets, `${name}'s fixture ${String(f)} is an asset its pack ${pack.pack.id} carries`).toContain(f);
      }
      expect(sorted(fixtures), `${name}'s listed fixtures are the ones its pack declares`).toEqual(sorted(arr(decl['fixtures'], `${name}'s declared fixtures`)));
    }

    // The first-party layouts, each with its doc and the cap validate enforces for it.
    const lays = listed(layoutsListed!, 'data.layout@1', page('data.layout@1'));
    for (const [i, name] of LAYOUTS.entries()) {
      const entry = lays.entries.find((e) => e['name'] === name);
      expect(entry, `data.layout@1 lists ${name}; it lists ${lays.entries.map((e) => String(e['name'])).join(', ')}`).toBeDefined();
      const value = obj(entry!['value'], `${name}'s value`);
      const doc = str(value['doc'], `${name}'s doc`);
      expect(doc.trim().length > 0 && [...doc].length <= 2_000, `${name}'s doc is a text of 1 to 2,000 characters: ${doc.slice(0, 200)}`).toBe(true);
      const cap = num(value['max_bytes'], `${name}'s cap (max_bytes)`);
      expect(cap, `${name}'s listed cap is the one validate enforces for it: ${show(validated[i])}`).toBe(num(validated[i]!['max_bytes'], `validate ${name}: max_bytes`));
      if (name === 'pages@1') expect(cap, 'pages@1\'s cap is its own: a header and 4,096 pages').toBe(PAGES_MAX_BYTES);
    }

    // The plug-in's entry, listed and refused, naming data.layout@1's fill; its layout validates nothing.
    expect(lays.row['fill'], `data.layout@1's fill: ${show(lays.row, 600)}`).toEqual(FILL);
    const plug = lays.entries.find((e) => e['name'] === pluginName);
    expect(plug, `data.layout@1 keeps listing the plug-in's entry ${pluginName} (#412)`).toBeDefined();
    expect({ origin: plug!['origin'], available: plug!['available'] }, `${pluginName} is the plug-in's, unavailable: ${show(plug)}`).toEqual({ origin: 'plugin', available: false });
    const refused = obj(plug!['refused'], `${pluginName}'s refusal`);
    expect({ code: refused['code'], registry: refused['registry'], fill: refused['fill'] }, `${pluginName}'s refusal names the registry and its fill: ${show(refused)}`)
      .toEqual({ code: 'fill_refused', registry: 'data.layout@1', fill: FILL });
    const plugValidated = validated[LAYOUTS.length]!;
    expect({ ok: plugValidated['ok'], outcome: plugValidated['outcome'] }, `the plug-in's layout validates nothing: ${show(plugValidated)}`).toEqual({ ok: false, outcome: undefined });
  }, TIMEOUT);
});
