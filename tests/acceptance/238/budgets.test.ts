// #238.fb1edf47: budgets, on the reference Mac in the local preflight, compared with the merge base: rewriting a
// 1 MB program takes under 200 ms once at check, as the logic module's rewrite does today; and a build with the
// sandbox module whose documents name no program gains no work at check or per frame.
//
// The rewrite: a generated program of at least 1,000,000 bytes, rewritten by `deep-sandbox` in five fresh
// processes after a warm-up, each reply's own `ms` judged against 200 by the design's rule; off a fit reference
// Mac (Mac15,7 or Mac15,12, Low Power Mode off, thermal state nominal, load at most the core count) it skips as
// INCONCLUSIVE after its structural checks, never passing by skipping. The merge base has no rewrite to compare
// (no logic module is built there), so the limit is the issue's 200 ms (README: Readings). "Once at check": two
// documents naming one provider rewrite it and run it once. "No work": the full build and the merge base's full
// build evaluate a document that names no program with the same nodes at check and the same nodes per frame,
// and the sandbox module checks, rewrites and runs nothing; those are counts, so they run on every machine.
import { describe, expect, it } from 'vitest';
import {
  DOC, FOUR_MIB, SANDBOX_COUNTS, arr, assembleText, baseDeepShow, board, checkCall, deepShow, environmentProblem, evalAt, framesOf, installPack, judgeRuns,
  macSandbox, num, obj, onMac, prebuild, present, rect, rewriteCall, rewritten, runShow, scenario, settle, show, str, useTemp,
  type Fixture, type JsonObject, type ShowFeature,
} from './helpers.ts';
import { meshItem, quadPack } from './programs.ts';

const ID = '#238.fb1edf47';
const LIMIT_MS = 200;
const NO_LOGIC: ShowFeature[] = ['full', 'test-leave-out-logic', 'test-mesh-item', 'test-prog-registry'];
prebuild(() => { macSandbox(); });
const temp = useTemp();

/** About 1.08 MB of code: 1,000 functions, each a loop over 40 float multiply-adds through memory. */
function bigProgram(): Fixture {
  const unit = '(f64.store (i32.const 8) (f64.add (f64.load (i32.const 8)) (f64.mul (f64.load (i32.const 16)) (f64.const 1.5))))';
  const fns: string[] = [];
  for (let k = 0; k < 1000; k++) {
    fns.push(`(func $f${k} (local $i i32) (loop $l ${unit.repeat(40)} (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $l (i32.lt_u (local.get $i) (i32.const 2)))))`);
  }
  return assembleText('one_mb', `(module (memory (export "memory") 1 1)
  (global (export "params_at") i32 (i32.const 61440)) (global (export "assets_at") i32 (i32.const 62464)) (global (export "out_at") i32 (i32.const 63488))
  (func $gen (export "gen") (param $seed i64) (result i32) (call $f0) (i32.const 0))
  ${fns.join('\n  ')})`);
}
const counts = (reply: JsonObject, what: string): { checks: number; rewrites: number; links: number; runs: number } =>
  ({ checks: num(reply['checks'], `${what}.checks`), rewrites: num(reply['rewrites'], `${what}.rewrites`), links: num(reply['links'], `${what}.links`), runs: num(reply['runs'], `${what}.runs`) });

