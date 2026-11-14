// #524.4c32c52f: "Swapping the soft-body solver changes one module and no world document"
//
// The swap is `deep-physics-rapier`'s cargo feature `test-swap-soft-solver` (README: The swapped solver): deep-physics
// built with it steps soft bodies with another solver, and nothing else changes. Judged three ways:
//   - no world document: every world this suite runs (the rope and banner, the two balloons, the soft cube and the
//     skinned cloth in their scenes, and the three labs' worlds), byte for byte the same, is admitted by both builds'
//     check and baked 120 steps by both;
//   - the swap is real: `runtime` names a different `soft_solver` in each build, and the banner's step hashes differ
//     between the builds within those 120 steps (a swap that changes nothing would pass the first point alone);
//   - one module: under crates/, the feature's name appears only in deep-physics-rapier's Cargo.toml and in one .rs
//     file of that crate, so the swap touches one module of the physics module's backend and no other crate.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, SWAP_FEATURE, TIMEOUT, admitted, ask, bake, check, cleanBuilds, cubeScene, firstDiffering, hashesOf, labOf, namingFiles, prebuild,
  ropeAndBanner, skinnedCloth, str, swappedBin, twoBalloons, type World,
} from './helpers.ts';

prebuild();
cleanBuilds();
const ID = CRITERIA[3];
const STEPS = 120;

describe(`${ID} swapping the soft-body solver changes one module and no world document`, () => {
  it(`${ID} the swapped build runs every world document unchanged, steps soft bodies differently, and names the feature in one module`, () => {
    const worlds: [string, World][] = [
      ['the rope and the banner', ropeAndBanner()], ['the two balloons', twoBalloons()], ['the soft cube', cubeScene()], ['the skinned cloth', skinnedCloth(28)],
      ['the rope bridge lab', labOf('bridge')], ['the banner lab', labOf('banner')], ['the ball-and-goal lab', labOf('goal')],
    ];
    const calls = [{ call: 'runtime' }, ...worlds.flatMap(([, w]) => [check(w), bake(w, STEPS)])];
    const real = ask(calls, { where: 'the shipped solver' });
    const swapped = ask(calls, { bin: swappedBin(), where: `--features ${SWAP_FEATURE}` });
    const solver = (r: typeof real, what: string): string => str(r[0]!['soft_solver'], `${what}: runtime.soft_solver`);
    expect(solver(swapped, 'the swapped build'), 'the swapped build names another soft-body solver').not.toBe(solver(real, 'the shipped build'));
    worlds.forEach(([name], i) => {
      for (const [r, build] of [[real, 'the shipped build'], [swapped, 'the swapped build']] as const) {
        admitted(r[1 + 2 * i], `${name} in ${build}`);
        hashesOf(r[2 + 2 * i], `${name}'s 120 steps in ${build}`);
      }
    });
    const banner = (r: typeof real, what: string): string[] => hashesOf(r[2], `the rope and banner in ${what}`);
    expect(firstDiffering(banner(real, 'the shipped build'), banner(swapped, 'the swapped build')), 'the swapped solver steps the banner and rope to other states within 120 steps').not.toBeNull();

    const files = namingFiles(SWAP_FEATURE);
    const sources = files.filter((f) => f.endsWith('.rs'));
    expect(files.filter((f) => !f.startsWith('crates/deep-physics-rapier/')), `${SWAP_FEATURE} is named outside deep-physics-rapier: ${files.join(', ')}`).toEqual([]);
    expect(files, `deep-physics-rapier's Cargo.toml declares ${SWAP_FEATURE}`).toContain('crates/deep-physics-rapier/Cargo.toml');
    expect(sources.length, `${SWAP_FEATURE} is read in one module, one source file of deep-physics-rapier: ${sources.join(', ') || 'none'}`).toBe(1);
  }, 2 * TIMEOUT);
});
