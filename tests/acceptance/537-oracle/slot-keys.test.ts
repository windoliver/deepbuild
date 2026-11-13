// AC1 #537.fdb98a26, Oracle lane: the upstream generational-key library's property test (README: Sources), re-expressed
// and run against our output. Upstream's property: random inserts, removes (a tenth of them clearing everything) and
// lookups on its slot map and on a hash map of never-reused counter keys agree at every step, so a key acts as a unique
// key and a key to a removed slot never reaches the slot's next occupant. Ours: the same random operations, drawn here
// from a fixed seed, become a logic program's pool of 8 slots (an insert spawns into a free slot under the slot's next
// generation, a remove despawns a live key's slot and a stale key's does nothing, a clear despawns every slot), and
// `view3d` draws an instancer fed by it for 180 steps. Each frame's elements (`evaluate`'s `items/pool/elements`) and
// selection (a viewer entry selecting every live element every 30 steps) must agree with the counter-key model: the live
// elements are the live keys; an element ID names one key, never reused; a lookup of a removed key finds nothing in its
// slot; and a selection holding an old generation drops it and never lands on the slot's next occupant.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, TIMEOUT, arr, binOf, column, frameAt, framesOf, logicItem, material, none, num, obj, poolProgram, prebuild, putAsset,
  requireMetal, runGpu, sessionDoc, show, str, topDown, useTemp, valueAt, view3dCall, writeJson, type Frame,
} from './helpers.ts';

prebuild(['deep-gpu']);
const temp = useTemp();

const SLOTS = 8;
const STEPS = 180;
const SELECT_EVERY = 30;
const SEEDS = [5370, 5371, 5372];
const ELEMENTS = 'items/pool/elements';

/** mulberry32: a fixed-seed generator of u32 words, standing in for upstream's generated operation lists. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
interface Key { key: number; slot: number; gen: number; born: number; died: number | null }
interface Model { table: { live: boolean; gen: number }[][]; keys: Key[]; lookups: { step: number; key: number }[] }
const idOf = (k: Key): string => `pool#${k.slot}.${k.gen}`;
const liveAt = (k: Key, step: number): boolean => k.born <= step && (k.died === null || step < k.died);
/**
 * The counter-key model: one operation per step, `(op, val)` as upstream draws them, op = op mod 3. Insert: into a free
 * slot (val picks which), under the slot's next generation, as a new counter key. Remove: one of every key ever made
 * (val picks which), a removed key removing nothing; a tenth of removes (val mod 10 = 0) clear every slot. Access: a
 * lookup of one of every key ever made, checked against the frame. The program's table holds each step's (live, gen) per
 * slot, a slot never used (false, 0).
 */
function plan(seed: number): Model {
  const next = rng(seed);
  const gens = Array.from({ length: SLOTS }, () => 0);
  const occupant: (number | null)[] = Array.from({ length: SLOTS }, () => null);
  const keys: Key[] = [];
  const lookups: { step: number; key: number }[] = [];
  const table: { live: boolean; gen: number }[][] = [];
  for (let step = 0; step < STEPS; step++) {
    const [op, val] = [next() % 3, next()];
    if (op === 0) {
      const free = occupant.flatMap((o, s) => (o === null ? [s] : []));
      if (free.length) {
        const s = free[val % free.length]!;
        gens[s]! += 1;
        keys.push({ key: keys.length, slot: s, gen: gens[s]!, born: step, died: null });
        occupant[s] = keys.length - 1;
      }
    } else if (op === 1) {
      if (val % 10 === 0) {
        for (let s = 0; s < SLOTS; s++) if (occupant[s] !== null) { keys[occupant[s]!]!.died = step; occupant[s] = null; }
      } else if (keys.length) {
        const k = keys[val % keys.length]!;
        if (k.died === null) { occupant[k.slot] = null; k.died = step; }
      }
    } else if (keys.length) {
      lookups.push({ step, key: val % keys.length });
    }
    table.push(occupant.map((o, s) => ({ live: o !== null, gen: o === null ? gens[s]! : keys[o]!.gen })));
  }
  return { table, keys, lookups };
}
/** What a frame shows: its elements' IDs (with their slot and gen) and its selection. */
interface Seen { elements: { id: string; slot: number; gen: number }[]; selection: string[] }
/** The selection the view holds at each step: every 30 steps a viewer entry selects every live element by its ID. */
const selectedAt = (m: Model, step: number): string[] => m.keys.filter((k) => liveAt(k, step - (step % SELECT_EVERY))).map(idOf);

