// Criterion 8: "A stair light: the source's live to a changeover's common, strap wires from its `a` to a second
// changeover's `a` and from its `b` to the second's `b`, and the second's common through a 60 W lamp to neutral. Over
// all four states of the two inputs the lamp carries 0.26087 A exactly when the inputs are equal, and 0 A at every step
// otherwise. With two more changeovers on a third input between the straps, wired so the straps run straight at 0 and
// crossed at 1, the lamp changes at every flip of any of the three inputs, over all eight states. A planted library
// that joins `a` and `b` for the step its input changes fails the stair fixture at that step, naming the lamp's
// current."
//
// Through `deep-logic first_party`, `playback`, `judge` and `check` (README: The surface): the stair light (circuits.ts:
// STAIR), its inputs through 00, 01, 11, 10, 00 a hundred steps apart, and the hall (HALL), its three inputs through
// the Gray code's eight states, at 1,000 steps a second. By hand: a path from live to the lamp exists exactly when the
// second changeover's way is the strap the first one feeds: x1 = x2 on the stair, x2 = x1 ⊕ x3 in the hall (the middle
// pair swaps the straps at 1), so the lamp lights exactly when x1 ⊕ x2 ⊕ x3 is 0 and one flip of any input changes
// it. At every step: lit, the lamp carries 0.26087 A within 1e-9 relative; unlit, `i` and `i_rms` 0 within 1e-12 A;
// each changeover's `on` reads 1 while its input is 0 and 2 while it isn't; circuit.kcl and circuit.power pass. Then
// the planted library `both_ways`: on this suite's stair at step 100, where x2 turns 1 with x1 at 0, it joins both
// straps to the lamp and lights it, the first step it differs; and linked as a library that implements circuit@2,
// the link is refused (#416) naming the interface's fixture `stair`, a step where one of that fixture's inputs
// changes, and the lamp's current (`i_rms` or `i` at the lamp's index). The wrong programs: a changeover that joins
// neither way while it moves or both, one read a step late, on that isn't 1 or 2, and a check that runs no fixture.
import { describe, expect, it } from 'vitest';
import { FLICKS, TIMEOUT, arr, checkCall, logicBin, num, obj, onHost, prebuild, refusedOf, show, str, type Entry, type JsonObject } from '../190/helpers.ts';
import { HALL, HALL_STATES, LAMP, STAIR, STAIR_STATES, index, type Fix, type State } from './circuits.ts';
import { AC, CIRCUIT, INTERFACE, KCL, POWER, circuitLib, item, judgeCall, judged, linkName, nums, piece, plantedLib, plantedPiece, plantsPack, playbackCall, played, refPiece, rel, rule, type Arrays } from './helpers.ts';

prebuild(() => { logicBin(); });

/** The inputs' values at step k, from the states the track steps through. */
const inputs = (states: State[], k: number): number[] => [...states].reverse().find((s) => s.k <= k)!.x;
const lit = (x: number[]): boolean => x.reduce((a, b) => a ^ b, 0) === 0;
/** Each step's wrong readings of `f`'s run: the lamp's current against the inputs, and each changeover's `on`. */
function wrong(f: Fix, states: State[], at: Map<number, Arrays>): string[] {
  const lamp = index(f.circuit, 'lamp');
  const ways = f.circuit.parts.flatMap((p, q) => (p.kind === 'changeover' ? [{ q, by: f.inputs.indexOf(String(p['at_b_by'])) }] : []));
  return Array.from({ length: f.steps }, (_, k) => k).flatMap((k) => {
    const x = inputs(states, k), a = at.get(k);
    const [i, irms] = [nums(a, 'i')[lamp]!, nums(a, 'i_rms')[lamp]!];
    const out = lit(x) ? (rel(irms, LAMP.amps) <= 1e-9 ? [] : [`step ${k} (${x.join('')}): lit, but the lamp carries ${irms} A`])
      : (Math.abs(i) <= 1e-12 && Math.abs(irms) <= 1e-12 ? [] : [`step ${k} (${x.join('')}): unlit, but the lamp carries ${irms} A`]);
    for (const w of ways) if (nums(a, 'on')[w.q] !== (x[w.by] ? 2 : 1)) out.push(`step ${k}: ${f.circuit.parts[w.q]!.id} reads on ${nums(a, 'on')[w.q]} with its input ${x[w.by]}`);
    return out;
  });
}
const STEPS = (f: Fix): number[] => Array.from({ length: f.steps }, (_, k) => k);

