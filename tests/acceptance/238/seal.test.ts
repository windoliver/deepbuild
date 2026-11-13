// #238.432c0da5: a test build with the sandbox module and without the logic module seals, runs a test provider
// that writes a one-quad mesh at check and a test layout's validator that refuses its malformed twin, and
// refuses a document with a logic item with module_missing, naming the logic module; a planted sandbox module
// that declares logic among its dependencies is refused at that build's seal, naming logic.
//
// The build is deep-show `full,test-leave-out-logic,test-mesh-item,test-prog-registry` (README: Test builds);
// the provider and the layout come in test/quadpack@1.0.0, written per test with its assets' hashes.
import { describe, expect, it } from 'vitest';
import {
  DIGEST, DOC, PACKS, REGISTRY, SANDBOX_COUNTS, SCHEDULE, arr, board, deepShow, framesOf, installPack, issuesOf, mentions, num, obj, packRow, prebuild,
  present, provided, refusalLine, runShow, scenario, show, startup, stateOf, str, useTemp, word, type JsonObject, type ShowFeature,
} from './helpers.ts';
import { QUAD, acceptPack, meshItem, quadPack } from './programs.ts';

const ID = '#238.432c0da5';
const NO_LOGIC: ShowFeature[] = ['full', 'test-leave-out-logic', 'test-mesh-item', 'test-prog-registry'];
const NEEDS_LOGIC: ShowFeature[] = ['full', 'test-leave-out-logic', 'test-sandbox-needs-logic'];
prebuild(() => { deepShow(NO_LOGIC); });
const temp = useTemp();

const counts = (reply: JsonObject, what: string): { checks: number; rewrites: number; runs: number } =>
  ({ checks: num(reply['checks'], `${what}.checks`), rewrites: num(reply['rewrites'], `${what}.rewrites`), runs: num(reply['runs'], `${what}.runs`) });

