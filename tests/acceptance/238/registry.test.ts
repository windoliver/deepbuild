// #238.8cc7e4f7: a test registry whose entries a pack may fill with programs admits a pack's program entry
// through sandbox@1's check and rewrite in a build without the logic module, and refuses one that imports a
// function, naming the import; in a build without the sandbox module the pack is refused with module_missing,
// naming the sandbox module.
//
// The test registry is test.prog@1, declared by the test module test.prog (feature test-prog-registry), whose
// entries are programs in the validator role (README: Test builds). The packs name only test.prog in
// requires.modules, so the build without sandbox must refuse them for their programs, not for a listed module.
import { describe, expect, it } from 'vitest';
import {
  PACKS, REGISTRIES, arr, deepShow, fixture, installPack, issuesOf, macSandbox, mentions, obj, onMac, packRow, prebuild, rewriteCall, rewritten, runShow,
  scenario, show, stateOf, str, useTemp, word, type ShowFeature,
} from './helpers.ts';
import { progPack } from './programs.ts';

const ID = '#238.8cc7e4f7';
const NO_LOGIC: ShowFeature[] = ['full', 'test-leave-out-logic', 'test-mesh-item', 'test-prog-registry'];
const NO_SANDBOX: ShowFeature[] = ['full', 'test-leave-out-sandbox', 'test-prog-registry'];
prebuild(() => { deepShow(NO_LOGIC); });
const temp = useTemp();

describe(`${ID} a pack's program entry in a test registry is admitted through sandbox@1's check and rewrite without the logic module, an importing one refused, and without the sandbox module the pack is module_missing`, () => {
  it(`${ID} in the build without the logic module, progpack.ok enters test.prog@1 rewritten by sandbox@1 (its rewritten hash is deep-sandbox's), its kit passing`, () => {
    const ok = progPack(temp(), 'progpack', 'ok', fixture('grid_validator'));
    const [install, listing] = runShow(deepShow(NO_LOGIC), scenario(temp(), [installPack(ok.pack), REGISTRIES]));
    expect(install!['outcome'], `test/progpack@1.0.0 installs: ${show(install)}`).toBe('installed');
    const reg = arr(listing!['registries'], 'registries').map((r, i) => obj(r, `registries[${i}]`)).find((r) => r['name'] === 'test.prog@1');
    expect(reg, 'deep://registries lists test.prog@1').toBeDefined();
    expect(reg!['owner'], 'test.prog@1 is test.prog\'s').toBe('test.prog');
    const entry = arr(reg!['entries'], 'test.prog@1: entries').map((e, i) => obj(e, `entries[${i}]`)).find((e) => e['name'] === 'progpack.ok');
    expect(entry, `test.prog@1 holds progpack.ok: ${show(reg)}`).toBeDefined();
    expect(entry!['origin'], 'it came from a pack').toBe('pack');
    expect(obj(entry!['kit'], 'progpack.ok.kit')['verdict'], 'its kit passed').toBe('PASS');
    const program = obj(entry!['program'], 'progpack.ok.program');
    expect([program['asset'], program['role']], 'the entry is the pack\'s program, in the validator role').toEqual([ok.sha['ok.wasm'], 'validator']);
    macSandbox();
    const [rw] = onMac([rewriteCall(fixture('grid_validator'), 'validator')]);
    expect(str(program['hash'], 'progpack.ok.program.hash'), 'the entry runs the bytes sandbox@1\'s check and rewrite make of it').toBe(rewritten(rw!, 'deep-sandbox: rewrite grid_validator').hash);
  }, 3_600_000);

  it(`${ID} in the build without the logic module, a pack whose program entry imports a function is refused, naming the import`, () => {
    const bad = progPack(temp(), 'badprog', 'imports', fixture('prog_import'));
    const [install, listing] = runShow(deepShow(NO_LOGIC), scenario(temp(), [installPack(bad.pack), PACKS]));
    expect(install!['outcome'], `test/badprog@1.0.0 is refused: ${show(install)}`).toBe('refused');
    const row = packRow(listing!, bad.pack);
    expect(stateOf(row), 'badprog is refused at its pack check').toBe('refused');
    const errors = [...issuesOf(row, 'badprog'), ...issuesOf(install!, 'install_pack')].filter((i) => i.severity === 'error');
    expect(errors.some((i) => mentions(i.raw, 'forbidden_fn') && mentions(i.raw, 'env')), `an error names the import env.forbidden_fn: ${show(row)}`).toBe(true);
  }, 3_600_000);

  it(`${ID} in a build without the sandbox module, the pack with a program entry is refused with module_missing, naming the sandbox module`, () => {
    const ok = progPack(temp(), 'progpack', 'ok', fixture('grid_validator'));
    const [install, listing] = runShow(deepShow(NO_SANDBOX), scenario(temp(), [installPack(ok.pack), PACKS]));
    expect(install!['outcome'], `test/progpack@1.0.0 is refused without the sandbox module: ${show(install)}`).toBe('refused');
    const row = packRow(listing!, ok.pack);
    expect(stateOf(row), 'progpack is refused at its pack check').toBe('refused');
    const missing = [...issuesOf(row, 'progpack'), ...issuesOf(install!, 'install_pack')].filter((i) => i.code === 'module_missing' && word('sandbox').test(JSON.stringify(i.raw)));
    expect(missing.length, `a module_missing names the sandbox module: ${show(row)}`).toBeGreaterThan(0);
  }, 3_600_000);
});
