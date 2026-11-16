// AC9 #155.eaff7d6a: "Every foley@1 preset is a synth.preset@1 entry that passes synth's pack check, and a planted
// foley preset with a node outside the closed list is refused at pack check, naming the preset and the node"
//
// The pack is the first-party foley@1 at packs/foley-1.0.0 (README: The surface under test): its manifest names the
// pack `foley` and carries `presets: {<material>.<action>@1 → preset}`, every one of the 10 materials × 9 actions the
// issue lists, so a document names each `foley.<material>.<action>@1` (Synth As built). Through `deep-show run`:
//   - `install_pack` of it as `deepbuild/foley` (#306, the synth pack check once per version, #204) answers installed
//     with no issue, and `registries` (#200) lists all 90 names as entries of `synth.preset@1` from that pack. Read from
//     the manifest itself: every node of every preset is one of synth's closed list (osc, noise, modes, string, env,
//     biquad, shaper, crush, delay, gain, mix; As built: the chip nodes aren't built).
//   - The planted preset, made here from the pack's own manifest: `paper.tear@1` with one more node, `grains` of kind
//     `granular`, in a pack `test/foley-planted` named `foley`. `install_pack` refuses it, with an issue at
//     `presets/paper.tear@1` naming the node `grains`; the same manifest without the node installs.
// The wrong program is the merge base, which ships no packs/foley-1.0.0.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, ACTIONS, MATERIALS, PACK_DIR, PACK_ID, TIMEOUT, arr, installFoley, installedOk, obj, presetKey, presetName, proof, runShow, scenario, show, tempDir,
  useShow, type JsonObject, type JsonValue,
} from './helpers.ts';

const bin = useShow();
/** Synth `synth@1`'s closed node list, as built (#204). */
const NODES = ['osc', 'noise', 'modes', 'string', 'env', 'biquad', 'shaper', 'crush', 'delay', 'gain', 'mix'];
/** A node's kind: `{kind, …}`, or its kind as the one key holding its fields (Synth As built: Built details). */
const kindOf = (node: JsonValue): string => {
  const o = node as JsonObject;
  if (typeof o?.['kind'] === 'string') return o['kind'];
  const keys = Object.keys(o ?? {});
  return keys.length === 1 ? keys[0]! : `<no kind: ${JSON.stringify(node).slice(0, 80)}>`;
};

function manifest(): JsonObject {
  expect(existsSync(join(PACK_DIR, 'pack.json')), `the first-party foley@1 pack is at packs/foley-1.0.0 (README): no ${join(PACK_DIR, 'pack.json')}`).toBe(true);
  return JSON.parse(readFileSync(join(PACK_DIR, 'pack.json'), 'utf8')) as JsonObject;
}

describe(`${AC[9]} every foley@1 preset passes synth's pack check, and a planted preset with a node outside the list is refused`, () => {
  it(`${AC[9]} packs/foley-1.0.0 holds the 90 presets foley.<material>.<action>@1 over synth's closed node list, install_pack admits it with no issue, and registries lists each as a synth.preset@1 entry`, () => {
    const m = manifest();
    expect(m['name'], 'the pack is named foley, so its presets are named foley.<material>.<action>@1').toBe('foley');
    const presets = obj(m['presets'], 'the manifest\'s presets');
    const want = MATERIALS.flatMap((mat) => ACTIONS.map((a) => presetKey(mat, a))).sort();
    expect(Object.keys(presets).sort(), 'the manifest holds one preset per (material, action), and no other').toEqual(want);
    const outside: string[] = [];
    for (const [key, p] of Object.entries(presets)) {
      for (const [id, node] of Object.entries(obj(obj(p, key)['nodes'], `${key}.nodes`))) if (!NODES.includes(kindOf(node))) outside.push(`${key} node ${id} is ${kindOf(node)}`);
    }
    expect(outside, 'every node of every preset is in synth\'s closed list').toEqual([]);
    const [installed, listed] = runShow(bin(), scenario(tempDir(), [installFoley(), { call: 'registries' }]), 'the foley@1 pack installed');
    installedOk(installed, `install_pack of ${PACK_ID}`);
    const rows = arr(obj(listed, 'registries')['registries'], 'registries.registries').map((r, i) => obj(r, `registries[${i}]`));
    const synth = rows.find((r) => r['name'] === 'synth.preset@1');
    expect(synth, `registries lists synth.preset@1; got ${show(rows.map((r) => r['name']))}`).toBeDefined();
    const entries = arr(synth!['entries'], 'synth.preset@1 entries').map((e, i) => obj(e, `synth.preset@1 entries[${i}]`));
    const fromPack = entries.filter((e) => String(e['pack'] ?? '').startsWith(PACK_ID)).map((e) => String(e['name']));
    proof('ac9-pack.json', { presets: Object.keys(presets).length, entries: fromPack.length, install: installed });
    const names = MATERIALS.flatMap((mat) => ACTIONS.map((a) => presetName(mat, a)));
    expect(names.filter((n) => !fromPack.includes(n)), `every preset is an entry of synth.preset@1 from ${PACK_ID}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[9]} the planted preset paper.tear@1 with a node grains of kind granular is refused at pack check, naming the preset and the node; without the node it installs`, () => {
    const m = manifest();
    const presets = obj(m['presets'], 'the manifest\'s presets');
    const tear = obj(presets[presetKey('paper', 'tear')], 'the preset paper.tear@1');
    const write = (name: string, preset: JsonObject): { id: string; dir: string } => {
      const dir = join(tempDir(), `${name}-1.0.0`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({ ...m, presets: { [presetKey('paper', 'tear')]: preset } }, null, 2)}\n`);
      return { id: `test/${name}`, dir };
    };
    const planted = write('foley-planted', { ...tear, nodes: { ...obj(tear['nodes'], 'paper.tear@1 nodes'), grains: { kind: 'granular', size: 0.05 } } });
    const clean = write('foley-clean', tear);
    const [bad, good] = runShow(bin(), scenario(tempDir(), [
      { call: 'install_pack', id: planted.id, dir: planted.dir }, { call: 'install_pack', id: clean.id, dir: clean.dir },
    ]), 'the planted foley preset and its clean twin');
    proof('ac9-planted.json', { planted: bad, clean: good });
    const r = obj(bad, 'the planted pack\'s install');
    expect(r['outcome'], `the planted preset is refused at pack check; got ${show(r, 1500)}`).toBe('refused');
    const issues = arr(r['issues'], 'its issues').map((i, k) => obj(i, `issues[${k}]`));
    const at = issues.filter((i) => typeof i['path'] === 'string' && (i['path'] as string).startsWith(`presets/${presetKey('paper', 'tear')}`)).map((i) => JSON.stringify(i));
    expect(at.length > 0, `an issue sits at presets/paper.tear@1, naming the preset; got ${show(issues, 1500)}`).toBe(true);
    expect(at.some((t) => t.includes('grains')), `the refusal names the node grains: ${at.join(' ')}`).toBe(true);
    installedOk(good, 'the same preset without the planted node');
  }, TIMEOUT);
});
