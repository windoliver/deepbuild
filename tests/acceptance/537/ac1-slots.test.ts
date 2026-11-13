// AC1 #537.fdb98a26: An instancer of 16 slots fed by logic, in which slot 3, live with gen 1 from step 0, turns not live
// at step 50 and live again with gen 2 at step 60, draws units#3.1 up to step 49, nothing in slot 3 for steps 50 to 59,
// and units#3.2 from step 60, whose seed is hash(seed, 3, 2), not gen 1's; a selection holding units#3.1 drops it at step
// 60's first frame; a planted instancer that addresses elements by slot alone keeps units#3 selected onto the new unit
// and fails, naming the element; and an instancer that takes both array columns and distribute is refused at check,
// naming both
//
// `units` (fixtures.ts) reads `brains` (programs.ts `slotsProgram`): 16 slots, all live with gen 1, slot 3 not live at
// steps 50 to 59 and live with gen 2 from step 60. `view3d` draws it from straight above at 60 fps, so frame n shows step
// n (README: The surface under test). What a slot draws is the object-ID target at the slot's centre (the stable ID the
// object-ID pass writes); the elements and their seeds are `evaluate`'s `items/units/elements`. The selection is the
// view's session state: a click on slot 3 at step 49 names what it picks, a viewer entry selects that, and the session
// seeks to step 60 (README: Readings). The refusal is the document check's, through `deep_show`.
import { describe, expect, it } from 'vitest';
import { GEN2_PLAN, OFF_FROM, ON_AGAIN, PLAN, SLOT, SLOTS, slotAt, slotState, slotsProgram } from './programs.ts';
import { UNITS_SIZE, UNITS_TARGET, UNITS_WIDTH, unitsAgent, unitsSession } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, arr, binOf, failsNaming, frameAt, framesOf, idsOf, issuesOf, namedIn, names, namesItem, none, num, obj,
  prebuild, presented, putAsset, putEvidence, requireMetal, runGpu, runShow, scenario, show, showCall, str, topDownPx, useTemp, valueAt,
  view3dCall, writeJson, type Frame, type JsonObject, type Planted,
} from './helpers.ts';

prebuild(['deep-gpu', 'deep-show']);
const temp = useTemp();

/** Steps 0 to 69, one frame each. */
const FRAMES = 70;
const CLICK_STEP = OFF_FROM - 1;
const ELEMENTS = 'items/units/elements';
const slotPx = (i: number): [number, number] => {
  const [x, , z] = slotAt(i);
  const [sx, sy] = topDownPx(UNITS_SIZE, UNITS_TARGET, UNITS_WIDTH, x, z);
  return [Math.floor(sx), Math.floor(sy)];
};
/** The element slot i holds after step k, or null when it isn't live. */
const expectedId = (i: number, k: number, plan = PLAN): string | null => { const s = slotState(i, k, plan); return s.live ? `units#${i}.${s.gen}` : null; };

interface Element { id: string; slot: number; gen: number; seed: string }
/** A frame's `items/units/elements`: one entry per live slot, `{id, slot, gen, seed}`, the seed's u64 as text. */
function elementsOf(f: Frame, what: string): Element[] {
  return arr(valueAt(f, ELEMENTS, what), `${what}: frame ${f.frame}'s ${ELEMENTS}`).map((v, j) => {
    const e = obj(v, `${what}: frame ${f.frame}'s element ${j}`);
    const seed = e['seed'];
    expect(typeof seed === 'string' || typeof seed === 'number', `${what}: frame ${f.frame}'s element ${j} carries its seed: ${show(e)}`).toBe(true);
    return { id: str(e['id'], 'id'), slot: num(e['slot'], 'slot'), gen: num(e['gen'], 'gen'), seed: String(seed) };
  });
}
/** Every frame 0 to 69: the ID drawn at each slot's centre, and the elements the frame holds, against the program's. */
function drawnFailures(out: string, frames: Frame[], what: string): string[] {
  const failures: string[] = [];
  for (let k = 0; k < FRAMES; k++) {
    const f = frameAt(frames, k, what);
    const ids = idsOf(out, f, what);
    for (let i = 0; i < SLOTS; i++) {
      const want = expectedId(i, k);
      const got = ids(...slotPx(i));
      if (want !== null && got !== want) failures.push(`step ${k}: slot ${i} draws ${got ?? 'nothing'}, not ${want}`);
      if (want === null && got !== null && got.startsWith('units')) failures.push(`step ${k}: slot ${i} isn't live, and draws ${got}`);
    }
    const held = elementsOf(f, what).map((e) => `${e.id} (slot ${e.slot}, gen ${e.gen})`).sort();
    const wanted = Array.from({ length: SLOTS }, (_, i) => expectedId(i, k)).flatMap((id, i) => (id ? [`${id} (slot ${i}, gen ${slotState(i, k).gen})`] : [])).sort();
    if (JSON.stringify(held) !== JSON.stringify(wanted)) failures.push(`step ${k}: the elements are ${held.join(', ')}; the program's live slots are ${wanted.join(', ')}`);
  }
  return failures;
}
/** The seed of element `id` on a frame. */
function seedOf(f: Frame, id: string, what: string): string {
  const e = elementsOf(f, what).find((x) => x.id === id);
  expect(e, `${what}: frame ${f.frame} holds ${id}: ${show(f.values, 600)}`).toBeDefined();
  return e!.seed;
}

