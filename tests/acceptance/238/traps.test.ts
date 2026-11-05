// #238.a3fecb68: each trap kind traps with that kind at the same function and offset in wasmtime on macOS arm64
// and Linux x86_64 and in headless Chrome: unreachable; divide (i32.div_s by 0); overflow (i32.div_s of −2³¹ by
// −1); conversion (i32.trunc_f32_s of NaN); bounds (a load past memory's end); call (call_indirect with the wrong
// signature); grow (memory.grow by one page). A planted mapper that reports every engine trap as unreachable
// fails, naming the fixture and both kinds, and a planted rewrite that lets memory.grow return −1 runs on and
// fails, naming the grow fixture.
//
// Upstream: wasm-spec fffc6e12fa traps.wast, unreachable.wast and call_indirect.wast give six of the seven traps;
// wasmtime 3c8a3e79aa traps.rs (test_trap_trace, trap_codes, call_signature_mismatch) reads a trap's function and
// module offset. Each fixture traps in function 1; the offset is the trapping instruction's in the program as
// written, read off this suite's assembler (README: Readings).
import { describe, expect, it } from 'vitest';
import { KIT, failuresNaming, fixture, kitOf, macSandbox, onMac, opAt, prebuild, show, theCase, type Ran } from './helpers.ts';
import { TRAP_KINDS, chromeRuns, nativeRuns, sameOnHosts, trapSpec, type Spec } from './programs.ts';

const ID = '#238.a3fecb68';
prebuild(() => { macSandbox(); });

const SPECS: Spec[] = TRAP_KINDS.map((t) => trapSpec(t.fixture));
function kindFailures(where: string, runs: Ran[]): string[] {
  return TRAP_KINDS.flatMap((t, i) => {
    const r = runs[i]!;
    const offset = opAt(fixture(t.fixture), 1, t.op, t.which);
    const want = { kind: t.kind, function: 1, offset };
    return JSON.stringify(r.trap) === JSON.stringify(want) ? [] : [`${where}: ${t.fixture} trapped ${JSON.stringify(r.trap)}, not ${JSON.stringify(want)} (its ${t.op})`];
  });
}

describe(`${ID} each trap kind traps with that kind at one function and offset on macOS arm64, Linux x86_64 and headless Chrome`, () => {
  it(`${ID} unreachable, divide, overflow, conversion, bounds, call and grow each trap with their kind at their instruction in function 1, the same on all three hosts`, async () => {
    const mac = nativeRuns('mac', SPECS);
    expect(kindFailures('macOS arm64', mac.runs), 'macOS arm64 traps each kind at its instruction').toEqual([]);
    expect(mac.runs[TRAP_KINDS.findIndex((t) => t.kind === 'grow')]!.reads.get('0+8'), 'memory.grow trapped before its result was stored').toBe('00'.repeat(8));
    const linux = nativeRuns('linux', SPECS);
    expect(kindFailures('Linux x86_64', linux.runs), 'Linux x86_64 traps each kind at its instruction').toEqual([]);
    expect(sameOnHosts(SPECS, mac.runs, linux.runs, 'Linux x86_64'), 'Linux x86_64 gives macOS arm64\'s traps').toEqual([]);
    const chrome = await chromeRuns(SPECS, mac.rewrites);
    expect(kindFailures('headless Chrome', chrome), 'headless Chrome traps each kind at its instruction').toEqual([]);
    expect(sameOnHosts(SPECS, mac.runs, chrome, 'headless Chrome'), 'headless Chrome gives macOS arm64\'s traps').toEqual([]);
  }, 5_400_000);

  it(`${ID} a planted mapper that reports every engine trap as unreachable fails the kit, naming the fixture and both kinds`, () => {
    const divide = TRAP_KINDS.findIndex((t) => t.kind === 'divide');
    const planted = nativeRuns('mac', [SPECS[divide]!], 'mapper_reports_unreachable').runs[0]!;
    expect(planted.trap?.kind, 'the planted mapper reports the division by zero as unreachable').toBe('unreachable');
    const kit = kitOf(onMac([KIT], 'mapper_reports_unreachable')[0]!, 'the kit under the planted mapper');
    expect(kit.verdict, 'the kit fails the planted mapper').toBe('FAIL');
    expect(theCase(kit, 'trap.divide', 'the kit').verdict, 'trap.divide fails').toBe('FAIL');
    const named = failuresNaming(kit, 'trap.divide').filter((f) => f['field'] === 'kind');
    expect(named.map((f) => [f['expected'], f['actual']]), `the failure names trap.divide and both kinds: ${show(kit.failures)}`).toContainEqual(['divide', 'unreachable']);
  }, 3_600_000);

  it(`${ID} a planted rewrite that lets memory.grow return −1 runs on and fails the kit, naming the grow fixture`, () => {
    const grow = TRAP_KINDS.findIndex((t) => t.kind === 'grow');
    const planted = nativeRuns('mac', [SPECS[grow]!], 'rewrite_grow_returns_minus_one').runs[0]!;
    expect(planted.trap, `under the planted rewrite memory.grow doesn't trap: ${show(planted.raw)}`).toBeNull();
    expect(planted.reads.get('0+8'), 'it returned −1 and the program ran on to store 7').toBe(`ffffffff${'07000000'}`);
    const kit = kitOf(onMac([KIT], 'rewrite_grow_returns_minus_one')[0]!, 'the kit under the planted rewrite');
    expect(kit.verdict, 'the kit fails the planted rewrite').toBe('FAIL');
    expect(theCase(kit, 'trap.grow', 'the kit').verdict, 'trap.grow fails').toBe('FAIL');
    expect(failuresNaming(kit, 'trap.grow').length, `a failure names trap.grow: ${show(kit.failures)}`).toBeGreaterThan(0);
  }, 3_600_000);
});
