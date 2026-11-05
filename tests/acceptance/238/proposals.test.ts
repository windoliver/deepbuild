// #238.eaad3176: programs that use a tail call, an exception handler, a second memory, a 64-bit memory, a
// garbage-collected type or an extended constant are each refused at check, naming the proposal, the instruction
// and its function; a planted check that builds on the parser's default features admits the tail call and
// fails, naming it.
//
// Upstream: wasm-tools e22db44da4 tests/cli/lime1.wast:72-102 and missing-features/missing-exceptions.wast refuse
// return_call, a second memory, a tag, a 64-bit memory and a GC subtype by proposal; lime1 admits extended
// constants, which the subset refuses. Our fixtures are those programs as providers with the instruction in
// function 1 (the extended constant initializes global 3, so it names the global; README: Readings).
import { describe, expect, it } from 'vitest';
import { KIT, checkCall, failuresNaming, fixture, holds, kitOf, macSandbox, onMac, prebuild, refusals, show, theCase, type JsonObject } from './helpers.ts';
import { PROPOSALS } from './programs.ts';

const ID = '#238.eaad3176';
prebuild(() => { macSandbox(); });

describe(`${ID} each proposal past WebAssembly 2.0 is refused at check by name, and a check on the parser's defaults fails`, () => {
  it(`${ID} tail call, exception handling, a second memory, a 64-bit memory, a GC type and an extended constant are each refused at check, naming the proposal, the instruction and its function`, () => {
    const out = onMac(PROPOSALS.map((p) => checkCall(fixture(p.fixture))));
    const failures = PROPOSALS.flatMap((p, i) => {
      const got = refusals(out[i]!, `check ${p.fixture}`);
      if (got.length === 0) return [`${p.fixture} was admitted at check`];
      return got.some((r) => p.want.some((w) => holds(r, w))) ? [] : [`${p.fixture} was refused without one refusal naming ${p.want.map((w) => JSON.stringify(w)).join(' or ')}: ${show(got as JsonObject[])}`];
    });
    expect(failures, 'every proposal is refused by name, with its instruction and where it is').toEqual([]);
    const kit = kitOf(onMac([KIT])[0]!, 'the reference kit');
    for (const p of PROPOSALS) {
      const c = theCase(kit, p.kit, 'the reference kit');
      expect([c.verdict, c.refusals.length > 0], `the kit's ${p.kit} is refused and passes`).toEqual(['PASS', true]);
    }
  }, 3_600_000);

  it(`${ID} a planted check built on the parser's default features admits the tail call and fails the kit, naming the tail-call fixture`, () => {
    const [admitted, kitReply] = onMac([checkCall(fixture('refuse_tail_call')), KIT], 'check_parser_defaults');
    expect(admitted!['ok'], `the planted check admits return_call: ${show(admitted)}`).toBe(true);
    const kit = kitOf(kitReply!, 'the kit under the planted check');
    expect(kit.verdict, 'the kit fails the planted check').toBe('FAIL');
    expect(theCase(kit, 'refuse.tail_call', 'the kit').verdict, 'refuse.tail_call fails').toBe('FAIL');
    expect(failuresNaming(kit, 'refuse.tail_call').length, `a failure names refuse.tail_call: ${show(kit.failures)}`).toBeGreaterThan(0);
  }, 3_600_000);
});
