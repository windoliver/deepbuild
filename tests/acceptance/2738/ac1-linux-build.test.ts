// AC1 #2738.a13e05b2: `cargo build --locked --bin deep-physics` at the workspace root and `cargo build --locked -p
// deep-physics-rapier --bin deep-physics` each succeed in `rust:<rust-toolchain.toml's channel>-slim-bookworm` for
// linux/amd64, which has no C++ compiler.
//
// Both commands run as the issue writes them, in /src (the checkout, mounted read-only) inside a linux/amd64 container
// of that image, with the caches under target/acceptance-2738-linux/ (helpers: linuxCargo). The image's lack of a C++
// compiler is checked first, since a build in an image that has one shows nothing. The wrong program is the base:
// scene3d links meshopt, whose build script finds no `c++` and fails (BASE-FAILURE.txt). No Docker, or no linux/amd64
// image here, is BLOCKED; nothing is pulled.
import { describe, expect, it } from 'vitest';
import { AC, LINUX_TIMEOUT, cxxIn, linuxCargo, linuxImage, linuxReady, none } from './helpers.ts';

const ID = AC[1];
const BUILDS = [
  ['build', '--locked', '--bin', 'deep-physics'],
  ['build', '--locked', '-p', 'deep-physics-rapier', '--bin', 'deep-physics'],
];

describe(`${ID} deep-physics builds for linux/amd64 in an image with no C++ compiler`, () => {
  it(`${ID} cargo build --locked --bin deep-physics at the workspace root and cargo build --locked -p deep-physics-rapier --bin deep-physics each succeed in ${linuxImage()} for linux/amd64, which has no C++ compiler`, () => {
    const image = linuxReady();
    expect(cxxIn(image), `${image} (linux/amd64) holds no C++ compiler, the premise of the criterion`).toEqual([]);
    // Both run whatever the first gives, so a failure names every command that failed.
    none(BUILDS.map((args) => linuxCargo(image, args)).filter((f) => f !== ''), `each build succeeds in ${image} (linux/amd64)`);
  }, LINUX_TIMEOUT);
});
