// Criterion 1: "A step that loops forever traps with kind fuel at the same function and offset in two runs and on
// Linux x86_64; the item's arrays keep the last good step's values, the rest of the piece plays on, and logic.trap
// names the step, the function, the offset and the input entries that step read; a recursion that never ends traps
// with kind stack at the same depth on macOS arm64 and Linux x86_64, before wasmtime's own stack limit under the
// stack setting the logic module gives it"
//
// Through `deep-logic bake` (README: deep-logic). The piece holds two logic items: `spin`, whose step loops forever
// once it reads a `go` entry (an entry of yours at step 10), and `tally`, which writes k every step. `recurse`
// recurses without end from its step, counting its depth in memory, which `peek` reads after the trap.
// Oracle: wasmtime tests/all/fuel.rs (iloop: a loop that never ends stops with out-of-fuel) and wasm-spec
// test/core/call.wast (runaway: a recursion that never ends is exhausted), written again as these programs; the
// same place on two machines, the kept arrays and logic.trap's fields are ours.
import { describe, expect, it } from 'vitest';
import { AC, STEP_60, TIMEOUT, arrayAt, bakeCall, bakeOf, entryAt, inBody, logicBin, none, onLinux, onMac, piece, prebuild, show, yours, type Bake, type JsonObject } from './helpers.ts';
import { DEPTH_AT, DOWN_FRAME, recurse, spin, tally } from './programs.ts';

prebuild(() => { logicBin(); });

const GO_STEP = 10;
const STEPS = 30;
const spinBake = (): JsonObject => bakeCall(piece({
  seed: 531_01, controls: ['go'],
  items: { spin: { program: spin(), reads: ['go'], writes: { k: { type: 'i32' } } }, tally: { program: tally(), writes: { k: { type: 'i32' } } } },
}), { steps: STEPS, track: [yours('go', GO_STEP, 1)] });
const recurseBake = (kib: number): JsonObject => bakeCall(piece({
  seed: 531_01, items: { deep: { program: recurse(), writes: { d: { type: 'i32' } }, budget: { stack: kib } } },
}), { steps: 1, peek: [{ item: 'deep', at: DEPTH_AT, len: 4 }] });
const CAPS_KIB = [64, 256] as const;

/** The fuel trap's place, its step and what it read, as one comparable line. */
const placed = (b: Bake): string => JSON.stringify(b.traps.map((t) => ({ item: t.item, kind: t.kind, step: t.step, function: t.function, offset: t.offset, inputs: t.inputs.map((e) => [e['t'], e['control'], e['value']]) })));

function judgeSpin(b: Bake, what: string): void {
  const p = spin();
  const items = b.items;
  expect(items, `${what}: the bake names its items`).not.toBeNull();
  expect(entryAt(items!['spin']!.layout, 'reads', 'go').offset, `${what}: spin was built for go's slot at offset 0 of its read region`).toBe(0);
  expect(entryAt(items!['spin']!.layout, 'writes', 'k').offset, `${what}: spin was built for k at offset 0 of its write region`).toBe(0);
  expect(b.traps.length, `${what}: one trap, spin's (${show(b.raw['traps'])})`).toBe(1);
  const t = b.traps[0]!;
  expect([t.item, t.kind, t.step, t.t], `${what}: logic.trap names the item, kind fuel, the step and its time`).toEqual(['spin', 'fuel', GO_STEP, GO_STEP * STEP_60]);
  expect(t.function, `${what}: the loop is function 2 of the program as written`).toBe(2);
  expect(inBody(p, 2, t.offset), `${what}: the offset ${t.offset} lies in function 2's body (${JSON.stringify([p.functions[2]?.start, p.functions[2]?.end])})`).toBe(true);
  expect(t.inputs.map((e) => [e['t'], e['control'], e['value']]), `${what}: logic.trap names the entries that step read`).toEqual([[GO_STEP * STEP_60, 'go', 1]]);
  const failures: string[] = [];
  for (let k = 0; k < STEPS; k++) {
    const s = b.steps.find((x) => x.step === k);
    if (!s) { failures.push(`step ${k} missing`); continue; }
    const spinK = arrayAt(b.steps, k, 'spin.k', what)[0];
    const tallyK = arrayAt(b.steps, k, 'tally.k', what)[0];
    if (k < GO_STEP && (spinK !== k || s.items['spin']?.failed)) failures.push(`step ${k}: spin.k ${show(spinK)}, failed ${s.items['spin']?.failed}; expected ${k} and running`);
    if (k >= GO_STEP && (spinK !== GO_STEP - 1 || !s.items['spin']?.failed)) failures.push(`step ${k}: spin.k ${show(spinK)}, failed ${s.items['spin']?.failed}; expected the last good step's ${GO_STEP - 1} and failed`);
    if (tallyK !== k || s.items['tally']?.failed) failures.push(`step ${k}: tally.k ${show(tallyK)}, failed ${s.items['tally']?.failed}; the rest of the piece plays on`);
  }
  none(failures, `${what}: the trapped item's arrays keep the last good step's values and the rest of the piece plays on`);
}

