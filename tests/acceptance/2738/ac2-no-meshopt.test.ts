// AC2 #2738.4e863912: Neither build's dependency graph holds `meshopt`: `cargo tree --locked -e normal,build -i
// meshopt`, run at the workspace root and with `-p deep-physics-rapier`, shows no path from `deep-physics-rapier`.
//
// The two commands run as the issue writes them, in the checkout on this machine. The inverted tree lists every
// package that reaches meshopt; it must not name deep-physics-rapier. Where meshopt is in no selected package's graph,
// cargo answers that the spec matched no package, which is also no path; any other failure is a failure (helpers:
// pathsFromPhysics). The wrong program is the base: deep-physics-rapier → deep-canvas-scene3d → meshopt in both.
import { describe, it } from 'vitest';
import { AC, cargo, none, pathsFromPhysics } from './helpers.ts';

const ID = AC[2];
const TREE = ['tree', '--locked', '-e', 'normal,build', '-i', 'meshopt'];

describe(`${ID} deep-physics-rapier's dependency graph holds no meshopt`, () => {
  it(`${ID} cargo tree --locked -e normal,build -i meshopt, at the workspace root and with -p deep-physics-rapier, shows no path from deep-physics-rapier`, () => {
    const failures = [[], ['-p', 'deep-physics-rapier']].flatMap((extra) => {
      const args = [...TREE, ...extra];
      return pathsFromPhysics(cargo(args), `cargo ${args.join(' ')}`);
    });
    none(failures, 'neither graph has a path from deep-physics-rapier to meshopt');
  }, 1_800_000);
});