describe(`${ID} budgets against the merge base: a 1 MB rewrite under 200 ms once at check, and no work for documents that name no program`, () => {
  it(`${ID} rewriting a 1 MB program takes under ${LIMIT_MS} ms on the reference Mac (five fresh processes after a warm-up)`, (ctx) => {
    const big = bigProgram();
    expect(big.bytes.length, 'the program is at least 1 MB').toBeGreaterThanOrEqual(1_000_000);
    expect(big.bytes.length, 'and inside the subset\'s 4 MiB').toBeLessThanOrEqual(FOUR_MIB);
    const [checked, first] = onMac([checkCall(big), rewriteCall(big)]);
    expect(checked!['ok'], `the 1 MB program passes the subset check: ${show(checked)}`).toBe(true);
    rewritten(first!, 'the 1 MB rewrite');
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    onMac([rewriteCall(big)]);
    const runs = [0, 1, 2, 3, 4].map((k) => rewritten(onMac([rewriteCall(big)])[0]!, `rewrite ${k}`).ms);
    settle(ctx, [judgeRuns(`${ID} rewriting a ${big.bytes.length}-byte program (ms)`, runs, LIMIT_MS)]);
  }, 3_600_000);

  it(`${ID} the rewrite and the run happen once at check: two documents naming one provider, presented twice, with frames between, rewrite and run it once`, () => {
    const quad = quadPack(temp());
    const doc = board('Quad', [meshItem('mesh-1')], { packs: ['test/quadpack@1.0.0'], requires: { modules: { 'test.mesh': '^1' } } });
    const [install, before, a, again, b, , after] = runShow(deepShow(NO_LOGIC), scenario(temp(), [
      installPack(quad.pack), SANDBOX_COUNTS, present(DOC.a, doc), present(DOC.a, doc), present(DOC.b, doc), framesOf(DOC.a, 30), SANDBOX_COUNTS,
    ]));
    expect(install!['outcome'], `test/quadpack@1.0.0 installs: ${show(install)}`).toBe('installed');
    for (const [r, w] of [[a, 'the first'], [again, 'the second'], [b, 'the other document\'s']] as const) expect(r!['outcome'], `${w} presentation`).toBe('presented');
    const c0 = counts(before!, 'sandbox before');
    const c1 = counts(after!, 'sandbox after');
    expect([c1.rewrites - c0.rewrites, c1.runs - c0.runs], 'the provider\'s program was rewritten once and run once, at the first check').toEqual([1, 1]);
  }, 3_600_000);

  it(`${ID} with the sandbox module in the build, a document that names no program evaluates the merge base's nodes at check and per frame, and the sandbox module does nothing`, () => {
    const doc = board('Plain', [rect('r-1', [20, 20, 200, 100], 'a0'), rect('r-2', [260, 40, 120, 160], 'a1')]);
    const calls = [present(DOC.a, doc), evalAt(DOC.a, 0), framesOf(DOC.a, 30)];
    const here = runShow(deepShow(['full']), scenario(temp(), [...calls, SANDBOX_COUNTS]));
    const base = baseDeepShow();
    const there = runShow(base.bin, scenario(temp(), calls));
    for (const [r, w] of [[here[0], 'here'], [there[0], 'on the merge base']] as const) expect(r!['outcome'], `the plain document is presented ${w}`).toBe('presented');
    const nodes = (reply: JsonObject, what: string): string[] => arr(reply['nodes'], `${what}: nodes`).map((n, i) => {
      const o = obj(n, `${what}: nodes[${i}]`);
      return `${str(o['operator'], `${what}: nodes[${i}].operator`)}|${o['item'] === null ? '-' : String(o['item'])}`;
    }).sort();
    expect(nodes(here[1]!, 'eval here'), `the check evaluates the merge base ${base.sha.slice(0, 12)}'s nodes, none of the sandbox module's`).toEqual(nodes(there[1]!, 'eval on the merge base'));
    const ran = (reply: JsonObject, what: string): number[] => arr(reply['frames'], `${what}: frames`).map((f, i) => num(obj(f, `${what}: frames[${i}]`)['ran'], `${what}: frames[${i}].ran`));
    expect(ran(here[2]!, 'frames here'), 'each frame runs as many nodes as on the merge base').toEqual(ran(there[2]!, 'frames on the merge base'));
    expect(counts(here[3]!, 'sandbox'), 'the sandbox module checked, linked, rewrote and ran nothing').toEqual({ checks: 0, rewrites: 0, links: 0, runs: 0 });
  }, 7_200_000);
});
