// #2012.4d10a14c: a golden recorded on the arm64 reference Mac matches on Linux x86_64 and in the wasm32 build step for
// step; a run in a Linux VM on the reference Mac reads machines: same and leaves the cross-machine criterion pending,
// never PASS.
//
// The golden (#2010's `golden`) is recorded here to verify on x86_64-unknown-linux-gnu and wasm32-unknown-unknown
// (Golden: the other CPU architecture, and the web player's wasm32). Linux x86_64 is the #1983 lane's pinned image run as
// linux/amd64 (emulated on this Mac); the wasm32 build is `node scripts/physics-wasm32.mjs`, the physics module built for
// wasm32-unknown-unknown and run in Node's WebAssembly engine; the Linux VM is the same pinned image run as linux/arm64,
// which colima's arm64 Linux VM runs natively (helpers). Each replay (`golden_verify`) answers its own step hashes,
// compared here with the golden's at every step. A second replay on each leg, shifted one ulp at step 120, must differ
// first at step 120, so a leg that echoed the golden instead of stepping the world is caught.
import { describe, expect, it } from 'vitest';
import {
  ARCH, CONTAINER_TIMEOUT, CRITERIA, LINUX_ARM, LINUX_MACHINE, LINUX_X86, WASM32, WEB_MACHINE, answered, arr, ask, crossGolden, hostTriple,
  machineFailures, matchFailures, none, onLane, onWasm32, pileAndFlyer, prebuild, recordHere, referenceMac, shift, shiftedFailures, show,
  verifyGolden, type JsonObject,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[1];
const N = 240;
const AT = 120;

describe(`${ID} a golden recorded on the Mac matches on Linux x86_64 and in wasm32 step for step; a Linux VM's run reads machines: same and stays pending`, () => {
  it(`${ID} a golden of the pile-and-flyer world recorded on this Mac matches on Linux x86_64 and in the wasm32 build at every one of its ${N + 1} step hashes, and with both runs it passes cross-machine`, () => {
    referenceMac();
    const w = pileAndFlyer();
    const golden = recordHere(w, N, [LINUX_X86, WASM32]);
    const [here] = ask([verifyGolden(golden, w, N)], { where: 'this Mac' });
    none(matchFailures(here!, golden, { target: hostTriple(), arch: ARCH, os: 'macos', machines: 'same' }, 'this Mac\'s replay'), 'this Mac replays its own golden step for step and reads machines: same');

    const replays = [verifyGolden(golden, w, N), verifyGolden(golden, w, N, { shift: shift(AT, 'ball', 'linear.x') })];
    const [wasm, wasmShifted] = onWasm32(replays);
    none(matchFailures(wasm!, golden, { target: WASM32, arch: 'wasm32', machines: 'different' }, 'the wasm32 replay'), 'the golden matches in the wasm32 build step for step');
    none(shiftedFailures(wasmShifted!, golden, AT, `the wasm32 replay shifted one ulp at step ${AT}`), 'the wasm32 leg steps the world itself');

    const [linux, linuxShifted] = onLane('linux/amd64', replays);
    none(matchFailures(linux!, golden, { target: LINUX_X86, arch: 'x86_64', os: 'linux', machines: 'different' }, 'the Linux x86_64 replay'), 'the golden matches on Linux x86_64 step for step');
    none(shiftedFailures(linuxShifted!, golden, AT, `the Linux x86_64 replay shifted one ulp at step ${AT}`), 'the Linux x86_64 leg steps the world itself');

    const machines = [LINUX_MACHINE, WEB_MACHINE];
    const [both, noLinux, noWasm] = ask([
      crossGolden(golden, machines, [here!, wasm!, linux!]),
      crossGolden(golden, machines, [here!, wasm!]),
      crossGolden(golden, machines, [here!, linux!]),
    ]);
    expect(answered(both, 'golden_cross with both runs')['verdict'], `with the Linux x86_64 and wasm32 runs, the golden passes cross-machine: ${show(both)}`).toBe('PASS');
    expect(answered(noLinux, 'golden_cross without the Linux run')['verdict'], `without the Linux x86_64 run it is pending: ${show(noLinux)}`).toBe('PENDING');
    expect(answered(noWasm, 'golden_cross without the wasm32 run')['verdict'], `without the wasm32 run it is pending: ${show(noWasm)}`).toBe('PENDING');
  }, CONTAINER_TIMEOUT);

  it(`${ID} a run in a Linux VM on this Mac (the lane's image as linux/arm64) reads machines: same and leaves the cross-machine golden pending, never PASS, even as the configured machine of a Linux target`, () => {
    referenceMac();
    const w = pileAndFlyer();
    const golden = recordHere(w, N, [LINUX_X86, WASM32]);
    const vmGolden = recordHere(w, N, [LINUX_ARM]);
    const [here] = ask([verifyGolden(golden, w, N)], { where: 'this Mac' });
    none(machineFailures(here!, { target: hostTriple(), arch: ARCH, os: 'macos', machines: 'same' }, 'this Mac\'s replay'), 'a replay on the recording machine reads machines: same');

    const [vm, vmOwn] = onLane('linux/arm64', [verifyGolden(golden, w, N), verifyGolden(vmGolden, w, N)]);
    const where = { target: LINUX_ARM, arch: 'aarch64', os: 'linux', machines: 'same' } as const;
    none([...machineFailures(vm!, where, 'the Linux VM\'s replay'), ...machineFailures(vmOwn!, where, 'the Linux VM\'s replay of a golden that verifies on its own target')], 'a run in a Linux VM on this Mac reads machines: same');

    const vmMachine: JsonObject = { name: 'linux-vm', target: LINUX_ARM };
    const [pending, withHere, configured] = ask([
      crossGolden(golden, [LINUX_MACHINE, WEB_MACHINE], [vm!]),
      crossGolden(golden, [LINUX_MACHINE, WEB_MACHINE], [here!, vm!]),
      crossGolden(vmGolden, [vmMachine], [vmOwn!]),
    ]);
    expect(answered(pending, 'golden_cross with the VM\'s run')['verdict'], `the VM's run leaves the cross-machine golden pending: ${show(pending)}`).toBe('PENDING');
    expect(arr(pending!['asks'], 'asks'), 'pending asks nothing').toEqual([]);
    expect(answered(withHere, 'golden_cross with this Mac\'s and the VM\'s runs')['verdict'], `two runs on the recording architecture leave it pending: ${show(withHere)}`).toBe('PENDING');
    expect(answered(configured, 'golden_cross with the VM configured for its own target')['verdict'], `the VM, configured for ${LINUX_ARM} and having run it, still leaves it pending: ${show(configured)}`).toBe('PENDING');
  }, CONTAINER_TIMEOUT);
});