function depthOf(b: Bake, what: string): { trap: string; depth: number } {
  expect(b.traps.length, `${what}: one trap (${show(b.raw['traps'])})`).toBe(1);
  const t = b.traps[0]!;
  expect([t.item, t.kind, t.step, t.function], `${what}: the recursion traps with kind stack in function 2 at step 0`).toEqual(['deep', 'stack', 0, 2]);
  expect(inBody(recurse(), 2, t.offset), `${what}: the offset ${t.offset} lies in function 2's body`).toBe(true);
  const peek = b.peeks.find((p) => p.item === 'deep' && p.at === DEPTH_AT);
  expect(peek, `${what}: peek read the depth counter (${show(b.raw['peeks'])})`).toBeDefined();
  return { trap: `${t.kind}@${t.function}:${t.offset}`, depth: Buffer.from(peek!.hex, 'hex').readUInt32LE(0) };
}

describe(`${AC[1]} a step that runs forever or recurses forever traps where the rewrite put it, the same on two machines`, () => {
  it(`${AC[1]} an endless loop traps with kind fuel at the same function and offset in two runs; its arrays keep step ${GO_STEP - 1}'s values, the other item plays on, and logic.trap names the step, function, offset and the go entry`, () => {
    const first = bakeOf(onMac([spinBake()])[0]!, 'run 1');
    const second = bakeOf(onMac([spinBake()])[0]!, 'run 2');
    judgeSpin(first, 'run 1');
    judgeSpin(second, 'run 2');
    expect(placed(second), 'the second run traps at the same function and offset').toBe(placed(first));
  }, TIMEOUT);

  it(`${AC[1]} an endless recursion traps with kind stack at a depth set by the logic module's stack cap (8 × 3 + 64 bytes a frame) at 64 KiB and 256 KiB, before wasmtime's own limit`, () => {
    const out = onMac(CAPS_KIB.map(recurseBake));
    const failures: string[] = [];
    CAPS_KIB.forEach((kib, i) => {
      const { depth } = depthOf(bakeOf(out[i]!, `${kib} KiB`), `${kib} KiB`);
      const want = (kib * 1024) / DOWN_FRAME;
      if (Math.abs(depth - want) > want * 0.05) failures.push(`${kib} KiB: depth ${depth}, the rewrite's charge gives about ${want.toFixed(0)} (within 5%)`);
    });
    none(failures, 'each recursion stops where the rewrite\'s stack charge reaches the cap the logic module gives it');
  }, TIMEOUT);

  it(`${AC[1]} on Linux x86_64 the loop traps at the same step, function, offset and entries, and the recursion at the same place and depth, as on this Mac`, () => {
    const calls = [spinBake(), ...CAPS_KIB.map(recurseBake)];
    const mac = onMac(calls);
    const linux = onLinux(calls);
    const macSpin = bakeOf(mac[0]!, 'macOS');
    const linuxSpin = bakeOf(linux[0]!, 'Linux x86_64');
    judgeSpin(linuxSpin, 'Linux x86_64');
    expect(placed(linuxSpin), 'Linux x86_64 traps where macOS does').toBe(placed(macSpin));
    CAPS_KIB.forEach((kib, i) => {
      expect(depthOf(bakeOf(linux[i + 1]!, `Linux ${kib} KiB`), `Linux ${kib} KiB`), `the ${kib} KiB recursion stops at the same place and depth on Linux x86_64 as on macOS`)
        .toEqual(depthOf(bakeOf(mac[i + 1]!, `macOS ${kib} KiB`), `macOS ${kib} KiB`));
    });
  }, TIMEOUT);
});