/** The re-expressed property, held to what our frames show at each step. */
function propertyFailures(m: Model, seen: Seen[]): string[] {
  const out: string[] = [];
  const owner = new Map<string, number>();
  for (let step = 0; step < STEPS; step++) {
    const live = m.keys.filter((k) => liveAt(k, step));
    const shown = seen[step]!;
    // The live elements are the live keys (upstream's contains_key and the final values agree).
    const want = live.map(idOf).sort();
    const got = shown.elements.map((e) => e.id).sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`step ${step}: the elements ${JSON.stringify(got)} aren't the live keys' ${JSON.stringify(want)}`);
    for (const e of shown.elements) {
      if (e.id !== `pool#${e.slot}.${e.gen}`) out.push(`step ${step}: element ${e.id} is reported at slot ${e.slot}, gen ${e.gen}`);
      // An element ID names one key: the key living in its slot now, never one before it.
      const k = live.find((x) => x.slot === e.slot);
      if (!k) continue;
      const before = owner.get(e.id);
      if (before !== undefined && before !== k.key) out.push(`step ${step}: element ID ${e.id} names key ${k.key} (born at step ${k.born}) after naming key ${before}: an element ID reused`);
      owner.set(e.id, k.key);
    }
    // A selection holding an old generation never lands on the slot's next occupant.
    const wantSel = selectedAt(m, step).filter((id) => live.some((k) => idOf(k) === id)).sort();
    const gotSel = [...shown.selection].sort();
    if (JSON.stringify(gotSel) !== JSON.stringify(wantSel)) {
      const stale = gotSel.filter((id) => !wantSel.includes(id));
      out.push(`step ${step}: the selection holds ${JSON.stringify(gotSel)}, not ${JSON.stringify(wantSel)}${stale.length ? `; ${stale.join(', ')} no longer name a live element` : ''}`);
    }
  }
  // A lookup of a removed key finds nothing, and never the slot's next occupant (upstream's access op).
  for (const { step, key } of m.lookups) {
    const k = m.keys[key]!;
    const atSlot = seen[step]!.elements.find((e) => e.slot === k.slot);
    if (liveAt(k, step) && atSlot?.id !== idOf(k)) out.push(`step ${step}: a lookup of live key ${key} (${idOf(k)}) finds ${atSlot?.id ?? 'nothing'} in slot ${k.slot}`);
    if (!liveAt(k, step) && atSlot?.id === idOf(k)) out.push(`step ${step}: a lookup of key ${key} (${idOf(k)}), removed at step ${k.died}, still finds ${atSlot.id} in slot ${k.slot}`);
  }
  return out;
}
/** What the model says each step shows: the honest program, and two wrong ones the property must fail. */
function synthetic(m: Model, kind: 'honest' | 'slot_alone' | 'selection_keeps_slot'): Seen[] {
  return Array.from({ length: STEPS }, (_, step) => {
    const live = m.keys.filter((k) => liveAt(k, step));
    const name = (k: Key): string => (kind === 'slot_alone' ? `pool#${k.slot}` : idOf(k));
    const selected = m.keys.filter((k) => liveAt(k, step - (step % SELECT_EVERY)));
    const selection = kind === 'honest' ? selected.filter((k) => liveAt(k, step)).map(idOf)
      : selected.flatMap((k) => { const now = live.find((x) => x.slot === k.slot); return now ? [kind === 'slot_alone' ? `pool#${k.slot}` : idOf(now)] : []; });
    return { elements: live.map((k) => ({ id: name(k), slot: k.slot, gen: k.gen })), selection };
  });
}

