// Criterion 10 (no upstream test): "Budgets, on the reference Mac in the local preflight, compared with the merge
// base: linking a 1 MB program with two 500 KB libraries takes under 300 ms once at check; a library's fixtures run
// once per hash in under 5 s; and an item without links gains no work at check or per frame"
//
// Through `deep-logic check` (its receipts' `link_ns` and fixture runs) and #532's `view` and `frame`, by this
// checkout's binary and the merge base's (helpers: baseBin), on macOS arm64 only (BLOCKED elsewhere). The 1 MB program
// and the two 500 KB libraries are half code (chains of calls, each a relocation) and half data (programs.ts:
// bigProgram, bigLib). "Once at check": a second check of the same piece in the same process runs no fixture again.
// "No work": an unlinked item's receipt shows no link (no merged program, no library, link_ns 0), its fuel per step
// is the merge base's, and its check and frame times stay within the merge base's: the median of 7 alternating
// rounds of 40 checks within 5% + 5 ms, and the median frame's `eval_ns` over 300 one-step frames within 5% + 20 µs.
import { describe, expect, it } from 'vitest';
import { AC, FLICKS, STEP_60, TIMEOUT, admitted, baseBin, bakeCall, bakeOf, checkCall, frameCall, live, logicBin, median, num, obj, onBase, onHost, piece, prebuild, requireMacArm64, show, str, timed, viewCall, type JsonObject } from './helpers.ts';
import { bigSet, pack, plainPiece } from './libs.ts';

prebuild(() => { logicBin(); });

const near = (size: number, want: number): boolean => size >= 0.95 * want && size <= 1.1 * want;

/** Each frame's eval_ns over `frames` one-step frames of `p` in one process of `bin`. */
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

describe(`${AC[10]} linking, fixtures and unlinked items keep their budgets`, () => {
  it(`${AC[10]} linking a 1 MB program with two 500 KB libraries takes under 300 ms once at check, and each library's fixtures run once per hash in under 5 s`, () => {
    const set = bigSet();
    const p = piece({ seed: 190_10, packs: [pack('big', [set.a, set.b])], items: { big: { program: set.program, writes: { v: { type: 'i32' } }, links: [set.a, set.b] } } });
    const [first, second] = onHost([checkCall(p), checkCall(p)]);
    const r1 = admitted(first!, 'the first check')['big']!;
    requireMacArm64('the budgets\' reference machine');
    expect([near(set.program.bytes.length, 1_000_000), near(set.a.program.bytes.length, 500_000), near(set.b.program.bytes.length, 500_000)],
      `a 1 MB program and two 500 KB libraries (${set.program.bytes.length}, ${set.a.program.bytes.length}, ${set.b.program.bytes.length} bytes)`).toEqual([true, true, true]);
    expect(r1.link_ns, `the link took ${r1.link_ns} ns, under 300 ms`).toBeLessThan(300_000_000);
    for (const lib of r1.libraries) {
      expect(lib.fixtures.map((f) => [f.verdict, f.ran]), `${lib.name}'s fixtures ran at the first check and passed`).toEqual(lib.fixtures.map(() => ['PASS', true]));
      for (const f of lib.fixtures) expect(f.ns, `${lib.name}'s fixture ${f.fixture} ran in under 5 s`).toBeLessThan(5_000_000_000);
    }
    const r2 = admitted(second!, 'the second check')['big']!;
    expect(r2.libraries.flatMap((l) => l.fixtures.map((f) => f.ran)), 'a second check of the same hashes runs no fixture again').toEqual(r1.libraries.flatMap((l) => l.fixtures.map(() => false)));
  }, TIMEOUT);

  it(`${AC[10]} an item without links gains no work at check or per frame, compared with the merge base`, async () => {
    const p = plainPiece();
    const [check] = onHost([checkCall(p)]);
    const r = admitted(check!, 'check of the unlinked piece')['plain']!;
    expect([r.linked, r.libraries, r.link_ns], 'the unlinked item\'s receipt shows no link').toEqual([null, [], 0]);
    requireMacArm64('the budgets\' reference machine');
    const fuel = (reply: JsonObject): number[] => bakeOf(reply, 'bake').steps.map((s) => s.items['plain']?.fuel ?? -1);
    const [headBake] = onHost([bakeCall(p, 60)]);
    const baseFuel = (obj(onBase([bakeCall(p, 60)])[0], 'the merge base\'s bake')['steps'] as JsonObject[]).map((s) => (obj(s['items'], 'items')['plain'] as JsonObject)['fuel']);
    expect(fuel(headBake!), 'every step\'s fuel is the merge base\'s').toEqual(baseFuel);
    const checks = Array.from({ length: 40 }, () => checkCall(p));
    const head: number[] = []; const base: number[] = [];
    for (let i = 0; i < 7; i++) { head.push(timed('head', checks)); base.push(timed('base', checks)); }
    expect(median(head), `40 checks take ${median(head)} ms here and ${median(base)} ms at the merge base`).toBeLessThanOrEqual(median(base) * 1.05 + 5);
    const headFrames = median(await frames(logicBin(), p, 300));
    const baseFrames = median(await frames(baseBin().bin, p, 300));
    expect(headFrames, `the median frame's eval_ns is ${headFrames} here and ${baseFrames} at the merge base`).toBeLessThanOrEqual(baseFrames * 1.05 + 20_000);
  }, TIMEOUT);
});
