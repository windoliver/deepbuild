// #2010.9300a915: the physics crate's resolved dependency tree has Rapier 0.36.1 and parry 0.31.1, Rapier's resolved
// features its defaults plus enhanced-determinism and serde-serialize with none of block-solver, fem, simd8, parallel or
// unsync-callbacks, glam resolved without fast-math, and the resolved versions and features of parry, wide, glam, glamx,
// simba and libm in the bake key and the runtime digest, so a planted lockfile that moves wide changes both; and its
// build flags carry no target-cpu=native or +fma; the preflight refuses a build with simd8 or target-cpu=native, naming
// the flag.
//
// The tree and the flags are read from cargo itself; the pins the program keys and digests are read from its `runtime`
// call and compared with cargo's. The planted builds are this file's: a lockfile with wide moved one release (built in
// its own target folder), `--features rapier3d/simd8`, and `-C target-cpu=native` in build.rustflags.
import { describe, expect, it } from 'vitest';
import {
  BACKEND, CRITERIA, OTHER, PIN, TIMEOUT, answered, arr, ask, bake, buildFromLock, closure, configuredRustflags, digestOf, featureTable,
  goldenOf, keyOf, lockEnv, none, obj, pileAndFlyer, pinnedOf, plantLockfile, preflight, prebuild, recordGolden, resolvedTree,
  runtime, scratch, show, str, type JsonObject, type Resolved,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[1];
const EXCLUDED = ['block-solver', 'fem', 'simd8', 'parallel', 'unsync-callbacks'];

/** The program's own account of its pins (README: runtime), as cargo's Resolved entries. */
function pinsOf(reply: JsonObject, what: string): Resolved[] {
  return arr(reply['pins'], `${what}: pins`).map((v, i) => {
    const p = obj(v, `${what}: pins[${i}]`);
    return { name: str(p['name'], `${what}: pins[${i}].name`), version: str(p['version'], `${what}: pins[${i}].version`), features: arr(p['features'], `${what}: pins[${i}].features`).map((f) => String(f)).sort() };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

describe(`${ID} the pinned build: its resolved tree, its flags, its preflight, and the pins in the bake key and the runtime digest`, () => {
  it(`${ID} the resolved tree has rapier3d ${PIN} and parry3d 0.31.1, rapier3d's defaults plus enhanced-determinism and serde-serialize and none of ${EXCLUDED.join(', ')}, glam without fast-math; the runtime names those resolved versions and features; the build flags carry no target-cpu=native or +fma`, () => {
    const rt = answered(ask([runtime()])[0], 'runtime');
    digestOf(rt['runtime_digest'], 'runtime: runtime_digest');
    const tree = resolvedTree();
    const of = (name: string): Resolved[] => tree.filter((p) => p.name === name);
    expect(of(BACKEND).map((p) => p.version), `${BACKEND} resolves to ${PIN} alone`).toEqual([PIN]);
    expect(of('parry3d').map((p) => p.version), 'parry3d resolves to 0.31.1 alone').toEqual(['0.31.1']);
    const rapier = of(BACKEND)[0]!;
    const want = closure(featureTable(BACKEND, PIN), ['default', 'enhanced-determinism', 'serde-serialize']).filter((f) => f !== 'default');
    expect(rapier.features.filter((f) => f !== 'default'), `${BACKEND}'s resolved features are its defaults plus enhanced-determinism and serde-serialize (with what they turn on in its own table)`).toEqual(want);
    expect(rapier.features.filter((f) => EXCLUDED.includes(f)), `${BACKEND} resolves none of ${EXCLUDED.join(', ')}`).toEqual([]);
    expect(of('glam').length, 'glam is in the tree').toBeGreaterThan(0);
    none(of('glam').filter((p) => p.features.includes('fast-math')).map((p) => `glam ${p.version} resolves fast-math`), 'glam resolves without fast-math');
    const backend = obj(rt['backend'], 'runtime: backend');
    expect([backend['name'], backend['version']], 'runtime: the backend is the pin').toEqual([BACKEND, PIN]);
    expect(arr(backend['features'], 'runtime: backend.features').map(String).sort(), `runtime: the backend's features are ${BACKEND}'s resolved features`).toEqual(rapier.features);
    const pins = pinnedOf(tree);
    expect(new Set(pins.map((p) => p.name)).size, 'cargo resolves each of parry3d, wide, glam, glamx, simba and libm').toBe(6);
    expect(pinsOf(rt, 'runtime'), 'runtime: the pins are the resolved versions and features of parry3d, wide, glam, glamx, simba and libm, as cargo resolves them').toEqual(pins);
    const flags = configuredRustflags();
    none(flags.filter((f) => /target-cpu\s*=\s*native|\+fma\b/.test(f)).map((f) => `rustflags ${f}`), 'the build flags (cargo\'s merged configuration for this checkout and machine) carry no target-cpu=native or +fma');
  }, TIMEOUT);

  it(`${ID} the preflight passes the checkout's build and refuses one with rapier3d's simd8 and one with target-cpu=native, each naming the flag`, () => {
    const real = preflight();
    expect(real.status, `node scripts/physics-build.mjs passes the checkout's build: ${real.out.slice(-3000)}`).toBe(0);
    expect(real.out, 'it prints a PASS line').toMatch(/^PASS\b/m);
    expect(real.out, 'and no FAIL line').not.toMatch(/^FAIL\b/m);
    const simd8 = preflight(['--features', 'rapier3d/simd8']);
    expect(simd8.status, `a build with rapier3d/simd8 is refused (exit 1): ${simd8.out.slice(-3000)}`).toBe(1);
    expect(simd8.out, 'the refusal names simd8 on a FAIL line').toMatch(/^FAIL\b.*simd8/m);
    const native = preflight(['--config', 'build.rustflags=["-C", "target-cpu=native"]']);
    expect(native.status, `a build with -C target-cpu=native is refused (exit 1): ${native.out.slice(-3000)}`).toBe(1);
    expect(native.out, 'the refusal names target-cpu=native on a FAIL line').toMatch(/^FAIL\b.*target-cpu=native/m);
  }, TIMEOUT);

  it(`${ID} a planted lockfile that moves wide changes both the bake key and the runtime digest`, () => {
    const w = pileAndFlyer();
    const [rt, baked, recorded] = ask([runtime(), bake(w, 120), recordGolden(w, 120, scratch('ac1-store'), [OTHER])]);
    const digest = digestOf(answered(rt, 'runtime')['runtime_digest'], 'runtime: runtime_digest');
    const key = keyOf(baked!, 'the bake');
    expect(goldenOf(recorded!, 'golden')['runtime_digest'], 'a golden carries the runtime digest the runtime names').toBe(digest);
    const wide = resolvedTree().filter((p) => p.name === 'wide').map((p) => p.version);
    expect(wide.length, `wide resolves to one version: ${wide.join(', ')}`).toBe(1);
    const moved = wide[0] === '1.7.0' ? '1.7.1' : '1.7.0';
    const lock = plantLockfile(moved);
    expect(resolvedTree(lockEnv(lock)).filter((p) => p.name === 'wide').map((p) => p.version), `the planted lockfile resolves wide to ${moved}`).toEqual([moved]);
    const bin = buildFromLock(lock);
    const [rt2, baked2] = ask([runtime(), bake(w, 120)], { bin, where: `built from the planted lockfile, wide ${moved}` });
    const digest2 = digestOf(answered(rt2, 'planted runtime')['runtime_digest'], 'planted runtime: runtime_digest');
    expect(pinsOf(rt2!, 'planted runtime').filter((p) => p.name === 'wide').map((p) => p.version), `the planted build pins wide ${moved}`).toEqual([moved]);
    expect(digest2, `the runtime digest moves with wide (${wide[0]} → ${moved}): ${show(rt2)}`).not.toBe(digest);
    expect(keyOf(baked2!, 'the planted bake'), `the bake key moves with wide (${wide[0]} → ${moved})`).not.toBe(key);
  }, TIMEOUT);
});
