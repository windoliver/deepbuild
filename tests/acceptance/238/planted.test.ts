// #238.a10d9b07: a planted rewriter that skips the fuel charge on one loop's back edge gives a rewritten program
// whose hash differs from the reference's and fails the kit, naming the function; a planted implementation that
// meters with wasmtime's own fuel traps the memory.fill fixture at another offset and fails, naming the fixture
// and both offsets; and a planted runner that skips the NaN rewrite writes 0xFFF8000000000000 for 0 ÷ 0 on x86_64
// and fails, naming the fixture.
//
// Each twin is `deep-sandbox --planted <name>` (README: Planted twins). The honest runner's results are read in
// the same test, so a twin that changes nothing fails here.
import { describe, expect, it } from 'vitest';
import { KIT, failuresNaming, fixture, kitOf, macSandbox, onLinux, onMac, prebuild, rewriteCall, rewritten, show, theCase } from './helpers.ts';
import { F64_NAN, F64_X86_NAN, FUEL_LOOP, NAN, nativeRuns } from './programs.ts';

const ID = '#238.a10d9b07';
prebuild(() => { macSandbox(); });

describe(`${ID} the planted rewriter, implementation and runner each fail sandbox@1's kit, naming what the criterion names`, () => {
  it(`${ID} a rewriter that skips the fuel charge on one loop's back edge rewrites to another hash and fails the kit, naming the function`, () => {
    const [honest] = onMac([rewriteCall(fixture(FUEL_LOOP.fixture), 'provider', FUEL_LOOP.budget)]);
    const [skipped, kitReply] = onMac([rewriteCall(fixture(FUEL_LOOP.fixture), 'provider', FUEL_LOOP.budget), KIT], 'rewriter_skips_back_edge_fuel');
    expect(rewritten(skipped!, 'the planted rewrite of fuel_loop.wat').hash, 'the planted rewrite of this suite\'s endless loop differs from the reference rewrite')
      .not.toBe(rewritten(honest!, 'the reference rewrite of fuel_loop.wat').hash);
    const kit = kitOf(kitReply!, 'the kit under the planted rewriter');
    expect(kit.verdict, 'the kit fails the planted rewriter').toBe('FAIL');
    const loop = theCase(kit, 'fuel.loop', 'the kit');
    expect(loop.verdict, 'fuel.loop fails').toBe('FAIL');
    expect(loop.hash, 'fuel.loop\'s rewritten hash differs from the reference\'s').not.toBe(loop.expected_hash);
    const named = failuresNaming(kit, 'fuel.loop').filter((f) => f['field'] === 'hash');
    expect(named.length, `a failure names fuel.loop's hash: ${show(kit.failures)}`).toBeGreaterThan(0);
    expect(named.map((f) => f['function']), 'the failure names function 1, whose loop lost its back-edge charge (README: The kit, fuel.loop)').toContain(1);
  }, 3_600_000);

  it(`${ID} an implementation metering with wasmtime's own fuel traps fuel.fill at another offset and fails the kit, naming the fixture and both offsets`, () => {
    const honest = theCase(kitOf(onMac([KIT])[0]!, 'the reference kit'), 'fuel.fill', 'the reference kit');
    expect(honest.trap?.kind, 'the reference traps fuel.fill with kind fuel').toBe('fuel');
    const kit = kitOf(onMac([KIT], 'meters_with_wasmtime_fuel')[0]!, 'the kit metering with wasmtime\'s own fuel');
    expect(kit.verdict, 'the kit fails the planted implementation').toBe('FAIL');
    const fill = theCase(kit, 'fuel.fill', 'the kit');
    expect(fill.verdict, 'fuel.fill fails').toBe('FAIL');
    const named = failuresNaming(kit, 'fuel.fill').filter((f) => f['field'] === 'offset');
    expect(named.length, `a failure names fuel.fill's offset: ${show(kit.failures)}`).toBeGreaterThan(0);
    const f = named[0]!;
    expect([typeof f['expected'], typeof f['actual']], `the failure names both offsets: ${show(f)}`).toEqual(['number', 'number']);
    expect(f['expected'], 'the expected offset is the reference\'s').toBe(honest.trap!.offset);
    expect(f['actual'], 'the planted implementation trapped at another offset').not.toBe(f['expected']);
  }, 3_600_000);

  it(`${ID} on Linux x86_64 a runner that skips the NaN rewrite writes 0xFFF8000000000000 for 0 ÷ 0 and fails the kit, naming the fixture`, () => {
    const honest = nativeRuns('linux', [NAN]).runs[0]!;
    expect(honest.reads.get('0+40')?.slice(32, 48), 'the reference runner on Linux x86_64 writes 0x7FF8000000000000 for f64 0 ÷ 0').toBe(F64_NAN);
    const planted = nativeRuns('linux', [NAN], 'runner_skips_nan').runs[0]!;
    expect(planted.reads.get('0+40')?.slice(32, 48), 'the planted runner on Linux x86_64 writes x86_64\'s 0xFFF8000000000000 for f64 0 ÷ 0').toBe(F64_X86_NAN);
    const kit = kitOf(onLinux([KIT], 'runner_skips_nan')[0]!, 'the kit on Linux x86_64 under the planted runner');
    expect(kit.verdict, 'the kit fails the planted runner on Linux x86_64').toBe('FAIL');
    const named = [...failuresNaming(kit, 'nan.f64'), ...failuresNaming(kit, 'nan.f32')];
    expect(named.length, `a failure names a NaN fixture: ${show(kit.failures)}`).toBeGreaterThan(0);
    expect(theCase(kit, 'nan.f64', 'the kit').verdict, 'nan.f64 (0 ÷ 0 among them) fails').toBe('FAIL');
  }, 5_400_000);
});
