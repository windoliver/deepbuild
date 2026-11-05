// #238.91f1b87c: the stack ladder (recursions of the smallest and the largest frames) traps with kind stack at
// the same depth in the app and in headless Chrome's own WebAssembly engine at 64 KiB and at 256 KiB, and a
// planted rewriter that charges no per-call overhead fails at the cap.
//
// stack_small.wat's frame charges 88 bytes a call by the design's rule (8 per param, local and value-stack slot,
// plus 64), stack_large.wat's 8,088; each counts its depth at 0. The depth must fall within 5% of cap ÷ frame
// (whose frames count toward the cap is the implementer's), and be the same in the app and in Chrome.
import { describe, expect, it } from 'vitest';
import { KIT, kitOf, macSandbox, onMac, prebuild, show, type Ran } from './helpers.ts';
import { CAPS, FRAME, chromeRuns, depthWindow, ladder, nativeRuns, sameOnHosts, type Spec } from './programs.ts';

const ID = '#238.91f1b87c';
prebuild(() => { macSandbox(); });

const LADDER: Spec[] = (['stack_small', 'stack_large'] as const).flatMap((f) => CAPS.map((cap) => ladder(f, cap)));
const depth = (r: Ran): number => Buffer.from(r.reads.get('0+4') ?? '', 'hex').readUInt32LE(0);
function ladderFailures(where: string, runs: Ran[]): string[] {
  const failures: string[] = [];
  LADDER.forEach((s, i) => {
    const r = runs[i]!;
    const cap = s.budget.stack!;
    const [lo, hi] = depthWindow(FRAME[s.fixture as keyof typeof FRAME], cap);
    if (r.trap?.kind !== 'stack' || r.trap.function !== 1) failures.push(`${where}: ${s.fixture} at ${cap} B didn't trap with kind stack in function 1: ${show(r.raw)}`);
    else if (depth(r) < lo || depth(r) > hi) failures.push(`${where}: ${s.fixture} at ${cap} B trapped at depth ${depth(r)}, outside ${lo}..${hi} (cap ${cap} ÷ ${FRAME[s.fixture as keyof typeof FRAME]} B a call)`);
  });
  return failures;
}

describe(`${ID} the stack ladder traps stack at one depth in the app and in headless Chrome at 64 KiB and 256 KiB`, () => {
  it(`${ID} the smallest and a large frame trap with kind stack at the per-call rule's depth, the same in the app and in headless Chrome, at 64 KiB and at 256 KiB`, async () => {
    const mac = nativeRuns('mac', LADDER);
    expect(ladderFailures('the app (macOS arm64)', mac.runs), 'the app traps each recursion stack at the per-call rule\'s depth').toEqual([]);
    const chrome = await chromeRuns(LADDER, mac.rewrites);
    expect(ladderFailures('headless Chrome', chrome), 'headless Chrome traps each recursion stack at the per-call rule\'s depth').toEqual([]);
    expect(sameOnHosts(LADDER, mac.runs, chrome, 'headless Chrome'), 'the same depth, function and offset in the app and in headless Chrome').toEqual([]);
  }, 3_600_000);

  it(`${ID} a planted rewriter that charges no per-call overhead goes past the smallest frame's depth at the cap and fails the kit's stack ladder`, () => {
    const honest = nativeRuns('mac', LADDER.slice(0, 1)).runs[0]!;
    const planted = nativeRuns('mac', LADDER.slice(0, 1), 'rewriter_no_call_overhead').runs[0]!;
    const [, hi] = depthWindow(FRAME.stack_small, CAPS[0]);
    expect(depth(honest), 'the reference rewriter stops the smallest frame within the rule\'s depth').toBeLessThanOrEqual(hi);
    expect(depth(planted), `without the 64-byte overhead the smallest frame recurses past the cap's depth (${hi}): ${show(planted.raw)}`).toBeGreaterThan(hi);
    const kit = kitOf(onMac([KIT], 'rewriter_no_call_overhead')[0]!, 'the kit under the planted rewriter');
    expect(kit.verdict, 'the kit fails the planted rewriter').toBe('FAIL');
    const stackFailures = kit.cases.filter((c) => c.fixture.startsWith('stack.') && c.verdict === 'FAIL').map((c) => c.fixture);
    expect(stackFailures.filter((f) => f.startsWith('stack.small.')), `a smallest-frame fixture of the kit's stack ladder fails: ${show(kit.failures)}`).not.toEqual([]);
  }, 3_600_000);
});
