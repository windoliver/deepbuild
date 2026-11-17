// Criterion 7, its interface half (no upstream test): "Budgets, on the reference Mac in the local preflight, compared
// with the merge base: an interface's fixtures run once per library hash in under 5 s; a 16 MiB asset validates once
// per hash in under 0.2 s; and a piece that names no interface or layout gains no work at check or per frame". The
// 16 MiB asset and the layouts are tests/acceptance/416/layouts/'s.
//
// Through `deep-logic check`, `bake` and #532's `view` and `frame`, by this checkout's binary and the merge base's
// (`git merge-base HEAD origin/main`, built from `git archive`; helpers.ts: baseBin), on macOS arm64 only (BLOCKED
// elsewhere). "Once per library hash": a second piece linking the same three libraries in the same process runs none of
// their interfaces' fixtures again. "Under 5 s": an interface's fixtures' run times on one library, summed. The piece
// that names no interface holds `plain`, a counter that links nothing, and `door`, which links fsm_table@1 by its own
// name from a pack entry that implements nothing. "No work": its receipts record no interface run, its fuel per step is the merge
// base's, and its check and frame times stay within the merge base's: the median of 7 alternating rounds of 40 checks
// within 5% + 5 ms, and the median frame's `eval_ns` over 300 one-step frames within 5% + 20 µs (#190's allowances).
import { describe, expect, it } from 'vitest';
import {
  FLICKS, STEP_60, TIMEOUT, admitted, bakeCall, bakeOf, checkCall, frameCall, live, logicBin, median, num, obj, onHost,
  prebuild, requireMacArm64, show, str, viewCall, type JsonObject,
} from '../../190/helpers.ts';
import { AC, baseBin, countLayout, doorItem, firstParty, fsmLib, interfaceRuns, netItem, nnLib, onBase, pack, phys2d, piece, slideItem, timed } from './helpers.ts';
import { COUNT_WRITES, counter, f32Bytes, netBytes, ownNet } from './programs.ts';

prebuild(() => { logicBin(); });

/** Each frame's eval_ns over `n` one-step frames of `p` in one process of `bin` (#190's criterion 10). */
async function frames(bin: string, p: JsonObject, n: number): Promise<number[]> {
  const l = live(bin);
  try {
    const opened = await l.call(viewCall(p, 30));
    expect(opened['ok'], `view opened the piece: ${show(opened)}`).toBe(true);
    const session = str(opened['session'], 'view.session');
    const out: number[] = [];
    for (let k = 1; k <= n; k++) out.push(num((await l.call(frameCall(session, (k * STEP_60) / FLICKS)))['eval_ns'], `frame ${k}.eval_ns`));
    return out;
  } finally { l.stop(); }
}

describe(`${AC[7]} interfaces cost their fixtures once per library hash, and nothing to a piece that names none`, () => {
  it(`${AC[7]} each interface's fixtures run once per library hash, in under 5 s`, () => {
    const fp = firstParty();
    const own = ownNet();
    const libs = { slide: phys2d(), door: fsmLib('table'), brain: nnLib() };
    const packs = [pack('physics', [libs.slide]), pack('doors', [libs.door]), pack('nets', [libs.brain])];
    const items = (tag: string) => ({
      [`slide${tag}`]: slideItem('lib:physics2d.lib@1', [libs.slide]),
      [`door${tag}`]: doorItem('lib:fsm@1', [libs.door]),
      [`brain${tag}`]: netItem('lib:nn.mlp@1', netBytes(own.net), f32Bytes(own.input), 2, [libs.brain]),
    });
    const [first, second] = onHost([checkCall(piece(4171, items('_a'), packs, fp.assets)), checkCall(piece(4172, items('_b'), packs, fp.assets))]);
    admitted(first!, 'the first piece\'s check');
    admitted(second!, 'the second piece\'s check');
    const checked: [string, string, string][] = [['slide', 'phys2d@1', 'physics2d.lib@1'], ['door', 'fsm_table@1', 'fsm@1'], ['brain', 'mlp@1', 'nn.mlp@1']];
    const firstRuns = checked.map(([item, lib, iface]) => {
      const runs = interfaceRuns(first!, `${item}_a`, lib)[iface];
      expect(runs?.map((r) => [r.fixture, r.verdict, r.ran]).sort(), `${iface}'s fixtures ran on ${lib} at the first check and passed`).toEqual(fp.iface(iface).fixtures.map((f) => [f, 'PASS', true]).sort());
      return { iface, lib, ns: runs!.reduce((s, r) => s + r.ns, 0) };
    });
    for (const [item, lib, iface] of checked) {
      expect(interfaceRuns(second!, `${item}_b`, lib)[iface]?.map((r) => r.ran), `a second piece linking ${lib} runs none of ${iface}'s fixtures again`).toEqual(fp.iface(iface).fixtures.map(() => false));
    }
    requireMacArm64('the budgets\' reference machine');
    for (const { iface, lib, ns } of firstRuns) expect(ns, `${iface}'s fixtures took ${ns} ns on ${lib}, under 5 s`).toBeLessThan(5_000_000_000);
  }, TIMEOUT);

  it(`${AC[7]} a piece that names no interface gains no work at check or per frame, compared with the merge base`, async () => {
    const door = fsmLib('table', null);
    expect(door.implements, 'fsm_table@1\'s entry here declares no implements').toBeUndefined();
    const p = piece(4173, { plain: { program: counter(countLayout()), writes: COUNT_WRITES }, door: doorItem('lib:fsm_table', [door]) }, [pack('doors', [door])]);
    const [check] = onHost([checkCall(p)]);
    const r = admitted(check!, 'check of the piece that names no interface');
    expect([r['plain']!.linked, r['plain']!.libraries], 'plain links nothing').toEqual([null, []]);
    expect(interfaceRuns(check!, 'door', 'fsm_table@1'), 'fsm_table@1, here implementing nothing, records no interface run').toEqual({});
    requireMacArm64('the budgets\' reference machine');
    const fuel = (reply: JsonObject, what: string): number[][] => (obj(reply, what)['steps'] as JsonObject[]).map((s) => ['plain', 'door'].map((id) => num(obj(obj(s['items'], 'items')[id], id)['fuel'], `${what}: ${id}'s fuel`)));
    const [headBake] = onHost([bakeCall(p, 60)]);
    bakeOf(headBake!, 'this checkout\'s bake');
    const [baseBake] = onBase([bakeCall(p, 60)]);
    expect(fuel(headBake!, 'this checkout\'s bake'), 'every step\'s fuel is the merge base\'s').toEqual(fuel(baseBake!, 'the merge base\'s bake'));
    const checks = Array.from({ length: 40 }, () => checkCall(p));
    const head: number[] = []; const base: number[] = [];
    for (let i = 0; i < 7; i++) { head.push(timed('head', checks)); base.push(timed('base', checks)); }
    expect(median(head), `40 checks take ${median(head)} ms here and ${median(base)} ms at the merge base`).toBeLessThanOrEqual(median(base) * 1.05 + 5);
    const headFrames = median(await frames(logicBin(), p, 300));
    const baseFrames = median(await frames(baseBin().bin, p, 300));
    expect(headFrames, `the median frame's eval_ns is ${headFrames} here and ${baseFrames} at the merge base`).toBeLessThanOrEqual(baseFrames * 1.05 + 20_000);
  }, TIMEOUT);
});