/** The session's selection as each frame presents it (README: `selection`). */
const selectionOf = (f: Frame, what: string): string[] => arr(f.raw['selection'], `${what}: frame ${f.frame}'s selection`).map((x) => str(x, 'a selected ID'));
/** The selection judge: at step 49 the selection holds what the click picked; at step 60's first frame, after the seek,
 * it holds nothing of slot 3. Each failure names the element the selection holds. */
function selectionFailures(frames: Frame[], picked: string, what: string): string[] {
  const failures: string[] = [];
  const before = selectionOf(frameAt(frames, CLICK_STEP, what), what);
  if (!before.includes(picked)) failures.push(`step ${CLICK_STEP}: the selection ${JSON.stringify(before)} doesn't hold ${picked}, the element the click picked`);
  for (const id of selectionOf(frameAt(frames, ON_AGAIN, what), what)) {
    if (/^units#3(\.|$)/.test(id)) failures.push(`step ${ON_AGAIN}'s first frame: the selection still holds ${id} (picked at step ${CLICK_STEP}), now slot ${SLOT}'s next occupant, units#3.2`);
  }
  return failures;
}
/** A click on slot 3 at step 49, then the selection of what it picked held from step 49 across a seek to step 60. */
function selectRun(planted?: Planted): { picked: string | null; frames: Frame[] } {
  requireMetal();
  const out = temp();
  const program = slotsProgram(PLAN);
  const doc = writeJson(out, 'units', unitsSession(program));
  const assets = putAsset(out, program.bytes, 'wasm');
  const what = `AC1 the click on slot 3${planted ? ` (planted ${planted})` : ''}`;
  const [click] = runGpu(binOf('deep-gpu'), out, [
    view3dCall({ doc, size: UNITS_SIZE, from: CLICK_STEP, frames: 1, clicks: [{ frame: CLICK_STEP, at: slotPx(SLOT) }], assets }),
  ], what, planted);
  const picked = frameAt(framesOf(click!, what), CLICK_STEP, what).clicks[0] ?? null;
  expect(picked, `${what}: the click at slot 3's centre at step ${CLICK_STEP} picks an element`).not.toBeNull();
  const sel = `AC1 the selection of ${picked}${planted ? ` (planted ${planted})` : ''}`;
  const [held] = runGpu(binOf('deep-gpu'), out, [
    view3dCall({ doc, size: UNITS_SIZE, from: CLICK_STEP, frames: 3, seeks: [{ after: CLICK_STEP, to: ON_AGAIN }], viewer: [{ frame: CLICK_STEP, selection: [picked!] }], assets }),
  ], sel, planted);
  return { picked, frames: framesOf(held!, sel) };
}

describe(`${AC[1]} 16 slots fed by logic: slot 3's generations drawn, seeded, selected and dropped, and the refusal of distribute`, () => {
  it(`${AC[1]} slot 3 draws units#3.1 to step 49, nothing at steps 50 to 59 and units#3.2 from step 60, whose seed is hash(seed, 3, 2), not gen 1's`, () => {
    requireMetal();
    const out = temp();
    const program = slotsProgram(PLAN);
    const gen2 = slotsProgram(GEN2_PLAN);
    const assets = { ...putAsset(out, program.bytes, 'wasm'), ...putAsset(out, gen2.bytes, 'wasm') };
    const call = (doc: string, frames: number, ids: boolean): JsonObject =>
      view3dCall({ doc, size: UNITS_SIZE, frames, ...(ids ? { capture: 'every', targets: ['ids'] } : {}), evaluate: [ELEMENTS], assets });
    const [played, ref, other] = runGpu(binOf('deep-gpu'), out, [
      call(writeJson(out, 'units', unitsSession(program)), FRAMES, true),
      call(writeJson(out, 'units-gen2', unitsSession(gen2, 'units-gen2')), 1, false),
      call(writeJson(out, 'units-gen2-seed538', unitsSession(gen2, 'units-gen2-seed538', 538)), 1, false),
    ], 'AC1 the 16 slots, steps 0 to 69');
    const frames = framesOf(played!, 'the 16 slots');
    none(drawnFailures(out, frames, 'the 16 slots'), 'the 16 slots at steps 0 to 69: the ID each slot draws and the elements each frame holds');

    // The seeds: units#3.2's is a function of (the document's seed, 3, 2) alone, and not gen 1's.
    const first = frameAt(frames, 0, 'the 16 slots');
    const seeds = elementsOf(first, 'the 16 slots').map((e) => e.seed);
    expect(new Set(seeds).size, `the 16 elements at step 0 have 16 seeds: ${seeds.join(', ')}`).toBe(SLOTS);
    const gen1 = seedOf(first, 'units#3.1', 'the 16 slots');
    const gen2Seed = seedOf(frameAt(frames, ON_AGAIN, 'the 16 slots'), 'units#3.2', 'the 16 slots');
    expect(gen2Seed, 'units#3.2 is seeded apart from units#3.1: a reused slot is a new element').not.toBe(gen1);
    const fresh = seedOf(frameAt(framesOf(ref!, 'slot 3 at gen 2 from step 0'), 0, 'slot 3 at gen 2 from step 0'), 'units#3.2', 'slot 3 at gen 2 from step 0');
    expect(gen2Seed, 'units#3.2\'s seed at step 60 is the seed units#3.2 has in a run where slot 3 holds gen 2 from step 0 (hash(seed, 3, 2), whatever the steps before)').toBe(fresh);
    const reseeded = seedOf(frameAt(framesOf(other!, 'the same at seed 538'), 0, 'the same at seed 538'), 'units#3.2', 'the same at seed 538');
    expect(reseeded, 'units#3.2\'s seed changes with the document\'s seed (hash(seed, 3, 2))').not.toBe(fresh);
  }, TIMEOUT);

  it(`${AC[1]} a selection holding units#3.1, picked at step 49, drops it at step 60's first frame`, () => {
    const { picked, frames } = selectRun();
    expect(picked, 'the click at slot 3\'s centre at step 49 picks units#3.1').toBe('units#3.1');
    none(selectionFailures(frames, picked!, 'the selection'), 'the selection of units#3.1 across the seek to step 60');
    expect(selectionOf(frameAt(frames, ON_AGAIN, 'the selection'), 'the selection'), 'at step 60\'s first frame the selection holds nothing').toEqual([]);
  }, TIMEOUT);

  it(`${AC[1]} planted instancer_addresses_by_slot keeps units#3 selected onto the new unit and fails, naming the element`, () => {
    const { picked, frames } = selectRun('instancer_addresses_by_slot');
    failsNaming(selectionFailures(frames, picked!, 'the selection under the planted instancer'), [/still holds units#3 \(/], 'the selection judge under instancer_addresses_by_slot');
  }, TIMEOUT);

  it(`${AC[1]} an instancer that takes both array columns and distribute is refused at check, naming both`, () => {
    const ev = temp();
    const program = slotsProgram(PLAN);
    putEvidence(ev, program.bytes);
    const [both, arrays] = runShow(binOf('deep-show'), scenario(ev, [DOC(1), DOC(2)], [
      showCall(DOC(1), unitsAgent(program, true)), showCall(DOC(2), unitsAgent(program, false)),
    ]), 'AC1 the refusal at check');
    expect(both!['outcome'], `the instancer with array columns and from: distribute is refused at check: ${show(both, 2500)}`).toBe('refused');
    const errors = issuesOf(both!).filter((i) => i['severity'] === 'error');
    const columns = ['live', 'gen', 'pos', 'brains.live', 'brains.gen', 'brains.pos'];
    const naming = errors.filter((e) => e['code'] !== 'unknown_field' && namesItem(e, 'units') && (names(namedIn(e), 'from') || names(namedIn(e), 'distribute')) && columns.some((c) => names(namedIn(e), c)));
    expect(naming.length, `an error, other than a field the check doesn't know, names units, its from (distribute) and its array columns, in its own fields; the errors: ${show(errors, 2500)}`).toBeGreaterThan(0);
    presented(arrays!, 'the same instancer with its array columns and no distribute');
  }, TIMEOUT);
});