describe(`${ID} a build with the sandbox module and without the logic module seals, runs a provider and a validator at check and refuses a logic item`, () => {
  it(`${ID} the build without the logic module seals with sandbox@1 (bit, canonical, wasmtime =49.0.5) and runs the test provider once at check, writing its one-quad mesh, never in a frame`, () => {
    const quad = quadPack(temp());
    const doc = board('Quad', [meshItem('mesh-1')], { packs: ['test/quadpack@1.0.0'], requires: { modules: { 'test.mesh': '^1' } } });
    const [reg, sched, install, before, shown, after, out, frames, later] = runShow(deepShow(NO_LOGIC), scenario(temp(), [
      REGISTRY, SCHEDULE, installPack(quad.pack), SANDBOX_COUNTS, present(DOC.a, doc), SANDBOX_COUNTS, provided(DOC.a), framesOf(DOC.a, 30), SANDBOX_COUNTS,
    ]));
    const modules = arr(reg!['modules'], 'registry: modules').map(String);
    expect(modules, 'the build holds the sandbox module').toContain('sandbox');
    expect(modules, 'the build holds no logic module').not.toContain('logic');
    const iface = obj(obj(sched!['interfaces'], 'schedule: interfaces')['sandbox@1'], 'schedule: interfaces["sandbox@1"]');
    expect(iface['module'], 'sandbox@1 is implemented by the sandbox module').toBe('sandbox');
    const impl = obj(iface['implementation'], 'sandbox@1.implementation');
    expect([impl['name'], impl['equivalence'], impl['state']], 'the shipped implementation is sandbox, bit and canonical').toEqual(['sandbox', 'bit', 'canonical']);
    expect(str(obj(obj(impl['pins'], 'pins')['wasmtime'], 'pins.wasmtime')['version'], 'pins.wasmtime.version'), 'it pins wasmtime =49.0.5').toBe('=49.0.5');
    expect(install!['outcome'], `test/quadpack@1.0.0 installs: ${show(install)}`).toBe('installed');

    expect(shown!['outcome'], `the document with the provider's mesh is presented: ${show(shown)}`).toBe('presented');
    expect(issuesOf(shown!, 'the document').filter((i) => i.severity === 'error').map((i) => i.raw), 'no error issue').toEqual([]);
    const c0 = counts(before!, 'sandbox before the check');
    const c1 = counts(after!, 'sandbox after the check');
    expect(c1.runs, 'the check-time runner ran the provider once at check').toBe(c0.runs + 1);
    const list = arr(out!['provided'], 'provided: provided').map((p, i) => obj(p, `provided[${i}]`));
    expect(list.length, `one provider ran for the document: ${show(out)}`).toBe(1);
    const p = list[0]!;
    expect([p['item'], p['provider'], p['trap'] ?? null], 'the item\'s provider, without a trap').toEqual(['mesh-1', 'quadpack.quad', null]);
    expect(str(p['key'], 'provided.key'), 'its content key').toMatch(DIGEST);
    const mesh = obj(obj(p['out'], 'provided.out')['mesh'], 'provided.out.mesh');
    expect({ positions: mesh['positions'], normals: mesh['normals'], uv0: mesh['uv0'], indices: mesh['indices'], bounds: mesh['bounds'] }, 'the provider wrote the one-quad mesh').toEqual(QUAD);

    const ranFrames = arr(frames!['frames'], 'frames: frames');
    expect(ranFrames.length, 'thirty frames ran').toBe(30);
    expect(counts(later!, 'sandbox after the frames'), 'no frame ran a program, rewrote or checked one').toEqual(c1);
  }, 3_600_000);

  it(`${ID} the test layout's validator, run at pack check, refuses its malformed twin at its first bad byte; a layout whose validator accepts its twin is refused, naming the twin`, () => {
    const quad = quadPack(temp());
    const accept = acceptPack(temp());
    const [install, listing, planted, after] = runShow(deepShow(NO_LOGIC), scenario(temp(), [installPack(quad.pack), PACKS, installPack(accept.pack), PACKS]));
    expect(install!['outcome'], `test/quadpack@1.0.0 installs: ${show(install)}`).toBe('installed');
    const layouts = arr(packRow(listing!, quad.pack)['layouts'], 'quadpack: layouts').map((l, i) => obj(l, `layouts[${i}]`));
    const grid = layouts.find((l) => l['name'] === 'quadpack.grid@1');
    expect(grid, `quadpack lists its layout quadpack.grid@1: ${show(layouts)}`).toBeDefined();
    expect(grid!['state'], 'the layout is admitted').toBe('admitted');
    const twins = arr(grid!['twins'], 'quadpack.grid@1: twins').map((t, i) => obj(t, `twins[${i}]`));
    expect(twins.map((t) => [t['asset'], t['valid'], t['offset']]), 'the validator refused the twin at offset 5, its first byte past 3').toEqual([[quad.sha['grid_twin.bin'], false, 5]]);
    expect(planted!['outcome'], `test/acceptpack@1.0.0, whose validator accepts its twin, is refused: ${show(planted)}`).toBe('refused');
    const row = packRow(after!, accept.pack);
    expect(stateOf(row), 'acceptpack is refused at its pack check').toBe('refused');
    expect(mentions(row['issues'] ?? planted!['issues'] ?? null, accept.sha['grid_valid.bin']!), `the refusal names the twin by its hash: ${show(row)}`).toBe(true);
  }, 3_600_000);

  it(`${ID} the build without the logic module refuses a document with a logic item with module_missing, naming the logic module`, () => {
    const item = { id: 'logic-1', kind: 'logic@1', name: 'Logic', order: 'z0', params: { program: 'ab'.repeat(32), step_rate: 60, writes: { score: { type: 'i32' } } } };
    const [shown] = runShow(deepShow(NO_LOGIC), scenario(temp(), [present(DOC.a, board('Logic', [item], { requires: { modules: { logic: '^1' } } }))]));
    expect(shown!['outcome'], 'the document is refused').toBe('refused');
    const named = issuesOf(shown!, 'the logic document').filter((i) => i.code === 'module_missing' && i.severity === 'error' && word('logic').test(i.what));
    expect(named.length, `an error module_missing names logic: ${show(shown)}`).toBeGreaterThan(0);
  }, 3_600_000);

  it(`${ID} a planted sandbox module that declares logic among its dependencies is refused at the build's seal, naming logic`, () => {
    const s = startup(deepShow(NEEDS_LOGIC));
    const line = refusalLine(s, 'the build whose sandbox module depends on logic');
    expect(arr(line['modules'], 'the refusal: modules').map(String), `the refusal names logic (and the sandbox module that needs it): ${show(line)}`).toEqual(expect.arrayContaining(['logic', 'sandbox']));
  }, 3_600_000);
});
