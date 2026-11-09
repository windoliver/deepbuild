// Criterion 10: "A Rust program built with debug info whose step divides by zero at `rules.rs:42` traps with kind
// divide, and logic.trap names `rules.rs:42` in two runs; the item's program hash and step hashes are the same with
// its sidecar named and without it, and without it logic.trap names the function and the offset as before; a
// planted mapper that ignores the offset shift the fuel rewrite adds names another line and fails, naming the trap"
//
// Through `deep-logic bake` (README: deep-logic, Sidecars). The program is this suite's Rust crate (rules/), built
// for wasm32-unknown-unknown with debug info: its step divides by a `boom` entry's value at rules.rs:42 (the one
// i32.div_u in the module). The agent's program is the built module without its `.debug_*` sections; the sidecar
// holds them, named on the item as `debug` (helpers.ts splitDebug). A `boom` entry of value 0 at step 12 traps.
// Oracle: wasmtime tests/all/traps.rs parse_dwarf_info (a trap's frame resolved through DWARF to its source line),
// ported here as this program; the sidecar, the equal hashes and the fuel rewrite's offset shift are ours.
import { describe, expect, it } from 'vitest';
import { AC, STEP_60, TIMEOUT, bakeCall, bakeOf, entryAt, firstDiff, logicBin, onMac, piece, prebuild, rulesProgram, show, stepHashes, yours, type Bake, type JsonObject, type Trap } from './helpers.ts';

prebuild(() => { logicBin(); rulesProgram(); });

const BOOM_STEP = 12;
const STEPS = 20;
const LINE_42 = /(^|[/\\])rules\.rs:42$/;
const rulesBake = (sidecar: boolean): JsonObject => {
  const r = rulesProgram();
  return bakeCall(piece({
    seed: 531_10, controls: ['boom'],
    items: { rules: { program: r.program, ...(sidecar ? { debug: r.sidecar } : {}), reads: ['boom'], writes: { acc: { type: 'i32' } } } },
  }), { steps: STEPS, track: [yours('boom', BOOM_STEP, 0)] });
};
function divideTrap(b: Bake, what: string): Trap {
  const r = rulesProgram();
  expect(entryAt(b.items!['rules']!.layout, 'reads', 'boom').offset, `${what}: the Rust program was built for boom's slot at offset 0`).toBe(0);
  expect(entryAt(b.items!['rules']!.layout, 'writes', 'acc').offset, `${what}: and for acc at offset 0`).toBe(0);
  expect(b.traps.length, `${what}: one trap (${show(b.raw['traps'])})`).toBe(1);
  const t = b.traps[0]!;
  expect([t.item, t.kind, t.step, t.t], `${what}: logic.trap names the item, kind divide, the step and its time`).toEqual(['rules', 'divide', BOOM_STEP, BOOM_STEP * STEP_60]);
  expect([t.function, t.offset], `${what}: the division is function ${r.judge}'s i32.div_u at ${r.divide} in the program as given`).toEqual([r.judge, r.divide]);
  return t;
}

describe(`${AC[10]} a trap names its source line through the program's debug sidecar`, () => {
  it(`${AC[10]} the Rust program's division by zero traps with kind divide, and logic.trap names rules.rs:42 in two runs`, () => {
    const first = divideTrap(bakeOf(onMac([rulesBake(true)])[0]!, 'run 1'), 'run 1');
    const second = divideTrap(bakeOf(onMac([rulesBake(true)])[0]!, 'run 2'), 'run 2');
    expect(first.source, `run 1: logic.trap names rules.rs:42 (it names ${first.source})`).toMatch(LINE_42);
    expect(second.source, 'run 2 names the same line').toBe(first.source);
  }, TIMEOUT);

  it(`${AC[10]} with the sidecar and without it the program hash and step hashes are the same, and without it logic.trap names the function and offset with no line`, () => {
    const [withIt, without] = onMac([rulesBake(true), rulesBake(false)]).map((r, i) => bakeOf(r, i ? 'without the sidecar' : 'with the sidecar'));
    const a = withIt!.items!['rules']!;
    const b = without!.items!['rules']!;
    expect(b.program, 'the item names the same program with or without its sidecar').toBe(a.program);
    expect(a.program, 'the program is the module without its debug sections').toBe(rulesProgram().program.sha);
    expect(b.hash, 'the rewritten program\'s hash is the same').toBe(a.hash);
    expect(firstDiff(stepHashes(without!.steps), stepHashes(withIt!.steps)), 'every step hash is the same').toBeNull();
    const t = divideTrap(without!, 'without the sidecar');
    expect(t.source, 'without the sidecar, logic.trap names no line').toBeNull();
    const w = divideTrap(withIt!, 'with the sidecar');
    expect([t.function, t.offset], 'and the function and offset it names with the sidecar').toEqual([w.function, w.offset]);
  }, TIMEOUT);

  it(`${AC[10]} a planted mapper that ignores the fuel rewrite's offset shift (mapper_ignores_fuel_shift) names another line and fails, naming the trap`, () => {
    const t = bakeOf(onMac([rulesBake(true)], 'mapper_ignores_fuel_shift')[0]!, 'the planted mapper').traps[0];
    expect(t, 'the planted mapper still traps').toBeDefined();
    const failure = t!.source !== null && !LINE_42.test(t!.source) ? `trap ${t!.kind} at step ${t!.step} (function ${t!.function}, offset ${t!.offset}): names ${t!.source}, not rules.rs:42` : null;
    expect(failure, `the planted mapper names another line (it names ${show(t!.source)})`).not.toBeNull();
    expect(failure, 'the failure names the trap').toMatch(/^trap divide at step 12/);
  }, TIMEOUT);
});