describe(`${AC[8]} two-way and intermediate switching`, () => {
  it(`${AC[8]} a stair light over all four states: the lamp carries 0.26087 A exactly when the inputs are equal and 0 A at every step otherwise; with two more changeovers on a third input the lamp changes at every flip of any of the three, over all eight states`, () => {
    expect([STAIR_STATES.length, new Set(STAIR_STATES.map((s) => s.x.join(''))).size, new Set(HALL_STATES.map((s) => s.x.join(''))).size], 'the stair\'s run visits all four states, the hall\'s all eight').toEqual([5, 4, 8]);
    expect(HALL_STATES.slice(1).every((s, j) => s.x.filter((v, i) => v !== HALL_STATES[j]!.x[i]).length === 1 && lit(s.x) !== lit(HALL_STATES[j]!.x)), 'each hall state flips one input and so the lamp').toBe(true);
    expect([0, 1, 2].every((i) => HALL_STATES.slice(1).some((s, j) => s.x[i] !== HALL_STATES[j]!.x[i])), 'and each of the three inputs flips').toBe(true);

    const L = circuitLib();
    const [ps, ph] = [refPiece(L, [STAIR]), refPiece(L, [HALL])];
    const [stair, hall, ...judges] = onHost([playbackCall(ps, STAIR, STEPS(STAIR)), playbackCall(ph, HALL, STEPS(HALL)), judgeCall(ps, STAIR), judgeCall(ph, HALL)]);
    expect(wrong(STAIR, STAIR_STATES, played(stair!, STAIR.item)).slice(0, 10), 'the stair light: lit exactly when the inputs are equal, 0 A at every other step, each changeover at the way its input names').toEqual([]);
    const h = played(hall!, HALL.item);
    expect(wrong(HALL, HALL_STATES, h).slice(0, 10), 'the hall: lit exactly when x1 ⊕ x2 ⊕ x3 is 0, 0 A at every other step').toEqual([]);
    const lamp = index(HALL.circuit, 'lamp');
    const changed = HALL_STATES.slice(1).filter((s) => (nums(h.get(s.k), 'i_rms')[lamp]! > 0.1) === (nums(h.get(s.k - 1), 'i_rms')[lamp]! > 0.1)).map((s) => `step ${s.k}`);
    expect(changed, 'the lamp changes at every one of the seven flips').toEqual([]);
    for (const [n, id] of [STAIR.item, HALL.item].entries()) {
      const j = judged(judges[n]!, id);
      for (const code of [KCL, POWER]) expect([rule(j, code).verdict, rule(j, code).fails], `${id}: ${code} passes at every step: ${show(rule(j, code).fails as never)}`).toEqual(['PASS', []]);
    }
  }, TIMEOUT);

  it(`${AC[8]} a planted library that joins a and b for the step its input changes fails the stair fixture at that step, naming the lamp's current`, () => {
    const L = circuitLib();
    // On this suite's stair: the first step it differs is a flip.
    const [play] = onHost([playbackCall(plantedPiece(L, 'both_ways', STAIR), STAIR, STEPS(STAIR))]);
    const first = wrong(STAIR, STAIR_STATES, played(play!, STAIR.item)).find((w) => w.includes('the lamp carries'));
    expect(first, 'on this suite\'s stair the planted library lights the lamp at step 100, where x2 turns 1 with x1 at 0').toMatch(/^step 100 \(01\): unlit, but the lamp carries 0\.26/);

    // Linked as a library that implements circuit@2: the interface's stair fixture fails, naming the lamp's current.
    const fixtures = L.fixtures.map((id) => ({ id, f: L.fixture(id) }));
    const stairs = fixtures.filter((x) => x.f['name'] === 'stair');
    expect(stairs.length, `${CIRCUIT} ships a fixture named stair: ${fixtures.map((x) => String(x.f['name'])).join(', ')}`).toBe(1);
    const fx = stairs[0]!.f;
    const params = obj(obj(fx['item'], 'the stair fixture\'s item')['params'], 'its params');
    const circuit = obj(params['circuit'], 'its circuit');
    const parts = arr(circuit['parts'], 'its parts').map((q) => obj(q, 'a part'));
    expect(parts.filter((q) => q['kind'] === 'changeover').length, 'the stair fixture holds changeovers').toBeGreaterThanOrEqual(2);
    const lampAt = parts.findIndex((q) => q['kind'] === 'load');
    const rate = num(params['step_rate'], 'its step rate');
    const values = new Map<string, number>(), changes = new Set<number>();
    for (const e of arr(fx['track'] ?? [], 'its track') as unknown as Entry[]) {
      const k = Math.ceil((e.t * rate) / FLICKS - 1e-9);
      if ((values.get(e.control) ?? 0) !== e.value) changes.add(k);
      values.set(e.control, e.value);
    }
    const planted = plantedLib(L, 'both_ways');
    const assets = { ...L.assets };
    const plants = plantsPack(planted, linkName('both_ways'), assets, true);
    const [reply] = onHost([checkCall(piece({ [STAIR.item]: item(STAIR, INTERFACE, [{ name: linkName('both_ways'), asset: planted.sha }]) }, [plants], assets))]);
    const r = refusedOf(reply as JsonObject, 'the check of a piece linking both_ways as a circuit@2 library');
    expect(r.code, 'the link is refused').toBe('link_refused');
    const named = r.refusals.find((x) => x['fixture'] === stairs[0]!.id);
    expect(named, `a refusal names the interface's stair fixture: ${show(r.refusals as never)}`).toBeDefined();
    expect([String(named!['interface']), changes.has(num(named!['step'], 'its step'))], `at a step where one of its inputs changes (${[...changes].join(', ')}): ${show(named!)}`).toEqual([CIRCUIT, true]);
    expect([['i_rms', 'i'].includes(str(named!['array'], 'its array')), num(named!['index'], 'its index')], `naming the lamp's current, part ${lampAt}: ${show(named!)}`).toEqual([true, lampAt]);
  }, TIMEOUT);
});
