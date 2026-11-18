// AC5 #1048.c2ba93df: "A fixture whose damage logic divides by an `armor` slider's value traps at `armor = 0`.
// `logic.edges` fails, naming the control, 0, the function and offset, and its track reproduces the trap in a fresh
// replica. The clean twin, which clamps `armor` to at least 1, passes."
//
// The duel (programs.ts): armor starts at 5, each entry on the `armor` slider (range [0, 10]) sets it and deals a blow
// of 60 / armor (i32.div_s), and so does each step with none; its interface lists the slider as an action and holds
// hurt to [0, 60]. logic.edges names a playtest of a policy picking armor 2, 5 or 8 every 0.25 s (2 runs of 120 steps),
// with 2 samples a run and 4 settle steps (the criterion names no count; README: The surface). Played at the base:
// armor 0 traps (divide) at the entry's step, at function 0, offset 109; the policy's own runs never trap.
// - On the duel, logic.edges fails with logic.trap naming control armor, value 0, the function and the offset; the
//   track it names (by sha256, a replica's recorded track) plays again here in a fresh replica, without anything else,
//   to a trap of kind divide at that function and offset. The values it put on armor include 0 and its range's ends,
//   0 and 10, which come from the slider's entry in control@1 and the control's own range.
// - On the clean twin, which holds armor to at least 1, logic.edges passes.
// The wrong programs: the base (no logic.edges), a check that never puts 0, one that names another function or
// offset, one whose track doesn't reproduce the trap, one that fails the clean twin.
import { describe, expect, it } from 'vitest';
import { AC, DOC, Pool, TIMEOUT, edgesSpec, lockPlay, macOnly, named, openHub, ownPlay, putPiece, runCheck, shown, show, stepOf, trackNamed, word, type Obj } from './helpers.ts';
import { ARMOR, ARMOR_POLICY, armorPiece, armorPlay, armorProgram } from './programs.ts';

const EDGES = { playtest: 'REQ-1048-duel', samples: 2, settle: 4, seed: 1048 };
const input = (piece: string, play: Obj): Obj => ({ piece, play, bots: [ARMOR_POLICY], runs: 2, seed: 1048, span: { steps: 120 }, goals: [], piece_seed: 'own', frames: { every: 0 } });

describe(`${AC[5]} logic.edges puts armor at its edge values`, () => {
  it(`${AC[5]} armor 0 traps: logic.edges fails naming armor, 0, the function and offset, its track reproduces the trap; the clamped twin passes`, async () => {
    macOnly();
    const pool = await Pool.open(2, { entries: true, keep: [] });
    const hub = await openHub(pool);
    const play = await lockPlay(armorPlay());

    const duel = putPiece(DOC.armor, armorPiece(armorProgram(false)));
    const r = await runCheck(hub, edgesSpec(EDGES, input(duel, play)));
    expect(r.outcome, `logic.edges fails on the duel: ${shown(r)}`).toBe('failed');
    const f = r.failures.find((x) => x.message.startsWith('logic.trap') && word('control armor').test(x.message) && word('value 0').test(x.message));
    expect(f, `a logic.trap failure names control armor and value 0: ${shown(r)}`).toBeDefined();
    expect(f!.test, `it names the run: ${f!.test}`).toMatch(/^bot 0 run [01]$/);
    expect(named(f!.message, 'step'), `it names the step it was put in from: ${f!.message}`).toBeDefined();
    const fn = named(f!.message, 'function');
    const offset = named(f!.message, 'offset');
    expect([fn, offset], `it names the function and the offset: ${f!.message}`).not.toContain(undefined);
    const track = trackNamed(f!.message);
    expect(track, `it names its track: "track <sha256>": ${f!.message}`).toBeDefined();
    const entries = pool.entriesOf(track!);
    expect(entries, `a replica play recorded the track ${track}`).toBeDefined();
    const steps = Math.max(...entries!.map(stepOf)) + 4;
    const fresh = await Pool.open(1, { entries: false, keep: [] });
    const again = await ownPlay(fresh, duel, { seed: 1048, span: { steps }, track: entries, values: [], frames: [] });
    const trap = again['trap'] as Obj | null;
    expect(trap, `the track traps in a fresh replica: ${show(again['trap'])}`).not.toBeNull();
    expect([trap!['kind'], trap!['function'], trap!['offset']], 'the fresh replica\'s trap: divide, at the function and offset logic.edges named').toEqual(['divide', fn, offset]);
    const put = (r.edges?.['put'] as Obj[] | undefined)?.filter((p) => p['control'] === 'armor').map((p) => String(p['value']));
    expect(put, `the result lists the values it put (edges.put): ${show(r.edges as never, 600)}`).toBeDefined();
    for (const v of ['0', String(ARMOR.range[0]), String(ARMOR.range[1])]) expect(put, `it put armor at ${v}`).toContain(v);

    const clamped = putPiece(DOC.armorClean, armorPiece(armorProgram(true)));
    const ok = await runCheck(hub, edgesSpec(EDGES, input(clamped, play)));
    expect(ok.outcome, `logic.edges passes on the clamped twin: ${shown(ok)}`).toBe('passed');
  }, TIMEOUT);
});