describe(`${AC[1]} Oracle lane: the upstream generational-key property, random spawns, despawns and slot reuse, run against our frames`, () => {
  it(`${AC[1]} element IDs act as never-reused keys and a selection holding an old generation never lands on the slot's next occupant, over random operations`, () => {
    // The property's judge fails the wrong programs it names, and passes the model's own frames.
    for (const seed of SEEDS) {
      const m = plan(seed);
      expect(m.keys.some((k) => m.keys.some((o) => o !== k && o.slot === k.slot && o.born > k.born)), `seed ${seed}: the operations reuse a slot under a new generation`).toBe(true);
      expect(m.lookups.some(({ step, key }) => !liveAt(m.keys[key]!, step) && m.keys.some((o) => o.slot === m.keys[key]!.slot && liveAt(o, step))), `seed ${seed}: a lookup asks for a removed key whose slot holds a new occupant`).toBe(true);
      none(propertyFailures(m, synthetic(m, 'honest')), `seed ${seed}: the model's own frames`);
      expect(propertyFailures(m, synthetic(m, 'slot_alone')).length, `seed ${seed}: the judge fails elements addressed by slot alone`).toBeGreaterThan(0);
      expect(propertyFailures(m, synthetic(m, 'selection_keeps_slot')).some((f) => /no longer name a live element|holds/.test(f)), `seed ${seed}: the judge fails a selection that follows its slot`).toBe(true);
    }

    requireMetal();
    const out = temp();
    const models = SEEDS.map(plan);
    const programs = models.map((m, i) => poolProgram(`pool-${SEEDS[i]}`, m.table));
    const assets = Object.assign({}, ...programs.map((p) => putAsset(out, p.bytes, 'wasm'))) as Record<string, string>;
    const calls = models.map((m, i) => {
      const doc = sessionDoc(`pool-${SEEDS[i]}`, [128, 128], {
        cam: topDown([3, 0, 1], 12), sky: DARK_SKY, paint: material({ base_color: [0.9, 0.9, 0.2, 1], unlit: true }),
        pebble: { kind: 'mark.box@1', params: { size: [1, 1, 1] }, material: 'paint', visible: false },
        keeper: logicItem(programs[i]!, [['live', 'bool', SLOTS], ['gen', 'i32', SLOTS], ['pos', 'vec3', SLOTS]]),
        pool: { kind: 'instance@1', params: { of: ['pebble'], live: column('keeper.live', 'bool'), gen: column('keeper.gen', 'u32'), pos: column('keeper.pos', 'f32') } },
      });
      const viewer = Array.from({ length: STEPS / SELECT_EVERY }, (_, j) => ({ frame: j * SELECT_EVERY, selection: m.keys.filter((k) => liveAt(k, j * SELECT_EVERY)).map(idOf) }));
      return view3dCall({ doc: writeJson(out, `pool-${SEEDS[i]}`, doc), size: [128, 128], frames: STEPS, evaluate: [ELEMENTS], viewer, assets });
    });
    const replies = runGpu(binOf('deep-gpu'), out, calls, 'the oracle lane\'s pools');
    const failures: string[] = [];
    replies.forEach((r, i) => {
      const what = `seed ${SEEDS[i]}`;
      const frames = framesOf(r, what);
      const seen: Seen[] = Array.from({ length: STEPS }, (_, step) => {
        const f: Frame = frameAt(frames, step, what);
        const elements = arr(valueAt(f, ELEMENTS, what), `${what}: step ${step}'s ${ELEMENTS}`).map((v) => {
          const e = obj(v, `${what}: an element`);
          return { id: str(e['id'], 'id'), slot: num(e['slot'], 'slot'), gen: num(e['gen'], 'gen') };
        });
        const selection = arr(f.raw['selection'], `${what}: step ${step}'s selection: ${show(f.raw, 300)}`).map((x) => str(x, 'a selected ID'));
        return { elements, selection };
      });
      failures.push(...propertyFailures(models[i]!, seen).slice(0, 10).map((x) => `${what}: ${x}`));
    });
    none(failures, 'the property over three random runs of 180 steps');
  }, TIMEOUT);
});
